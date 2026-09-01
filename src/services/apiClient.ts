import type { GameGallery, AuthStatus, AcgnApi, SearchQuery, SearchResultItem, TagSearchQuery, ChannelTag, TimelineItem, TimelinePage, NetworkStatsResult, BgmStatus } from '@shared/types'

/**
 * 渲染进程对主进程 API 能力的安全封装（不直接 import electron）。
 * 所有访问都经此处的守卫，确保 preload 未就绪（多见于改动了 preload 后未重启应用）
 * 时给出明确提示，而不是抛出晦涩的 "Cannot read properties of undefined (reading 'auth')"。
 */
function acgn(): AcgnApi {
  if (!window.acgn) {
    throw new Error('应用接口尚未就绪：请完全退出应用后重新打开（若改动了主进程/preload 需重新构建并重启）')
  }
  return window.acgn
}

export const apiClient = {
  search: (query: SearchQuery): Promise<SearchResultItem[]> =>
    acgn().api.search(query),
  /** 标签搜索（p1）：按 tags/metaTags/type 检索作品 */
  searchByTag: (query: TagSearchQuery): Promise<SearchResultItem[]> =>
    acgn().api.searchByTag(query),
  /** 频道热门标签（p1）：标签搜索的联想 / 热门标签 */
  channelTags: (type: number): Promise<{ data: ChannelTag[]; total: number }> =>
    acgn().api.channelTags(type),
  /** 打开外部链接（如 Bangumi 角色/人物页） */
  openExternal: (url: string): Promise<void> => acgn().app.openExternal(url),
  /** 重启应用（用于需要重启才生效的启动期设置，如 GPU 加速开关） */
  relaunch: (): Promise<void> => acgn().app.relaunch(),
  /** 拉取应用当月及近 6 月网络使用量统计 */
  getNetworkStats: (): Promise<NetworkStatsResult> => acgn().app.getNetworkStats(),
  /** 拉取 Bangumi 可用性监测状态（bgm-status 探针）；失败返回 null */
  getBgmStatus: (): Promise<BgmStatus | null> => acgn().app.getBgmStatus(),
  /** 当前实际生效的数据目录（userData）；custom=true 表示用户自定义过 */
  getDataDir: (): Promise<{ dir: string; custom: boolean }> => acgn().app.getDataDir(),
  /** 在系统文件管理器中打开数据目录 */
  openDataDir: (): Promise<void> => acgn().app.openDataDir(),
  /** 原生目录选择器选新数据位置 → 校验/迁移/重启 */
  pickDataDir: () => acgn().app.pickDataDir(),
  /** 恢复默认数据位置（迁移后自动重启应用） */
  setDataDir: (dir: null) => acgn().app.setDataDir(dir),
  gallery: (subjectId: number | string, force = false): Promise<GameGallery> =>
    acgn().api.gallery(subjectId, force),
  /** 时间胶囊（操作历史）：拉取指定用户的时间线动态，支持分页（until 游标翻页） */
  timeline: (username: string, page = 1, until?: string | null): Promise<TimelinePage> =>
    acgn().personal.timeline(username, page, until)
}

export interface AppCredentials {
  appId: string
  appSecret: string
}

/** 鉴权相关封装。 */
export const authClient = {
  getStatus: (): Promise<AuthStatus> => acgn().auth.getStatus(),
  saveToken: (token: string): Promise<void> => acgn().auth.saveToken(token),
  login: (): Promise<AuthStatus> => acgn().auth.login(),
  getAppCredentials: (): Promise<AppCredentials> => acgn().auth.getAppCredentials(),
  saveAppCredentials: (appId: string, secret: string): Promise<void> =>
    acgn().auth.saveAppCredentials(appId, secret),
  logout: (): Promise<void> => acgn().auth.logout()
}
