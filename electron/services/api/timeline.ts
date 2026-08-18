import { safeFetch } from './http'

/**
 * Bangumi「时间胶囊 / 操作历史」数据。
 *
 * 重要：Bangumi v0 官方 OpenAPI **没有**时间胶囊 / 操作历史的端点。该数据只能从
 * `https://bgm.tv/user/{username}/timeline` 的只读 HTML 解析得到（公开页面，无需令牌，
 * 按 username 取）。本模块即做这件事。
 *
 * 真实 HTML 结构（已对照 bgm.tv 实际页面核对）：
 *   <h4 class="Header">今天</h4>                ← 分组标题（今天/昨天/绝对日期）
 *   <ul>
 *     <li id="tml_{id}" class="clearit tml_item" ...>
 *       <span class="info_full clearit">
 *         看过 <a href=".../subject/ep/1345842" class="l">ep.4 Though the Heavens Fall</a>  ← 看单集：首 a 是 ep 链接
 *         <div class="card card_tiny ">           ← 看过/在读整部时首 a 直接是 subject 链接
 *           <div class="container">
 *             <a href=".../subject/494608"><span class="cover"><img src="//lain.bgm.tv/..."></span></a>
 *             <div class="inner">
 *               <p class="title"><a href=".../subject/494608">中文名 <small class="subtitle grey">原名</small></a></p>
 *               <p class="info tip">8话 / 2026年4月8日 / ...</p>
 *               <p class="rateInfo"><span.../><small class="fade">5.1</small> <small class="rate_total">(199)</small></p>
 *             </div>
 *           </div>
 *         </div>
 *         <div class="post_actions date">
 *           <span title="2026-8-10 16:01" class="titleTip">13小时59分钟前</span> · <small class="grey"><a href="https://next.bgm.tv">next</a></small>
 *         </div>
 *       </span>
 *     </li>
 *   </ul>
 * 注：加好友等非条目动态无 subject 链接，会被跳过。
 */

/** 时间胶囊里涉及的作品引用（单条目 1 个，多条目如「想读 X、Y 2 本书」为多个） */
export interface TimelineSubjectRef {
  subjectId: number
  cover?: string
  title?: string
  subtitle?: string
}

export interface TimelineItem {
  id: string
  group: string
  action: string
  actionLine: string
  /** 涉及的作品（单条目 1 个；多条目如「想读 X、Y 2 本书」为多个）。封面左右排列用此数组 */
  subjects: TimelineSubjectRef[]
  subjectId: number
  title?: string
  subtitle?: string
  cover?: string
  episode?: string
  episodeId?: number
  info?: string
  /** 用户本人评分（0-10），仅已收藏动作且有 starlight starsN 时；单集/多条目为 undefined */
  myRating?: number
  /** 站点总评分（如 5.1） */
  siteRating?: number
  siteRatingCount?: number
  rank?: string
  /** 是否显示评分：单集/多条目为 false */
  showRating: boolean
  comment?: string
  time: string
  timeAbs?: string
  source?: string
}

const UA = 'yhq18/ACGN-Records/0.1 (https://github.com/yhq18/acgn-records)'

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 时间胶囊单页数据（解析自 bgm.tv/user/{username}/timeline 的只读 HTML）。 */
export interface TimelinePage {
  /** 本页动态列表 */
  items: TimelineItem[]
  /** 当前页码（从 1 开始） */
  page: number
  /** 是否有上一页（page_inner 中存在「上一页」链接） */
  hasPrev: boolean
  /** 是否有下一页（page_inner 中存在「下一页」链接） */
  hasNext: boolean
}

/** 抓取并解析某用户的时间胶囊（只读 HTML 解析，非官方 API）。支持分页。 */
export async function fetchTimeline(username: string, page = 1): Promise<TimelinePage> {
  const base = `https://bgm.tv/user/${encodeURIComponent(username)}/timeline`
  const url = page > 1 ? `${base}?page=${page}` : base
  const res = await safeFetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }
  })
  if (!res.ok) {
    throw new Error(`时间胶囊页面获取失败（HTTP ${res.status}）`)
  }
  const html = await res.text()
  const items = parseTimeline(html, 60)
  const { hasPrev, hasNext } = parsePager(html)
  return { items, page, hasPrev, hasNext }
}

