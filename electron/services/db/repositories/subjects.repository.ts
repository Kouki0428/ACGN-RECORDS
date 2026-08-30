import { getDb } from '../connection'
import { throttle, getSubjectDetail, classifyBookCategory } from '../../api/bangumi'
import { getValidToken } from '../../auth/oauth'
import electron from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { Subject, Category, Provider } from '../../../../shared/types'

/** subjects 表的仓储示例：演示缓存写入与按类别查询 */
export async function upsertSubject(subject: Subject): Promise<void> {
  const db = await getDb()
  const tagsJson = subject.tags ? JSON.stringify(subject.tags) : null
  const metaJson = subject.meta ? JSON.stringify(subject.meta) : null
  const seriesVal = subject.series === true ? 1 : subject.series === false ? 0 : null
  db.prepare(
    `INSERT INTO subjects
       (provider, provider_subject_id, category, title, title_cn, summary, image_url, air_date, total_episodes, total_volumes, series, rating, raw_json, tags, infobox, updated_at)
     VALUES (@provider, @providerSubjectId, @category, @title, @titleCn, @summary, @imageUrl, @airDate, @totalEpisodes, @totalVolumes, @series, @rating, @rawJson, @tags, @infobox, strftime('%s','now'))
     ON CONFLICT(provider, provider_subject_id) DO UPDATE SET
       title=excluded.title, title_cn=excluded.title_cn, summary=excluded.summary,
       image_url=excluded.image_url, air_date=excluded.air_date,
       total_episodes=excluded.total_episodes, total_volumes=excluded.total_volumes, series=excluded.series,
       rating=excluded.rating, raw_json=excluded.raw_json, tags=excluded.tags, infobox=excluded.infobox,
       updated_at=strftime('%s','now')`
  ).run({
    provider: subject.provider,
    providerSubjectId: subject.providerSubjectId,
    category: subject.category,
    title: subject.title,
    titleCn: subject.titleCn ?? null,
    summary: subject.summary ?? null,
    imageUrl: subject.imageUrl ?? null,
    airDate: subject.airDate ?? null,
    totalEpisodes: subject.totalEpisodes ?? null,
    totalVolumes: subject.totalVolumes ?? null,
    series: seriesVal,
    rating: subject.rating ?? null,
    rawJson: null,
    tags: tagsJson,
    infobox: metaJson
  })
}

export async function listSubjectsByCategory(category: Category, limit = 50): Promise<any[]> {
  const db = await getDb()
  return db
    .prepare('SELECT * FROM subjects WHERE category = ? ORDER BY updated_at DESC LIMIT ?')
    .all(category, limit)
}

/**
 * 从 Bangumi 整库导入时使用的 upsert：返回本地 id。
 * - 新作品：按给定 category 插入。
 * - 已存在：更新元数据（标题/封面/集数/标签/制作信息），并**强制写回 category**
 *   （书籍分类是本地按 tag 启发式判定，需覆盖早期错误数据；其余分类本就确定，无副作用）。
 * tags/meta 写入 infobox 列（JSON 文本），供离线详情页展示。
 */
export async function importSubject(subject: Subject): Promise<number> {
  const db = await getDb()
  const tagsJson = subject.tags ? JSON.stringify(subject.tags) : null
  const metaJson = subject.meta ? JSON.stringify(subject.meta) : null
  const existing = db
    .prepare('SELECT id FROM subjects WHERE provider = ? AND provider_subject_id = ?')
    .get(subject.provider, subject.providerSubjectId) as { id: number } | undefined
  const seriesVal = subject.series === true ? 1 : subject.series === false ? 0 : null
  if (existing) {
    db.prepare(
      `UPDATE subjects
       SET title=?, title_cn=?, summary=?, image_url=?, air_date=?,
           total_episodes=?, total_volumes=?, series=?, rating=?, category=?, tags=?, infobox=?, updated_at=strftime('%s','now')
       WHERE id=?`
    ).run(
      subject.title,
      subject.titleCn ?? null,
      subject.summary ?? null,
      subject.imageUrl ?? null,
      subject.airDate ?? null,
      subject.totalEpisodes ?? null,
      subject.totalVolumes ?? null,
      seriesVal,
      subject.rating ?? null,
      subject.category,
      tagsJson,
      metaJson,
      existing.id
    )
    return existing.id
  }
  const res = db
    .prepare(
      `INSERT INTO subjects
         (provider, provider_subject_id, category, title, title_cn, summary, image_url, air_date, total_episodes, total_volumes, series, rating, raw_json, tags, infobox, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, strftime('%s','now'))`
    )
    .run(
      subject.provider,
      subject.providerSubjectId,
      subject.category,
      subject.title,
      subject.titleCn ?? null,
      subject.summary ?? null,
      subject.imageUrl ?? null,
      subject.airDate ?? null,
      subject.totalEpisodes ?? null,
      subject.totalVolumes ?? null,
      seriesVal,
      subject.rating ?? null,
      tagsJson,
      metaJson
    )
  return Number(res.lastInsertRowid)
}

