// 备份与恢复（主进程）：
// - 导出：better-sqlite3 db.backup() 在线一致性备份（自动合并 WAL），用户选路径保存
// - 导入：校验 SQLite 头 + 必需表 → 自动留存当前库应急副本 → 覆盖主库文件（清 -wal/-shm）
//   → 重置连接，下次 getDb() 重新打开并跑迁移
import electron from 'electron'
const { app, dialog } = electron
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { getDb, closeDb } from './db/connection'

const require = createRequire(import.meta.url)

export interface BackupResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function mainDbPath(): string {
  return join(app.getPath('userData'), 'acgn-records.db')
}

/** 导出备份：在线 backup API 保证一致性（含未 checkpoint 的 WAL 内容） */
export async function exportBackup(): Promise<BackupResult> {
  try {
    const res = await dialog.showSaveDialog({
      title: '导出备份',
      defaultPath: `acgn-backup-${stamp()}.db`,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    const db = await getDb()
    await db.backup(res.filePath)
    return { ok: true, path: res.filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 校验候选文件是本应用的数据库（SQLite 头 + 必需表存在） */
function validateBackupFile(path: string): void {
  const fd = readFileSync(path)
  const header = fd.subarray(0, 16).toString('latin1')
  if (header !== 'SQLite format 3\u0000') throw new Error('所选文件不是有效的 SQLite 数据库')
  const Database = require('better-sqlite3')
  const ro = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const names = ro
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name)
    for (const t of ['collections', 'subjects', 'settings']) {
      if (!names.includes(t)) throw new Error(`备份缺少必需的数据表（${t}），可能不是本应用的备份文件`)
    }
  } finally {
    ro.close()
  }
}

/** 从备份恢复：先自动留存当前库的应急副本，再覆盖并重连 */
export async function importBackup(): Promise<BackupResult> {
  try {
    const res = await dialog.showOpenDialog({
      title: '从备份恢复',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite 数据库', extensions: ['db'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths?.length) return { ok: false, canceled: true }
    const src = res.filePaths[0]
    validateBackupFile(src)

    const target = mainDbPath()
    // 应急副本：恢复前把当前库（含 wal/shm）存入 userData/backups/
    const backupDir = join(app.getPath('userData'), 'backups')
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
    const safetyCopy = join(backupDir, `before-restore-${stamp()}.db`)
    try {
      await (await getDb()).backup(safetyCopy)
    } catch (e) {
      console.warn('[backup] 恢复前留存当前库失败（继续恢复）：', e)
    }

    // 关连接 → 覆盖文件 → 清附属 → 下次 getDb() 重开
    await closeDb()
    copyFileSync(src, target)
    for (const suffix of ['-wal', '-shm']) {
      const p = target + suffix
      if (existsSync(p)) rmSync(p)
    }
    await getDb() // 立即重开验证可读 + 跑迁移
    return { ok: true, path: src }
  } catch (e) {
    // 恢复失败后尽力保证主库可用
    try {
      await closeDb()
      await getDb()
    } catch {
      /* ignore */
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
