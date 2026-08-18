import electron from 'electron'
const { ipcMain } = electron
import { pushAll, pullAll, syncAll } from '../services/sync/syncEngine'

/** 注册同步相关 IPC（双向同步 + 冲突处理） */
export function registerSyncIpc(): void {
  ipcMain.handle('sync:pushAll', async () => pushAll())
  ipcMain.handle('sync:pullAll', async () => pullAll())
  ipcMain.handle('sync:pullAllFull', async () => pullAll({ full: true }))
  ipcMain.handle('sync:syncAll', async () => syncAll())
}