/**
 * 解析时间线底部分页：<div class="page_inner"> 内的「上一页 / 下一页」文字链接。
 * 单页（无 page_inner）时两者均为 false。
 */
function parsePager(html: string): { hasPrev: boolean; hasNext: boolean } {
  const m = html.match(/<div class="page_inner"[^>]*>([\s\S]*?)<\/div>/)
  const inner = m ? m[1] : ''
  return {
    hasPrev: /上一页/.test(inner),
    hasNext: /下一页/.test(inner)
  }
}

/** 从时间线 HTML 解析出动态列表（纯函数，便于单测与复用）。 */
export function parseTimeline(html: string, limit = 30): TimelineItem[] {
  const items: TimelineItem[] = []
  // 顺序扫描：分组标题 <h4 class="Header"> 或 条目 <li id="tml_{id}">
  const tokenRe =
    /<h4 class="Header">([\s\S]*?)<\/h4>|<li id="tml_(\d+)"[^>]*>([\s\S]*?)<\/li>/g
  let group = ''
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(html)) && items.length < limit) {
    if (m[1] !== undefined) {
      group = decode(m[1])
      continue
    }
    const id = m[2]
    const block = m[3]
    const item = parseItem(id, group, block)
    if (item) items.push(item)
  }
  return items
}