/** 仅补写作品简介（当本地 subjects.summary 缺失、联网从 Bangumi 取回后持久化，避免每次详情都重拉） */
export function setSubjectSummary(subjectId: number, summary: string): void {
  const db = getDb()
  db.prepare("UPDATE subjects SET summary = ?, updated_at = strftime('%s','now') WHERE id = ?").run(
    summary,
    subjectId
  )
}

export async function findCached(
  provider: Provider,
  providerSubjectId: string
): Promise<any | undefined> {
  const db = await getDb()
  return db
    .prepare('SELECT * FROM subjects WHERE provider = ? AND provider_subject_id = ?')
    .get(provider, providerSubjectId)
}

/** 补全作品封面（辅助源有更好图片但 Bangumi 缺图时使用） */
export async function setSubjectImage(subjectId: number, imageUrl: string): Promise<void> {
  const db = await getDb()
  db.prepare('UPDATE subjects SET image_url = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = ?').run(
    imageUrl,
    subjectId
  )
}

/** 按本地 id 取作品（标题等），用于 CG 抓取时按标题自动关联 VNDB */
export async function getSubjectById(id: number): Promise<any | undefined> {
  const db = await getDb()
  return db
    .prepare(
      'SELECT id, provider, provider_subject_id, title, title_cn, vndb_rating, vndb_rating_count FROM subjects WHERE id = ?'
    )
    .get(id)
}

/** 写回 VNDB 评分（Galgame 区展示，离线缓存） */
export async function setSubjectVndbRating(
  id: number,
  rating: number | null,
  ratingCount: number | null
): Promise<void> {
  const db = await getDb()
  db.prepare(
    'UPDATE subjects SET vndb_rating = ?, vndb_rating_count = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = ?'
  ).run(rating, ratingCount, id)
}

/** 写回 Bangumi 评分分布（1–10 星票数），供详情页右侧柱状图离线展示 */
export async function saveSubjectRatingDistribution(
  id: number,
  ratingCount: number[],
  ratingTotal: number
): Promise<void> {
  const db = await getDb()
  db.prepare(
    'UPDATE subjects SET rating_count = ?, rating_total = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = ?'
  ).run(JSON.stringify(ratingCount), ratingTotal, id)
}

export interface ReclassifySummary {
  total: number
  changed: number
  lightNovel: number
  manga: number
  failed: number
}

/**
 * 对本地已存在的 Bangumi 书籍（category 为 manga / light_novel）重新判定分类，
 * 写回与当前不同的结果。
 * 判定规则（classifyBookCategory）：platform 字段优先（'小说'→轻小说,'漫画'→漫画），
 * 缺失时按 tag 计数（轻小说关键词 vs 漫画关键词的人气 count 之和）兜底。
 * - 离线 Archive 优先（免联网、瞬时）：Archive 自带 platform 数字 code + tags，可就地细分小说/漫画；
 *   仅 Archive 缺失的极少数再回退联网拉详情（带令牌桶限速），避免逐本联网（6901 本 ≈ 80/min 要一个多小时）。
 * - 单本失败（超时/限流/网络）不影响其余，计入 failed。
 * 用于「图书按 platform/tags 细分轻小说/漫画」规则变更、以及修复 detailFull 误写 'manga' 造成的存量数据修正。
 */
