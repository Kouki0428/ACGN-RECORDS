// 错误分类解析（渲染端）：解析主进程经 IPC 传来的「[CODE] 消息」前缀，
// 无前缀时按关键词兜底归类。统一用户可见报错的形态与可行动提示。

export type AppErrorCode = 'NETWORK' | 'AUTH' | 'RATE_LIMIT' | 'NOT_FOUND' | 'SERVER' | 'UNKNOWN'

export interface AppErrorInfo {
  code: AppErrorCode
  /** 用户可读的错误消息（已去除内部前缀） */
  message: string
  /** 可行动提示（如「请到设置页重新登录」），可为空 */
  hint?: string
}

const CODE_RE = /^\[(NETWORK|AUTH|RATE_LIMIT|NOT_FOUND|SERVER)\]\s*/

const HINTS: Record<AppErrorCode, string | undefined> = {
  AUTH: '请到设置页重新登录 Bangumi',
  NETWORK: '请检查网络连接或代理设置',
  RATE_LIMIT: '请求过于频繁，请稍后再试',
  NOT_FOUND: undefined,
  SERVER: 'Bangumi 服务暂时不可用，请稍后再试',
  UNKNOWN: undefined
}

export function parseAppError(e: unknown, fallback = '操作失败'): AppErrorInfo {
  let raw = e instanceof Error ? e.message : String(e ?? '')
  const m = CODE_RE.exec(raw)
  if (m) {
    const code = m[1] as AppErrorCode
    return { code, message: raw.slice(m[0].length).trim() || fallback, hint: HINTS[code] }
  }
  // 关键词兜底分类
  const lower = raw.toLowerCase()
  if (/401|403|授权|登录失效|token/.test(lower)) {
    return { code: 'AUTH', message: raw || fallback, hint: HINTS.AUTH }
  }
  if (/429|限流|频繁/.test(lower)) {
    return { code: 'RATE_LIMIT', message: raw || fallback, hint: HINTS.RATE_LIMIT }
  }
  if (/超时|网络|代理|enotfound|econnrefused|etimedout|fetch failed|直连|证书/.test(lower)) {
    return { code: 'NETWORK', message: raw || fallback, hint: HINTS.NETWORK }
  }
  if (/http 5\d\d|服务器/.test(lower)) {
    return { code: 'SERVER', message: raw || fallback, hint: HINTS.SERVER }
  }
  if (/404|不存在/.test(lower)) {
    return { code: 'NOT_FOUND', message: raw || fallback, hint: HINTS.NOT_FOUND }
  }
  return { code: 'UNKNOWN', message: raw || fallback }
}
