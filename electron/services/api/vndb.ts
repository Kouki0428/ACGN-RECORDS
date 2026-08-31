import type { Category, Subject } from '../../../../shared/types'

// VNDB Kana API（v2）：POST JSON 到 /kana/vn
const BASE = 'https://api.vndb.org/kana/vn'

// VNDB 建议提供 UA；匿名检索也有较严格限流（200 次/5 分钟）
export const VNDB_UA = 'Bangumi-For-PC/0.1 (https://github.com/Kouki0428/Bangumi-For-PC)'
const UA = VNDB_UA

function vndbHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': UA
  }
  if (token) h.Authorization = `Token ${token}`
  return h
}

/**
 * VNDB 适配器（Galgame 辅助源），使用 Kana API（GraphQL 风格 JSON 查询）。
 * 鉴权：可选 token，存于 settings。匿名也可检索（限流更严）。
 * 注意：Kana API 的 token 用 `Authorization: Token <token>`（不是 Bearer）。
 */
export async function searchVndb(keyword: string, token?: string): Promise<any[]> {
  const body = {
    filters: ['search', '=', keyword],
    fields: 'title, alttitle, image.url, released, rating, description, developers.name',
    results: 20
  }

  const res = await fetch(BASE, { method: 'POST', headers: vndbHeaders(token), body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`VNDB 检索失败 (HTTP ${res.status})`)
  const json = (await res.json()) as { results?: any[] }
  return json.results ?? []
}

/** 按 VNDB id 取详情（封面图 / 标题），用于画廊封面 */
export async function getVnDetails(
  vndbId: string,
  token?: string
): Promise<{ imageUrl?: string; title?: string }> {
  const body = { filters: ['id', '=', vndbId], fields: 'title, image.url', results: 1 }
  const res = await fetch(BASE, { method: 'POST', headers: vndbHeaders(token), body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`VNDB 详情失败 (HTTP ${res.status})`)
  const json = (await res.json()) as { results?: any[] }
  const r = json.results?.[0]
  return { imageUrl: r?.image?.url, title: r?.title }
}

/** 取某 VN 的角色图（画廊用），最多 24 个 */
export async function getVnCharacters(
  vndbId: string,
  token?: string
): Promise<{ imageUrl?: string; name?: string }[]> {
  const body = { filters: ['vn', '=', [vndbId]], fields: 'image.url, name', results: 24 }
  const res = await fetch('https://api.vndb.org/kana/character', {
    method: 'POST',
    headers: vndbHeaders(token),
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`VNDB 角色失败 (HTTP ${res.status})`)
  const json = (await res.json()) as { results?: any[] }
  return (json.results ?? [])
    .map((c) => ({ imageUrl: c.image?.url, name: c.name }))
    .filter((c) => c.imageUrl)
}

/** 取某 VN 的外部链接（用于从 VNDB 自动解析 Steam / DLsite） */
export async function getVnExtlinks(vndbId: string, token?: string): Promise<any[]> {
  const body = { filters: ['id', '=', vndbId], fields: 'extlinks', results: 1 }
  const res = await fetch(BASE, { method: 'POST', headers: vndbHeaders(token), body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`VNDB extlinks 失败 (HTTP ${res.status})`)
  const json = (await res.json()) as { results?: any[] }
  return json.results?.[0]?.extlinks ?? []
}

/**
 * 取某 VN 的真实游戏截图（CG）。VNDB 的 screenshots 字段即游戏内截图，
 * 带 sexual / violence 分级（0-3），>=2 视为 R18。这是「游戏画廊」组件的主力图源。
 * 同时返回该 VN 在 VNDB 的评分（rating 0-10，rating_count 为投票人数），供 Galgame 区展示。
 */
export async function getVnScreenshots(
  vndbId: string,
  token?: string
): Promise<{
  shots: { url: string; thumb?: string; nsfw: boolean }[]
  rating?: number
  ratingCount?: number
}> {
  const body = {
    filters: ['id', '=', vndbId],
    // 注意：Kana API 无 rating_count / ratingCount 字段（请求会 400 导致整条失败），
    // 投票数正确字段是 votecount；rating 保留用于 Galgame 区展示。
    fields:
      'id,rating,votecount,screenshots{id,url,dims,sexual,violence,thumbnail,thumbnail_dims}',
    results: 1
  }
  const res = await fetch(BASE, { method: 'POST', headers: vndbHeaders(token), body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`VNDB 截图失败 (HTTP ${res.status})`)
  const json = (await res.json()) as { results?: any[] }
  const vn = json.results?.[0]
  const shots = (vn?.screenshots ?? []).map((s: any) => ({
    url: s.url,
    thumb: s.thumbnail,
    nsfw: (s.sexual ?? 0) >= 2 || (s.violence ?? 0) >= 2
  }))
  const rating = typeof vn?.rating === 'number' ? vn.rating : undefined
  const ratingCount = typeof vn?.votecount === 'number' ? vn.votecount : undefined
  return { shots, rating, ratingCount }
}

/** 把 VNDB 原始条目归一化为统一 Subject（仅在 galgame 检索时调用）。 */
export function toVndbSubject(raw: any, category: Category = 'galgame'): Subject {
  return {
    provider: 'vndb',
    providerSubjectId: String(raw.id),
    category,
    title: raw.title ?? '',
    titleCn: raw.alttitle,
    summary: raw.description,
    imageUrl: raw.image?.url,
    airDate: raw.released,
    rating: raw.rating
  }
}
