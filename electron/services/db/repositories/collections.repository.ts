import { getDb } from '../connection'
import { convertToCNY } from '../../currency'
import type { UserStats, GroupStat } from '@shared/types'

// Bangumi 收藏状态枚举（与技术方案一致）
export const COLLECTION_STATUS = {
  wish: 1,
  done: 2,
  doing: 3,
  onHold: 4,
  dropped: 5
} as const

/**
 * 本地离线账户：未登录 Bangumi 时也能在本地记录进度。
 * 返回 local 账户的 id（不存在则创建）。
 */
export async function ensureLocalAccount(): Promise<number> {
  const db = await getDb()
  const row = db.prepare("SELECT id FROM accounts WHERE provider = 'local' LIMIT 1").get()
  if (row) return row.id as number
  const res = db
    .prepare("INSERT INTO accounts (provider, username) VALUES ('local', 'local')")
    .run()
  return Number(res.lastInsertRowid)
}

/** 取或建一条收藏记录；已存在则返回原记录 id（不覆盖状态）。 */
export async function getOrCreateCollection(
  accountId: number,
  subjectId: number,
  status: number = COLLECTION_STATUS.doing
): Promise<number> {
  const db = await getDb()
  const row = db
    .prepare('SELECT id FROM collections WHERE account_id = ? AND subject_id = ?')
    .get(accountId, subjectId)
  if (row) return row.id as number
  const res = db
    .prepare(
      'INSERT INTO collections (account_id, subject_id, status, dirty) VALUES (?, ?, ?, 1)'
    )
    .run(accountId, subjectId, status)
  return Number(res.lastInsertRowid)
}

export async function getCollectionBySubject(
  accountId: number,
  subjectId: number
): Promise<any | undefined> {
  const db = await getDb()
  return db
    .prepare('SELECT * FROM collections WHERE account_id = ? AND subject_id = ?')
    .get(accountId, subjectId)
}

/** 更新已看集数并标记 dirty（待同步）。 */
export async function updateEpStatus(collectionId: number, epStatus: number): Promise<void> {
  const db = await getDb()
  db.prepare(
    `UPDATE collections
     SET ep_status = ?, dirty = 1, local_updated_at = strftime('%s','now')
     WHERE id = ?`
  ).run(epStatus, collectionId)
}

/** 更新已读卷数并标记 dirty（待同步）。漫画/轻小说用。 */
export async function updateVolStatus(collectionId: number, volStatus: number): Promise<void> {
  const db = await getDb()
  db.prepare(
    `UPDATE collections
     SET vol_status = ?, dirty = 1, local_updated_at = strftime('%s','now')
     WHERE id = ?`
  ).run(volStatus, collectionId)
}

/** 仅本地更新已看集数（不标记 dirty，不触发同步）。Galgame 路线数用，进度纯本地。
 *  同样刷新 local_updated_at：路线数编辑也是一次「标记」，列表应随之置顶。 */
export async function updateEpStatusLocal(collectionId: number, epStatus: number): Promise<void> {
  const db = await getDb()
  db.prepare(
    'UPDATE collections SET ep_status = ?, local_updated_at = strftime(\'%s\',\'now\') WHERE id = ?'
  ).run(epStatus, collectionId)
}

/** 仅本地更新已读卷数（不标记 dirty，不触发同步）。同样刷新时间戳。 */
export async function updateVolStatusLocal(collectionId: number, volStatus: number): Promise<void> {
  const db = await getDb()
  db.prepare(
    'UPDATE collections SET vol_status = ?, local_updated_at = strftime(\'%s\',\'now\') WHERE id = ?'
  ).run(volStatus, collectionId)
}

/** 更改收藏状态（想玩/在玩/已通关等），标记 dirty。通用收藏模块使用。 */
export async function setCollectionStatus(collectionId: number, status: number): Promise<void> {
  const db = await getDb()
  db.prepare(
    `UPDATE collections
     SET status = ?, dirty = 1, local_updated_at = strftime('%s','now')
     WHERE id = ?`
  ).run(status, collectionId)
}

