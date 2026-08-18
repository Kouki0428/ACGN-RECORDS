import { getArchiveRank, saveArchiveRank } from './archive/archive.service'
import { getSubjectDetail } from './api/bangumi'

/** 取作品的 Bangumi subject id（provider_subject_id）。 */
function bangumiIdOf(subject: any): string | null {
  const pid = subject?.provider_subject_id ?? subject?.providerSubjectId
  return pid != null && String(pid) !== '' ? String(pid) : null
}

/** 把数字 rank 规范成 '#N' 字符串挂到 subject.rank。 */
function applyRank(subject: any, rank: number | null | undefined): void {
  if (typeof rank === 'number' && rank > 0) subject.rank = '#' + rank
}

/**
 * 离线优先：从 Archive 读取 Bangumi 站点排名（热门作品有值，冷门可能为空）。
 * 仅对 Bangumi 作品生效；非 Bangumi / 无 id 直接跳过。
 */
export async function resolveRank(subject: any): Promise<void> {
  if (subject?.provider !== 'bangumi') return
  const pid = bangumiIdOf(subject)
  if (!pid) return
  try {
    const r = await getArchiveRank(pid)
    applyRank(subject, r)
  } catch {
    /* 忽略，离线无数据 */
  }
}

/**
 * 联网刷新：拉取 Bangumi 实时 rank（匿名可访问），合并进 subject 并写回 Archive。
 * 失败不影响详情其余展示。
 */
export async function updateRankOnline(subject: any): Promise<void> {
  if (subject?.provider !== 'bangumi') return
  const pid = bangumiIdOf(subject)
  if (!pid) return
  try {
    const detail = await getSubjectDetail(String(pid))
    const r = detail?.rank
    if (typeof r === 'number' && r > 0) {
      applyRank(subject, r)
      await saveArchiveRank(pid, r)
    }
  } catch {
    /* 忽略，联网失败不影响其余展示 */
  }
}
