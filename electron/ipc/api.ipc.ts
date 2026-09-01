import electron from 'electron'
const { ipcMain } = electron
import { unifiedSearch, unifiedTagSearch, type TagSearchQuery } from '../services/api/normalizer'
import { getP1ChannelTags, searchP1Tags } from '../services/api/bangumi'
import { getGalleryForSubject, lastGalleryDiag } from '../services/api/cg'
import { fetchTimeline } from '../services/api/timeline'
import { getValidToken } from '../services/auth/oauth'
import type { SearchQuery } from '../../shared/types'

/** 注册检索相关 IPC（统一搜索：条目 / 人物 + Galgame CG 画廊 + 时间胶囊） */
export function registerApiIpc(): void {
  // 统一搜索：条目（动画/书籍/游戏）或人物（角色/现实），返回联合结果。
  // 新请求自动 abort 上一个在途请求（v0 全量分页可能几十页，取消省配额）；
  // 被取消的请求向上抛 AbortError，渲染层由「请求序号守卫」丢弃，不会闪错误。
  let searchCtrl: AbortController | null = null
  ipcMain.handle('api:search', async (_event, query: SearchQuery) => {
    searchCtrl?.abort()
    const ctrl = new AbortController()
    searchCtrl = ctrl
    try {
      return await unifiedSearch(query, ctrl.signal)
    } finally {
      if (searchCtrl === ctrl) searchCtrl = null
    }
  })

  // 标签搜索：按 tags/metaTags/type 检索作品（p1 /search/subjects）。返回 SearchResultItem[]。
  // 独立于关键词搜索，共用一个搜索请求序号守卫（与 api:search 互斥，避免结果串台）。
  ipcMain.handle('api:searchByTag', async (_event, query: TagSearchQuery) => {
    searchCtrl?.abort()
    const ctrl = new AbortController()
    searchCtrl = ctrl
    try {
      return await unifiedTagSearch(query, ctrl.signal)
    } finally {
      if (searchCtrl === ctrl) searchCtrl = null
    }
  })

  // 频道热门标签（p1 /channels/{type}/tags）：供标签搜索的联想 / 热门标签展示。
  ipcMain.handle('api:channelTags', async (_event, type: number) => {
    const token = (await getValidToken()) ?? undefined
    return getP1ChannelTags(type, token)
  })

  // 按关键词搜索标签（p1 频道标签 + 客户端过滤）：返回匹配的 [{ name, count }]。
  // 与作品标签搜索分离：这里返回的是「标签」候选，点击后在渲染层打开标签悬浮窗。
  // payload.type 缺省或为 0 表示「全部类型」（遍历 1/2/3/4/6 合并标签）。
  let tagCtrl: AbortController | null = null
  ipcMain.handle(
    'api:searchTags',
    async (_event, payload: { keyword: string; type?: number }) => {
      tagCtrl?.abort()
      const ctrl = new AbortController()
      tagCtrl = ctrl
      try {
        const token = (await getValidToken()) ?? undefined
        const types = payload.type ? [payload.type] : [1, 2, 4]
        return await searchP1Tags(payload.keyword, types, token, ctrl.signal)
      } finally {
        if (tagCtrl === ctrl) tagCtrl = null
      }
    }
  )

  // 游戏画廊（复刻「游戏画廊」组件：VNDB 截图 / DLsite 样例 / Steam 截图，按来源分组）
  ipcMain.handle('api:gallery', async (_event, subjectId: number | string, force = false) => {
    const g = await getGalleryForSubject(subjectId, force)
    // 附带解析诊断（空画廊时界面据此展示各源 id，便于用户反馈是哪一环没拿到外链）
    return { ...g, diag: { ...lastGalleryDiag } }
  })

  // 时间胶囊（操作历史）：p1 /users/{username}/timeline（官方接口，游标翻页）
  ipcMain.handle(
    'personal:timeline',
    async (_event, username: string, page?: number, until?: string | null) => {
      return fetchTimeline(username, page ?? 1, undefined, until)
    }
  )
}
