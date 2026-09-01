import type { ArchiveMeta, ArchiveProgress, ArchiveUpdateResult, ArchiveSubjectSearch, ArchiveTagSubject, ChannelTag } from '@shared/types'

export const archiveClient = {
  getMeta: () => window.acgn.archive.getMeta() as Promise<ArchiveMeta | null>,
  update: () => window.acgn.archive.update() as Promise<ArchiveUpdateResult>,
  search: (query: string, type?: number, limit = 50) =>
    window.acgn.archive.search(query, type, limit) as Promise<ArchiveSubjectSearch[]>,
  searchByTag: (tag: string, limit = 300) =>
    window.acgn.archive.searchByTag(tag, limit) as Promise<ArchiveTagSubject[]>,
  searchTags: (keyword: string, limit = 50) =>
    window.acgn.archive.searchTags(keyword, limit) as Promise<{ data: ChannelTag[]; total: number }>,
  hotTags: (limit = 20) => window.acgn.archive.hotTags(limit) as Promise<ChannelTag[]>,
  ensureCovers: (ids: number[]) => window.acgn.archive.ensureCovers(ids) as Promise<Record<number, string>>,
  subjectDates: (ids: number[]) =>
    window.acgn.archive.subjectDates(ids) as Promise<Record<number, string | null>>,
  onProgress: (cb: (p: ArchiveProgress) => void) => window.acgn.archive.onProgress(cb),
  delete: () => window.acgn.archive.delete() as Promise<boolean>
}
