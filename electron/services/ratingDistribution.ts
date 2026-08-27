import { getSubjectDetail } from './api/bangumi'
import { getArchiveRatingDistribution, saveArchiveRatingDistribution } from './archive/archive.service'
import { saveSubjectRatingDistribution } from './db/repositories/subjects.repository'

export interface RatingDistribution {
  /** 长度 10：索引 i 对应 (i+1) 星的票数（1–10 星） */
  ratingCount: number[]
  /** 总票数 */
  ratingTotal: number
}

/**
 * 取 Bangumi 作品的评分分布（1–10 星各自的票数）。
 * 仅在作品为 Bangumi 来源时有效；取不到返回 null（不抛错，详情主体不受此影响）。
 */
export async function fetchRatingDistribution(subject: {
  provider?: string
  providerSubjectId?: string
  provider_subject_id?: string
}): Promise<RatingDistribution | null> {
  const pid = subject?.providerSubjectId ?? subject?.provider_subject_id
  if (subject?.provider !== 'bangumi' || !pid) return null
  try {
    const raw = await getSubjectDetail(String(pid))
    const r = raw?.rating
    if (!r || typeof r !== 'object' || !r.count) return null
    const count = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => Number((r.count as any)[k]) || 0)
    const total = typeof r.total === 'number' ? r.total : count.reduce((a, b) => a + b, 0)
    return { ratingCount: count, ratingTotal: total }
  } catch (e) {
    console.warn('[fetchRatingDistribution] 取评分分布失败（忽略）：', e)
    return null
  }
}

/**
 * 从 DB 行（snake_case 缓存列 rating_count/rating_total）把评分分布解析并挂到
 * 运行时 subject 对象（camelCase 的 ratingCount/ratingTotal），供离线详情页柱状图使用。
 * 无缓存（rating_count 为空或解析失败）则不动 subject。纯函数，不触碰数据库。
 */
export function applyCachedRatingDistribution(row: any): void {
  if (!row || !row.rating_count) return
  try {
    const arr = JSON.parse(row.rating_count)
    if (!Array.isArray(arr)) return
    row.ratingCount = arr
    row.ratingTotal =
      typeof row.rating_total === 'number'
        ? row.rating_total
        : arr.reduce((a: number, b: number) => a + b, 0)
  } catch {
    /* 缓存损坏忽略 */
  }
}

/** 取 Bangumi subject id（兼容 camelCase / snake_case 字段） */
function resolvePid(subject: any): string | null {
  const pid = subject?.providerSubjectId ?? subject?.provider_subject_id
  return subject?.provider === 'bangumi' && pid ? String(pid) : null
}

/**
 * 解析评分分布，优先级：Archive 离线库（score_details 列，dump 自带，离线即可用）
 * → 主库缓存（rating_count/rating_total 列，仅作兜底）。不联网，离线通道可安全调用。
 * 挂到 subject.ratingCount/ratingTotal。
 */
export async function resolveRatingDistribution(subject: any): Promise<void> {
  const pid = resolvePid(subject)
  if (!pid) return
  try {
    const arc = await getArchiveRatingDistribution(Number(pid))
    if (arc) {
      subject.ratingCount = arc.ratingCount
      subject.ratingTotal = arc.ratingTotal
      return
    }
  } catch {
    /* 离线库不可用，继续兜底 */
  }
  // 兜底：主库缓存（上轮已落库到 bangumi-for-pc.db.subjects.rating_count）
  applyCachedRatingDistribution(subject)
}

/**
 * 打开详情时联网更新评分分布：从 Bangumi 取最新分布，写回 Archive 离线库（优先），
 * Archive 不可用时回退主库缓存。最终把最新数据挂到 subject。不抛错。
 */
export async function updateRatingDistributionOnline(subject: any): Promise<void> {
  const pid = resolvePid(subject)
  if (!pid) return
  const dist = await fetchRatingDistribution(subject)
  if (!dist) return
  subject.ratingCount = dist.ratingCount
  subject.ratingTotal = dist.ratingTotal
  try {
    await saveArchiveRatingDistribution(Number(pid), dist.ratingCount, dist.ratingTotal)
  } catch (e) {
    console.warn('[updateRatingDistributionOnline] 写 Archive 失败，回退主库缓存：', e)
    try {
      await saveSubjectRatingDistribution(subject.id, dist.ratingCount, dist.ratingTotal)
    } catch {
      /* 主库兜底也失败则忽略 */
    }
  }
}
