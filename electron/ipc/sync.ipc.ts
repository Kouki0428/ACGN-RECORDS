import electron from 'electron'
const { ipcMain } = electron
import { pushAll, pullAll, syncAll } from '../services/sync/syncEngine'
import { getMyCollections } from '../services/api/bangumi'
import { getValidToken, getBangumiAccount } from '../services/auth/oauth'

/** 注册同步相关 IPC（双向同步 + 冲突处理） */
export function registerSyncIpc(): void {
  ipcMain.handle('sync:pushAll', async (_e, opts) => pushAll(opts))
  ipcMain.handle('sync:pullAll', async () => pullAll())
  ipcMain.handle('sync:pullAllFull', async () => pullAll({ full: true }))
  ipcMain.handle('sync:syncAll', async () => syncAll())
  // 巡检数据源：只拉「最近有活动」的第 1 页收藏（v0 按 updated_at 倒序，1 个请求）。
  // 取消单集标记等 timeline 看不见的变化会把收藏顶到前排，且 ep_status/vol_status/status/rate
  // 会随之变化 —— 主页拉回这一页逐字段比对即可发现，无需全量扫描。
  ipcMain.handle('sync:listRecentCollections', async (_e, limit = 30) => {
    const token = await getValidToken()
    if (!token) return []
    const acct = await getBangumiAccount()
    if (!acct?.username) return []
    const page = await getMyCollections(token, { limit, offset: 0 }, acct.username)
    const parseTs = (v: unknown): number => {
      if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v
      if (typeof v === 'string' && v) {
        const t = Date.parse(v)
        if (Number.isFinite(t)) return Math.floor(t / 1000)
      }
      return 0
    }
    return (page.data ?? []).map((it: Record<string, any>) => ({
      providerSubjectId: String(it?.subject?.id ?? ''),
      status: it?.type ?? 0,
      rate: typeof it?.rate === 'number' ? it.rate : null,
      epStatus: it?.ep_status ?? 0,
      volStatus: it?.vol_status ?? 0,
      updatedAt: parseTs(it?.updated_at)
    }))
  })
}
