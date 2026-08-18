import { getArchiveScore, saveArchiveScore, traceScore } from './archive/archive.service'
import { getSubjectDetail } from './api/bangumi'
import { getDb } from './db/connection'

/** 取作品的 Bangumi subject id（provider_subject_id）。 */
function bangumiIdOf(subject: any): string | null {
  const pid = subject?.provider_subject_id ?? subject?.providerSubjectId
  return pid != null && String(pid) !== '' ? String(pid) : null
}

/**
 * 离线优先：从 Archive 读取 Bangumi 站点均分（score，全量 dump 自带，离线即可读），
 * 填充 subject.rating。仅对 Bangumi 作品生效；主库已有缓存（subjects.rating）时不覆盖。
 * 非 Bangumi / 无 id / 离线库无数据时直接跳过（subject.rating 保持原值）。
 */
export async function resolveScore(subject: any): Promise<void> {
  if (subject?.provider !== 'bangumi') {
    traceScore('resolveScore', 'SKIP provider=' + subject?.provider)
    console.warn('[resolveScore] SKIP provider=', subject?.provider)
    return
  }
  if (typeof subject.rating === 'number' && isFinite(subject.rating)) {
    traceScore('resolveScore', 'SKIP already rating=' + subject.rating)
    console.warn('[resolveScore] SKIP already rating=', subject.rating)
    return
  }
  const pid = bangumiIdOf(subject)
  if (!pid) {
    traceScore('resolveScore', 'SKIP no pid')
    console.warn('[resolveScore] SKIP no pid (provider_subject_id=', subject?.provider_subject_id, 'providerSubjectId=', subject?.providerSubjectId, ')')
    return
  }
  try {
    const s = await getArchiveScore(pid)
    traceScore('resolveScore', 'pid=' + pid + ' archiveScore=' + s + ' -> subject.rating=' + (typeof s === 'number' ? s : subject.rating))
    console.warn(`[resolveScore] pid=${pid} archiveScore=${s} -> subject.rating=${typeof s === 'number' ? s : subject.rating}`)
    if (typeof s === 'number') {
      subject.rating = s
      // 把离线 Archive 评分写回主库 subjects.rating：使其成为持久缓存，
      // 之后即便 Archive 离线库暂时打不开，主库缓存也能即时显示，杜绝「暂无评分」反复出现。
      try {
        const db = await getDb()
        db.prepare(
          "UPDATE subjects SET rating = ?, updated_at = ? WHERE provider = 'bangumi' AND provider_subject_id = ?"
        ).run(s, Date.now(), pid)
      } catch {
        /* 写回失败不影响本次展示 */
      }
    }
  } catch {
    /* 忽略，离线无数据 */
  }
}

/**
 * 联网刷新：拉取 Bangumi 实时均分（匿名可访问），合并进 subject.rating 并写回 Archive。
 * 失败不影响详情其余展示。仅对 Bangumi 作品生效。
 */
export async function updateScoreOnline(subject: any): Promise<void> {
  if (subject?.provider !== 'bangumi') return
  const pid = bangumiIdOf(subject)
  if (!pid) return
  try {
    const detail = await getSubjectDetail(String(pid))
    const s = typeof detail?.rating?.score === 'number' ? detail.rating.score : null
    if (s != null) {
      subject.rating = s
      await saveArchiveScore(pid, s)
    }
  } catch {
    /* 忽略，联网失败不影响其余展示 */
  }
}