/** 待同步的本地脏收藏（仅 Bangumi 来源的作品），供 push 使用 */
export async function getDirtyCollectionsForSync(
  localAccountId: number
): Promise<
  {
    id: number
    status: number
    ep_status: number
    vol_status: number
    rating: number | null
    comment: string | null
    private: number
    local_updated_at: number
    dirty_rate: number
    provider_subject_id: string
    category: string
  }[]
> {
  const db = await getDb()
  return db
    .prepare(
      `SELECT c.id, c.status, c.ep_status, c.vol_status, c.rating, c.comment, c.private, c.local_updated_at, c.dirty_rate,
              s.provider_subject_id, s.category
       FROM collections c
       JOIN subjects s ON c.subject_id = s.id
       WHERE c.dirty = 1 AND c.account_id = ? AND s.provider = 'bangumi'`
    )
    .all(localAccountId)
}

/**
 * 拉取时用于“早停对齐”的本地收藏快照（按 local_updated_at DESC，对应 Bangumi 列表的 updated_at DESC）。
 * 仅取 Bangumi 来源、用于与远端逐条比对内容是否一致。
 */
export async function getCollectionsForCompare(
  accountId: number
): Promise<
  {
    id: number
    status: number
    ep_status: number
    vol_status: number
    rating: number | null
    comment: string | null
    dirty: number
    dirty_rate: number
    private: number
    provider_subject_id: string
    category: string
  }[]
> {
  const db = await getDb()
  return db
    .prepare(
      `SELECT c.id, c.status, c.ep_status, c.vol_status, c.rating, c.comment, c.dirty, c.dirty_rate, c.private,
              s.provider_subject_id, s.category
       FROM collections c
       JOIN subjects s ON c.subject_id = s.id
       WHERE c.account_id = ? AND s.provider = 'bangumi'
       ORDER BY c.local_updated_at DESC`
    )
    .all(accountId)
}

/**
 * Q1：删除本地“在云端已不存在”的 Bangumi 收藏（同步取消收藏）。
 * 仅删除 dirty=0（已同步/无未上传改动）的行；本地有未上传改动(dirty=1)的收藏保护不被删。
 * 离线自建、provider!='bangumi' 的作品因 JOIN 条件天然排除，不受影响。
 */
export async function deleteUnsyncedBangumiCollections(
  accountId: number,
  remoteSubjectIds: Set<string>
): Promise<number> {
  const db = await getDb()
  const rows = db
    .prepare(
      `SELECT c.id, s.provider_subject_id
       FROM collections c
       JOIN subjects s ON c.subject_id = s.id
       WHERE c.account_id = ? AND c.dirty = 0 AND s.provider = 'bangumi'`
    )
    .all(accountId) as { id: number; provider_subject_id: string }[]
  const toDelete = rows.filter((r) => !remoteSubjectIds.has(r.provider_subject_id)).map((r) => r.id)
  if (toDelete.length === 0) return 0
  const placeholders = toDelete.map(() => '?').join(',')
  db.prepare(`DELETE FROM collections WHERE id IN (${placeholders})`).run(...toDelete)
  return toDelete.length
}

/** 更新个人吐槽（comment）并标记 dirty（待上传）。预留给将来的吐槽编辑 UI。 */
export async function updateCollectionComment(
  collectionId: number,
  comment: string
): Promise<void> {
  const db = await getDb()
  db.prepare(
    `UPDATE collections
     SET comment = ?, dirty = 1, local_updated_at = strftime('%s','now')
     WHERE id = ?`
  ).run(comment, collectionId)
}

/** 更新用户评分（1-10）并标记 dirty（待同步）。传 null 表示清除评分。 */
export async function updateCollectionRating(
  collectionId: number,
  rating: number | null
): Promise<void> {
  const db = await getDb()
  db.prepare(
    `UPDATE collections
     SET rating = ?, dirty = 1, dirty_rate = 1, local_updated_at = strftime('%s','now')
     WHERE id = ?`
  ).run(rating, collectionId)
}

/**
 * 按 Bangumi 作品 id 设置评分：取/建本地收藏（默认 status=doing），写入评分并标记 dirty。
 * 返回本地 collectionId 与（取到的或默认的）status，供调用方推送到 Bangumi。
 */
