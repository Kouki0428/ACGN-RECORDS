// 备份与恢复（主进程）：
// - 导出：better-sqlite3 db.backup() 在线一致性备份（自动合并 WAL），用户选路径保存
// - 导入：校验 SQLite 头 + 必需表 → 自动留存当前库应急副本 → 覆盖主库文件（清 -wal/-shm）
//   → 重置连接，下次 getDb() 重新打开并跑迁移
import electron from 'electron'
const { app, dialog } = electron
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
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
  return join(app.getPath('userData'), 'bangumi-for-pc.db')
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

// ===== 收藏数据导出（CSV / JSON，单向轻量导出，不可导回）=====

const CATEGORY_CN: Record<string, string> = {
  anime: '动画',
  light_novel: '小说',
  manga: '漫画',
  galgame: '游戏',
  game: '游戏'
}
const STATUS_CN = ['想看', '看过', '在看', '搁置', '抛弃']

function fmtDateTime(unixSec: number | null | undefined): string {
  if (!unixSec) return ''
  const d = new Date(unixSec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function queryCollectionsForExport(): Promise<
  Array<{
    titleCn: string
    title: string
    category: string
    status: number
    rating: number | null
    epStatus: number
    volStatus: number
    comment: string
    privateFlag: number
    markedAt: number | null
    url: string
  }>
> {
  const db = await getDb()
  return db
    .prepare(
      `SELECT s.title_cn AS titleCn, s.title AS title, s.category AS category,
              c.status AS status, c.rating AS rating, c.ep_status AS epStatus,
              c.vol_status AS volStatus, COALESCE(c.comment,'') AS comment,
              c.private AS privateFlag, c.local_updated_at AS markedAt,
              s.provider_subject_id AS pid
       FROM collections c JOIN subjects s ON s.id = c.subject_id
       ORDER BY s.category, c.local_updated_at DESC`
    )
    .all()
    .map((r: any) => ({
      ...r,
      url: r.pid && /^\d+$/.test(String(r.pid)) ? `https://bgm.tv/subject/${r.pid}` : ''
    }))
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

export async function exportCollections(format: 'csv' | 'json'): Promise<BackupResult> {
  try {
    const rows = await queryCollectionsForExport()
    const stampStr = stamp()
    const ext = format === 'csv' ? 'csv' : 'json'
    const res = await dialog.showSaveDialog({
      title: '导出收藏数据',
      defaultPath: `acgn-collections-${stampStr}.${ext}`,
      filters:
        format === 'csv'
          ? [{ name: 'CSV 表格', extensions: ['csv'] }]
          : [{ name: 'JSON 文件', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }

    let content: string
    if (format === 'json') {
      content = JSON.stringify(
        rows.map((r) => ({
          title: r.titleCn || r.title,
          titleOriginal: r.title,
          category: CATEGORY_CN[r.category] ?? r.category,
          status: STATUS_CN[r.status - 1] ?? String(r.status),
          rating: r.rating ?? null,
          progressEpisodes: r.epStatus,
          progressVolumes: r.volStatus,
          comment: r.comment,
          private: !!r.privateFlag,
          markedAt: fmtDateTime(r.markedAt),
          url: r.url
        })),
        null,
        2
      )
    } else {
      const headers = ['标题', '原名', '分类', '状态', '我的评分', '话/章进度', '卷进度', '吐槽', '仅自己可见', '标记时间', '链接']
      const lines = [headers.join(',')]
      for (const r of rows) {
        const cells = [
          r.titleCn || r.title,
          r.title,
          CATEGORY_CN[r.category] ?? r.category,
          STATUS_CN[r.status - 1] ?? String(r.status),
          r.rating != null && r.rating > 0 ? String(r.rating) : '',
          String(r.epStatus ?? ''),
          String(r.volStatus ?? ''),
          // 吐槽里的换行替换为空格，避免 Excel 内换行错位
          r.comment.replace(/[\r\n]+/g, ' '),
          r.privateFlag ? '是' : '否',
          fmtDateTime(r.markedAt),
          r.url
        ]
        lines.push(cells.map(csvEscape).join(','))
      }
      // BOM：让 Excel 正确识别 UTF-8 中文
      content = '\uFEFF' + lines.join('\r\n')
    }

    writeFileSync(res.filePath, content, 'utf-8')
    return { ok: true, path: res.filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
