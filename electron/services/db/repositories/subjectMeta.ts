import { getDb } from '../connection'
import { getValidToken } from '../../auth/oauth'
import { getSubjectDetail, parseSubjectMeta } from '../../api/bangumi'
import { parseBangumiInfoboxLinks } from '../../api/cg'
import { saveExternalLink, getExternalLinks } from './externalLinks.repository'
import { getArchiveSubjectMeta } from '../../archive/archive.service'
import type { SubjectTag, SubjectMeta } from '../../../../shared/types'

function parseJsonCol<T>(v: any): T | null {
  if (v == null) return null
  if (typeof v !== 'string') return v as T
  try {
    return JSON.parse(v) as T
  } catch {
    return null
  }
}

/**
 * 仅从本地数据库列（subjects.tags / subjects.infobox / subjects.rating）解析，不触发任何联网。
 * 供「本地优先」详情使用：打开详情时先展示已缓存的评分/标签/制作信息，再后台联网补全。
 */
export function parseSubjectColumns(row: any): {
  tags: SubjectTag[]
  meta: SubjectMeta[]
  rating: number | null
  metaTags: string[]
} {
  const tags = parseJsonCol<SubjectTag[]>(row?.tags) ?? []
  const meta = parseJsonCol<SubjectMeta[]>(row?.infobox) ?? []
  const metaTags = parseJsonCol<string[]>(row?.meta_tags) ?? []
  const rating =
    typeof row?.rating === 'number' && isFinite(row.rating) ? row.rating : null
  return { tags, meta, rating, metaTags }
}

/**
 * 离线优先读取作品的标签与制作信息。
 * - 本地已缓存（subjects.tags / subjects.infobox 有值）且评分已有：直接返回，省去一切读取。
 * - 本地未缓存时，从离线 Archive 库（arc_subjects 的 tags / infobox / score）秒取——
 *   这是「未登录用户也能看到制作信息」的关键：此前本地 subjects 为空时从不读离线库，导致一直空白。
 * - 取到的离线数据会写回本地 subjects 列，使后续 detailLocal（首屏）直接读到，无需重复读 Archive / 联网。
 * 返回解析后的数组，供 IPC 透传给渲染进程。该函数**不联网**；联网补全由 refreshSubjectMeta 后台完成。
 */
export async function loadSubjectMeta(subject: any): Promise<{
  tags: SubjectTag[]
  meta: SubjectMeta[]
  /** Bangumi 评分（10 分制 1 位小数）；离线缓存命中时取 DB 值，离线 Archive 命中时取 arc_subjects.score */
  rating: number | null
  /** 官方/系统标签（来自 Bangumi meta_tags 顶层字符串数组） */
  metaTags: string[]
}> {
  let tags = parseJsonCol<SubjectTag[]>(subject?.tags)
  let meta = parseJsonCol<SubjectMeta[]>(subject?.infobox)
  let metaTags = parseJsonCol<string[]>(subject?.meta_tags) ?? []
  let rating =
    typeof subject?.rating === 'number' && isFinite(subject.rating) ? subject.rating : null

  const hasCache = (tags && tags.length) || (meta && meta.length)
  // 已缓存且评分也已有：直接返回，省去一切读取
  if (hasCache && rating != null) {
    return { tags: tags ?? [], meta: meta ?? [], rating, metaTags }
  }
  if (subject?.provider !== 'bangumi' || !subject?.provider_subject_id) {
    return { tags: tags ?? [], meta: meta ?? [], rating, metaTags }
  }

  // 离线优先：本地未缓存时，从离线 Archive 库秒取标签/制作信息/评分，让未登录用户也能立即看到制作信息
  try {
    const arc = await getArchiveSubjectMeta(Number(subject.provider_subject_id))
    if (arc && ((arc.tags && arc.tags.length) || (arc.meta && arc.meta.length) || arc.rating != null)) {
      const mergedTags = tags && tags.length ? tags : arc.tags
      const mergedMeta = meta && meta.length ? meta : arc.meta
      const mergedMetaTags = metaTags && metaTags.length ? metaTags : arc.metaTags
      const mergedRating = rating != null ? rating : arc.rating
      const nsfw = subject?.nsfw ? true : !!arc.nsfw
      // 写回本地 subjects 列：下次 detailLocal（首屏）即可直接读到，无需重复读 Archive / 联网
      try {
        const db = await getDb()
        db.prepare(
          'UPDATE subjects SET tags = ?, infobox = ?, meta_tags = ?, rating = ?, nsfw = ? WHERE id = ?'
        ).run(
          JSON.stringify(mergedTags ?? []),
          JSON.stringify(mergedMeta ?? []),
          JSON.stringify(mergedMetaTags ?? []),
          mergedRating ?? null,
          nsfw ? 1 : 0,
          subject.id
        )
      } catch (e) {
        console.warn('[meta] 离线数据写回本地失败（忽略）：', e)
      }
      return {
        tags: mergedTags ?? [],
        meta: mergedMeta ?? [],
        rating: mergedRating ?? null,
        metaTags: mergedMetaTags ?? []
      }
    }
  } catch (e) {
    console.warn('[meta] 离线 Archive 取标签/制作信息失败（忽略）：', e)
  }

  // 既无本地缓存也无离线数据的兜底：返回当前已有的（可能为空），由 refreshSubjectMeta 联网补全
  return { tags: tags ?? [], meta: meta ?? [], rating, metaTags }
}

