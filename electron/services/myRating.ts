import { getBangumiAccount, getValidToken } from './auth/oauth'
import { getMyCollection } from './api/bangumi'
import { saveCollectionRatingLocal } from './db/repositories/collections.repository'

/**
 * 解析「我的评价」评分（1-10）用于详情页展示：
 * - 本地有未推送改动(dirty=1)：以本地为准（app 内刚改、待同步），不联网、不覆盖。
 * - 否则：若已登录 Bangumi，实时拉取该用户在 Bangumi 上的收藏评分(rate 字段)；
 *   取到则写回本地缓存（不标记 dirty）并返回；取不到则回退本地已缓存值（可能为 null）。
 * 这样用户在 Bangumi 网页端打的分，打开详情页时会立刻反映出来。
 */
export async function resolveMyRating(
  subject: { provider?: string; provider_subject_id?: string } | null | undefined,
  localCollection: { rating?: number | null; dirty?: number } | null | undefined
): Promise<number | null> {
  const isBgm = !!subject && subject.provider === 'bangumi' && !!subject.provider_subject_id
  if (!isBgm) return null

  const localRating = (localCollection as { rating?: number | null } | null)?.rating ?? null
  const localDirty = (localCollection as { dirty?: number } | null)?.dirty ?? 0

  // 本地有未推送改动：以本地为准，避免覆盖 app 内刚点的星
  if (localRating != null && localDirty === 1) return localRating

  // 已登录则实时取 Bangumi 上的我的评分
  try {
    const token = await getValidToken()
    const acct = await getBangumiAccount()
    if (token && acct?.username) {
      const remote = await getMyCollection(subject.provider_subject_id!, token, acct.username)
      const rate = remote && typeof remote.rate === 'number' ? remote.rate : null
      if (rate != null) {
        await saveCollectionRatingLocal(subject.provider_subject_id!, rate)
        return rate
      }
    }
  } catch (e) {
    console.warn('[resolveMyRating] 拉取 Bangumi 我的评分失败（不影响详情）：', e)
  }

  // 远端取不到：回退本地（已缓存或 null）
  return localRating
}
