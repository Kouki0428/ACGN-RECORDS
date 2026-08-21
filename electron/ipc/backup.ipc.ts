import electron from 'electron'
const { ipcMain } = electron
import { exportBackup, importBackup, exportCollections } from '../services/backup'

export function registerBackupIpc(): void {
  ipcMain.handle('backup:export', async () => exportBackup())
  ipcMain.handle('backup:import', async () => importBackup())
  // 收藏数据轻量导出（CSV/JSON，单向，不可导回）
  ipcMain.handle('backup:exportCollections', async (_e, format: 'csv' | 'json') =>
    exportCollections(format === 'json' ? 'json' : 'csv')
  )
}
