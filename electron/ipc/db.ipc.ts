import electron from 'electron'
const { ipcMain } = electron
import { getDb } from '../services/db/connection'

/** 注册数据库相关 IPC。渲染进程只拿到受限的 query/run 能力。 */
export function registerDbIpc(): void {
  ipcMain.handle('db:query', async (_event, sql: string, params: unknown[] = []) => {
    const db = await getDb()
    return db.prepare(sql).all(...(params as unknown[]))
  })

  ipcMain.handle('db:run', async (_event, sql: string, params: unknown[] = []) => {
    const db = await getDb()
    const res = db.prepare(sql).run(...(params as unknown[]))
    return { lastInsertRowid: Number(res.lastInsertRowid), changes: res.changes }
  })
}