export async function setRatingByProviderSubjectId(
  providerSubjectId: string,
  rating: number,
  defaultStatus = 3
): Promise<{ collectionId: number; status: number }> {
  const db = await getDb()
  const localAcct = await ensureLocalAccount()
  const found = db
    .prepare(
      `SELECT c.id, c.status FROM collections c
       JOIN subjects s ON c.subject_id = s.id
       WHERE s.provider = 'bangumi' AND s.provider_subject_id = ? AND c.account_id = ?`
    )
    .get(providerSubjectId, localAcct) as { id: number; status: number } | undefined
  let collectionId: number
  let status: number
  if (found) {
    collectionId = found.id
    status = found.status
  } else {
    const subj = db
      .prepare("SELECT id FROM subjects WHERE provider = 'bangumi' AND provider_subject_id = ?")
      .get(providerSubjectId) as { id: number } | undefined
    if (!subj) throw new Error('本地未找到该作品，无法评分')
    collectionId = await getOrCreateCollection(localAcct, subj.id, defaultStatus)
    status = defaultStatus
  }
  await updateCollectionRating(collectionId, rating)
  return { collectionId, status }
}

/**
 * 不标记 dirty 地写回「我的评分」到本地库（用于从 Bangumi 拉取后做缓存）。
 * 仅当本地已存在该收藏行时生效；不存在（用户只在 Bangumi 网页评过分、未在 app 添加）则跳过。
 */
export async function saveCollectionRatingLocal(
  providerSubjectId: string,
  rating: number
): Promise<void> {
  const db = await getDb()
  const row = db
    .prepare(
      `SELECT c.id FROM collections c
       JOIN subjects s ON c.subject_id = s.id
       WHERE s.provider = 'bangumi' AND s.provider_subject_id = ?`
    )
    .get(providerSubjectId) as { id: number } | undefined
  if (!row) return
  db.prepare('UPDATE collections SET rating = ? WHERE id = ?').run(rating, row.id)
}

/** 推送成功后清除 dirty 标记并记录同步时间 */
export async function clearDirty(collectionId: number): Promise<void> {
  const db = await getDb()
  db.prepare(
    `UPDATE collections SET dirty = 0, dirty_rate = 0, last_sync_at = strftime('%s','now') WHERE id = ?`
  ).run(collectionId)
}

/** 按 Bangumi 作品 id 反查本地收藏（pull 时定位） */
export async function findLocalCollectionByProviderSubjectId(
  providerSubjectId: string
): Promise<{ id: number; ep_status: number; vol_status: number; status: number } | undefined> {
  const db = await getDb()
  return db
    .prepare(
      `SELECT c.id, c.ep_status, c.vol_status, c.status
       FROM collections c
       JOIN subjects s ON c.subject_id = s.id
       WHERE s.provider = 'bangumi' AND s.provider_subject_id = ?`
    )
    .get(providerSubjectId)
}

/**
 * 将 Bangumi 远端进度合并进本地（pull）。
 * 冲突策略：ep_status / vol_status 取较大值；status 取进度更大的一侧（并列则保留本地）。
 * 合并后清除 dirty 并记录同步时间。
 */
export async function mergeFromBangumi(
  collectionId: number,
  remote: { type: number; ep_status: number; vol_status: number }
): Promise<void> {
  const db = await getDb()
  const local = db
    .prepare('SELECT ep_status, vol_status, status FROM collections WHERE id = ?')
    .get(collectionId) as { ep_status: number; vol_status: number; status: number } | undefined
  if (!local) return

  const ep = Math.max(local.ep_status ?? 0, remote.ep_status ?? 0)
  const vol = Math.max(local.vol_status ?? 0, remote.vol_status ?? 0)
  const localProgress = (local.ep_status ?? 0) + (local.vol_status ?? 0)
  const remoteProgress = (remote.ep_status ?? 0) + (remote.vol_status ?? 0)
  const status = remoteProgress >= localProgress ? remote.type : local.status

  db.prepare(
    `UPDATE collections
     SET ep_status = ?, vol_status = ?, status = ?, dirty = 0, last_sync_at = strftime('%s','now')
     WHERE id = ?`
  ).run(ep, vol, status, collectionId)
}

