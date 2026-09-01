import type { Category, Subject, SearchQuery, SearchResultItem } from '../../../../shared/types'
import { upsertSubject } from '../db/repositories/subjects.repository'
import { getValidToken } from '../auth/oauth'
import {
  searchBangumiByType,
  searchCharacters,
  searchPersons,
  searchBangumiByTag,
  toSubject,
  classifyBookCategory,
  getSubjectDetail,
  mapWithConcurrency,
  BGM_TYPE_TO_CATEGORY
} from './bangumi'
import { dbg } from '../debugLog'

/** 检索子分类 → Bangumi subject type（undefined=全部，按 1/2/4 并行检索） */
function subjectFilterToType(filter: 'all' | 'anime' | 'book' | 'game'): number | undefined {
  if (filter === 'anime') return 2
  if (filter === 'book') return 1
  if (filter === 'game') return 4
  return undefined
}

/**
 * 书籍( Bangumi type=1 )细分为「轻小说 / 漫画」：
 * - v0 检索结果已带 platform 字段（'小说'/'漫画'）→ 直接判定，无需额外请求；
 * - 匿名旧版检索不含 platform → 拉一次详情取 platform 细分（调用方已限并发）。
 */
async function classifyBook(raw: any, token?: string): Promise<Category> {
  if (raw?.platform) return classifyBookCategory(raw)
  try {
    const detail = await getSubjectDetail(String(raw.id), token)
    return classifyBookCategory(raw, detail)
  } catch {
    return 'manga'
  }
}

/**
 * 统一搜索入口：条目（动画/书籍/游戏）或人物（角色/现实）。
 * - 条目：按 Bangumi subject type 检索并归一化为本地 Subject（category 由 type 推导）。
 * - 人物：v0 **实验性**端点（POST /v0/search/characters、/v0/search/persons），
 *   **需 Bearer 令牌**（匿名返回空），虚拟=角色、现实=人物。未登录时抛错提示登录。
 *   主源检索失败（离线/网络/令牌失效）直接抛出，由渲染层显示明确错误，不塞示例数据。
 */
export async function unifiedSearch(query: SearchQuery, signal?: AbortSignal): Promise<SearchResultItem[]> {
  const token = (await getValidToken()) ?? undefined
  dbg('unifiedSearch domain=', query.domain, 'subjectType=', query.subjectType, 'personType=', query.personType, 'tokenPresent=', !!token)
  if (query.domain === 'person') {
    if (!token) {
      throw new Error('请先登录 Bangumi 后再搜索角色 / 人物')
    }
    return searchPersonDomain(query, token, signal)
  }
  return searchSubjectDomain(query, token, signal)
}

async function searchSubjectDomain(
  query: SearchQuery,
  token?: string,
  signal?: AbortSignal
): Promise<SearchResultItem[]> {
  const filter = query.subjectType ?? 'all'
  const rawList: any[] = []
  if (filter === 'all') {
    // 「全部」一次拉全量：searchBangumiByType 默认用 v0 的 filter.type=[1,2,4]（漫画/动画/游戏/小说）
    // 在服务端过滤，既提速又排除音乐(3)/三次元(6)；再由下方按 raw.type 细分栏目。
    const list = await searchBangumiByType(query.keyword, undefined, token, signal).catch((e) => {
      if (signal?.aborted || (e as Error)?.name === 'AbortError') throw e
      return [] as any[]
    })
    rawList.push(...list)
  } else {
    const type = subjectFilterToType(filter)
    const l = await searchBangumiByType(query.keyword, type, token, signal)
    rawList.push(...l)
  }
  // 并行归一化：书籍需细分（匿名时拉详情取 platform，限并发 4 避免打爆）。
  const classified = await mapWithConcurrency(rawList, 4, async (raw) => {
    let category: Category
    if (raw.type === 1 || filter === 'book') {
      category = await classifyBook(raw, token)
    } else if (raw.type === 2) category = 'anime'
    else if (raw.type === 4) category = 'galgame'
    else category = 'manga' // 音乐(3)/三次元(6) 无对应栏目，归漫画仅作展示
    return { raw, category }
  })
  const items: SearchResultItem[] = []
  for (const { raw, category } of classified) {
    const subject = toSubject(raw, category)
    await upsertSubject(subject)
    items.push({ kind: 'subject', subject })
  }
  return items
}

