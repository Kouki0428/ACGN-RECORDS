import electron from 'electron'
const { app } = electron
import { join } from 'node:path'
import { runMigrations } from './migrations'

// 使用 any 以兼容未安装原生模块时的动态导入；实际类型是 better-sqlite3 的 Database
type Database = any

let dbPromise: Promise<Database> | null = null

/**
 * 获取（并缓存）SQLite 连接。
 * 采用动态 import，使应用在 better-sqlite3 尚未编译时仍能启动（仅 db:* 通道会报错）。
 */
export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const Database = (await import('better-sqlite3')).default
      const dbPath = join(app.getPath('userData'), 'acgn-records.db')
      const db: Database = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
      await runMigrations(db)
      return db
    })().catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

/**
 * 关闭并重置缓存的连接（供「从备份恢复」等需要替换库文件的流程使用）。
 * 下次 getDb() 会重新打开（并跑迁移）。恢复流程必须先 closeDb 再覆盖文件。
 */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return
  const p = dbPromise
  dbPromise = null
  try {
    const db = await p
    db.close()
  } catch {
    /* 连接已坏也无所谓，目标是丢弃它 */
  }
}