/**
 * 从 Bangumi 整库拉取时使用的 upsert：以远端进度为准重建本地收藏。
 * - 不存在：新建（dirty=0，已同步）。
 * - 存在且本地有未推送改动(dirty=1)：跳过，避免覆盖离线编辑（稍后由 push 上传）。
 * - 存在且已同步：用远端 status/ep_status/vol_status 覆盖，并记录同步时间。
 */
export async function upsertCollectionFromBangumi(
  accountId: number,
  subjectId: number,
  remote: { type: number; ep_status: number; vol_status: number; rating?: number | null; comment?: string | null },
  updatedAt?: number | null
): Promise<void> {
  const db = await getDb()
  const row = db
    .prepare('SELECT id, dirty FROM collections WHERE account_id = ? AND subject_id = ?')
    .get(accountId, subjectId) as { id: number; dirty: number } | undefined
  if (!row) {
    db.prepare(
      `INSERT INTO collections
         (account_id, subject_id, status, ep_status, vol_status, rating, comment, dirty, local_updated_at, last_sync_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, COALESCE(?, strftime('%s','now')), strftime('%s','now'))`
    ).run(
      accountId,
      subjectId,
      remote.type ?? 3,
      remote.ep_status ?? 0,
      remote.vol_status ?? 0,
      remote.rating ?? null,
      remote.comment ?? null,
      updatedAt ?? null
    )
    return
  }
  if (row.dirty === 1) return // 本地离线改动待推送，pull 阶段不动它
  db.prepare(
    `UPDATE collections
     SET status = ?, ep_status = ?, vol_status = ?, rating = ?, comment = COALESCE(?, comment), dirty = 0, dirty_rate = 0, last_sync_at = strftime('%s','now'),
         /* 取「远端标记时间 / 本地标记时间」较新者：防止拉取把本地最近标记的时间戳
            覆盖成远端旧值或零值回退（resolveMarkTime 的远古兜底），破坏「最后标记排最前」 */
         local_updated_at = MAX(COALESCE(?, 0), local_updated_at)
     WHERE id = ?`
  ).run(
    remote.type ?? 3,
    remote.ep_status ?? 0,
    remote.vol_status ?? 0,
    remote.rating ?? null,
    remote.comment ?? null,
    updatedAt ?? null,
    row.id
  )
}

