import { getSubjectDetail } from './api/bangumi'
import { getArchiveSubjectSummary } from './archive/archive.service'
import { setSubjectSummary } from './db/repositories/subjects.repository'

/**
 * 简介优先补全 + 流式推送。
 *
 * 背景：此前简介在 getDetail 里取到后，要等后面的 loadSubjectExtra（角色中文名，
 * 网络逐条补、易超时）跑完才随整条响应返回；一旦 loadSubjectExtra 抛错，整条
 * getDetail 就 reject，前端拿不到带简介的对象 —— 表现为「动画没简介 + 很慢」。
 *
 * 这里把简介移到最前面取，取到后立即：①写回本地 subjects.summary 缓存；②通过
 * subjectExtra:summaryUpdated 事件推给前端，前端无需等待角色加载即可显示。
 * 该函数永不抛错，失败仅告警。
 *
 * 取数顺序（兼顾速度与离线）：先查本地 Archive 库（SQLite 本地镜像，瞬时，覆盖绝大多数
 * Bangumi 条目，离线数据本身带简介）；Archive 没有（如 Archive 未下载 / 该条目不在镜像）
 * 才匿名联网取 Bangumi v0 详情里的 summary。这样离线用户不会被 20s 网络超时卡住，
 * 在线用户也能瞬时拿到 Archive 的简介（摘要极少变动，新鲜度损失可忽略）。
 */
export async function enrichSummary(
  event: { sender?: { send?: (channel: string, ...args: unknown[]) => void } } | undefined,
  subject: any
): Promise<void> {
  if (!subject || subject.summary || subject.provider !== 'bangumi' || !subject.provider_subject_id) {
    return
  }
  const push = (summary: string) => {
    subject.summary = summary
    try {
      setSubjectSummary(subject.id, summary)
    } catch {
      /* 写库失败不影响展示 */
    }
    event?.sender?.send?.('subjectExtra:summaryUpdated', { subjectId: subject.id, summary })
  }
  // 1) 先查本地 Archive（瞬时，离线可用）
  try {
    const arcSummary = await getArchiveSubjectSummary(subject.provider_subject_id)
    if (arcSummary) {
      push(arcSummary)
      return
    }
  } catch (e) {
    console.warn('[enrichSummary] 离线 Archive 取简介失败，尝试联网兜底：', e)
  }
  // 2) Archive 未覆盖时，匿名联网取 Bangumi v0 详情里的 summary（单请求、未走令牌桶，较快）
  try {
    const detail = await getSubjectDetail(String(subject.provider_subject_id))
    const apiSummary = detail?.summary
    if (apiSummary) push(apiSummary)
  } catch (e) {
    console.warn('[enrichSummary] 联网补取简介失败（不影响其余展示）：', e)
  }
}
