import electron from 'electron'
const { contextBridge, ipcRenderer, webFrame } = electron
import type { AcgnApi, EntityDetail, SubjectFullDetail, SubjectCharacter, SubjectPerson, EpisodeProgressState, SubjectFullEpisode, EpisodeComment, EpisodeDetail, CacheStats, NetworkStatsResult } from '../shared/types'

// 仅暴露白名单方法，绝不直接暴露 require / fs / ipcRenderer 本身
const api: AcgnApi = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    relaunch: () => ipcRenderer.invoke('app:relaunch'),
    setProxy: (url: string | null) => ipcRenderer.invoke('app:setProxy', url),
    getNetworkStats: () => ipcRenderer.invoke('app:getNetworkStats') as Promise<NetworkStatsResult>
  },
  db: {
    query: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
    run: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:run', sql, params)
  },
  api: {
    // 统一搜索：条目 / 人物，query 由调用方构造
    search: (query) => ipcRenderer.invoke('api:search', query),
    gallery: (subjectId: number | string, force?: boolean) =>
      ipcRenderer.invoke('api:gallery', subjectId, force)
  },
  anime: {
    addToWatching: (subject) => ipcRenderer.invoke('anime:addToWatching', subject),
    getDetailLocal: (subjectId) => ipcRenderer.invoke('anime:getDetailLocal', subjectId),
    getDetailsLocal: (subjectIds) => ipcRenderer.invoke('anime:getDetailsLocal', subjectIds),
    getDetail: (subjectId) => ipcRenderer.invoke('anime:getDetail', subjectId),
    toggleEpisode: (collectionId, episodeId) =>
      ipcRenderer.invoke('anime:toggleEpisode', collectionId, episodeId),
    setEpisodeStatus: (collectionId, payload) =>
      ipcRenderer.invoke('anime:setEpisodeStatus', collectionId, payload),
    listWatching: (status = 3) => ipcRenderer.invoke('anime:listWatching', status),
    getStats: () => ipcRenderer.invoke('anime:getStats')
  },
  collection: {
    add: (subject, status) => ipcRenderer.invoke('collection:add', subject, status),
    detailLocal: (subjectId) => ipcRenderer.invoke('collection:detailLocal', subjectId),
    detail: (subjectId) => ipcRenderer.invoke('collection:detail', subjectId),
    setProgress: (collectionId, value, kind, localOnly) =>
      ipcRenderer.invoke('collection:setProgress', collectionId, value, kind, localOnly),
    setStatus: (collectionId, status) =>
      ipcRenderer.invoke('collection:setStatus', collectionId, status),
    setRating: (providerSubjectId, rating) =>
      ipcRenderer.invoke('collection:setRating', providerSubjectId, rating),
    list: (category, status) => ipcRenderer.invoke('collection:list', category, status),
    stats: (category) => ipcRenderer.invoke('collection:stats', category),
    reclassifyBooks: () => ipcRenderer.invoke('collection:reclassifyBooks'),
    saveCollection: (payload) => ipcRenderer.invoke('collection:saveCollection', payload),
    deleteCollection: (providerSubjectId) =>
      ipcRenderer.invoke('collection:deleteCollection', providerSubjectId),
    getExisting: (providerSubjectId) =>
      ipcRenderer.invoke('collection:getExisting', providerSubjectId) as Promise<{
        status: number | null
        comment: string | null
        private: boolean | null
      }>,
    userStats: () => ipcRenderer.invoke('collection:userStats') as Promise<import('../../shared/types').UserStats>,
    routes: (collectionId) => ipcRenderer.invoke('collection:routes', collectionId),
    routeAdd: (collectionId, name) => ipcRenderer.invoke('collection:routeAdd', collectionId, name),
    routeUpdate: (id, name) => ipcRenderer.invoke('collection:routeUpdate', id, name),
    routeDelete: (id) => ipcRenderer.invoke('collection:routeDelete', id)
  },
  purchases: {
    get: (collectionId) => ipcRenderer.invoke('purchases:get', collectionId),
    save: (collectionId, data) => ipcRenderer.invoke('purchases:save', collectionId, data),
    totalSpent: (category) => ipcRenderer.invoke('purchases:totalSpent', category)
  },
  subjectExtra: {
    onCnUpdated: (cb) => {
      const listener = (_event: unknown, p: unknown) => cb(p as any)
      ipcRenderer.on('subjectExtra:cnUpdated', listener)
      return () => ipcRenderer.removeListener('subjectExtra:cnUpdated', listener)
    },
    onSummaryUpdated: (cb) => {
      const listener = (_event: unknown, p: unknown) => cb(p as any)
      ipcRenderer.on('subjectExtra:summaryUpdated', listener)
      return () => ipcRenderer.removeListener('subjectExtra:summaryUpdated', listener)
    },
    onMetaUpdated: (cb) => {
      const listener = (_event: unknown, p: unknown) => cb(p as any)
      ipcRenderer.on('subjectExtra:metaUpdated', listener)
      return () => ipcRenderer.removeListener('subjectExtra:metaUpdated', listener)
    }
  },
  auth: {
    getStatus: () => ipcRenderer.invoke('auth:getStatus'),
    saveToken: (token) => ipcRenderer.invoke('auth:saveToken', token),
    login: () => ipcRenderer.invoke('auth:login'),
    getAppCredentials: () => ipcRenderer.invoke('auth:getAppCredentials'),
    saveAppCredentials: (appId, secret) =>
      ipcRenderer.invoke('auth:saveAppCredentials', appId, secret),
    logout: () => ipcRenderer.invoke('auth:clearToken'),
    getMe: () => ipcRenderer.invoke('auth:getMe') as Promise<{ username?: string; nickname?: string; avatar?: string | null }>
  },
  sync: {
    pushAll: () => ipcRenderer.invoke('sync:pushAll'),
    pullAll: () => ipcRenderer.invoke('sync:pullAll'),
    pullAllFull: () => ipcRenderer.invoke('sync:pullAllFull'),
    syncAll: () => ipcRenderer.invoke('sync:syncAll'),
    onStateChanged: (cb: (s: unknown) => void) => {
      const h = (_e: unknown, s: unknown) => cb(s)
      ipcRenderer.on('sync:stateChanged', h)
      return () => ipcRenderer.removeListener('sync:stateChanged' as never, h as never)
    }
  },
  subject: {
    getComments: (subjectId: string, offset = 0) => ipcRenderer.invoke('subject:comments', subjectId, offset),
    getEntity: (kind: 'character' | 'person', id: number) =>
      ipcRenderer.invoke('subject:entity', kind, id) as Promise<EntityDetail>,
    detailFull: (id: number, opts?: { withCn?: boolean }) =>
      ipcRenderer.invoke('subject:detailFull', id, opts) as Promise<SubjectFullDetail>,
    detailLocal: (id: number) =>
      ipcRenderer.invoke('subject:detailLocal', id) as Promise<SubjectFullDetail | null>,
    characters: (id: number) =>
      ipcRenderer.invoke('subject:characters', id) as Promise<SubjectCharacter[]>,
    persons: (id: number) =>
      ipcRenderer.invoke('subject:persons', id) as Promise<SubjectPerson[]>,
    getProgress: (providerSubjectId: string) =>
      ipcRenderer.invoke('subject:getProgress', providerSubjectId) as Promise<{
        collectionId: number | null
        progress: Record<number, EpisodeProgressState>
      }>,
    pullEpisodeProgress: (providerSubjectId: string, opts?: { force?: boolean; reconcile?: boolean }) =>
      ipcRenderer.invoke('subject:pullEpisodeProgress', providerSubjectId, opts) as Promise<{
        collectionId: number | null
        progress: Record<number, EpisodeProgressState>
        episodes: SubjectFullEpisode[]
      }>,
    getEpisodes: (providerSubjectId: string) =>
      ipcRenderer.invoke('subject:getEpisodes', providerSubjectId) as Promise<SubjectFullEpisode[]>
  },
  episode: {
    getDetail: (episodeId: number) =>
      ipcRenderer.invoke('episode:getDetail', episodeId) as Promise<EpisodeDetail>,
    getComments: (episodeId: number, offset = 0) =>
      ipcRenderer.invoke('episode:getComments', episodeId, offset) as Promise<{
        comments: EpisodeComment[]
        total: number
      }>,
    addComment: (payload: { providerSubjectId: string; episodeId: number; content: string }) =>
      ipcRenderer.invoke('episode:addComment', payload) as Promise<{ id: number; synced: boolean }>,
    listLocal: (episodeId: number) =>
      ipcRenderer.invoke('episode:listLocal', episodeId) as Promise<EpisodeComment[]>,
    toggleReaction: (payload: { commentId: number; value: number; remove?: boolean }) =>
      ipcRenderer.invoke('episode:addReaction', payload) as Promise<{ synced: boolean; error?: string }>
  },
  archive: {
    getMeta: () => ipcRenderer.invoke('archive:getMeta'),
    update: () => ipcRenderer.invoke('archive:update'),
    search: (query, type, limit) => ipcRenderer.invoke('archive:search', query, type, limit),
    searchByTag: (tag, limit) => ipcRenderer.invoke('archive:searchByTag', tag, limit),
    ensureCovers: (ids: number[]) => ipcRenderer.invoke('archive:ensureCovers', ids) as Promise<Record<number, string>>,
    onProgress: (cb) => {
      const listener = (_event: unknown, p: unknown) => cb(p as any)
      ipcRenderer.on('archive:progress', listener)
      return () => ipcRenderer.removeListener('archive:progress', listener)
    },
    delete: () => ipcRenderer.invoke('archive:delete')
  },
  theme: {
    capture: () => ipcRenderer.invoke('theme:capture'),
    setNativeBg: (color: string) => ipcRenderer.invoke('theme:setNativeBg', color)
  },
  // 视图层（渲染进程内直接执行，不经主进程 IPC）：当前仅页面缩放。
  // webFrame 在 preload 隔离世界可直接访问，调用即作用于当前页面顶层 frame。
  view: {
    setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor)
  },
  personal: {
    timeline: (username: string, limit?: number) =>
      ipcRenderer.invoke('personal:timeline', username, limit)
  },
  cache: {
    stats: () => ipcRenderer.invoke('cache:stats') as Promise<CacheStats>,
    clear: () => ipcRenderer.invoke('cache:clear') as Promise<CacheStats>,
    prune: () => ipcRenderer.invoke('cache:prune') as Promise<CacheStats>
  },
  backup: {
    exportBackup: () =>
      ipcRenderer.invoke('backup:export') as Promise<{
        ok: boolean
        canceled?: boolean
        path?: string
        error?: string
      }>,
    importBackup: () =>
      ipcRenderer.invoke('backup:import') as Promise<{
        ok: boolean
        canceled?: boolean
        path?: string
        error?: string
      }>
  },
  statsSnapshotHistory: (limit = 12) =>
    ipcRenderer.invoke('collection:snapshotHistory', limit)
}

contextBridge.exposeInMainWorld('acgn', api)
