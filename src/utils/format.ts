/** 把 unix 秒级时间戳格式化为 YYYY-MM-DD（无效值返回空串）。 */
export function formatMarkedAt(ts?: number | null): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
