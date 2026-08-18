import { getDb } from '../connection'
import { getValidToken } from '../../auth/oauth'
import { getSubjectCharacters, getSubjectRelations } from '../../api/bangumi'
import { getArchiveExtra, getArchiveMeta } from '../../archive/archive.service'
import { categoryToBgmType } from '../../archive/constants'
import type { SubjectCharacter, SubjectRelation } from '../../../../shared/types'

/**
 * 角色与关联作品的本地缓存 + 在线补全。
 * 两张表分别缓存：subject_characters / subject_relations，离线可读、在线补全后写回。
 */

/**
 * 判断一条缓存的图片是否为「可用」地址。
 * acgn-img:// 是早期失效的代理协议（渲染端拉不到图），一旦缓存里残留该前缀，
 * 必须当作无图重新向 Bangumi 补直连 URL，否则会一直空白。
 */
function usableImage(img?: string): boolean {
  return !!img && !img.startsWith('acgn-img://')
}

/** 旧库可能缺少 name_cn 列：探测后按需 ALTER（幂等），避免「duplicate column」直接抛错。 */
function addColumnIfMissing(db: any, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
  if (!cols.some((c: any) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

/**
 * 合并 CV：优先「真正取到中文」的一侧，避免限流回退的原名覆盖已缓存的中文名。
 * 若两侧都没中文，保留新抓到的（原名）即可。
 */
function mergeActors(fresh: any[] | undefined, cached: any[] | undefined): any[] {
  if (!fresh || !fresh.length) return cached || []
  if (!cached || !cached.length) return fresh
  const cm = new Map<number, any>(
    (cached as any[]).filter((x) => typeof x.id === 'number').map((x) => [x.id, x])
  )
  return fresh.map((a: any) => {
    const c = a.id != null ? cm.get(a.id) : undefined
    if (!c) return a
    const freshCn = (a.nameCn && a.nameCn.trim()) || ''
    const cachedCn = (c.nameCn && c.nameCn.trim()) || ''
    return {
      ...a,
      name: freshCn ? a.name : cachedCn ? c.name : a.name || c.name,
      nameCn: freshCn || cachedCn
    }
  })
}

/**
 * 按 id 把「中文名补丁」合并进基础列表（角色或关联条目）。
 * 优先顺序：补丁的中文名(nameCn) > 基础列表已有中文名 > 都不带则保留原名。
 * 补丁的 name 应为「中文优先」展示名（getArchiveExtra / getSubjectCharacters 均已如此）。
 * 仅当有变化时标记 changed，避免无谓写库与推送。
 */
function applyCnPatch(
  base: any[],
  patch: any[],
  opts: { isChar?: boolean } = {}
): { list: any[]; changed: boolean } {
  if (!patch?.length) return { list: base, changed: false }
  const pm = new Map<number, any>(patch.map((p) => [p.id, p]))
  let changed = false
  const list =
    base.length === 0
      ? patch
      : base.map((b) => {
          const p = pm.get(b.id)
          if (!p) return b
          const pCn = (p.nameCn && p.nameCn.trim()) || ''
          const bCn = (b.nameCn && b.nameCn.trim()) || ''
          const mergedCn = pCn || bCn
          const newName = mergedCn ? p.name || b.name : b.name
          const newImage = usableImage(p.image) ? p.image : b.image
          const newActors = opts.isChar ? mergeActors(p.actors, b.actors) : b.actors
          if (newName !== b.name || newImage !== b.image || (mergedCn && mergedCn !== bCn)) {
            changed = true
          }
          return { ...b, name: newName, nameCn: mergedCn, image: newImage, actors: newActors }
        })
  return { list, changed }
}

function ensureTables(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subject_characters (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      char_id    INTEGER NOT NULL,
      name       TEXT,
      image      TEXT,
      relation   TEXT,
      actors_json TEXT,
      UNIQUE(subject_id, char_id),
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_char_subject ON subject_characters(subject_id);

    CREATE TABLE IF NOT EXISTS subject_relations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      related_id INTEGER NOT NULL,
      name       TEXT,
      image      TEXT,
      type       INTEGER,
      relation   TEXT,
      UNIQUE(subject_id, related_id),
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_rel_subject ON subject_relations(subject_id);
  `)
  // 旧库补列（name_cn 用于持久化「是否真取到中文」，合并时优先中文、不被原名覆盖）
  addColumnIfMissing(db, 'subject_characters', 'name_cn', 'TEXT')
  addColumnIfMissing(db, 'subject_relations', 'name_cn', 'TEXT')
  // display_order：缓存 P1 给出的「作品内展示顺序」（数组下标）。旧缓存该列缺省为 NULL，
  // 读取时回退按缓存 id 顺序；heal 后写入真实下标，避免「重启即沿用旧 v0 顺序」的回归。
  addColumnIfMissing(db, 'subject_characters', 'display_order', 'INTEGER')
  // updated_at：缓存最近刷新时间（Unix 秒），供「自动清理半年前缓存」按年龄裁剪。
  // 旧行该列为 NULL，一次性回填为当前时间（视为刚刷新），避免首跑把存量缓存全清掉。
  addColumnIfMissing(db, 'subject_characters', 'updated_at', 'INTEGER')
  addColumnIfMissing(db, 'subject_relations', 'updated_at', 'INTEGER')
  db.exec(
    `UPDATE subject_characters SET updated_at = strftime('%s','now') WHERE updated_at IS NULL;
     UPDATE subject_relations SET updated_at = strftime('%s','now') WHERE updated_at IS NULL;`
  )
}

export async function getCachedCharacters(subjectId: number): Promise<SubjectCharacter[]> {
  const db = await getDb()
  ensureTables(db)
  const rows = db
    .prepare('SELECT char_id AS id, name, name_cn AS nameCn, image, relation, actors_json, display_order AS displayOrder FROM subject_characters WHERE subject_id = ? ORDER BY COALESCE(display_order, id)')
    .all(subjectId) as any[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    nameCn: r.nameCn ?? '',
    image: r.image ?? undefined,
    relation: r.relation ?? '',
    // 仅当列存在且非 NULL 才给值，避免把 SQLite 的 0 误当成「有效顺序 0」
    displayOrder: typeof r.displayOrder === 'number' ? r.displayOrder : undefined,
    actors:
      typeof r.actors_json === 'string' && r.actors_json
        ? JSON.parse(r.actors_json)
        : []
  }))
}

export async function getCachedRelations(subjectId: number): Promise<SubjectRelation[]> {
  const db = await getDb()
  ensureTables(db)
  const rows = db
    .prepare('SELECT related_id AS id, name, name_cn AS nameCn, image, type, relation FROM subject_relations WHERE subject_id = ? ORDER BY id')
    .all(subjectId) as any[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    nameCn: r.nameCn ?? '',
    image: r.image ?? undefined,
    type: r.type ?? 0,
    relation: r.relation ?? ''
  }))
}

export async function cacheCharacters(subjectId: number, chars: SubjectCharacter[]): Promise<void> {
  const db = await getDb()
  ensureTables(db)
  const del = db.prepare('DELETE FROM subject_characters WHERE subject_id = ?')
  const ins = db.prepare(
    'INSERT OR REPLACE INTO subject_characters (subject_id, char_id, name, name_cn, image, relation, actors_json, display_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const now = Math.floor(Date.now() / 1000)
  const tx = db.transaction(() => {
    del.run(subjectId)
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]
      ins.run(
        subjectId,
        c.id,
        c.name,
        c.nameCn ?? null,
        c.image ?? null,
        c.relation,
        JSON.stringify(c.actors ?? []),
        // P1 数组下标即「作品内展示顺序」；未带 displayOrder（如 v0 兜底）则存 NULL，
        // 读取时回退按 id，下次 online 时会 heal 重写。
        typeof c.displayOrder === 'number' ? c.displayOrder : i,
        now
      )
    }
  })
  tx()
}

export async function cacheRelations(subjectId: number, rels: SubjectRelation[]): Promise<void> {
  const db = await getDb()
  ensureTables(db)
  const del = db.prepare('DELETE FROM subject_relations WHERE subject_id = ?')
  const ins = db.prepare(
    'INSERT OR REPLACE INTO subject_relations (subject_id, related_id, name, name_cn, image, type, relation, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const now = Math.floor(Date.now() / 1000)
  const tx = db.transaction(() => {
    del.run(subjectId)
    for (const r of rels) {
      ins.run(subjectId, r.id, r.name, r.nameCn ?? null, r.image ?? null, r.type, r.relation, now)
    }
  })
  tx()
}

/**
 * 读取角色与关联作品（本地优先 + 在线补全）。
 * - 列表/头像优先用缓存，缺失才联网；中文名优先用已下载的离线库（Archive）同步补全。
 * - 离线库是本地 SQLite、98.6% 角色含简体中文名、查询瞬时：故中文名在【首次同步返回】
 *   就生效，不再依赖异步推送，彻底规避「异步没生效就永远显示原名」的坑。
 */
export async function loadSubjectExtra(
  subject: any,
  onCnChunk?: (chunk: { subjectId: number; characters: any[]; relations: any[] }) => void,
  opts: { online?: boolean } = {}
): Promise<{
  characters: SubjectCharacter[]
  relations: SubjectRelation[]
}> {
  const online = opts.online !== false
  const subjectId = subject?.id
  if (!subjectId) return { characters: [], relations: [] }

  const cachedChars = await getCachedCharacters(subjectId)
  const cachedRels = await getCachedRelations(subjectId)

  const bgmId = Number(subject?.provider_subject_id)
  const isBgm = subject?.provider === 'bangumi' && bgmId > 0
  const token = isBgm ? await getValidToken() : null
  // 离线库可用（已下载）：一次读取 meta，中文名补全优先走本地库（瞬时不限流）
  const archiveMeta = isBgm ? await getArchiveMeta().catch(() => null) : null

  let characters = cachedChars
  let relations = cachedRels

  // 是否需（重新）抓取「列表 + 头像/封面」：仅当列表为空，或头像/封面缺失（含失效代理地址）时。
  // 注意：中文名不在此判断范围内——即便已缓存且有图，也要走下方第 3 步用离线库把原名升级为中文名。
  const needList =
    characters.length === 0 ||
    relations.length === 0 ||
    characters.some((c) => !usableImage(c.image)) ||
    relations.some((r) => !usableImage(r.image))

  // 离线库该作品的中文名/列表数据（本地查询，瞬时；有索引）——同步路径与异步补强共用同一份
  let arc: { characters: SubjectCharacter[]; relations: SubjectRelation[] } | null = null
  if (archiveMeta) {
    try {
      const bgmType = categoryToBgmType(subject?.category)
      arc = await getArchiveExtra(bgmId, bgmType)
    } catch (e) {
      console.warn('[extra] 离线库读取失败（后续走在线）：', e)
      arc = null
    }
  }

  // 角色列表需重新抓取的条件：列表为空（首次）、或头像缺失、或【过渡期旧缓存缺 display_order】。
  // 最后一项是关键——P1 改造前缓存的角色是按 v0「按 id 升序」存的，重启后 ORDER BY id 会沿用旧顺序；
  // 故旧缓存（displayOrder 为 null）必须重新向 P1 拉取真实「作品内顺序」并写回，否则排列永远不变。
  // 过渡期检测：若缓存中「所有角色都没有 CV」（典型症状——P1 改造早期把 cast 当扁平结构、
  // 实际 cast 嵌套了 person，导致 CV 名字全空被写进缓存），也强制重新向 P1 拉取、覆盖坏缓存。
  const cvMissingAll =
    characters.length > 0 && characters.every((c: any) => !(c.actors && c.actors.length))
  const needCharsRefresh =
    characters.length === 0 ||
    characters.some((c: any) => c.displayOrder == null) ||
    characters.some((c) => !usableImage(c.image)) ||
    cvMissingAll

  if (online && isBgm && (needList || needCharsRefresh)) {
    // 1) 在线 API 取列表（角色关系 + 头像 + 关联条目）；已 cached 且无需刷新（含 display_order 齐全）的部分不重复拉。
    //    注意：同步路径只取「列表」（withCn:false），角色/CV 的中文名放在后台 step 4 异步补全，
    //    避免一次同步等待上百个「角色/CV 详情」请求把详情页卡死（点不进去 / 角色加载不出）。
    // 在线补全列表：P1(角色) / v0(关联) 均匿名可用，故不强制要求 token，
    // 未登录也能触发 heal（修复缓存中毒 / 旧 v0 顺序 / CV 全空）。带令牌仅提高限流配额。
    try {
      const [chars, rels] = await Promise.all([
        needCharsRefresh
          ? getSubjectCharacters(String(bgmId), token ?? undefined, { withCn: false })
          : Promise.resolve(characters),
        relations.length === 0
          ? getSubjectRelations(String(bgmId), token ?? undefined)
          : Promise.resolve(relations)
      ])
      if (needCharsRefresh && chars?.length) {
        characters = chars
        await cacheCharacters(subjectId, characters)
      }
      if (relations.length === 0 && rels?.length) {
        relations = rels
        await cacheRelations(subjectId, relations)
      }
    } catch (e) {
      console.warn('[extra] 角色/关联作品在线列表补全失败，回退离线库：', e)
    }
  }

  // 2) 离线库兜底列表：不论 online 与否——
  //    - online 时：仅在网络列表为空（或在线抓取失败）才用 Archive 兜底；
  //    - 纯本地通道（online:false，即首屏 detailLocal）：直接以 Archive 秒填角色/关联，
  //      实现用户要求的「先用离线库填充、联网后再替换」，不再因本地缓存为空而转圈等网络。
  //    Archive 角色/关联按 subject_id 建索引、查询瞬时；头像/封面 Archive 无图，仍由在线通道补。
  //    注意 Archive 角色覆盖不全（部分条目 arc_subject_characters 为空），这类仍由下方在线通道补全。
  if (arc && (characters.length === 0 || relations.length === 0)) {
    try {
      if (characters.length === 0 && arc.characters.length) {
        characters = arc.characters
        await cacheCharacters(subjectId, characters)
      }
      if (relations.length === 0 && arc.relations.length) {
        relations = arc.relations
        await cacheRelations(subjectId, relations)
      }
    } catch (e) {
      console.warn('[extra] 离线库列表兜底失败（沿用缓存）：', e)
    }
  }

  // 3) 【同步】离线库中文名补全 —— 只要 Archive 可用就应用，不依赖异步推送。
  //    Archive 是本地 SQLite（已建 subject_id 索引，查询瞬时），且 98.6% 角色含简体中文名
  //    （含在 infobox 的「简体中文名」里）。这样【首次返回即带中文名】，用户立即看到；
  //    已缓存原名的也在此就地升级为中文——彻底规避「异步推送没生效就永远显示原名」的坑。
  if (arc) {
    try {
      let dirty = false
      if (arc.characters?.length) {
        const r = applyCnPatch(characters, arc.characters, { isChar: true })
        if (r.changed) {
          characters = r.list
          dirty = true
        }
      }
      if (arc.relations?.length) {
        const r = applyCnPatch(relations, arc.relations)
        if (r.changed) {
          relations = r.list
          dirty = true
        }
      }
      if (dirty) {
        await cacheCharacters(subjectId, characters)
        await cacheRelations(subjectId, relations)
      }
    } catch (e) {
      console.warn('[extra] 离线库中文名同步补全失败（继续）：', e)
    }
  }

  // 3b) 关联条目中文名：离线库 arc_subjects.name_cn 极稀疏（炽焰天穹 120 条仅 5 条有），
  //     而 Bangumi 在线关联列表自带 name_cn 且覆盖率很高（一次请求返回全部关联）。
  //     故对「仍缺中文名」的关联条目，在同步路径补一次在线列表，确保关联条目也立即显示中文名。
  //    仅在有令牌时做（未登录匿名也能调，但令牌配额更高），失败不影响已得的展示。
  const relsMissingCn = relations.some((r: any) => !(r.nameCn && r.nameCn.trim()))
  if (online && isBgm && relations.length && relsMissingCn) {
    try {
      const onlineRels = await getSubjectRelations(String(bgmId), token ?? undefined)
      if (onlineRels?.length) {
        const r = applyCnPatch(relations, onlineRels)
        if (r.changed) {
          relations = r.list
          await cacheRelations(subjectId, relations)
        }
      }
    } catch (e) {
      console.warn('[extra] 关联条目在线中文名同步补全失败（沿用现有）：', e)
    }
  }

  // 4) 【异步补强】在线 API 仅补「离线库仍缺中文名」的条目（令牌桶限速，不触发 429），补完推送刷新。
  //    绝大多数常见角色/CV/关联条目已由第 3 步离线库覆盖，此步只兜底极少数字节库未收录的。
  const stillMissingCn =
    characters.some((c: any) => !(c.nameCn && c.nameCn.trim())) ||
    relations.some((r: any) => !(r.nameCn && r.nameCn.trim()))
  if (online && isBgm && onCnChunk && stillMissingCn) {
    const sid = subjectId
    const bid = bgmId
    void (async () => {
      try {
        const [freshChars, freshRels] = await Promise.all([
          getSubjectCharacters(String(bid), token ?? undefined),
          getSubjectRelations(String(bid), token ?? undefined)
        ])
        let dirty = false
        let curC = characters
        let curR = relations
        if (freshChars?.length) {
          const r = applyCnPatch(curC, freshChars, { isChar: true })
          if (r.changed) {
            curC = r.list
            dirty = true
          }
        }
        if (freshRels?.length) {
          const r = applyCnPatch(curR, freshRels)
          if (r.changed) {
            curR = r.list
            dirty = true
          }
        }
        if (dirty) {
          await cacheCharacters(sid, curC)
          await cacheRelations(sid, curR)
          characters = curC
          relations = curR
          onCnChunk({ subjectId: sid, characters: curC, relations: curR })
        }
      } catch (e) {
        console.warn('[extra] 在线异步补强中文名失败（沿用现有）：', e)
      }
    })()
  }

  return { characters, relations }
}
