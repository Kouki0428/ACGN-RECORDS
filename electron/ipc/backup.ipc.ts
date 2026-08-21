import electron from 'electron'
const { ipcMain } = electron
import { exportBackup, importBackup } from '../services/backup'

export function registerBackupIpc(): void {
  ipcMain.handle('backup:export', async () => exportBackup())
  ipcMain.handle('backup:import', async () => importBackup())
}
