import type { GameGallery, GameGalleryImage, GalleryItem } from '../../../../shared/types'
import { getExt, saveExternalLink } from '../db/repositories/externalLinks.repository'
import { getCachedGallery, cacheGallery } from '../db/repositories/gallery.repository'
import { setSubjectVndbRating, findCached } from '../db/repositories/subjects.repository'
import { getSetting } from '../db/repositories/settings.repository'
import { getVnScreenshots, searchVndb, VNDB_UA } from './vndb'
import { getSubjectDetail } from './bangumi'
import { getArchiveRawInfo } from '../archive/archive.service'

const UA = VNDB_UA

/** 复刻 Bangumi「游戏画廊」超合金组件的核心逻辑。
 *  数据以 Bangumi 为主：从 Bangumi 条目 infobox 的真实外链提取 VNDB / DLsite / Steam id，
 *  再分别抓取真实游戏截图：
 *    - VNDB screenshots（游戏内 CG，带 sexual/violence 分级 → R18 过滤）—— 主力图源
 *    - DLsite 直链探测（img.dlsite.jp 的 _img_main / _img_smpa{n} / _img_smp{n}）
 *    - Steam 商店截图（走组件作者提供的 Cloudflare worker 代理，回退官方 appdetails）
 *  所有图片只存远程 URL，不下载到本地。
 */

const STEAM_WORKER_BASE = 'https://bangumi-steam-gallery.ry.mk'
const SOURCE_TIMEOUT_MS = 10000
const DLSITE_IMAGE_TIMEOUT_MS = 4000
/** 三源并装抓取的整体预算：任一源拖太久直接以「已拿到的」返回，避免画廊一直转圈 */
const GALLERY_FETCH_BUDGET_MS = 15000
/** DLsite 探测整体预算：逐张 HEAD 太慢时提前放弃，避免长时间转圈 */
const DLSITE_PROBE_BUDGET_MS = 9000

/** 给 Promise 加整体超时：超时返回 fallback（不 abort 底层请求，但上层不再等待） */
function withBudget<T>(p: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
  ])
}

// ---------- 从 URL 抽取各类 id（与组件正则一致） ----------

function extractVndbId(href: string): string | null {
  const m = (href || '').match(/vndb\.org\/(v\d+)/i)
  return m ? m[1] : null
}
function extractDlsiteId(href: string): string | null {
  const m = (href || '').match(/product_id\/((?:RJ|VJ|BJ)\d+)/i)
  return m ? m[1].toUpperCase() : null
}
function extractSteamAppId(href: string): string | null {
  const m = (href || '').match(/store\.steampowered\.com\/(?:agecheck\/)?app\/(\d+)/i)
  return m ? m[1] : null
}

/** 遍历 Bangumi infobox（可能嵌套 数组/对象，链接藏在 value 的 v/k 字段），收集所有外链 URL。
 *  k/v 字段都收集（不强制 https:// 前缀）：Bangumi 链接常写作无协议的裸链接（如 vndb.org/v123），
 *  显示名等普通文本由 extract* 正则天然过滤，无害。 */
function collectInfoboxUrls(infobox: any): string[] {
  const urls: string[] = []
  const walk = (node: any) => {
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node)) urls.push(node)
    } else if (Array.isArray(node)) {
      node.forEach(walk)
    } else if (node && typeof node === 'object') {
      if (typeof node.v === 'string' && node.v.trim()) urls.push(node.v.trim())
      if (typeof node.k === 'string' && node.k.trim()) urls.push(node.k.trim())
      for (const key of Object.keys(node)) if (key !== 'v' && key !== 'k') walk(node[key])
    }
  }
  walk(infobox)
  return urls
}

/** 从 Bangumi infobox 解析出 VNDB / DLsite / Steam 外链（对齐组件从 #infobox a[href*=...] 取链接） */
export function parseBangumiInfoboxLinks(infobox: any): {
  vndb: string | null
  dlsite: string | null
  steam: string | null
} {
  const urls = collectInfoboxUrls(infobox)
  let vndb: string | null = null
  let dlsite: string | null = null
  let steam: string | null = null
  for (const u of urls) {
    if (!vndb) vndb = extractVndbId(u)
    if (!dlsite) dlsite = extractDlsiteId(u)
    if (!steam) steam = extractSteamAppId(u)
  }
  return { vndb, dlsite, steam }
}

/** 从任意文本（如离线 Archive 的 raw infobox 或网页 HTML）提取 VNDB / DLsite / Steam 外链。
 *  对齐网页插件「扫描 infobox 内 href 链接」的做法，作为在线解析失败的离线兜底。
 *  同时匹配「带协议」与「无协议」两种写法：Archive infobox 里的链接常为无 https:// 的裸链接。 */
