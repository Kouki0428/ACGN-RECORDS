import electron from 'electron'
const { ipcMain } = electron
import { unifiedSearch } from '../services/api/normalizer'
import { getGalleryForSubject, lastGalleryDiag } from '../services/api/cg'
import { fetchTimeline } from '../services/api/timeline'
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
    const g = await getGalleryForSubject(subjectId, force)
    // 附带解析诊断（空画廊时界面据此展示各源 id，便于用户反馈是哪一环没拿到外链）
    return { ...g, diag: { ...lastGalleryDiag } }
  })

  // 时间胶囊（操作历史）：p1 /users/{username}/timeline（官方接口，游标翻页）
  ipcMain.handle(
    'personal:timeline',
    async (_event, username: string, page?: number, until?: string | null) => {
      return fetchTimeline(username, page ?? 1, undefined, until)
    }
  )
}
