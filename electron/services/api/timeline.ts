import { safeFetch } from './http'
import { getValidToken } from '../auth/oauth'

/**
 * Bangumi「时间胶囊 / 操作历史」数据。
 *
 * 数据源：next.bgm.tv/p1 官方接口 /users/{username}/timeline（需登录 Bearer 令牌）。
 * 返回结构规范化为现有的 TimelineItem / TimelinePage 形状，前端消费与样式保持不变。
 *
 * 注：p1 接口需要登录；未登录时 fetchTimeline 直接抛「请先登录」，由前端统一兜底展示。
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

/** 时间胶囊单页数据（解析自 p1 /users/{username}/timeline 的 JSON 响应）。 */
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

/**
 * p1 官方接口实现（next.bgm.tv/p1/users/{username}/timeline）。
 * 需登录 Bearer 令牌（与 progressGuard 共用同源端点）。返回形状仍为 TimelinePage / TimelineItem，前端零改动。
 */
const P1_BASE = 'https://next.bgm.tv/p1'

/** 从 p1 活动项里抽取时间（秒），兼容多种字段名/单位。 */
function parseP1Time(item: any): number | null {
  const raw =
    item?.time ??
    item?.created_at ??
    item?.datetime ??
    item?.date ??
    item?.timestamp ??
    item?.dateline ??
    item?.createdAt ??
    item?.created ??
    item?.addTime
  if (raw == null) return null
  if (typeof raw === 'number') return raw < 1e12 ? raw : Math.floor(raw / 1000)
  const t = Date.parse(String(raw))
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

/** 按时间戳算分组标题（今天 / 昨天 / YYYY-MM-DD），与现 HTML 版分组一致。 */
function formatGroup(tsSec: number): string {
  const d = new Date(tsSec * 1000)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayMs = 86400_000
  if (d.getTime() >= startOfToday) return '今天'
  if (d.getTime() >= startOfToday - dayMs) return '昨天'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 相对时间文案（与 Bangumi 网页「x分钟前」风格一致）。 */
function formatRelative(tsSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - tsSec
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}天前`
  return new Date(tsSec * 1000).toLocaleDateString('zh-CN')
}

/** 从 p1 活动项里抽作品 id（供 C' 定向刷新定位「哪几部」有新活动）。无法解析返回 null。 */
export function extractP1SubjectId(raw: any): number | null {
  const memo = raw?.memo ?? {}
  let subject: any = null
  if (memo?.progress) {
    const p = memo.progress
    if (p?.single) subject = p.single.subject
    else if (p?.bulk) subject = p.bulk.subject
  } else if (memo?.collection) {
    const c = memo.collection
    subject =
      c.subject ??
      c.collect?.subject ??
      c.wish?.subject ??
      c.do?.subject ??
      c.onHold?.subject ??
      c.drop?.subject ??
      null
  } else {
    subject = raw?.subject ?? memo?.subject
  }
  const sid = Number(subject?.id ?? raw?.subjectID ?? raw?.subject_id)
  return sid || null
}

/** 标记来源（旧版硬编码 'API'）：p1 顶层或 memo 里带真实 source。
 *  已知短码映射为可读文案；未知值（如客户端应用名）原样透传；取不到回退 'API'。 */
function parseP1Source(raw: any): string | undefined {
  const source =
    raw?.source ??
    raw?.memo?.collection?.source ??
    raw?.memo?.progress?.source ??
    raw?.memo?.source
  if (source == null) return 'API'
  const s = String(source).trim()
  if (!s) return 'API'
  const lower = s.toLowerCase()
  const map: Record<string, string> = {
    web: '网页',
    website: '网页',
    api: 'API',
    mobile: '手机',
    mobi: '手机',
    mobibot: '手机',
    app: '客户端',
    client: '客户端',
    ios: 'iOS 客户端',
    iphone: 'iOS 客户端',
    android: 'Android 客户端',
    windows: 'Windows 客户端',
    win: 'Windows 客户端',
    mac: 'macOS 客户端',
    '1': '网页',
    '2': 'API',
    '3': '其他'
  }
  return map[lower] ?? s
}

/**
 * 把单条 p1 活动规范化为现有 TimelineItem（字段形状与 HTML 版一致，前端零改动）。
 * p1 真实结构：顶层 { id, uid, cat, type, memo }，实体藏在 memo 里：
 *   - memo.progress.single.{ episode, subject }      → 看单集
 *   - memo.progress.bulk.{ subject, episodes }       → 看多集
 *   - memo.collection.{ subject, status/rate/comment } → 收藏状态变更
 */
function parseP1Item(raw: any): TimelineItem | null {
  const memo = raw?.memo ?? {}
  let subject: any = null
  let episode: any = null
  let isEpisode = false
  let action = '操作'
  let myRating: number | undefined
  let comment: string | undefined

  if (memo?.progress) {
    const p = memo.progress
    if (p?.single) {
      subject = p.single.subject
      episode = p.single.episode
      isEpisode = true
    } else if (p?.bulk) {
      subject = p.bulk.subject
      episode = Array.isArray(p.bulk.episodes) ? p.bulk.episodes[0] : p.bulk.episode
      isEpisode = true
    }
    action = '看过'
  } else if (memo?.collection) {
    const c = memo.collection
    subject =
      c.subject ??
      c.collect?.subject ??
      c.wish?.subject ??
      c.do?.subject ??
      c.onHold?.subject ??
      c.drop?.subject ??
      null
    let status: number | undefined = c.status
    if (status == null) {
      if (c.wish != null) status = 1
      else if (c.collect != null) status = 2
      else if (c.do != null) status = 3
      else if (c.onHold != null) status = 4
      else if (c.drop != null) status = 5
    }
    switch (status) {
      case 1: action = '想看'; break
      case 2: action = '看过'; break
      case 3: action = '在看'; break
      case 4: action = '搁置'; break
      case 5: action = '抛弃'; break
      default: action = '操作'
    }
    myRating = c.rate ?? c.rating ?? raw?.rate
    comment = c.comment ?? raw?.comment
  } else {
    // 其他类型（评论 / 吐槽等）：尝试直接取 subject
    subject = raw?.subject ?? memo?.subject
  }

  const sid = Number(subject?.id ?? raw?.subjectID ?? raw?.subject_id)
  if (!sid) {
    console.debug('[timeline:p1] 跳过无法解析的动态：', JSON.stringify(raw).slice(0, 300))
    return null
  }

  const ts = parseP1Time(raw) ?? Math.floor(Date.now() / 1000)
  const title = subject?.nameCN || subject?.name || ''
  const subtitle = subject?.nameCN ? subject?.name : undefined
  const coverRaw: string | undefined =
    subject?.images?.common || subject?.images?.large || subject?.image
  const cover = coverRaw?.startsWith('//') ? 'https:' + coverRaw : coverRaw
  const info: string | undefined = subject?.info

  const epSort = episode?.sort
  const epName = episode?.nameCN || episode?.name
  const episodeId = episode?.id != null ? Number(episode.id) : undefined

  // actionLine：单集动态含「ep.N 名称」；收藏/其他动态只放动词，作品名由 showTitle 单独展示避免重复。
  let actionLine: string
  if (isEpisode) {
    const epLabel = epSort != null ? `ep.${epSort}` : epName ? '' : '某集'
    const rest = [epLabel, epName].filter(Boolean).join(' ') || '某集'
    actionLine = `${action} ${rest}`
  } else {
    actionLine = action
  }

  const siteRating = subject?.rating?.score != null ? Number(subject.rating.score) : undefined
  const siteRatingCount = subject?.rating?.total != null ? Number(subject.rating.total) : undefined
  const rank = subject?.rating?.rank != null ? `#${subject.rating.rank}` : undefined
  const subjects: TimelineSubjectRef[] = [{ subjectId: sid, cover, title: title || undefined, subtitle }]

  return {
    id: String(raw?.id ?? `${sid}-${ts}`),
    group: formatGroup(ts),
    action,
    actionLine,
    subjects,
    subjectId: sid,
    title: title || undefined,
    subtitle,
    cover,
    episode: isEpisode ? (epSort != null ? `ep.${epSort}` : epName) : undefined,
    episodeId,
    info,
    myRating: myRating != null ? Number(myRating) : undefined,
    siteRating,
    siteRatingCount,
    rank,
    showRating: !isEpisode && subjects.length <= 1,
    comment: comment || undefined,
    time: formatRelative(ts),
    timeAbs: new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false }),
    source: parseP1Source(raw)
  }
}