/** 写入 sync_log */
export async function logSync(
  direction: 'push' | 'pull',
  entity: string,
  entityId: number,
  status: 'ok' | 'failed',
  message?: string
): Promise<void> {
  try {
    const db = await getDb()
    const acct = db
      .prepare("SELECT id FROM accounts WHERE provider = 'bangumi' ORDER BY id DESC LIMIT 1")
      .get() as { id: number } | undefined
    db.prepare(
      `INSERT INTO sync_log (account_id, direction, entity, entity_id, status, message)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(acct?.id ?? null, direction, entity, entityId, status, message ?? null)
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/**
 * 新建 / 更新收藏「完整字段」（收藏悬浮窗保存用）：
 * 写 status + 吐槽(comment) + 仅自己可见(private) 并标记 dirty（待同步）。
 */
export async function saveCollectionFull(
  collectionId: number,
  status: number,
  comment: string | null,
  privateFlag: boolean
): Promise<void> {
  const db = await getDb()
  db.prepare(
    `UPDATE collections
     SET status = ?, comment = ?, private = ?, dirty = 1, local_updated_at = strftime('%s','now')
     WHERE id = ?`
  ).run(status, comment ?? null, privateFlag ? 1 : 0, collectionId)
}

/**
 * 查询某作品（按 Bangumi 作品 id）是否已收藏，返回状态与吐槽。
 * 未收藏返回 { status: null, comment: null }。
 */
export async function getCollectionExistingBySubject(
  providerSubjectId: string
): Promise<{ id: number | null; status: number | null; comment: string | null; private: boolean | null; rating: number | null; ep_status: number | null; vol_status: number | null }> {
  const db = await getDb()
  // 同一个作品在「本地账户」与「bangumi 账户（pull 镜像）」下可能各有一行收藏。
  // 读取时优先取「带评分」的那一行（ORDER BY rating 非空优先，其次 id 大者），
  // 避免取到镜像行的空/旧评分，导致收藏悬浮窗读不到详情页已打的分。
  const row = db
    .prepare(
      `SELECT c.id, c.status, c.comment, c.private, c.rating, c.ep_status, c.vol_status FROM collections c
       JOIN subjects s ON c.subject_id = s.id
       WHERE s.provider = 'bangumi' AND s.provider_subject_id = ?
       ORDER BY (CASE WHEN c.rating IS NOT NULL THEN 0 ELSE 1 END), c.id DESC
       LIMIT 1`
    )
    .get(providerSubjectId) as { id: number; status: number; comment: string | null; private: number; rating: number | null; ep_status: number; vol_status: number } | undefined
  if (!row) return { id: null, status: null, comment: null, private: null, rating: null, ep_status: null, vol_status: null }
  return {
    id: row.id,
    status: row.status,
    comment: row.comment ?? null,
    private: !!row.private,
    rating: typeof row.rating === 'number' ? row.rating : null,
    ep_status: row.ep_status ?? 0,
    vol_status: row.vol_status ?? 0
  }
}

/**
 * 删除某作品的收藏：先删 collection_tags 联结，再删 collections 行。
 * 返回删除的收藏行数（0 表示本就无收藏）。
 */
export async function deleteCollectionFullBySubject(
  providerSubjectId: string
): Promise<number> {
  const db = await getDb()
  const rows = db
    .prepare(
      `SELECT c.id FROM collections c
       JOIN subjects s ON c.subject_id = s.id
       WHERE s.provider = 'bangumi' AND s.provider_subject_id = ?`
    )
    .all(providerSubjectId) as { id: number }[]
  if (rows.length === 0) return 0
  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM collection_tags WHERE collection_id IN (${placeholders})`).run(...ids)
  // 级联清理该收藏下的通关路线（Galgame），避免孤儿行
  db.prepare(`DELETE FROM routes WHERE collection_id IN (${placeholders})`).run(...ids)
  db.prepare(`DELETE FROM collections WHERE id IN (${placeholders})`).run(...ids)
  return ids.length
}

/** 取某收藏已关联的「我的 tag」名称列表 */
export async function getCollectionTags(collectionId: number): Promise<string[]> {
  const db = await getDb()
  const rows = db
    .prepare(
      `SELECT t.name FROM collection_tags ct JOIN tags t ON ct.tag_id = t.id
       WHERE ct.collection_id = ? ORDER BY ct.rowid`
    )
    .all(collectionId) as { name: string }[]
  return rows.map((r) => r.name)
}

/**
 * 写「我的 tag」：先清空该收藏已有联结，再按 names 逐个 upsert tags 表并重新建立联结。
 * 重复 name 自动去重；tags 表 name 唯一约束，冲突则忽略（保留原 color）。
 */
export async function setCollectionTags(collectionId: number, names: string[]): Promise<void> {
  const db = await getDb()
  const uniq = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).slice(0, 10)
  db.prepare('DELETE FROM collection_tags WHERE collection_id = ?').run(collectionId)
  if (uniq.length === 0) return
  const insertTag = db.prepare(
    `INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name`
  )
  const selectTag = db.prepare('SELECT id FROM tags WHERE name = ?')
  const insertLink = db.prepare(
    'INSERT OR IGNORE INTO collection_tags (collection_id, tag_id) VALUES (?, ?)'
  )
  for (const name of uniq) {
    insertTag.run(name)
    const tag = selectTag.get(name) as { id: number } | undefined
    if (tag) insertLink.run(collectionId, tag.id)
  }
}

/**
 * 取某作品前 N 个 Bangumi tag 名称（按标记次数降序），供「我的 tag」自动填充。
 * 从 subjects.tags（JSON SubjectTag[]）解析。
 */