export function parseLinksFromText(text: string): {
  vndb: string | null
  dlsite: string | null
  steam: string | null
} {
  const out = { vndb: null as string | null, dlsite: null as string | null, steam: null as string | null }
  if (!text) return out
  // ① 带协议 URL
  const urls = text.match(/https?:\/\/[^\s"'<>\]\[|\\]+/gi) ?? []
  for (const u of urls) {
    if (!out.vndb) out.vndb = extractVndbId(u)
    if (!out.dlsite) out.dlsite = extractDlsiteId(u)
    if (!out.steam) out.steam = extractSteamAppId(u)
    if (out.vndb && out.dlsite && out.steam) return out
  }
  // ② 无协议裸链接（Archive infobox 常见写法）：直接按站点模式从整段文本抓
  const bare = [
    ...(text.match(/vndb\.org\/v\d+/gi) ?? []),
    ...(text.match(/(?:www\.)?dlsite\.com[^\s"'<>\]\[|\\]*?product_id\/(RJ|VJ|BJ)\d+/gi) ?? []),
    ...(text.match(/(?:store\.steampowered\.com\/(?:agecheck\/)?app\/\d+|steamdb\.info\/app\/\d+)/gi) ?? [])
  ]
  for (const u of bare) {
    if (!out.vndb) out.vndb = extractVndbId(u)
    if (!out.dlsite) out.dlsite = extractDlsiteId(u)
    if (!out.steam) out.steam = extractSteamAppId(u)
    if (out.vndb && out.dlsite && out.steam) break
  }
  return out
}

// ---------- VNDB 截图（主力图源） ----------

async function fetchVndbScreenshots(
  vndbId: string,
  token?: string
): Promise<{ images: GameGalleryImage[]; rating?: number; ratingCount?: number }> {
  try {
    const { shots, rating, ratingCount } = await withBudget(
      getVnScreenshots(vndbId, token),
      SOURCE_TIMEOUT_MS,
      { shots: [], rating: undefined, ratingCount: undefined }
    )
    return {
      images: shots.map((s) => ({ url: s.url, thumb: s.thumb, caption: 'CG', nsfw: s.nsfw })),
      rating,
      ratingCount
    }
  } catch (e) {
    console.warn('[cg] VNDB 截图抓取失败：', e)
    return { images: [], rating: undefined, ratingCount: undefined }
  }
}

// ---------- DLsite 直链探测（复刻组件 probeDlsiteImages） ----------

function buildDlsiteImageUrl(id: string, suffix: string): string {
  const prefix = id.slice(0, 2) // RJ / VJ / BJ
  const digits = id.slice(2)
  const folderNum = Math.ceil(parseInt(digits, 10) / 1000) * 1000
  let padded = String(folderNum)
  while (padded.length < digits.length) padded = '0' + padded
  const kind = prefix === 'RJ' ? 'doujin' : 'professional'
  return `https://img.dlsite.jp/modpub/images2/work/${kind}/${prefix}${padded}/${id}${suffix}`
}

/** 仅探测存在性（不下载图片体），超时/失败视为不存在 */
async function dlsiteImageExists(url: string): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), DLSITE_IMAGE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Referer: 'https://www.dlsite.com/' },
      signal: ctrl.signal
    })
    // 取消响应体，避免真的把图片下载下来
    if (res.body) await res.body.cancel().catch(() => {})
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 仅探测样例 CG（_img_smp{n}）+ 主封面（_img_main）。
 *  （参考网页插件：先探测主封面 _img_main，再顺序试 _img_smpa{n}/_img_smp{n}，连续缺失即停止。）
 *  受 DLSITE_PROBE_BUDGET_MS 整体时间预算约束：达到预算立刻返回已探测到的，避免长期转圈。 */
async function probeDlsiteImages(id: string): Promise<GameGalleryImage[]> {
  const out: GameGalleryImage[] = []
  const start = Date.now()
  // ① 主封面图（插件第一张即 _img_main；仅商店样例图缺失时也能拿到封面）
  const mainUrl = buildDlsiteImageUrl(id, '_img_main.webp')
  if (await dlsiteImageExists(mainUrl)) out.push({ url: mainUrl, caption: 'CG' })
  // ② 样例图顺序探测（_img_smpa{n} / _img_smp{n}，连续缺失即停止）
  for (let n = 1; n <= 20; n++) {
    if (Date.now() - start > DLSITE_PROBE_BUDGET_MS) break
    let url = buildDlsiteImageUrl(id, `_img_smpa${n}.webp`)
    if (!(await dlsiteImageExists(url))) {
      url = buildDlsiteImageUrl(id, `_img_smp${n}.webp`)
      if (!(await dlsiteImageExists(url))) break // 连续缺失 → 停止探测
    }
    out.push({ url, caption: 'CG' })
  }
  return out
}

// ---------- Steam 截图（worker 代理 + 官方 appdetails 回退） ----------

async function fetchSteamViaWorker(appId: string): Promise<GameGalleryImage[] | null> {
  try {
    const res = await fetch(
      `${STEAM_WORKER_BASE}/v1/steam/apps/${encodeURIComponent(appId)}/screenshots`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } }
    )
    if (!res.ok) return null
    const json = (await res.json()) as { screenshots?: { thumbnail: string; full: string }[] }
    const shots = (json.screenshots ?? []).filter(
      (s) => typeof s?.thumbnail === 'string' && typeof s?.full === 'string'
    )
    if (!shots.length) return null
    return shots.map((s) => ({ url: s.full, thumb: s.thumbnail, caption: '截图' }))
  } catch (e) {
    console.warn('[cg] Steam worker 代理失败，回退官方 appdetails：', e)
    return null
  }
}

