import type { Category, Subject } from '../../../../shared/types'

const BASE = 'https://api.themoviedb.org/3'

/**
 * TMDB 适配器（动画元数据补充源）。
 * 鉴权：v3 API Key（query 参数）或 v4 Bearer Token（Authorization 头）。
 * 本应用为个人本地工具，API Key 由用户在设置页填入，存于 settings（明文，仅本机）。
 */
export async function searchTmdb(keyword: string, apiKey: string): Promise<any[]> {
  const url = new URL(`${BASE}/search/tv`)
  url.searchParams.set('query', keyword)
  url.searchParams.set('language', 'zh-CN')
  url.searchParams.set('include_adult', 'false')
  url.searchParams.set('page', '1')

  const headers: Record<string, string> = { Accept: 'application/json' }
  // v4 token 通常以 JWT 形式（eyJ...）出现，走 Bearer；其余按 v3 api_key 处理
  if (apiKey.trimStart().startsWith('eyJ')) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  } else {
    url.searchParams.set('api_key', apiKey.trim())
  }

  const res = await fetch(url.toString(), { headers })
  if (!res.ok) throw new Error(`TMDB 检索失败 (HTTP ${res.status})`)
  const json = (await res.json()) as { results?: any[] }
  return json.results ?? []
}

/** 把 TMDB 原始条目归一化为统一 Subject（仅在动画检索时调用）。 */
export function toTmdbSubject(raw: any, category: Category = 'anime'): Subject {
  return {
    provider: 'tmdb',
    providerSubjectId: String(raw.id),
    category,
    title: raw.original_name || raw.name || '', // 原名
    titleCn: raw.name, // 中文显示名
    summary: raw.overview,
    imageUrl: raw.poster_path ? `https://image.tmdb.org/t/p/w300${raw.poster_path}` : undefined,
    airDate: raw.first_air_date,
    rating: raw.vote_average
  }
}
