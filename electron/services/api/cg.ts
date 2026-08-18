import type { GameGallery, GameGalleryImage, GalleryItem } from '../../../../shared/types'
import { getExt, saveExternalLink } from '../db/repositories/externalLinks.repository'
import { getCachedGallery, cacheGallery } from '../db/repositories/gallery.repository'
import { setSubjectVndbRating, findCached } from '../db/repositories/subjects.repository'
import { getSetting } from '../db/repositories/settings.repository'
import { getVnScreenshots, searchVndb, VNDB_UA } from './vndb'
import { getSubjectDetail } from './bangumi'

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

/** 遍历 Bangumi infobox（可能嵌套 数组/对象，链接藏在 value 的 v/k 字段），收集所有外链 URL */
function collectInfoboxUrls(infobox: any): string[] {
  const urls: string[] = []
  const walk = (node: any) => {
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node)) urls.push(node)
    } else if (Array.isArray(node)) {
      node.forEach(walk)
    } else if (node && typeof node === 'object') {
      if (typeof node.v === 'string') urls.push(node.v)
      if (typeof node.k === 'string' && /^https?:\/\//i.test(node.k)) urls.push(node.k)
      for (const k of Object.keys(node)) if (k !== 'v' && k !== 'k') walk(node[k])
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

// ---------- VNDB 截图（主力图源） ----------

async function fetchVndbScreenshots(
  vndbId: string,
  token?: string
): Promise<{ images: GameGalleryImage[]; rating?: number; ratingCount?: number }> {
  try {
    const { shots, rating, ratingCount } = await getVnScreenshots(vndbId, token)
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

/** 仅探测样例 CG（_img_smp{n}），不含主封面图。
 *  顺序探测：先试 _img_smpa{n}，失败回退 _img_smp{n}；遇到连续缺失即停止（与组件一致）。 */
async function probeDlsiteImages(id: string): Promise<GameGalleryImage[]> {
  const out: GameGalleryImage[] = []
  for (let n = 1; n <= 20; n++) {
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
  const viaWorker = await fetchSteamViaWorker(appId)
  if (viaWorker && viaWorker.length) return viaWorker
  return fetchSteamAppDetails(appId)
}

// ---------- 标题兜底检索（外链缺失时尽量补全） ----------

async function searchSteamByTitle(query: string): Promise<string | null> {
  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
      query
    )}&l=schinese&cc=CN`
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!res.ok) return null
    const json = (await res.json()) as { items?: { id?: number | string }[] }
    const item = json.items?.[0]
    return item?.id != null ? String(item.id) : null
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
  const title = subj?.title_cn || subj?.title

  // 1) 优先从 Bangumi 条目 infobox 取真实外链（对齐组件）
  let links = { vndb: null as string | null, dlsite: null as string | null, steam: null as string | null }
  try {
    const detail = await getSubjectDetail(providerId)
    links = parseBangumiInfoboxLinks(detail?.infobox)
    if (localId != null) {
      if (links.vndb) await saveExternalLink(localId, 'vndb', links.vndb)
      if (links.dlsite) await saveExternalLink(localId, 'dlsite', links.dlsite)
      if (links.steam) await saveExternalLink(localId, 'steam', links.steam)
    }
  } catch (e) {
    console.warn('[cg] 解析 Bangumi infobox 外链失败（回退已有/检索）：', e)
  }

  // 2) 缺失的来源：先用已存外链，再按标题兜底检索
  let vndbId = links.vndb || (localId != null ? await getExt(localId, 'vndb') : null)
  let dlsiteId = links.dlsite || (localId != null ? await getExt(localId, 'dlsite') : null)
  let steamId = links.steam || (localId != null ? await getExt(localId, 'steam') : null)

  if (!vndbId && (subj?.title || subj?.title_cn)) {
    // VNDB 标题多为原名（日文/英文），优先用原名，其次中文名，提高命中率
    const candidates = [subj?.title, subj?.title_cn].filter(Boolean) as string[]
    for (const q of candidates) {
      try {
        const hits = await searchVndb(q, vndbToken)
        if (hits.length) {
          vndbId = String(hits[0].id)
          if (localId != null) await saveExternalLink(localId, 'vndb', vndbId)
          break
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (!dlsiteId && title) {
    const id = await searchDlsiteByTitle(title)
    if (id) {
      dlsiteId = id
      if (localId != null) await saveExternalLink(localId, 'dlsite', id)
    }
  }
  if (!steamId && title) {
    const id = await searchSteamByTitle(title)
    if (id) {
      steamId = id
      if (localId != null) await saveExternalLink(localId, 'steam', id)
    }
  }

  // 3) 并行抓取三个来源（各自容错，单源失败不影响其它）
  const [vndb, dlsite, steam] = await Promise.all([
    vndbId
      ? fetchVndbScreenshots(vndbId, vndbToken)
      : Promise.resolve({ images: [] as GameGalleryImage[], rating: undefined, ratingCount: undefined }),
    dlsiteId ? probeDlsiteImages(dlsiteId) : Promise.resolve([] as GameGalleryImage[]),
    steamId ? fetchSteamScreenshots(steamId) : Promise.resolve([] as GameGalleryImage[])
  ])

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