function parseItem(id: string, group: string, block: string): TimelineItem | null {
  // 动作词：info_full 中第一个 <a> 之前的文本
  const am = block.match(/<span class="info_full clearit">([\s\S]*?)<a[ >]/)
  const action = am ? decode(am[1]).replace(/\s+$/, '') : ''

  // 首行完整文本：info_full 中到首个 <div class="card / <div class="collectInfo / <div class="post_actions 为止
  // （collectInfo 里是「评价+短评」，需单独解析，不能并进首行）
  let actionLine = ''
  const fm = block.match(
    /<span class="info_full clearit">([\s\S]*?)(<div class="(?:card|collectInfo|post_actions))/i
  )
  if (fm) {
    actionLine = decode(fm[1])
  }

  // 单集链接（看过/在读某集）
  const epM = block.match(
    /<a href="https?:\/\/bgm\.tv\/subject\/ep\/(\d+)"[^>]*>([\s\S]*?)<\/a>/
  )
  const episode = epM ? decode(epM[2]) : undefined
  const episodeId = epM ? Number(epM[1]) : undefined

  // 提取所有「作品 + 封面」：<a href="/subject/{id}"><span class="cover"><img src=...>
  const coverMap = new Map<number, string>()
  for (const cm of block.matchAll(
    /<a href="https?:\/\/bgm\.tv\/subject\/(\d+)"[^>]*>\s*<span class="cover"><img src="([^"]+)"/g
  )) {
    const sid = Number(cm[1])
    let c = cm[2]
    if (c.startsWith('//')) c = 'https:' + c
    if (!coverMap.has(sid)) coverMap.set(sid, c)
  }
  // 提取所有「作品 + 标题/原名」：<p class="title"><a href="/subject/{id}">...</a>
  const titleMap = new Map<number, { title?: string; subtitle?: string }>()
  for (const tm of block.matchAll(
    /<p class="title">\s*<a href="https?:\/\/bgm\.tv\/subject\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g
  )) {
    const sid = Number(tm[1])
    const inner = tm[2]
    const title = decode(inner.replace(/<small[\s\S]*?<\/small>/g, ''))
    const subM = inner.match(/<small class="subtitle grey">([\s\S]*?)<\/small>/)
    const subtitle = subM ? decode(subM[1]) : undefined
    if (!titleMap.has(sid)) titleMap.set(sid, { title, subtitle })
  }
  // 合并为 subjects（优先按 titleMap 顺序，再补 coverMap 独有 id）
  const order: number[] = []
  for (const sid of titleMap.keys()) if (!order.includes(sid)) order.push(sid)
  for (const sid of coverMap.keys()) if (!order.includes(sid)) order.push(sid)
  const subjects: TimelineSubjectRef[] = order.map((sid) => ({
    subjectId: sid,
    cover: coverMap.get(sid),
    ...(titleMap.get(sid) || {})
  }))
  // 没有 subject 链接（如加好友动态）→ 跳过
  if (!subjects.length) return null

  const subjectId = subjects[0].subjectId
  const title = subjects[0].title
  const subtitle = subjects[0].subtitle
  const cover = subjects[0].cover

  // 元信息行
  const infoM = block.match(/<p class="info tip">([\s\S]*?)<\/p>/)
  const info = infoM ? decode(infoM[1]) : undefined

  // 评分区分（关键：用户个人评分与站点总评来源不同，严禁混用）
  // - 站点总评分：rateInfo 里的 <small class="fade">X.X</small>（小数，如 7.8）
  // - 站点评分人数：rateInfo 里的 rate_total (N)
  // - 站点排名：rank #N
  // - 用户个人评分：collectInfo 里的「starstop-s」→ starlight starsN。
  //   注意 rateInfo 里同样有 starlight starsN，但那恒等于 round(站点总评)，
  //   绝不代表用户本人打分——本人打分只藏在 collectInfo 的 starstop-s 内。
  const fadeM = block.match(/<small class="fade">([\d.]+)<\/small>/)
  const cntM = block.match(/<small class="rate_total">\((\d+)\)<\/small>/)
  const rankM = block.match(/<span class="rank">#(\d+)<\/span>/)
  const myStarM = block.match(/class="starstop-s"[^>]*>[\s\S]*?starlight stars(\d+)/)
  const siteRating = fadeM ? Number(fadeM[1]) : undefined
  const siteRatingCount = cntM ? Number(cntM[1]) : undefined
  const rank = rankM ? '#' + rankM[1] : undefined
  // 用户个人评分：仅当 collectInfo 内存在 starstop-s 星级（即本人确实打了分）
  const myRating = myStarM ? Number(myStarM[1]) : undefined

  const isEpisode = !!episodeId
  const isMulti = subjects.length > 1
  // 单集 / 多条目动态不显示评分（用户个人评分也随之不显示）
  const showRating = !isEpisode && !isMulti

  // 时间（相对 + 绝对）
  const tipM = block.match(
    /<span title="([^"]*)" class="titleTip">([\s\S]*?)<\/span>/
  )
  const time = tipM ? decode(tipM[2]) : ''
  const timeAbs = tipM ? tipM[1] : undefined

  // 来源：post_actions 中最后一个「·」之后（带「回复」链接的条目会有多个「·」）
  let source: string | undefined
  const paM = block.match(/<div class="post_actions date">([\s\S]*?)<\/div>/)
  if (paM) {
    const parts = paM[1].split('·')
    if (parts.length > 1) {
      const raw = decode(parts[parts.length - 1]).replace(/\s+/g, ' ').trim()
      source = /next\.bgm\.tv/.test(paM[1]) ? 'API' : raw || undefined
    }
  }

  // 评论（可选）
  let comment: string | undefined
  const cmM = block.match(/<div class="comment">([\s\S]*?)<\/div>/)
  if (cmM) {
    const c = decode(cmM[1])
    if (c) comment = c
  }

  // 首行退化补充
  if (!actionLine) {
    actionLine = action + (title ? ' ' + title : '')
  }

  return {
    id,
    group,
    action,
    actionLine,
    subjects,
    subjectId,
    title,
    subtitle,
    cover,
    episode,
    episodeId,
    info,
    myRating,
    siteRating,
    siteRatingCount,
    rank,
    showRating,
    comment,
    time,
    timeAbs,
    source
  }
}