/** 官方 appdetails（匿名可用），作为 worker 代理的兜底 */
async function fetchSteamAppDetails(appId: string): Promise<GameGalleryImage[]> {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(
      appId
    )}&cc=cn&l=schinese&filters=basic,screenshots`
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!res.ok) return []
    const json = (await res.json()) as Record<string, any>
    const entry = json[appId]
    if (!entry || !entry.success || !entry.data) return []
    const out: GameGalleryImage[] = []
    // 仅取游戏内截图，不含商店头图（用户不需要封面）
    for (const s of entry.data.screenshots ?? []) {
      if (s?.path_full) out.push({ url: s.path_full, thumb: s.path_thumbnail, caption: '截图' })
    }
    return out
  } catch (e) {
    console.warn('[cg] Steam appdetails 回退失败：', e)
    return []
  }
}

async function fetchSteamScreenshots(appId: string): Promise<GameGalleryImage[]> {
  return withBudget(
    (async () => {
      const viaWorker = await fetchSteamViaWorker(appId)
      if (viaWorker && viaWorker.length) return viaWorker
      return fetchSteamAppDetails(appId)
    })(),
    SOURCE_TIMEOUT_MS,
    [] as GameGalleryImage[]
  )
}

// ---------- 标题兜底检索（外链缺失时尽量补全） ----------

/** 标题规范化：小写 + 去空白/标点，用于跨站标题比对（容忍 ・！？（） 全半角差异） */
function normTitle(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[\s・·、，,。.．!！?？（）()【】\[\]「」『』:：/\\"'`~+＋-]+/g, '')
}

/** 按标题兜底检索 Steam：优先「规范化精确命中」；退而求其次「名称包含关系」（取最长的）；
 *  都没有把握时返回 null（宁可不配 Steam，也不串到别的游戏）。 */
