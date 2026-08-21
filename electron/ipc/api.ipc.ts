import electron from 'electron'
const { ipcMain } = electron
import { unifiedSearch } from '../services/api/normalizer'
import { getGalleryForSubject } from '../services/api/cg'
import { fetchTimeline } from '../services/api/timeline'
import { getDb } from '../services/db/connection'
import type { SearchQuery } from '../../shared/types'

/** 注册检索相关 IPC（统一搜索：条目 / 人物 + Galgame CG 画廊 + 时间胶囊） */
export function registerApiIpc(): void {
  // 统一搜索：条目（动画/书籍/游戏）或人物（角色/现实），返回联合结果。
  // 新请求自动 abort 上一个在途请求（v0 全量分页可能几十页，取消省配额）；
  // 被取消的请求向上抛 AbortError，渲染层由「请求序号守卫」丢弃，不会闪错误。
  let searchCtrl: AbortController | null = null
  ipcMain.handle('api:search', async (_event, query: SearchQuery) => {
    searchCtrl?.abort()
    const ctrl = new AbortController()
    searchCtrl = ctrl
    try {
      return await unifiedSearch(query, ctrl.signal)
    } finally {
      if (searchCtrl === ctrl) searchCtrl = null
    }
  })

  // 游戏画廊（复刻「游戏画廊」组件：VNDB 截图 / DLsite 样例 / Steam 截图，按来源分组）
  ipcMain.handle('api:gallery', async (_event, subjectId: number | string, force = false) => {
    return getGalleryForSubject(subjectId, force)
  })

  // 时间胶囊（操作历史）：解析 bgm.tv/user/{username}/timeline 只读 HTML（非官方 API 端点）
  ipcMain.handle('personal:timeline', async (_event, username: string, page?: number) => {
    return fetchTimeline(username, page ?? 1)
  })

  // 观看活动热力图：按天聚合近 N 天的标记活动
  // （单集看过次数 + 收藏状态/进度/评分变更次数），供个人页 GitHub 风格热力格渲染
  ipcMain.handle('personal:heatmap', async (_event, days = 365) => {
    const db = await getDb()
    const n = Math.max(30, Math.min(731, Number(days) || 365))
    const since = Math.floor(Date.now() / 1000) - n * 86400
    const rows = db
      .prepare(
        `SELECT day, SUM(n) AS n FROM (
           SELECT date(watched_at, 'unixepoch') AS day, COUNT(*) AS n
           FROM episode_progress
           WHERE watched = 1 AND watched_at IS NOT NULL AND watched_at >= ?
           GROUP BY 1
           UNION ALL
           SELECT date(local_updated_at, 'unixepoch') AS day, COUNT(*) AS n
           FROM collections
           WHERE local_updated_at IS NOT NULL AND local_updated_at >= ?
           GROUP BY 1
         ) GROUP BY day ORDER BY day`
      )
      .all(since, since) as Array<{ day: string; n: number }>
    return rows.map((r) => ({ day: r.day, count: r.n }))
  })
}