export async function getSubjectTopTags(
  providerSubjectId: string,
  limit = 10
): Promise<string[]> {
  const db = await getDb()
  const row = db
    .prepare("SELECT tags FROM subjects WHERE provider = 'bangumi' AND provider_subject_id = ?")
    .get(providerSubjectId) as { tags: string | null } | undefined
  if (!row?.tags) return []
  try {
    const parsed = JSON.parse(row.tags) as { name: string; count?: number }[]
    return (Array.isArray(parsed) ? parsed : [])
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, limit)
      .map((t) => t.name)
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * 个人页统计悬浮窗：从本地 collections 聚合统计。
 * 按分类归并为 5 组：all（全部）/ light_novel（小说）/ manga（漫画）/ anime / game（galgame+game）。
 * 每组给出 收藏数 / 完成数(status=2) / 完成率 / 平均分 / 标准差 / 评分数 / 1-10 评分直方图。
 * collections 仅 768 行，全量读出后在 JS 聚合，避免多 SQL。
 */
export async function getUserStats(): Promise<UserStats> {
  const db = await getDb()
  const rows = db
    .prepare(
      `SELECT s.category AS category, c.status AS status, c.rating AS rating
       FROM collections c JOIN subjects s ON s.id = c.subject_id`
    )
    .all() as { category: string; status: number; rating: number | null }[]

  type Acc = { total: number; done: number; ratings: number[]; hist: number[]; spent: number }
  type GroupStatLike = GroupStat
  const newAcc = (): Acc => ({ total: 0, done: 0, ratings: [], hist: new Array(11).fill(0), spent: 0 })
  const acc: Record<'all' | 'light_novel' | 'manga' | 'anime' | 'game', Acc> = {
    all: newAcc(),
    light_novel: newAcc(),
    manga: newAcc(),
    anime: newAcc(),
    game: newAcc()
  }

  const groupOf = (
    cat: string
  ): 'all' | 'light_novel' | 'manga' | 'anime' | 'game' | null => {
    if (cat === 'light_novel') return 'light_novel'
    if (cat === 'manga') return 'manga'
    if (cat === 'anime') return 'anime'
    if (cat === 'galgame' || cat === 'game') return 'game'
    return null
  }

  for (const r of rows) {
    const g = groupOf(r.category)
    acc.all.total++
    if (r.status === 2) acc.all.done++
    if (typeof r.rating === 'number' && r.rating > 0) {
      acc.all.ratings.push(r.rating)
      acc.all.hist[r.rating]++
    }
    if (g) {
      acc[g].total++
      if (r.status === 2) acc[g].done++
      if (typeof r.rating === 'number' && r.rating > 0) {
        acc[g].ratings.push(r.rating)
        acc[g].hist[r.rating]++
      }
    }
  }

  // 各分类累计花费（来自 purchases 表，galgame+game 合并到 game）。
  // 按 (category, currency) 分组求和，再统一折算人民币（离线静态汇率，见 currency.ts）。
  const spentRows = db
    .prepare(
      `SELECT s.category AS category, p.currency AS currency, COALESCE(SUM(p.price), 0) AS spent
       FROM purchases p
       JOIN collections c ON c.id = p.collection_id
       JOIN subjects s ON s.id = c.subject_id
       WHERE p.price IS NOT NULL
       GROUP BY s.category, p.currency`
    )
    .all() as { category: string; currency: string | null; spent: number }[]
  for (const sr of spentRows) {
    const cny = convertToCNY(sr.spent, sr.currency)
    acc.all.spent += cny
    const g = groupOf(sr.category)
    if (g) acc[g].spent += cny
  }

  const finalize = (a: Acc): GroupStatLike => {
    const ratedCount = a.ratings.length
    const avg = ratedCount ? a.ratings.reduce((s, x) => s + x, 0) / ratedCount : null
    let std: number | null = null
    if (ratedCount > 0) {
      const mean = avg as number
      const variance = a.ratings.reduce((s, x) => s + (x - mean) ** 2, 0) / ratedCount
      std = Math.sqrt(variance)
    }
    return {
      total: a.total,
      done: a.done,
      completionRate: a.total ? a.done / a.total : 0,
      avgRating: avg,
      stdRating: std,
      ratedCount,
      histogram: a.hist,
      totalSpent: a.spent
    }
  }

  return {
    all: finalize(acc.all),
    light_novel: finalize(acc.light_novel),
    manga: finalize(acc.manga),
    anime: finalize(acc.anime),
    game: finalize(acc.game)
  }
}