async function searchSteamByTitle(query: string): Promise<string | null> {
  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
      query
    )}&l=schinese&cc=CN`
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!res.ok) return null
    const json = (await res.json()) as { items?: { id?: number | string; name?: string }[] }
    const items = json.items ?? []
    if (!items.length) return null
    const qn = normTitle(query)
    const exact = items.find((it) => it?.name && normTitle(it.name) === qn)
    if (exact?.id != null) return String(exact.id)
    const byContains = items
      .filter((it) => it?.name && (normTitle(it.name).includes(qn) || qn.includes(normTitle(it.name))))
      .sort((a, b) => normTitle(b.name ?? '').length - normTitle(a.name ?? '').length)
    if (byContains[0]?.id != null) return String(byContains[0].id)
    return null
  } catch {
    return null
  }
}

async function searchDlsiteByTitle(query: string): Promise<string | null> {
  try {
    const url = `https://www.dlsite.com/maniax/product/search/?word=${encodeURIComponent(
      query
    )}&age_check=1&sex_category=all&order=popular`
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } })
    if (!res.ok) return null
    const html = await res.text()
    const m =
      html.match(/\/work\/\/=\/product_id\/(RJ\d+|BJ\d+|VJ\d+)/i) ||
      html.match(/product_id\/(RJ\d+|BJ\d+|VJ\d+)/i)
    return m ? m[1].toUpperCase() : null
  } catch {
    return null
  }
}

// ---------- 缓存结构化画廊 ----------

function reconstructGameGallery(subjectId: number, flat: GalleryItem[]): GameGallery {
  const g: GameGallery = { vndb: [], dlsite: [], steam: [], defaultSource: 'dlsite' }
  for (const it of flat) {
    const img: GameGalleryImage = { url: it.url, thumb: it.thumb, caption: it.caption, nsfw: it.nsfw }
    if (it.source === 'vndb') g.vndb.push(img)
    else if (it.source === 'dlsite') g.dlsite.push(img)
    else if (it.source === 'steam') g.steam.push(img)
  }
  g.defaultSource = g.vndb.length ? 'vndb' : g.dlsite.length ? 'dlsite' : 'steam'
  return g
}

function flattenGallery(g: GameGallery): GalleryItem[] {
  const out: GalleryItem[] = []
  for (const s of ['vndb', 'dlsite', 'steam'] as const) {
    for (const img of g[s]) out.push({ source: s, url: img.url, thumb: img.thumb, caption: img.caption, nsfw: img.nsfw })
  }
  return out
}

// ---------- 主入口 ----------

export async function getGalleryForSubject(
  subjectId: number | string,
  force = false
): Promise<GameGallery> {
  // 入参统一为 Bangumi provider id（全局唯一）。先反查本地行拿到本地主键：
  // 渲染层（SubjectCard 的 detailFull / GalgameView 的 detailLocal）给出的 id 可能是
  // provider id，直接按本地主键查会错位到其它作品（串图）。故统一以 provider id 解析。
  const providerId = String(subjectId)
  const subj = await findCached('bangumi', providerId)
  const localId = typeof subj?.id === 'number' ? subj.id : null

  if (!force && localId != null) {
    const cached = await getCachedGallery(localId)
    if (cached.length) {
      const g = reconstructGameGallery(localId, cached)
      if (subj && typeof subj.vndb_rating === 'number') {
        g.vndbRating = subj.vndb_rating
        g.vndbRatingCount =
          typeof subj.vndb_rating_count === 'number' ? subj.vndb_rating_count : undefined
      }
      return g
    }
  }

  const vndbToken = (await getSetting('vndb_token')) || undefined

  // 1) 优先从 Bangumi 条目 infobox 取真实外链（对齐组件）
  let links = { vndb: null as string | null, dlsite: null as string | null, steam: null as string | null }
  try {
    // bgm api 不可达时 safeFetch 会逐策略等待，这里再加 10s 预算，避免画廊被卡住几十秒才降级
    const detail = await withBudget(getSubjectDetail(providerId), SOURCE_TIMEOUT_MS, null as any)
    links = parseBangumiInfoboxLinks(detail?.infobox)
    if (localId != null) {
      if (links.vndb) await saveExternalLink(localId, 'vndb', links.vndb)
      if (links.dlsite) await saveExternalLink(localId, 'dlsite', links.dlsite)
      if (links.steam) await saveExternalLink(localId, 'steam', links.steam)
    }
  } catch (e) {
    console.warn('[cg] 解析 Bangumi infobox 外链失败（回退已有/检索）：', e)
  }
  // 在线 infobox 未取到（限流/网络/无外链）→ 依次兜底：
  //   ① 本地 subjects.infobox 列（详情页联网补全写回的 meta，常含 VNDB/DLsite/Steam 链接，免联网）
  //   ② 离线 Archive raw infobox（与网页插件「读页面 infobox 链接」等价）
  if (!links.vndb && !links.dlsite && !links.steam) {
    try {
      // ① 本地已缓存的 meta（JSON 字符串，链接在 value 里以 URL 文本存在）
      const localRaw = subj?.infobox ? (typeof subj.infobox === 'string' ? subj.infobox : JSON.stringify(subj.infobox)) : ''
      const localLinks = parseLinksFromText(localRaw)
      if (localLinks.vndb || localLinks.dlsite || localLinks.steam) {
        links = { ...links, ...localLinks }
        if (localId != null) {
          if (links.vndb) await saveExternalLink(localId, 'vndb', links.vndb)
          if (links.dlsite) await saveExternalLink(localId, 'dlsite', links.dlsite)
          if (links.steam) await saveExternalLink(localId, 'steam', links.steam)
        }
      }
    } catch (e) {
      console.warn('[cg] 本地 infobox 外链提取失败（忽略）：', e)
    }
  }
  if (!links.vndb && !links.dlsite && !links.steam) {
    try {
      const raw = await getArchiveRawInfo(Number(providerId))
      const offline = parseLinksFromText(raw ?? '')
      if (offline.vndb || offline.dlsite || offline.steam) {
        links = { ...links, ...offline }
        if (localId != null) {
          if (links.vndb) await saveExternalLink(localId, 'vndb', links.vndb)
          if (links.dlsite) await saveExternalLink(localId, 'dlsite', links.dlsite)
          if (links.steam) await saveExternalLink(localId, 'steam', links.steam)
        }
      }
    } catch (e) {
      console.warn('[cg] 离线 Archive infobox 外链提取失败（忽略）：', e)
    }
  }

  // 2) 缺失的来源：先用已存外链，再按标题兜底检索
  let vndbId = links.vndb || (localId != null ? await getExt(localId, 'vndb') : null)
  let dlsiteId = links.dlsite || (localId != null ? await getExt(localId, 'dlsite') : null)
  let steamId = links.steam || (localId != null ? await getExt(localId, 'steam') : null)

  if (!vndbId && (subj?.title || subj?.title_cn)) {
    // VNDB 标题多为原名（日文/英文），**优先用 Bangumi 的日文原名 subj.title 去匹配 VNDB 的 title**，
    // 中文译名次之。匹配时做规范化（小写、去空白、去常见标点），容忍全半角/符号/后缀差异。
    // - 规范化后精确命中（title / alttitle 与候选一致）→ 可信，持久化外链（防串图固化）；
    // - 未精确命中 → 用首个结果 id「仅当次使用、不持久化」，保底出 CG（不把不确定 id 固化）。
    const candidates = [subj?.title, subj?.title_cn].filter(Boolean) as string[]
    outer: for (const q of candidates) {
      try {
        const hits = await searchVndb(q, vndbToken)
        if (!hits.length) continue
        const qn = normTitle(q)
        const exact = hits.find((h: any) => {
          const t = normTitle(String(h?.title ?? ''))
          const a = normTitle(String(h?.alttitle ?? ''))
          return t === qn || (a !== '' && a === qn)
        })
        if (exact != null) {
          vndbId = String(exact.id)
          if (localId != null) await saveExternalLink(localId, 'vndb', vndbId)
          break outer
        }
        // 无精确命中：首个结果当次使用，不持久化（避免把不确定的 id 固化）
        vndbId = String(hits[0].id)
        break outer
      } catch {
        /* ignore */
      }
    }
  }
  // DLsite / Steam 标题兜底：优先用原文（subj.title），中文次之；结果仅当次使用、不持久化
  if (!dlsiteId) {
    for (const q of [subj?.title, subj?.title_cn].filter(Boolean) as string[]) {
      const id = await searchDlsiteByTitle(q)
      if (id) {
        dlsiteId = id
        break
      }
    }
  }
  if (!steamId) {
    for (const q of [subj?.title, subj?.title_cn].filter(Boolean) as string[]) {
      const id = await searchSteamByTitle(q)
      if (id) {
        steamId = id
        break
      }
    }
  }

  // 3) 并行抓取三个来源（各自容错，单源失败不影响其它；整体受 GALLERY_FETCH_BUDGET_MS 预算约束，
  //    任一向拖太久时直接以「已拿到的」返回，避免画廊长期转圈）
  const emptyVndb = Promise.resolve({ images: [] as GameGalleryImage[], rating: undefined, ratingCount: undefined })
  const [vndb, dlsite, steam] = await withBudget(
    Promise.all([
      vndbId
        ? fetchVndbScreenshots(vndbId, vndbToken)
        : emptyVndb,
      dlsiteId ? probeDlsiteImages(dlsiteId) : Promise.resolve([] as GameGalleryImage[]),
      steamId ? fetchSteamScreenshots(steamId) : Promise.resolve([] as GameGalleryImage[])
    ]),
    GALLERY_FETCH_BUDGET_MS,
    [{ images: [] as GameGalleryImage[], rating: undefined, ratingCount: undefined }, [] as GameGalleryImage[], [] as GameGalleryImage[]]
  )

  // 写回 VNDB 评分（Galgame 区展示 + 离线缓存），仅当有值时更新
  if (vndb.rating != null && localId != null) {
    try {
      await setSubjectVndbRating(localId, vndb.rating, vndb.ratingCount ?? null)
    } catch (e) {
      console.warn('[cg] 写回 VNDB 评分失败（忽略）：', e)
    }
  }

  const gallery: GameGallery = {
    vndb: vndb.images,
    dlsite,
    steam,
    defaultSource: vndb.images.length ? 'vndb' : dlsite.length ? 'dlsite' : 'steam',
    vndbRating: vndb.rating,
    vndbRatingCount: vndb.ratingCount
  }

  if (localId != null) await cacheGallery(localId, flattenGallery(gallery))
  return gallery
}
