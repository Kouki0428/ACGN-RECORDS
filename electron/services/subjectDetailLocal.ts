import { getDb } from './db/connection'
import { loadSubjectMeta } from './db/repositories/subjectMeta'
import { loadSubjectExtra } from './db/repositories/subjectExtra.repository'
import { resolveRatingDistribution } from './ratingDistribution'
import { resolveRank } from './subjectRank'
import { resolveScore } from './subjectScore'

export interface LocalSubjectDetail {
  subject: any
  collection: any
  characters: any[]
  relations: any[]
}

/**
 * 取作品本地详情（不联网）：直接返回已缓存的评分 / 标签 / 制作信息 + 角色 / 关联作品，
 * 供「本地优先」即时展示。评分均分优先主库 subjects.rating，主库无值时回退 Archive
 * 离线库（全量 dump 自带，离线即可读），从而避免打开即转圈。
 *
 * @param resolveBy  本地 subjects 主键（isProvider=false）或 Bangumi provider subject id（isProvider=true）
 * @param isProvider true 时按 Bangumi provider id 反查本地主键
 */
export async function getSubjectDetailLocal(
  resolveBy: number | string,
  isProvider = false
): Promise<LocalSubjectDetail> {
  const db = await getDb()
  let localId: number | undefined
  if (isProvider) {
    const row = db
      .prepare("SELECT id FROM subjects WHERE provider = 'bangumi' AND provider_subject_id = ?")
      .get(String(resolveBy)) as { id: number } | undefined
    if (!row) return { subject: null, collection: null, characters: [], relations: [] }
    localId = row.id
  } else {
    localId = Number(resolveBy)
  }
  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(localId)
  if (!subject) return { subject: null, collection: null, characters: [], relations: [] }
  const collection = db
    .prepare('SELECT * FROM collections WHERE subject_id = ? ORDER BY id DESC LIMIT 1')
    .get(localId)
  const { tags, meta, rating, metaTags } = await loadSubjectMeta(subject)
  subject.tags = tags
  subject.meta = meta
  subject.metaTags = metaTags
  if (typeof rating === 'number') subject.rating = rating
  // subjects.series 在库中存为 INTEGER(0/1/null)，本地优先通道直接返回原始整数，
  // 而渲染层门控用 `series !== false`：JS 里 `0 !== false` 为 true，会导致「非系列书」
  // 在本地优先阶段误显示「已读卷」、等联网补全拿到布尔 false 才隐藏的闪烁。
  // 这里把整数归一化成布尔/null，与联网通道（collection:detail 返回布尔）保持一致。
  subject.series = subject.series == null ? null : !!subject.series
  // 站点均分 / 评分分布 / 站点排名：三者都查 Archive 离线库，彼此独立 → 并行化，
  // 把三段顺序 await 的延迟从「三者之和」降到「最长一段」，缩短悬浮窗本地详情的首屏耗时。
  await Promise.all([
    resolveScore(subject),
    resolveRatingDistribution(subject),
    resolveRank(subject)
  ])
  // 本地优先通道：仅用「缓存 + 离线 Archive」即时返回（online:false 不联网），
  // 详情秒开、中文名走 Archive 同步补全。在线列表/头像与极少数缺失的
  // 中文名由后续联网路径 + 后台推送补齐，避免在此同步等待网络卡死。
  const { characters, relations } = await loadSubjectExtra(subject, undefined, { online: false })
  return {
    subject,
    collection: collection ?? null,
    characters,
    relations
  }
}