/**
 * 后台联网补全标签/制作信息/评分（需 Bangumi 令牌，匿名不可用——R18 等还需账号开启成人内容）。
 *
 * 设计为**不阻塞**详情主流程：先由 loadSubjectMeta 用本地缓存 + 离线 Archive 库秒填，
 * 这里取权威数据后通过 subjectExtra:metaUpdated 事件推前端就地替换（即用户要求的「先离线填充、后联网替换」）。
 * 仅在已登录且有令牌时触发；无令牌或联网失败则静默跳过，离线 Archive 数据已足够展示。
 *
 * 注意：若在线评分缺失，保留已秒显的离线评分（subject.rating），避免被冲成 null。
 */
export async function refreshSubjectMeta(
  event: { sender?: { send?: (channel: string, ...args: unknown[]) => void } } | undefined,
  subject: any
): Promise<void> {
  if (subject?.provider !== 'bangumi' || !subject?.provider_subject_id) return
  let token: string | null = null
  try {
    token = await getValidToken()
  } catch {
    token = null
  }
  if (!token) return
  try {
    const detail = await getSubjectDetail(String(subject.provider_subject_id), token)
    const parsed = parseSubjectMeta(detail)
    const bgmRating = typeof detail?.rating?.score === 'number' ? detail.rating.score : null
    const mergedRating = bgmRating ?? subject.rating ?? null
    const nsfw = subject?.nsfw ? true : !!detail?.nsfw
    const db = await getDb()
    db.prepare('UPDATE subjects SET tags = ?, infobox = ?, meta_tags = ?, rating = ?, nsfw = ? WHERE id = ?').run(
      JSON.stringify(parsed.tags),
      JSON.stringify(parsed.meta),
      JSON.stringify(parsed.metaTags ?? []),
      mergedRating,
      nsfw ? 1 : 0,
      subject.id
    )

    // 顺带解析并缓存外链（VNDB / DLsite / Steam），供 CG 画廊使用（对齐「游戏画廊」组件：从 infobox 取真实外链）
    try {
      const existing = await getExternalLinks(subject.id)
      if (!existing.vndb && !existing.dlsite && !existing.steam) {
        const links = parseBangumiInfoboxLinks(detail?.infobox)
        if (links.vndb) await saveExternalLink(subject.id, 'vndb', links.vndb)
        if (links.dlsite) await saveExternalLink(subject.id, 'dlsite', links.dlsite)
        if (links.steam) await saveExternalLink(subject.id, 'steam', links.steam)
      }
    } catch (e) {
      console.warn('[meta] 外链解析失败（忽略）：', e)
    }

    // 推前端：用权威数据就地替换（若在线评分缺失，保留已秒显的离线评分，避免被冲成 null）
    event?.sender?.send?.('subjectExtra:metaUpdated', {
      subjectId: subject.id,
      tags: parsed.tags,
      meta: parsed.meta,
      rating: mergedRating,
      metaTags: parsed.metaTags ?? []
    })
  } catch (e) {
    console.warn('[meta] 在线补全标签/制作信息失败（保留离线 Archive 数据）：', e)
  }
}
