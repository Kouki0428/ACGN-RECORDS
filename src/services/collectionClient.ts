import type {
  Subject,
  Category,
  CollectionDetail,
  CollectionItem,
  CollectionStats,
  SaveCollectionPayload,
  SaveCollectionResult,
  CollectionExisting,
  UserStats,
  RouteItem
} from '@shared/types'

/** 渲染进程对通用收藏模块主进程能力的封装（轻小说/漫画/Galgame/游戏 共用） */
export const collectionClient = {
  add: (subject: Subject, status = 3) => window.acgn.collection.add(subject, status),
  // 本地优先通道；若 preload 未暴露（旧构建）则回退到完整详情，避免详情打不开
  detailLocal: (subjectId: number) => {
    const c = window.acgn.collection as unknown as Record<string, (id: number) => Promise<CollectionDetail>>
    return typeof c.detailLocal === 'function'
      ? (c.detailLocal(subjectId) as Promise<CollectionDetail>)
      : (c.detail(subjectId) as Promise<CollectionDetail>)
  },
  detail: (subjectId: number) => window.acgn.collection.detail(subjectId) as Promise<CollectionDetail>,
  setProgress: (collectionId: number, value: number, kind?: 'ep' | 'vol', localOnly?: boolean) =>
    window.acgn.collection.setProgress(collectionId, value, kind, localOnly),
  setStatus: (collectionId: number, status: number) =>
    window.acgn.collection.setStatus(collectionId, status),
  /** 设置「我的评价」评分（1-10）并同步到 Bangumi */
  setRating: (providerSubjectId: string, rating: number) =>
    window.acgn.collection.setRating(providerSubjectId, rating),
  list: (category: Category, status = 3) =>
    window.acgn.collection.list(category, status) as Promise<CollectionItem[]>,
  stats: (category: Category) => window.acgn.collection.stats(category) as Promise<CollectionStats>,
  /** 新建 / 更新收藏（收藏悬浮窗「保存」） */
  saveCollection: (payload: SaveCollectionPayload) =>
    window.acgn.collection.saveCollection(payload) as Promise<SaveCollectionResult>,
  /** 删除收藏（收藏悬浮窗「删除」） */
  deleteCollection: (providerSubjectId: string) =>
    window.acgn.collection.deleteCollection(providerSubjectId) as Promise<{ ok: true }>,
  /** 查询某作品是否已收藏（返回 status + 吐槽 + 仅自己可见） */
  getExisting: (providerSubjectId: string) =>
    window.acgn.collection.getExisting(providerSubjectId) as Promise<CollectionExisting>,
  /** 个人页统计悬浮窗：本地收藏聚合统计 */
  userStats: () => window.acgn.collection.userStats() as Promise<UserStats>,
  /** 取某收藏的通关路线列表（Galgame） */
  routes: (collectionId: number) => window.acgn.collection.routes(collectionId) as Promise<RouteItem[]>,
  /** 新增一条通关路线，返回新行 id */
  routeAdd: (collectionId: number, name: string) => window.acgn.collection.routeAdd(collectionId, name) as Promise<{ id: number }>,
  /** 修改路线名称 */
  routeUpdate: (id: number, name: string) => window.acgn.collection.routeUpdate(id, name) as Promise<{ ok: true }>,
  /** 删除一条路线 */
  routeDelete: (id: number) => window.acgn.collection.routeDelete(id) as Promise<{ ok: true }>
}
