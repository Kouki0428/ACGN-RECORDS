import type { ArchiveMeta, ArchiveProgress, ArchiveUpdateResult, ArchiveSubjectSearch, ArchiveTagSubject } from '@shared/types'

export const archiveClient = {
  getMeta: () => window.acgn.archive.getMeta() as Promise<ArchiveMeta | null>,
  update: () => window.acgn.archive.update() as Promise<ArchiveUpdateResult>,
  search: (query: string, type?: number, limit = 50) =>
    window.acgn.archive.search(query, type, limit) as Promise<ArchiveSubjectSearch[]>,
  searchByTag: (tag: string, limit = 300) =>
    window.acgn.archive.searchByTag(tag, limit) as Promise<ArchiveTagSubject[]>,
  ensureCovers: (ids: number[]) => window.acgn.archive.ensureCovers(ids) as Promise<Record<number, string>>,
  onProgress: (cb: (p: ArchiveProgress) => void) => window.acgn.archive.onProgress(cb),
  delete: () => window.acgn.archive.delete() as Promise<boolean>
}
