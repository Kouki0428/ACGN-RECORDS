import electron from 'electron'
const { ipcMain } = electron
import { unifiedSearch } from '../services/api/normalizer'
import { getGalleryForSubject } from '../services/api/cg'
import { fetchTimeline } from '../services/api/timeline'
import type { SearchQuery } from '../../shared/types'

/** 注册检索相关 IPC（统一搜索：条目 / 人物 + Galgame CG 画廊 + 时间胶囊） */
export function registerApiIpc(): void {
  // 统一搜索：条目（动画/书籍/游戏）或人物（角色/现实），返回联合结果
  ipcMain.handle('api:search', async (_event, query: SearchQuery) => {
    return unifiedSearch(query)
  })

  // 游戏画廊（复刻「游戏画廊」组件：VNDB 截图 / DLsite 样例 / Steam 截图，按来源分组）
  ipcMain.handle('api:gallery', async (_event, subjectId: number | string, force = false) => {
    return getGalleryForSubject(subjectId, force)
  })

  // 时间胶囊（操作历史）：解析 bgm.tv/user/{username}/timeline 只读 HTML（非官方 API 端点）
  ipcMain.handle('personal:timeline', async (_event, username: string, page?: number) => {
    return fetchTimeline(username, page ?? 1)
  })
}