async function searchPersonDomain(
  query: SearchQuery,
  token: string,
  signal?: AbortSignal
): Promise<SearchResultItem[]> {
  const kind = query.personType ?? 'all'
  const specs: { pk: 'character' | 'person'; fn: () => Promise<any[]> }[] = []
  if (kind === 'all' || kind === 'virtual') {
    specs.push({ pk: 'character', fn: () => searchCharacters(query.keyword, token, signal) })
  }
  if (kind === 'all' || kind === 'real') {
    specs.push({ pk: 'person', fn: () => searchPersons(query.keyword, token, signal) })
  }
  // 逐个执行并保留真实错误：某类失败不牵连另一类；两类都失败时抛出首个真实错误
  // （避免把错误吞成 undefined，导致 UI 显示「检索失败：undefined」）。
  const settled = await Promise.all(
    specs.map(async (s) => {
      try {
        const raw = await s.fn()
        return { pk: s.pk, raw, err: null as Error | null }
      } catch (e) {
        return { pk: s.pk, raw: [] as any[], err: e as Error }
      }
    })
  )
  const out: SearchResultItem[] = []
  let anyData = false
  const errors: Error[] = []
  const seenPerson = new Set<string>()
  for (const r of settled) {
    if (r.err) {
      errors.push(r.err)
      continue
    }
    anyData = true
    for (const item of r.raw) {
      // 角色与人物共用同一数字 id 空间，按「类型:id」联合去重，否则同名 id 会互相覆盖
      // （表现为结果里出现「重复」的条目，且前端 :key 冲突导致渲染错乱）。
      const key = `${r.pk}:${item.id}`
      if (seenPerson.has(key)) continue
      seenPerson.add(key)
      out.push(toPersonItem(item, r.pk))
    }
  }
  if (!anyData && errors.length) throw errors[0]
  return out
}

function toPersonItem(raw: any, pk: 'character' | 'person'): SearchResultItem {
  const images = raw.images || {}
  const img = images.medium ?? images.large ?? images.grid ?? images.small ?? raw.image
  // 搜索返回项无 name_cn（中文名在 infobox，需另取详情），故直接使用 name（多为常用名）。
  return {
    kind: 'person',
    id: String(raw.id),
    name: raw.name || '',
    nameCn: raw.name_cn,
    imageUrl: img,
    personKind: pk
  }
}

/** p1 标签搜索请求（渲染层透传到主进程的 /p1/search/subjects） */
export interface TagSearchQuery {
  keyword: string
  tags?: string[]
  metaTags?: string[]
  /** Bangumi 作品类型（1 书籍 / 2 动画 / 3 音乐 / 4 游戏 / 6 三次元） */
  type?: number
  sort?: 'match' | 'heat' | 'rank' | 'score'
}

/**
 * 按标签检索作品（p1）。返回归一化的 SearchResultItem[]（kind='subject'）。
 * p1 SlimSubject 字段为 nameCN/nameCN 驼峰、images.common 等，与 v0 搜索基本一致，
 * 直接复用 toSubject 归一化；type 经 BGM_TYPE_TO_CATEGORY 映射成本地 category。
 * 匿名可调（p1 无令牌也可检索）。
 */
export async function unifiedTagSearch(query: TagSearchQuery, signal?: AbortSignal): Promise<SearchResultItem[]> {
  const token = (await getValidToken()) ?? undefined
  const rawList = await searchBangumiByTag(query.keyword, {
    tags: query.tags,
    metaTags: query.metaTags,
    type: query.type,
    sort: query.sort
  }, token, signal)
  const items: SearchResultItem[] = []
  for (const raw of rawList) {
    const category = BGM_TYPE_TO_CATEGORY[Number(raw.type)] ?? 'manga'
    const subject = toSubject(raw, category)
    await upsertSubject(subject)
    items.push({ kind: 'subject', subject })
  }
  return items
}
