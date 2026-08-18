import electron from 'electron'
const { ipcMain, app, session } = electron
import { join } from 'node:path'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { getDb } from '../services/db/connection'
import { getSetting, setSetting } from '../services/db/repositories/settings.repository'
import type { CacheStats } from '../../shared/types'

/**
 * 缓存管理 IPC：统计 + 清理「可重新抓取」的本地辅助缓存。
 *
 * 哪些算「缓存」（清理目标）：
 *  - subject_episodes    本地剧集元数据（集号/标题/首播/时长），开详情页优先读本地、可重新抓取
 *  - subject_characters  角色 / 声优列表缓存，可重新抓取
 *  - subject_relations   关联作品列表缓存，可重新抓取
 *  - subject_gallery     Galgame 画廊（VNDB/DLsite/Steam 截图链接），可重新抓取
 *  - Chromium HTTP 磁盘缓存（userData/Cache）：封面 / 角色头像 / 关联封面的真实图片字节，
 *    由 Electron 自行管理；本次清理一并 clearCache()，下次打开所有作品图片重新下载（首开冷）。
 *
 * 哪些不算「缓存」（绝不清理）：
 *  - 用户数据：collections / subjects / episodes / episode_progress / purchases / accounts / episode_comments
 *  - Bangumi 离线数据库（用户手动下载、体积大，单独在「Bangumi 离线数据库」面板管理）
 */

/** 单个文件大小（字节），不存在/出错返回 0。 */
function fileSize(p: string): number {
  try {
    if (!existsSync(p)) return 0
    return statSync(p).size
  } catch {
    return 0
  }
}

/** 递归累加某目录（含子目录）下所有文件的字节数，目录不存在/出错返回 0。 */
function dirSize(p: string): number {
  let total = 0
  try {
    if (!existsSync(p)) return 0
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const fp = join(d, e.name)
        if (e.isDirectory()) walk(fp)
        else total += statSync(fp).size
      }
    }
    walk(p)
  } catch {
    /* 忽略 */
  }
  return total
}

/** 统计主数据库体积（含 WAL/SHM 附属文件）+ 各缓存表条目数 + 离线库体积 + 图片字节缓存体积。 */
async function computeStats(): Promise<CacheStats> {
  const db = await getDb()
  const userData = app.getPath('userData')
  const dbSize =
    fileSize(join(userData, 'acgn-records.db')) +
    fileSize(join(userData, 'acgn-records.db-wal')) +
    fileSize(join(userData, 'acgn-records.db-shm'))
  const episodes = (db.prepare('SELECT COUNT(*) AS n FROM subject_episodes').get() as { n: number }).n
  const characters = (db.prepare('SELECT COUNT(*) AS n FROM subject_characters').get() as { n: number }).n
  const relations = (db.prepare('SELECT COUNT(*) AS n FROM subject_relations').get() as { n: number }).n
  const galleries = (db.prepare('SELECT COUNT(*) AS n FROM subject_gallery').get() as { n: number }).n
  const archiveSize = fileSize(join(userData, 'bangumi-archive', 'bangumi-archive.db'))
  // 图片字节缓存（Chromium HTTP 磁盘缓存）单独统计，settings 面板的「缓存大小」才真实。
  const imageCacheSize = dirSize(join(userData, 'Cache'))
  return { dbSize, episodes, characters, relations, galleries, archiveSize, imageCacheSize }
}

/**
 * 删除「半年以上未刷新」的缓存（仅删可重新抓取的辅助缓存，不影响收藏/进度）。
 * 各表的时间戳列：episodes.updated_at / characters.updated_at / relations.updated_at / gallery.fetched_at
 * （均为 Unix 秒）。存量 NULL 行已由 ensureTables 回填为当前时间，不会被误删。
 * @returns 各表被删除的条数
 */
async function pruneStaleCache(days = 180): Promise<{
  episodes: number
  characters: number
  relations: number
  galleries: number
}> {
  const db = await getDb()
  const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 3600
  const run = (table: string, col: string) => {
    const info = db
      .prepare(`DELETE FROM ${table} WHERE ${col} IS NOT NULL AND ${col} < ?`)
      .run(cutoff)
    return info.changes
  }
  return {
    episodes: run('subject_episodes', 'updated_at'),
    characters: run('subject_characters', 'updated_at'),
    relations: run('subject_relations', 'updated_at'),
    galleries: run('subject_gallery', 'fetched_at')
  }
}

/** 应用启动时调用：若开启了自动清理且距上次清理超过 30 天，则后台静默裁剪半年前缓存 */
export async function maybeAutoCleanCache(): Promise<void> {
  try {
    const flag = await getSetting('autoCacheClean')
    if (flag === '0') {
      console.log('[cache] 自动清理已关闭（autoCacheClean=0），跳过')
      return
    }
    const last = await getSetting('lastCacheClean')
    const THIRTY_DAYS = 30 * 24 * 3600 * 1000
    if (!last || Date.now() - Number(last) > THIRTY_DAYS) {
      console.log('[cache] 触发每月自动清理（删除半年前缓存）')
      await pruneStaleCache(180)
      await setSetting('lastCacheClean', String(Date.now()))
    }
  } catch (e) {
    console.warn('[cache] 自动清理跳过：', e)
  }
}

export function registerCacheIpc(): void {
  ipcMain.handle('cache:stats', async () => {
    return await computeStats()
  })

  ipcMain.handle('cache:clear', async () => {
    const db = await getDb()
    const tables = ['subject_episodes', 'subject_characters', 'subject_relations', 'subject_gallery']
    const tx = db.transaction(() => {
      for (const t of tables) {
        db.prepare(`DELETE FROM ${t}`).run()
      }
    })
    tx()
    // 删除后回收空间（WAL 模式下 VACUUM 会把空闲页还给文件系统，让「清理」真正释放磁盘）
    try {
      db.exec('VACUUM')
    } catch (e) {
      console.warn('[cache] VACUUM 失败（可忽略，不影响数据）：', e)
    }
    // 一并清空 Chromium HTTP 磁盘缓存（封面/头像图片字节所在目录 userData/Cache），
    // 让「清理缓存」真正释放图片占用；下次打开所有作品图片都会重新下载一次（首开冷），之后重新累积。
    // subjects 里的封面 URL 不受影响（那是另一条路，不在此清理范围）。
    try {
      await session.defaultSession.clearCache()
    } catch (e) {
      console.warn('[cache] clearCache（图片字节）失败（可忽略）：', e)
    }
    return await computeStats()
  })

  // 手动触发「裁剪半年前缓存」（设置页预留；也可由 maybeAutoCleanCache 每月自动调用）。
  ipcMain.handle('cache:prune', async () => {
    const pruned = await pruneStaleCache(180)
    console.log('[cache] 手动裁剪半年前缓存：', pruned)
    return await computeStats()
  })
}