/** 解析 p1 时间线 JSON 为 TimelineItem[]（纯函数）。 */
export function parseP1Timeline(json: any): TimelineItem[] {
  const list: any[] = Array.isArray(json) ? json : json?.data ?? []
  if (!Array.isArray(list)) return []
  return list
    .map(parseP1Item)
    .filter((x: TimelineItem | null): x is TimelineItem => !!x)
}

/** 从 p1 接口抓取并解析时间胶囊（需登录令牌）。翻页走 until 游标（p1 忽略 offset）。 */
async function fetchTimelineFromP1(
  username: string,
  page: number,
  token: string,
  until?: string | null
): Promise<TimelinePage> {
  // p1 timeline 限制 limit <= 20，超出返回 400（REQUEST_VALIDATION_ERROR）。
  // 翻页用 until=上一页最后一条动态的 id（游标），而非 offset（offset 被接口忽略，始终返回最新页）。
  const limit = 20
  const url =
    until != null
      ? `${P1_BASE}/users/${encodeURIComponent(username)}/timeline?limit=${limit}&until=${encodeURIComponent(String(until))}`
      : `${P1_BASE}/users/${encodeURIComponent(username)}/timeline?limit=${limit}`
  const res = await safeFetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 500)
    } catch {
      /* ignore */
    }
    if (res.status === 401) throw new Error('Bangumi 授权已失效，请重新登录')
    throw new Error(`时间胶囊获取失败（HTTP ${res.status}）${detail ? '：' + detail : ''}`)
  }
  const json = (await res.json()) as any
  // 原始条数用于判断分页（部分动态如「加好友」无 subject 会被 parseP1Item 过滤，
  // 不能因解析后条数变少就误判没有下一页）。
  const rawList: any[] = Array.isArray(json) ? json : json?.data ?? []
  const items = parseP1Timeline(json)
  // 临时诊断：若首条动态取不到时间字段（说明字段名不匹配），打日志便于对齐（验证通过后移除）。
  const firstRaw = rawList[0]
  if (firstRaw && parseP1Time(firstRaw) == null) {
    console.warn('[timeline:p1] 首条动态未能识别时间字段，首元素字段=', Object.keys(firstRaw).join(','))
  }
  // 临时诊断：原始有数据但解析为空（结构不匹配）时抛到界面；真正的空页（无动态）静默返回。
  if (rawList.length > 0 && items.length === 0) {
    const first = rawList[0]
    const firstKeys = Object.keys(first).join(',')
    const sample = JSON.stringify(first)
    throw new Error(`时间胶囊解析为空（结构不符）。首元素字段=[${firstKeys}]；首元素完整JSON=${sample}`)
  }
  // 下一页游标：取本页最后一条动态的 id（p1 按 id 游标翻页）；不足一页则无更多。
  let nextUntil: string | null = null
  if (rawList.length >= limit) {
    const last = rawList[rawList.length - 1]
    if (last?.id != null) nextUntil = String(last.id)
  }
  return { items, page, hasPrev: page > 1, hasNext: nextUntil != null, nextUntil }
}

/**
 * 时间胶囊统一入口。未传 token 时取当前登录令牌；未登录抛「请先登录」，前端已做兜底展示。
 * 现已改走 p1 官方接口（见 fetchTimelineFromP1）。
 */
export async function fetchTimeline(
  username: string,
  page = 1,
  token?: string,
  until?: string | null
): Promise<TimelinePage> {
  if (!token) token = await getValidToken()
  if (!token) throw new Error('请先登录 Bangumi 后查看时间胶囊')
  return fetchTimelineFromP1(username, page, token, until)
}
