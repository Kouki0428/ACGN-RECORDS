<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useEpisodeCommentModal } from '@/composables/useEpisodeCommentModal'
import { useEntityCard } from '@/composables/useEntityCard'
import { useSearchOverlay } from '@/composables/searchOverlay'
import { episodeClient } from '@/services/episodeClient'
import BgmBbcode from '@/components/BgmBbcode.vue'
import { reactionGifUrl, REACTION_VALUES } from '@/constants/bgmReactions'
import type { EpisodeComment, EpisodeDetail } from '@shared/types'

// 本组件现为「单一 overlay 容器」EntitySubjectCard 的内嵌 body（单集评论，state.kind==='episode'）。
// 外层遮罩、层级(z-index)、Esc / 背景点击关闭均由宿主 EntitySubjectCard 统一管理，
// 这里只负责面板内容（单集详情 + 评论 + 发评）。
// 从作品悬浮窗点剧集进入时：悬浮窗容器不卸载、仅把头部「作品名」替换为「单集标题」、
// 下方内容进行加载 —— 与角色↔作品在同一 overlay 内只换内部内容、零重载闪烁的体验完全一致。
const modal = useEpisodeCommentModal()
const entity = useEntityCard()
const searchOverlay = useSearchOverlay()
// 关闭按钮（X）：单集评论作为实体卡导航栈的一层，点 X 应「连背后搜索一起关掉」、
// 并关闭整个实体卡 overlay（即关闭所有悬浮窗），与角色/CV/作品卡的关闭语义一致。
function closeAll() {
  entity.close()
  searchOverlay.close()
}
// 头部箭头：返回上一级（导航栈上一层的作品/角色/CV）。已在栈根（首个打开的实体）时
// back() 返回 false，则直接关闭卡片（回到背后的详情页），与详情页「返回」语义一致。
function goBack() {
  if (!entity.back()) entity.close()
}

const detail = ref<EpisodeDetail | null>(null)
const comments = ref<EpisodeComment[]>([])
const total = ref(0)
const me = ref<{ username?: string; nickname?: string; avatar?: string | null }>({})
const draft = ref('')
const posting = ref(false)
const loading = ref(false)

// 评论排序：每次点进单集默认倒序（最新在前），点击切换为顺序（API 原序）
const sortOrder = ref<'asc' | 'desc'>('desc')
const sortLabel = computed(() => (sortOrder.value === 'asc' ? '倒序' : '顺序'))
function toggleSort() {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
}
const displayComments = computed(() =>
  sortOrder.value === 'asc' ? comments.value : [...comments.value].reverse()
)
// 稳定楼层号：按发布时间升序给每条评论分配 1-based 序号（不随排序切换变化）
const floorMap = computed<Record<string, number>>(() => {
  const sorted = [...comments.value].sort((a, b) => {
    const ta = new Date(a.createdAt ?? 0).getTime()
    const tb = new Date(b.createdAt ?? 0).getTime()
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb)
  })
  const map: Record<string, number> = {}
  sorted.forEach((c, i) => {
    if (c.id != null) map[String(c.id)] = i + 1
  })
  return map
})

const loggedIn = computed(() => !!(me.value.username || me.value.nickname))

const epNumber = computed(() => detail.value?.epNumber ?? modal.meta.value.epNumber ?? modal.episodeId.value)
const title = computed(() => detail.value?.title ?? modal.meta.value.title ?? null)
const duration = computed(() => detail.value?.duration ?? modal.meta.value.duration ?? null)
const airDate = computed(() => detail.value?.airDate ?? modal.meta.value.airDate ?? null)

/** 取评论的作者显示信息：自己发的评论用当前用户头像/昵称 */
function creatorOf(c: EpisodeComment) {
  if (c.mine && (me.value.username || me.value.nickname || me.value.avatar)) {
    return {
      username: me.value.username ?? '',
      nickname: me.value.nickname ?? me.value.username ?? '',
      avatar: me.value.avatar ?? undefined
    }
  }
  return { ...c.creator, avatar: c.creator.avatar ?? undefined }
}

