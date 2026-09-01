import electron from 'electron'
const { ipcMain } = electron
import { getArchiveMeta, updateArchive, searchSubjects, deleteArchive, getArchiveSubjectsByTag, searchArchiveTags, ensureArchiveSubjectCovers, getArchiveSubjectDates } from '../services/archive/archive.service'
import { getValidToken } from '../services/auth/oauth'

export function registerArchiveIpc(): void {
  ipcMain.handle('archive:getMeta', async () => getArchiveMeta())

  ipcMain.handle('archive:update', async (event) => {
    const onProgress = (p: any) => {
      try {
        event.sender.send('archive:progress', p)
      } catch {
        /* 渲染端已关闭，忽略 */
      }
    }
    return await updateArchive(onProgress)
  })

  ipcMain.handle('archive:search', async (_event, query: string, type?: number, limit?: number) =>
    searchSubjects(query, type, limit)
  )

  ipcMain.handle('archive:searchByTag', async (_event, tag: string, limit?: number) =>
    getArchiveSubjectsByTag(tag, limit)
  )

  // 离线标签搜索：按关键词在离线库 tags/meta_tags 中模糊匹配标签（本地查询，快且全）
  ipcMain.handle('archive:searchTags', async (_event, keyword: string, limit?: number) =>
    searchArchiveTags(keyword, limit)
  )

  // 离线 Archive 缺封面：从 Bangumi v0 联网补图（并回写 Archive 缓存）。
  // 带令牌时用授权配额（80/min），未登录回退匿名（24/min），避免批量补图被 429 打光。
  ipcMain.handle('archive:ensureCovers', async (_event, ids: number[]) => {
    const token = (await getValidToken()) ?? undefined
    return ensureArchiveSubjectCovers(ids, token)
  })

  // 批量取离线库的作品开播日期（主页周历对 air_date 缺失条目的兜底）。Map → 普通对象便于结构化克隆
  ipcMain.handle('archive:subjectDates', async (_event, ids: number[]) => {
    const map = await getArchiveSubjectDates(Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [])
    return Object.fromEntries(map)
  })

  ipcMain.handle('archive:delete', async () => {
    await deleteArchive()
    return true
  })
}
