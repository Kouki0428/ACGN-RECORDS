import electron from 'electron'
const { ipcMain } = electron
import { getArchiveMeta, updateArchive, searchSubjects, deleteArchive, getArchiveSubjectsByTag, ensureArchiveSubjectCovers } from '../services/archive/archive.service'

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

  // 离线 Archive 缺封面：按标签列出的作品匿名从 Bangumi v0 联网补图（并回写 Archive 缓存）
  ipcMain.handle('archive:ensureCovers', async (_event, ids: number[]) =>
    ensureArchiveSubjectCovers(ids)
  )

  ipcMain.handle('archive:delete', async () => {
    await deleteArchive()
    return true
  })
}