function fmtTime(ts: number | string | null): string {
  if (ts == null) return ''
  let ms: number
  if (typeof ts === 'number') {
    ms = ts > 1e12 ? ts : ts * 1000
  } else {
    const n = Number(ts)
    if (!Number.isNaN(n) && /^\d+$/.test(ts)) ms = n > 1e12 ? n : n * 1000
    else {
      const p = Date.parse(ts)
      ms = Number.isNaN(p) ? 0 : p
    }
  }
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 表情回应（reactions）辅助：计数取 total，缺省用 users 长度
function rxTotal(rx: any): number {
  return typeof rx.total === 'number' ? rx.total : rx.users ? rx.users.length : 0
}
// 悬停卡片只显示回应者昵称列表（最多 10 个，超出加「等」）
function rxNames(rx: any): string {
  const users = rx.users || []
  const names = users.map((u: any) => u.nickname || u.username || '用户')
  if (names.length > 10) return names.slice(0, 10).join('、') + ' 等'
  return names.join('、') || '暂无回应'
}

// —— 表情回应（发表）——
const reactingTo = ref<number | null>(null) // 当前打开表情选择器的评论 id（顶层/子评论共用，仅一个）
const reactPosting = ref<number | null>(null) // 正在发表回应的评论 id（Bangumi 评论 id）
const rxError = ref('') // 发表表情回应失败时的提示（短暂显示）
function toggleReaction(id: number) {
  reactingTo.value = reactingTo.value === id ? null : id
}
function closeReaction() {
  reactingTo.value = null
}
// 判断当前登录用户是否已对某条评论做过某个表情回应
function meInReaction(rx: any): boolean {
  const users = rx?.users || []
  return users.some(
    (u: any) =>
      (me.value.username && u.username === me.value.username) ||
      (me.value.nickname && u.nickname === me.value.nickname)
  )
}
// 这条评论我是否已做过任意表情回应（用于爱心是否填充）
function commentReacted(c: any): boolean {
  return !!(c?.reactions && c.reactions.some(meInReaction))
}
// 这条评论里我已经做过的表情 value 集合（用于选择器高亮）
function reactedValues(c: any): Set<string> {
  const s = new Set<string>()
  for (const rx of c?.reactions || []) if (meInReaction(rx)) s.add(String(rx.value))
  return s
}
async function onReact(target: EpisodeComment, value: string | number) {
  const commentId = (target.providerId ?? target.id) as number
  if (!commentId) return
  if (reactPosting.value === commentId) return
  closeReaction()
  // toggle 语义：已对该评论做过该表情 → 取消（DELETE）；否则添加（PUT）
  const remove = reactedValues(target).has(String(value))
  reactPosting.value = commentId
  rxError.value = ''
  try {
    const r = await episodeClient.toggleReaction({ commentId, value: Number(value), remove })
    if (!r.synced && r.error) {
      rxError.value = r.error
      setTimeout(() => { if (rxError.value === r.error) rxError.value = '' }, 5000)
      return
    }
    // 刷新评论列表：已做的表情回应会随 p1 返回（reactions 含当前用户）
    await refreshComments()
  } catch (e) {
    console.warn('[EpisodeCommentModal] 发表表情回应失败：', e)
    rxError.value = (e as Error)?.message ?? '发表表情回应失败'
    setTimeout(() => { if (rxError.value) rxError.value = '' }, 5000)
  } finally {
    reactPosting.value = null
  }
}
// 点击已有表情标签：快速用该表情回应（沿用 onReact 的 toggle 语义）。
// 未登录或评论未同步到 Bangumi（本地草稿）时不动作。
function quickReact(target: any, value: string | number) {
  if (!loggedIn.value || target.providerId == null) return
  onReact(target, String(value))
}

async function loadAll() {
  if (!modal.episodeId.value) return
  loading.value = true
  draft.value = ''
  const epId = modal.episodeId.value
  const [d, c, m] = await Promise.all([
    episodeClient.getDetail(epId).catch(() => null),
    episodeClient.getComments(epId).catch(() => ({ comments: [] as EpisodeComment[], total: 0 })),
    episodeClient.getMe().catch(() => ({}))
  ])
  detail.value = d
  // 从单集评论链接打开时未带 pid：用 v0 返回的 subject_id 反查，补全作品 id（用于发评论）
  if (!modal.providerSubjectId.value && d?.subjectId) modal.providerSubjectId.value = String(d.subjectId)
  comments.value = c.comments
  total.value = c.total
  me.value = m
  loading.value = false
}

async function refreshComments() {
  if (!modal.episodeId.value) return
  const c = await episodeClient.getComments(modal.episodeId.value).catch(() => ({ comments: [] as EpisodeComment[], total: 0 }))
  comments.value = c.comments
  total.value = c.total
}

async function onSend() {
  const content = draft.value.trim()
  if (!content || posting.value) return
  posting.value = true
  try {
    await episodeClient.addComment({
      providerSubjectId: modal.providerSubjectId.value,
      episodeId: modal.episodeId.value,
      content
    })
    draft.value = ''
    // 刷新评论列表：已同步的会随 p1 返回，未同步的以本地草稿(mine, 待同步)出现
    await refreshComments()
  } catch (e) {
    console.warn('[EpisodeCommentModal] 发送评论失败：', e)
  } finally {
    posting.value = false
  }
}

// —— 子评论（回复）——
const replyingTo = ref<number | null>(null)
// 回复归属的顶层评论 id：Bangumi 是两层模型，回复子评论的评论仍归到顶层评论的 replies，
// 所以子评论回复的 parentId 必须指向其所属顶层评论（top），relatedId 才指向被回复的子评论本身。
const replyToTopId = ref<number | null>(null)
const replyDraft = ref('')
const replyPosting = ref(false)
function startReply(target: EpisodeComment, top?: EpisodeComment) {
  replyingTo.value = target.id
  replyToTopId.value = top ? top.id : target.id
  replyDraft.value = ''
}
function cancelReply() {
  replyingTo.value = null
  replyToTopId.value = null
  replyDraft.value = ''
}
async function onSendReply(target: EpisodeComment) {
  const content = replyDraft.value.trim()
  if (!content || replyPosting.value) return
  replyPosting.value = true
  try {
    await episodeClient.addComment({
      providerSubjectId: modal.providerSubjectId.value,
      episodeId: modal.episodeId.value as number,
      content,
      // parentId 指向顶层评论（主进程按它归并到 replies）；relatedId 指向被回复的那条（顶层或子评论）
      parentId: replyToTopId.value ?? target.id,
      relatedId: target.providerId ?? null
    })
    replyDraft.value = ''
    replyingTo.value = null
    replyToTopId.value = null
    // 刷新评论列表：已同步的回复会随 p1 父评论的 replies 返回，未同步的以本地草稿(mine)出现
    await refreshComments()
  } catch (e) {
    console.warn('[EpisodeCommentModal] 发送子评论失败：', e)
  } finally {
    replyPosting.value = false
  }
}


// —— 评论输入框的 BBCode 工具栏 + 实时预览 ——
const taRef = ref<HTMLTextAreaElement | null>(null)

// Bangumi 表情包面板：仅列出真实存在的表情（URL 已逐一验证可达）。
// 发出评论时插入 (代码) 文本，Bangumi 端会自行渲染成图。
const SMILEY_BASE = 'https://lain.bgm.tv/img/smiles/'
const p2 = (n: number) => String(n).padStart(2, '0')
const SMILEYS: { code: string; src: string }[] = [
  // 早期 bgm 系列（bgm/NN.png，已验证 01-10/12-22 存在）
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((n) => ({
    code: `(bgm${n})`,
    src: `${SMILEY_BASE}bgm/${p2(n)}.png`
  })),
  // 主 bgm 系列（tv/NN.gif，bgm24..85 → tv/01..tv/62）
  ...Array.from({ length: 62 }, (_, k) => {
    const n = k + 24
    return { code: `(bgm${n})`, src: `${SMILEY_BASE}tv/${p2(n - 23)}.gif` }
  }),
  // tv_vs 系列（bgm200..238 → tv_vs/bgm_N.png，即“b2xx”系列）
  ...Array.from({ length: 39 }, (_, k) => {
    const n = k + 200
    return { code: `(bgm${n})`, src: `${SMILEY_BASE}tv_vs/bgm_${n}.png` }
  }),
  // tv_500 特殊系列（仅 500/501/505/515..519 真实存在）
  ...[500, 501, 505, 515, 516, 517, 518, 519].map((n) => ({
    code: `(bgm${n})`,
    src: `${SMILEY_BASE}tv_500/bgm_${n}.gif`
  })),
  // musume / blake 娘系列（06..41 已验证存在）
  ...Array.from({ length: 36 }, (_, k) => {
    const n = k + 6
    return { code: `(musume_${p2(n)})`, src: `${SMILEY_BASE}musume/musume_${p2(n)}.gif` }
  }),
  ...Array.from({ length: 36 }, (_, k) => {
    const n = k + 6
    return { code: `(blake_${p2(n)})`, src: `${SMILEY_BASE}blake/blake_${p2(n)}.gif` }
  })
]
const showSmiley = ref(false)
function toggleSmiley() {
  showSmiley.value = !showSmiley.value
}
function insertSmiley(code: string) {
  const ta = taRef.value
  if (!ta) {
    draft.value += code
    return
  }
  const start = ta.selectionStart
  const end = ta.selectionEnd
  draft.value = draft.value.slice(0, start) + code + draft.value.slice(end)
  nextTick(() => {
    ta.focus()
    const p = start + code.length
    ta.setSelectionRange(p, p)
  })
}

/** 在光标选区两侧包裹 before/after；选区为空时插入占位文字 */
function surround(before: string, after: string, placeholder = '') {
  const ta = taRef.value
  if (!ta) {
    draft.value = before + (draft.value || placeholder) + after
    return
  }
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const sel = draft.value.slice(start, end) || placeholder
  draft.value = draft.value.slice(0, start) + before + sel + after + draft.value.slice(end)
  nextTick(() => {
    ta.focus()
    const pos = start + before.length
    ta.setSelectionRange(pos, pos + sel.length)
  })
}

function wrap(tag: string) {
  surround(`[${tag}]`, `[/${tag}]`, '文字')
}
function insertColor() {
  surround('[color=red]', '[/color]', '彩色文字')
}
function insertUrl() {
  const ta = taRef.value
  const start = ta?.selectionStart ?? 0
  const end = ta?.selectionEnd ?? 0
  const sel = draft.value.slice(start, end)
  if (sel && /^https?:\/\//i.test(sel)) surround(`[url=${sel}]`, '[/url]', '链接文字')
  else surround('[url=http://]', '[/url]', '链接文字')
}
function insertImg() {
  surround('[img]', '[/img]', 'http://')
}

/** 输入框快捷键：Ctrl/⌘ + B/I/U/D/L/P（与 Bangumi 编辑器一致） */
function onTaKey(e: KeyboardEvent) {
  const map: Record<string, () => void> = {
    b: () => wrap('b'),
    i: () => wrap('i'),
    u: () => wrap('u'),
    d: () => wrap('s'),
    l: () => insertUrl(),
    p: () => insertImg()
  }
  const fn = map[e.key.toLowerCase()]
  if ((e.ctrlKey || e.metaKey) && fn) {
    e.preventDefault()
    fn()
  }
}

watch(
  () => modal.episodeId.value,
  () => {
    detail.value = null
    comments.value = []
    total.value = 0
    // 每次进入单集评论默认顺序（最早在前）
    sortOrder.value = 'desc'
    loadAll()
  },
  { immediate: true }
)
</script>

<template>
  <div class="ec-modal" @click.stop>
    <div v-if="reactingTo !== null" class="ec-rx-backdrop" @click="closeReaction"></div>
    <header class="ec-head">
      <button class="back-btn" type="button" title="返回上级" aria-label="返回上级" @click="goBack">
        <svg class="back-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="12" x2="4" y2="12" /><polyline points="10,5 4,12 10,19" /></svg>
      </button>
      <div class="ec-title">
        <span class="ec-epno">ep.{{ epNumber }}</span>
        <span class="ec-name">{{ title || ('第 ' + epNumber + ' 话') }}</span>
      </div>
      <button class="ec-close" type="button" title="关闭" aria-label="关闭" @click="closeAll()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </header>

    <div class="ec-scroll">
    <div class="ec-meta">
      <span>时长: {{ duration || '—' }}</span>
      <span>首播: {{ airDate || '—' }}</span>
    </div>
    <div v-if="detail?.desc" class="ec-desc">
      <BgmBbcode :text="detail.desc" as="div" />
    </div>

    <!-- 自己的评论输入卡 -->
    <div class="ec-mine">
      <img v-if="me.avatar" :src="(me.avatar ?? undefined)" class="ec-avatar" alt="" />
      <div v-else class="ec-avatar ec-avatar-ph"></div>
      <div class="ec-mine-body">
        <div class="ec-mine-name">{{ me.nickname || me.username || '我' }}</div>
        <div class="ec-bb-bar">
          <button type="button" class="ec-bb-btn" title="粗体 (Ctrl+B)" @click="wrap('b')"><b>B</b></button>
          <button type="button" class="ec-bb-btn" title="斜体 (Ctrl+I)" @click="wrap('i')"><i>I</i></button>
          <button type="button" class="ec-bb-btn" title="下划线 (Ctrl+U)" @click="wrap('u')"><u>U</u></button>
          <button type="button" class="ec-bb-btn" title="删除线 (Ctrl+D)" @click="wrap('s')"><s>S</s></button>
          <button type="button" class="ec-bb-btn" title="颜色" @click="insertColor()">色</button>
          <button type="button" class="ec-bb-btn" title="链接 (Ctrl+L)" @click="insertUrl()">链</button>
          <button type="button" class="ec-bb-btn" title="图片 (Ctrl+P)" @click="insertImg()">图</button>
          <span class="ec-smiley-wrap">
            <button type="button" class="ec-bb-btn" title="表情" @click="toggleSmiley">表</button>
            <div v-if="showSmiley" class="ec-smiley-panel">
              <img
                v-for="s in SMILEYS"
                :key="s.code"
                :src="s.src"
                :alt="s.code"
                :title="s.code"
                class="ec-smiley-item"
                @click="insertSmiley(s.code)"
              />
            </div>
          </span>
        </div>
        <textarea
          ref="taRef"
          v-model="draft"
          class="ec-textarea"
          rows="3"
          maxlength="2000"
          placeholder="写下你对这集的评论…（支持 Bangumi BBCode：粗体/斜体/颜色/链接/图片等）"
          @keydown="onTaKey"
        ></textarea>
        <div v-if="draft.trim()" class="ec-preview">
          <span class="ec-preview-label">预览</span>
          <BgmBbcode :text="draft" as="div" class="ec-preview-body" />
        </div>
        <div class="ec-mine-foot">
          <span v-if="!loggedIn" class="ec-hint">未登录：评论仅保存在本地</span>
          <span v-else-if="posting" class="ec-hint">发送中…</span>
          <span v-else class="ec-hint"></span>
          <button class="ec-send" type="button" :disabled="!draft.trim() || posting" @click="onSend">
            {{ posting ? '发送中…' : '加上去' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 别人的评论 -->
    <div class="ec-list">
      <div class="ec-list-head">
        <span>评论 ({{ total }})</span>
        <button
          class="ec-sort-btn"
          type="button"
          :title="sortOrder === 'asc' ? '当前：倒序（点击切换为顺序）' : '当前：顺序（点击切换为倒序）'"
          @click="toggleSort"
        >{{ sortLabel }}</button>
      </div>
      <div v-if="rxError" class="ec-rx-error">表情回应失败：{{ rxError }}</div>
      <div v-if="loading" class="ec-loading">加载中…</div>
      <div v-else-if="comments.length === 0" class="ec-empty">还没有评论，来抢沙发～</div>
      <div
        v-for="c in displayComments"
        :key="c.id"
        class="ec-comment"
        :class="{ mine: c.mine }"
      >
        <img v-if="creatorOf(c).avatar" :src="creatorOf(c).avatar" class="ec-c-avatar" alt="" />
        <div v-else class="ec-c-avatar ec-avatar-ph"></div>
        <div class="ec-c-body">
          <div class="ec-c-head">
            <span class="ec-c-name">{{ creatorOf(c).nickname || creatorOf(c).username || '匿名' }}</span>
            <span v-if="c.mine" class="ec-c-me">我</span>
            <span v-if="c.mine && !c.synced" class="ec-c-draft">待同步</span>
            <span class="ec-c-floor-meta">
              <span class="ec-c-floor">#{{ floorMap[String(c.id)] }}</span>
              <span class="ec-c-time">{{ fmtTime(c.createdAt) }}</span>
            </span>
            <button class="ec-reply-btn" type="button" title="回复" aria-label="回复" @click="startReply(c)">
              <svg class="ec-reply-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>
            <button
              class="ec-react-btn"
              type="button"
              :class="{ active: commentReacted(c) }"
              :disabled="!loggedIn || c.providerId == null || reactPosting === (c.providerId ?? c.id)"
              :title="(!loggedIn ? '登录后才能发表表情回应' : c.providerId == null ? '评论同步后可发表表情回应' : '发表表情回应')"
              @click="toggleReaction(c.id)"
            >
              <svg class="ec-heart" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
            </button>
            <div v-if="reactingTo === c.id" class="ec-react-picker" @click.stop>
              <div class="ec-react-picker-title">发表表情回应</div>
              <div class="ec-react-grid">
                <button
                  v-for="v in REACTION_VALUES"
                  :key="v"
                  type="button"
                  class="ec-react-item"
                  :class="{ on: reactedValues(c).has(v) }"
                  :title="'表情 ' + v"
                  @click="onReact(c, v)"
                >
                  <img :src="reactionGifUrl(v)" referrerpolicy="no-referrer" alt="" />
                </button>
              </div>
            </div>
          </div>
          <BgmBbcode :text="c.content" as="span" class="ec-c-content" />

          <!-- 表情回应（reactions，仅登录态返回；别人给这条评论发的表情包） -->
          <div v-if="c.reactions && c.reactions.length" class="ec-reactions">
            <span
              v-for="(rx, ri) in c.reactions"
              :key="ri"
              class="ec-reaction"
              :class="{ 'ec-reaction--mine': meInReaction(rx) }"
              role="button"
              tabindex="0"
              :title="loggedIn ? '点击用此表情回应' : '登录后可用'"
              @click="quickReact(c, rx.value)"
              @keydown.enter.prevent="quickReact(c, rx.value)"
            >
              <img
                v-if="reactionGifUrl(rx.value)"
                :src="reactionGifUrl(rx.value)"
                class="ec-rx-img"
                alt=""
                referrerpolicy="no-referrer"
              />
              <template v-else>{{ rx.value }}</template>
              <span class="ec-rx-count">{{ rxTotal(rx) }}</span>
              <span class="ec-rx-tip">{{ rxNames(rx) }}</span>
            </span>
          </div>

          <!-- 嵌套子评论（Bangumi 评论回复） -->
          <div v-if="c.replies && c.replies.length" class="ec-replies">
            <div
              v-for="(r, ri) in c.replies"
              :key="r.id"
              class="ec-reply"
              :class="{ mine: r.mine }"
            >
              <img v-if="creatorOf(r).avatar" :src="creatorOf(r).avatar" class="ec-r-avatar" alt="" />
              <div v-else class="ec-r-avatar ec-avatar-ph"></div>
              <div class="ec-r-body">
                <div class="ec-r-head">
                  <span class="ec-r-name">{{ creatorOf(r).nickname || creatorOf(r).username || '匿名' }}</span>
                  <span v-if="r.mine" class="ec-c-me">我</span>
                  <span v-if="r.mine && !r.synced" class="ec-c-draft">待同步</span>
                  <span class="ec-c-floor-meta">
                    <span class="ec-c-floor">#{{ floorMap[String(c.id)] }}-{{ ri + 1 }}</span>
                    <span class="ec-c-time">{{ fmtTime(r.createdAt) }}</span>
                  </span>
                  <button class="ec-reply-btn" type="button" title="回复" aria-label="回复" @click="startReply(r, c)">
                    <svg class="ec-reply-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </button>
                  <button
                    class="ec-react-btn"
                    type="button"
                    :class="{ active: commentReacted(r) }"
                    :disabled="!loggedIn || r.providerId == null || reactPosting === (r.providerId ?? r.id)"
                    :title="(!loggedIn ? '登录后才能发表表情回应' : r.providerId == null ? '评论同步后可发表表情回应' : '发表表情回应')"
                    @click="toggleReaction(r.id)"
                  >
                    <svg class="ec-heart" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                  </button>
                  <div v-if="reactingTo === r.id" class="ec-react-picker" @click.stop>
                    <div class="ec-react-picker-title">发表表情回应</div>
                    <div class="ec-react-grid">
                      <button
                        v-for="v in REACTION_VALUES"
                        :key="v"
                        type="button"
                        class="ec-react-item"
                        :class="{ on: reactedValues(r).has(v) }"
                        :title="'表情 ' + v"
                        @click="onReact(r, v)"
                      >
                        <img :src="reactionGifUrl(v)" referrerpolicy="no-referrer" alt="" />
                      </button>
                    </div>
                  </div>
                </div>
                <BgmBbcode :text="r.content" as="span" class="ec-c-content" />

                <!-- 子评论的表情回应 -->
                <div v-if="r.reactions && r.reactions.length" class="ec-reactions">
                  <span
                    v-for="(rx, ri) in r.reactions"
                    :key="ri"
                    class="ec-reaction"
                    :class="{ 'ec-reaction--mine': meInReaction(rx) }"
                    role="button"
                    tabindex="0"
                    :title="loggedIn ? '点击用此表情回应' : '登录后可用'"
                    @click="quickReact(r, rx.value)"
                    @keydown.enter.prevent="quickReact(r, rx.value)"
                  >
                    <img
                      v-if="reactionGifUrl(rx.value)"
                      :src="reactionGifUrl(rx.value)"
                      class="ec-rx-img"
                      alt=""
                      referrerpolicy="no-referrer"
                    />
                    <template v-else>{{ rx.value }}</template>
                    <span class="ec-rx-count">{{ rxTotal(rx) }}</span>
                    <span class="ec-rx-tip">{{ rxNames(rx) }}</span>
                  </span>
                </div>

                <!-- 子评论的回复输入框（回复归属其所属顶层评论 c，relatedId 指向子评论 r） -->
                <div v-if="replyingTo === r.id" class="ec-reply-box">
                  <textarea
                    v-model="replyDraft"
                    class="ec-textarea ec-reply-ta"
                    rows="2"
                    maxlength="2000"
                    :placeholder="'回复 @' + (creatorOf(r).nickname || creatorOf(r).username || '匿名')"
                  ></textarea>
                  <div class="ec-mine-foot">
                    <span v-if="replyPosting" class="ec-hint">发送中…</span>
                    <span v-else class="ec-hint"></span>
                    <div class="ec-reply-actions">
                      <button class="ec-reply-cancel" type="button" :disabled="replyPosting" @click="cancelReply">取消</button>
                      <button class="ec-send" type="button" :disabled="!replyDraft.trim() || replyPosting" @click="onSendReply(r)">
                        {{ replyPosting ? '发送中…' : '回复' }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 回复输入框（同一时间仅展开一个） -->
          <div v-if="replyingTo === c.id" class="ec-reply-box">
            <textarea
              v-model="replyDraft"
              class="ec-textarea ec-reply-ta"
              rows="2"
              maxlength="2000"
              :placeholder="'回复 @' + (creatorOf(c).nickname || creatorOf(c).username || '匿名')"
            ></textarea>
            <div class="ec-mine-foot">
              <span v-if="replyPosting" class="ec-hint">发送中…</span>
              <span v-else class="ec-hint"></span>
              <div class="ec-reply-actions">
                <button class="ec-reply-cancel" type="button" :disabled="replyPosting" @click="cancelReply">取消</button>
                <button class="ec-send" type="button" :disabled="!replyDraft.trim() || replyPosting" @click="onSendReply(c)">
                  {{ replyPosting ? '发送中…' : '回复' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.ec-modal {
  width: 100%;
  max-width: none;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.ec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.ec-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
  padding: 0 8px;
  flex-wrap: wrap;
  /* 整行标题字号（ep.2 + 单集名），内部 epno/name 用 em 跟随，保持比例 */
  font-size: 20px;
}
.ec-epno {
  font-weight: 700;
  color: var(--text);
  flex-shrink: 0;
}
.ec-name {
  color: var(--text);
  font-size: 1em;
  line-height: 1.4;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.ec-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: none;
  background: var(--bg-elev);
  color: var(--text-dim);
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s ease, color 0.15s ease;
}
.ec-close svg {
  width: 16px;
  height: 16px;
  display: block;
}
.ec-close:hover {
  background: var(--accent-2);
  color: #fff;
}
.ec-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 16px 0;
  color: var(--text-dim);
  font-size: 12px;
}
.ec-desc {
  padding: 8px 16px 0;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.ec-mine {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  margin: 10px 16px 0;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.ec-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
  background: var(--bg-panel);
}
.ec-avatar-ph {
  background: var(--border);
}
.ec-mine-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ec-mine-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.ec-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  font-family: inherit;
}
.ec-textarea:focus {
  border-color: var(--accent-2);
}
.ec-bb-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ec-bb-btn {
  min-width: 30px;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  line-height: 1;
  color: var(--text);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ec-bb-btn:hover {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
.ec-smiley-wrap {
  position: relative;
  display: inline-flex;
}
.ec-smiley-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  width: min(336px, 72vw);
  max-height: 224px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
}
.ec-smiley-item {
  width: 28px;
  height: 28px;
  object-fit: contain;
  cursor: pointer;
  border-radius: 6px;
  justify-self: center;
}
.ec-smiley-item:hover {
  background: var(--bg-elev);
}
.ec-preview {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--bg-panel);
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.ec-preview-label {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.ec-preview-body {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
}
.ec-mine-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ec-hint {
  font-size: 12px;
  color: var(--text-dim);
}
.ec-send {
  padding: 7px 20px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  background: var(--accent-2);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.ec-send:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.ec-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.ec-list {
  padding: 12px 16px 16px;
  margin-top: 12px;
  border-top: 1px solid var(--border-soft);
}
.ec-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}
.ec-sort-btn {
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  color: var(--text);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.ec-sort-btn:hover {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
.ec-rx-error {
  margin: 0 0 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #fff;
  background: #d9534f;
  border-radius: 8px;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.ec-loading,
.ec-empty {
  color: var(--text-dim);
  font-size: 13px;
  padding: 12px 0;
  text-align: center;
}
.ec-comment {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-soft);
}
.ec-comment:last-child {
  border-bottom: none;
}
.ec-comment.mine {
  background: color-mix(in srgb, var(--accent-2) 8%, transparent);
  border-radius: 8px;
  padding: 10px 8px;
  margin: 0 -8px;
}
.ec-c-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
  background: var(--bg-panel);
}
.ec-c-body {
  flex: 1;
  min-width: 0;
}
.ec-c-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 3px;
}
.ec-c-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.ec-c-me {
  font-size: 11px;
  color: #fff;
  background: var(--accent-2);
  border-radius: 4px;
  padding: 0 5px;
  line-height: 16px;
}
.ec-c-draft {
  font-size: 11px;
  color: #d98b3a;
  border: 1px solid #d98b3a;
  border-radius: 4px;
  padding: 0 5px;
  line-height: 16px;
}
.ec-c-time {
  font-size: 11px;
  color: var(--text-dim);
  margin-left: auto;
}
/* 主评论头部：楼层号 + 日期作为一个整体靠右；子评论的 .ec-c-time 不在 meta 内，保持原右推 */
.ec-c-floor-meta {
  margin-left: auto;
  display: inline-flex;
  align-items: baseline;
}
.ec-c-floor-meta .ec-c-time {
  margin-left: 0;
}
.ec-c-floor {
  font-size: 11px;
  line-height: 16px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ec-c-floor::after {
  content: ' -';
  color: var(--text-dim);
}
.ec-c-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-all;
  overflow-wrap: anywhere;
}
.ec-reply-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-dim);
  background: transparent;
  border: none;
  padding: 4px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ec-reply-ico {
  width: 15px;
  height: 15px;
  display: block;
}
.ec-reply-btn:hover {
  color: var(--accent-2);
  background: var(--bg-elev);
}
/* 表情回应：回复右侧的空心爱心按钮 */
.ec-react-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 22px;
  padding: 2px;
  color: var(--text-dim);
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}
.ec-react-btn .ec-heart {
  width: 16px;
  height: 16px;
  display: block;
}
.ec-react-btn:hover:not(:disabled) {
  color: #ff5b7a;
  background: var(--bg-elev);
}
.ec-react-btn.active {
  color: #ff5b7a;
}
.ec-react-btn.active .ec-heart {
  fill: #ff5b7a;
}
.ec-react-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* 表情选择卡片（弹出层） */
.ec-rx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 45;
}
.ec-react-picker {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  width: max-content;
  padding: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
}
.ec-react-picker-title {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.ec-react-grid {
  display: grid;
  grid-template-columns: repeat(4, auto);
  gap: 8px;
}
.ec-react-item {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease, transform 0.08s ease;
}
.ec-react-item img {
  width: 22px;
  height: 22px;
  object-fit: contain;
  pointer-events: none;
}
.ec-react-item:hover {
  border-color: var(--accent-2);
  background: color-mix(in srgb, var(--accent-2) 12%, var(--bg-elev));
}
.ec-react-item:active {
  transform: scale(0.94);
}
.ec-react-item.on {
  border-color: var(--accent-2);
  background: color-mix(in srgb, var(--accent-2) 18%, var(--bg-elev));
}
.ec-reactions {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ec-reaction {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-dim);
  background: color-mix(in srgb, var(--text-dim) 12%, var(--bg-elev));
  border: 1px solid var(--border);
  padding: 3px 7px;
  border-radius: 999px;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.ec-reaction:hover {
  border-color: color-mix(in srgb, var(--accent-2) 55%, var(--border));
}
/* 浅色模式：表情卡片背景更浅 */
:global(:root[data-theme="light"]) .ec-reaction {
  background: color-mix(in srgb, var(--text-dim) 6%, var(--bg-elev));
  border-color: color-mix(in srgb, var(--text-dim) 14%, var(--border));
}
/* 我自己做过的表情回应：高亮（强调色边框 + 淡底色 + 文字/数字强调色） */
.ec-reaction--mine {
  color: var(--accent-2);
  background: color-mix(in srgb, var(--accent-2) 16%, var(--bg-elev));
  border-color: color-mix(in srgb, var(--accent-2) 55%, var(--border));
}
.ec-reaction--mine .ec-rx-count {
  color: var(--accent-2);
}
:global(:root[data-theme="light"]) .ec-reaction--mine {
  background: color-mix(in srgb, var(--accent-2) 12%, var(--bg-elev));
  border-color: color-mix(in srgb, var(--accent-2) 45%, var(--border));
}
.ec-rx-img {
  width: 18px;
  height: 18px;
  object-fit: contain;
  vertical-align: middle;
  border-radius: 3px;
}
.ec-rx-count {
  margin-left: 3px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}
/* 悬停卡片：只显示回应者昵称列表，圆角浮层。
   左对齐到表情标签（而非水平居中），避免卡片左半超出悬浮窗左边界被裁切。 */
.ec-rx-tip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  transform: translateY(4px);
  width: max-content;
  max-width: min(280px, 80vw);
  padding: 7px 10px;
  border-radius: 10px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 20;
}
.ec-reaction:hover .ec-rx-tip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
/* 浅色模式：悬停卡片用更实的浅色底，保证可读 */
:global(:root[data-theme="light"]) .ec-rx-tip {
  background: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
}
.ec-replies {
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ec-reply {
  display: flex;
  gap: 8px;
}
.ec-reply.mine {
  background: color-mix(in srgb, var(--accent-2) 8%, transparent);
  border-radius: 8px;
  padding: 6px 6px;
  margin: 0 -6px;
}
.ec-r-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
  background: var(--bg-panel);
}
.ec-r-body {
  flex: 1;
  min-width: 0;
}
.ec-r-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 2px;
}
.ec-r-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.ec-reply-box {
  margin-top: 8px;
}
.ec-reply-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ec-reply-cancel {
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev);
  color: var(--text-dim);
  cursor: pointer;
  transition: all 0.15s ease;
}
.ec-reply-cancel:hover {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
</style>