export async function reclassifyBooks(): Promise<ReclassifySummary> {
  const db = await getDb()
  const rows = db
    .prepare(
      `SELECT id, provider, provider_subject_id, category FROM subjects
       WHERE provider = 'bangumi' AND category IN ('manga','light_novel')`
    )
    .all() as any[]
  const token = (await getValidToken().catch(() => null)) || null
  const summary: ReclassifySummary = { total: rows.length, changed: 0, lightNovel: 0, manga: 0, failed: 0 }

  // 离线 Archive 优先（免联网、瞬时）
  const arcMap = await loadArchiveBookMeta(rows.map((r) => Number(r.provider_subject_id)))
  for (const r of rows) {
    try {
      let newCat: Category
      const arc = arcMap.get(Number(r.provider_subject_id))
      if (arc) {
        newCat = classifyBookCategory({}, { platform: arc.platform, tags: arc.tags })
      } else {
        await throttle(!!token)
        const detail = await getSubjectDetail(String(r.provider_subject_id), token ?? undefined)
        newCat = classifyBookCategory(r, detail)
      }
      if (newCat !== r.category) {
        db.prepare(
          "UPDATE subjects SET category = ?, updated_at = strftime('%s','now') WHERE id = ?"
        ).run(newCat, r.id)
        summary.changed++
      }
      if (newCat === 'light_novel') summary.lightNovel++
      else summary.manga++
    } catch (e) {
      summary.failed++
      console.warn('[reclassify] 书籍重分类失败', r.provider_subject_id, e)
    }
  }
  return summary
}

/**
 * 从离线 Archive 库批量回填主库 subjects.nsfw（存档为权威源：每周官方导出自带 R18 标记）。
 * 幂等：把存档标为 nsfw=1 的主库行置 1，其余保持原值。Archive 缺失时静默跳过。
 */
export async function backfillSubjectNsfw(): Promise<void> {
  const db = await getDb()
  const rows = db
    .prepare("SELECT id, provider_subject_id FROM subjects WHERE provider = 'bangumi'")
    .all() as { id: number; provider_subject_id: string }[]
  if (!rows.length) return
  try {
    const { app } = electron
    const arcPath = join(app.getPath('userData'), 'bangumi-archive', 'bangumi-archive.db')
    if (!existsSync(arcPath)) return
    const Database = (await import('better-sqlite3')).default
    const arc = new Database(arcPath, { readonly: true, fileMustExist: true })
    const byId = new Map<number, number>()
    for (const r of rows) byId.set(Number(r.provider_subject_id), r.id)
    try {
      const ids = rows.map((r) => Number(r.provider_subject_id))
      const upd = db.prepare('UPDATE subjects SET nsfw = 1 WHERE id = ?')
      // 分块查询避免 SQLite 变量上限（999）
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        const ph = chunk.map(() => '?').join(',')
        const arcRows = arc
          .prepare(`SELECT id, nsfw FROM arc_subjects WHERE id IN (${ph})`)
          .all(...chunk) as { id: number; nsfw: number }[]
        for (const a of arcRows) {
          if (a.nsfw && byId.has(a.id)) upd.run(byId.get(a.id))
        }
      }
    } finally {
      arc.close()
    }
  } catch (e) {
    console.warn('[nsfw] 回填失败（忽略，封面不模糊）：', e)
  }
}

/**
 * 从离线 Archive 库批量读取书籍的 platform(code) + tags，用于本地书籍细分（免联网）。
 * Archive platform code：1001=漫画，1002=轻小说；其余（文库/单行本等）不强行映射，交给 tag 计数兜底。
 */
async function loadArchiveBookMeta(
  ids: number[]
): Promise<Map<number, { platform?: string; tags?: any[] }>> {
  const map = new Map<number, { platform?: string; tags?: any[] }>()
  if (!ids.length) return map
  try {
    const { app } = electron
    const arcPath = join(app.getPath('userData'), 'bangumi-archive', 'bangumi-archive.db')
    if (!existsSync(arcPath)) return map
    const Database = (await import('better-sqlite3')).default
    const arc = new Database(arcPath, { readonly: true, fileMustExist: true })
    try {
      const ph = ids.map(() => '?').join(',')
      const arcRows = arc
        .prepare(`SELECT id, platform, tags FROM arc_subjects WHERE id IN (${ph})`)
        .all(...ids) as any[]
      const PLAT: Record<number, string> = { 1001: '漫画', 1002: '小说' }
      for (const a of arcRows) {
        let tags: any[] | undefined
        try {
          tags = a.tags ? JSON.parse(a.tags) : undefined
        } catch {
          tags = undefined
        }
        map.set(Number(a.id), {
          platform: a.platform != null ? PLAT[Number(a.platform)] : undefined,
          tags
        })
      }
    } finally {
      arc.close()
    }
  } catch (e) {
    console.warn('[reclassify] 读取 Archive 失败，将回退联网', e)
  }
  return map
}
