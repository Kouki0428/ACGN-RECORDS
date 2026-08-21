// 错误码打标（主进程侧）：跨 IPC 的 Error 只保留 message，
// 故用「[CODE] 前缀嵌入消息」的方式携带错误类别，渲染端 parseAppError 解析。

export type AppCode = 'NETWORK' | 'AUTH' | 'RATE_LIMIT' | 'NOT_FOUND' | 'SERVER'

/** 给消息加错误码前缀：[AUTH] xxx */
export function tagError(code: AppCode, msg: string): string {
  return `[${code}] ${msg}`
}

/** HTTP 状态 → 错误码（无法归类时返回 null，由调用方用通用消息） */
export function codeForStatus(status: number): AppCode | null {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'SERVER'
  return null
}
