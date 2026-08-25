<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useModalZ } from '@/composables/useModalZ'
import { subjectClient } from '@/services/subjectClient'
import { episodeClient } from '@/services/episodeClient'
import BgmBbcode from '@/components/BgmBbcode.vue'
import CommentReactions from '@/components/CommentReactions.vue'
import ReactionPicker from '@/components/ReactionPicker.vue'
import { SMILEYS } from '@/constants/bgmSmileys'
import type { BgmTopicDetail, BgmTopicReply } from '@shared/types'

const props = defineProps<{
  /** 要展示的讨论串 id；null 时隐藏 */
  topicId: number | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

// 悬浮窗层级：走全局递增管理器，保证盖在作品悬浮卡（同为 useModalZ 体系）之上
const isOpen = computed(() => props.topicId != null)
const z = useModalZ(isOpen)

const detail = ref<BgmTopicDetail | null>(null)
const loading = ref(false)
const error = ref('')
const me = ref<{ username?: string; nickname?: string; avatar?: string | null }>({})
const loggedIn = computed(() => !!(me.value.username || me.value.nickname))

// 楼层号：按发布顺序 1-based（replies[0] 是楼主帖 = #1）
const floorMap = computed<Record<number, number>>(() => {
  const map: Record<number, number> = {}
  let n = 0
  for (const r of detail.value?.replies ?? []) map[r.id] = ++n
  return map
})

const opPost = computed<BgmTopicReply | null>(() => detail.value?.replies?.[0] ?? null)
const replyList = computed<BgmTopicReply[]>(() => (detail.value?.replies ?? []).slice(1))

function fmtTime(ts: number | string | null): string {
  if (ts == null) return ''
  const sec = typeof ts === 'number' ? ts : parseInt(String(ts), 10)
  if (!isFinite(sec) || sec <= 0) return ''
  const d = new Date(sec * 1000)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function openInBrowser() {
  if (props.topicId) void window.acgn.app.openExternal(`https://bgm.tv/subject/topic/${props.topicId}`)
}

async function load(withMe = false) {
  error.value = ''
  if (!props.topicId) return
  loading.value = true
  try {
    const [d, m] = await Promise.all([
      subjectClient.getTopicDetail(props.topicId),
      withMe ? episodeClient.getMe().catch(() => ({})) : Promise.resolve(me.value)
    ])
    me.value = m ?? me.value
    if (!d && !error.value) error.value = '该讨论不存在，或需登录后才能查看。'
    else detail.value = d
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function closeAll() {
  emit('close')
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.topicId != null) closeAll()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

watch(() => props.topicId, () => { detail.value = null; load(true) })

// —— 发表顶层回复 / 楼中楼回复 ——
const draft = ref('')
const posting = ref(false)
const replyingTo = ref<number | null>(null) // 目标楼层 id；null = 顶层回复框收起
const replyDraft = ref('')
const replyPosting = ref(false)

async function refreshDetail() {
  if (!props.topicId) return
  try {
    detail.value = await subjectClient.getTopicDetail(props.topicId)
  } catch { /* 忽略刷新失败 */ }
}

async function onSendTop() {
  const content = draft.value.trim()
  if (!content || posting.value || !props.topicId) return
  posting.value = true
  try {
    await subjectClient.postTopicReply({ topicId: props.topicId, content })
    draft.value = ''
    await refreshDetail()
  } catch (e) {
    console.warn('[TopicBoard] 回复失败：', e)
    error.value = e instanceof Error ? e.message : String(e)
    setTimeout(() => { if (error.value === String(e)) error.value = '' }, 5000)
  } finally {
    posting.value = false
  }
}

function startReply(target: BgmTopicReply, top?: BgmTopicReply) {
  replyingTo.value = target.id
  // Bangumi 两层模型：楼中楼回复的 replyTo 始终指向所属顶层楼层
  void top
  replyDraft.value = ''
}
function cancelReply() {
  replyingTo.value = null
  replyDraft.value = ''
}
async function onSendReply(target: BgmTopicReply) {
  const content = replyDraft.value.trim()
  if (!content || replyPosting.value || !props.topicId) return
  replyPosting.value = true
  try {
    await subjectClient.postTopicReply({ topicId: props.topicId, content, replyTo: target.id })
    replyDraft.value = ''
    replyingTo.value = null
    await refreshDetail()
  } catch (e) {
    console.warn('[TopicBoard] 回复失败：', e)
    error.value = e instanceof Error ? e.message : String(e)
    setTimeout(() => { if (error.value === String(e)) error.value = '' }, 5000)
  } finally {
    replyPosting.value = false
  }
}

// —— 表情回应（toggle，端点 subjects/-/posts/{postId}/like）——
const reactingTo = ref<number | null>(null)
const reactPosting = ref<number | null>(null)
const rxError = ref('')
function toggleReaction(id: number) {
  reactingTo.value = reactingTo.value === id ? null : id
}
function closeReaction() {
  reactingTo.value = null
}
function meInReaction(rx: any): boolean {
  const users = rx?.users || []
  return users.some(
    (u: any) =>
      (me.value.username && u.username === me.value.username) ||
      (me.value.nickname && u.nickname === me.value.nickname)
  )
}
function commentReacted(c: BgmTopicReply): boolean {
  return !!(c.reactions && c.reactions.some(meInReaction))
}
function reactedValues(c: BgmTopicReply): Set<string> {
  const s = new Set<string>()
  for (const rx of c.reactions || []) if (meInReaction(rx)) s.add(String(rx.value))
  return s
}
async function onReact(target: BgmTopicReply, value: string | number) {
  if (!target.id) return
  if (reactPosting.value === target.id) return
  closeReaction()
  const remove = reactedValues(target).has(String(value))
  reactPosting.value = target.id
  rxError.value = ''
  try {
    const r = await subjectClient.toggleTopicReaction({ postId: target.id, value: Number(value), remove })
    if (!r.synced) return
    await refreshDetail()
  } catch (e) {
    console.warn('[TopicBoard] 表情回应失败：', e)
    rxError.value = (e as Error)?.message ?? '发表表情回应失败'
    setTimeout(() => { if (rxError.value === ((e as Error)?.message ?? '')) rxError.value = '' }, 5000)
  } finally {
    reactPosting.value = null
  }
}
function quickReact(target: BgmTopicReply, value: string | number) {
  if (!loggedIn.value || target.id == null) return
  void onReact(target, value)
}

// —— 回复输入框 BBCode 工具栏 + 表情插入（与单集评论编辑器一致） ——
const taRef = ref<HTMLTextAreaElement | null>(null)
const showSmiley = ref(false)
function toggleSmiley() {
  showSmiley.value = !showSmiley.value
}
function insertAtSelection(getText: (sel: string) => string) {
  const ta = taRef.value
  if (!ta) return
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const sel = draft.value.slice(start, end)
  const ins = getText(sel)
  draft.value = draft.value.slice(0, start) + ins + draft.value.slice(end)
  nextTick(() => {
    ta.focus()
    const p = start + ins.length
    ta.setSelectionRange(p, p)
  })
}
function wrap(tag: string) {
  insertAtSelection((sel) => `[${tag}]${sel || '文字'}[/${tag}]`)
}
function insertColor() {
  insertAtSelection((sel) => `[color=red]${sel || '彩色文字'}[/color]`)
}
function insertUrl() {
  const ta = taRef.value
  const sel = draft.value.slice(ta?.selectionStart ?? 0, ta?.selectionEnd ?? 0)
  insertAtSelection((s) =>
    sel && /^https?:\/\//i.test(sel) ? `[url=${sel}]${s || '链接文字'}[/url]` : `[url=http://]${s || sel || '链接文字'}[/url]`
  )
}
function insertImg() {
  insertAtSelection((sel) => `[img]${sel || 'http://'}[/img]`)
}
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
</script>

<template>
  <Teleport to="body">
    <div v-if="topicId != null" class="tb-backdrop" :style="{ zIndex: z }" @click.self="closeAll">
      <div class="tb-modal ec-modal-size" @click.stop>
        <header class="ec-head tb-head">
          <div class="ec-title tb-title">
            <span class="tb-tag">讨论板</span>
            <span class="ec-name">{{ detail?.title || '加载中…' }}</span>
          </div>
          <button class="ec-close" type="button" title="关闭" aria-label="关闭" @click="closeAll">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </header>

        <div class="ec-scroll">
          <p v-if="loading" class="tb-placeholder">加载中…</p>
          <p v-else-if="error" class="tb-placeholder warn">{{ error }}</p>
          <template v-else-if="detail">
            <div class="ec-meta tb-meta">
              <span v-if="detail.subject?.nameCN || detail.subject?.name">
                {{ detail.subject?.nameCN || detail.subject?.name }}
              </span>
              <span>{{ detail.replyCount }} 条回复</span>
              <button class="tb-open" type="button" @click="openInBrowser">在浏览器打开 ↗</button>
            </div>

            <!-- 楼主帖 -->
            <div v-if="opPost" class="ec-comment tb-op">
              <img v-if="opPost.creator.avatar" :src="opPost.creator.avatar" class="ec-c-avatar" alt="" />
              <div v-else class="ec-c-avatar ec-avatar-ph"></div>
              <div class="ec-c-body">
                <div class="ec-c-head">
                  <span class="ec-c-name">{{ opPost.creator.nickname || opPost.creator.username || '匿名' }}</span>
                  <span class="tb-op-badge">楼主</span>
                  <span class="ec-c-floor-meta">
                    <span class="ec-c-floor">#1</span>
                    <span class="ec-c-time">{{ fmtTime(opPost.createdAt) }}</span>
                  </span>
                </div>
                <BgmBbcode :text="opPost.content" as="div" class="ec-c-content tb-op-content" />

                <!-- 楼主帖表情回应 -->
                <CommentReactions
                  v-if="opPost.reactions && opPost.reactions.length"
                  :reactions="opPost.reactions"
                  :me="me"
                  :logged-in="loggedIn"
                  @quick-react="(v) => quickReact(opPost!, v)"
                />

                <div v-if="opPost" class="tb-actions">
                  <button class="ec-reply-btn" type="button" title="回复" @click="startReply(opPost)">
                    <svg class="ec-reply-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  </button>
                  <button
                    class="ec-react-btn"
                    type="button"
                    :class="{ active: commentReacted(opPost) }"
                    :disabled="!loggedIn || reactPosting === opPost.id"
                    :title="!loggedIn ? '登录后才能发表表情回应' : '发表表情回应'"
                    @click="toggleReaction(opPost.id)"
                  >
                    <svg class="ec-heart" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                  </button>
                  <ReactionPicker v-if="reactingTo === opPost.id" :reacted="reactedValues(opPost)" @select="(v) => onReact(opPost!, v)" />
                </div>
              </div>
            </div>

            <!-- 我的回复输入卡 -->
            <div class="ec-mine tb-mine">
              <img v-if="me.avatar" :src="me.avatar ?? undefined" class="ec-avatar" alt="" />
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
                        @click="draft += s.code"
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
                  placeholder="回复这个讨论…（支持 Bangumi BBCode）"
                  @keydown="onTaKey"
                ></textarea>
                <div class="ec-mine-foot">
                  <span v-if="!loggedIn" class="ec-hint">未登录：请先在「个人」页登录后再回复</span>
                  <span v-else-if="posting" class="ec-hint">发送中…</span>
                  <span v-else class="ec-hint"></span>
                  <button class="ec-send" type="button" :disabled="!draft.trim() || posting || !loggedIn" @click="onSendTop">
                    {{ posting ? '发送中…' : '加上去' }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 回复列表 -->
            <div class="ec-list tb-list">
              <div class="ec-list-head"><span>回复 ({{ replyList.length }})</span></div>
              <div v-if="replyList.length === 0" class="ec-empty">还没有回复。</div>
              <div v-for="r in replyList" :key="r.id" class="ec-comment">
                <img v-if="r.creator.avatar" :src="r.creator.avatar" class="ec-c-avatar" alt="" />
                <div v-else class="ec-c-avatar ec-avatar-ph"></div>
                <div class="ec-c-body">
                  <div class="ec-c-head">
                    <span class="ec-c-name">{{ r.creator.nickname || r.creator.username || '匿名' }}</span>
                    <span class="ec-c-floor-meta">
                      <span class="ec-c-floor">#{{ floorMap[r.id] }}</span>
                      <span class="ec-c-time">{{ fmtTime(r.createdAt) }}</span>
                    </span>
                  </div>
                  <BgmBbcode :text="r.content" as="div" class="ec-c-content" />

                  <CommentReactions
                    v-if="r.reactions && r.reactions.length"
                    :reactions="r.reactions"
                    :me="me"
                    :logged-in="loggedIn"
                    @quick-react="(v) => quickReact(r, v)"
                  />

                  <!-- 操作行：回复 / 表情 -->
                  <div class="tb-actions">
                    <button class="ec-reply-btn" type="button" title="回复" @click="startReply(r)">
                      <svg class="ec-reply-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                    </button>
                    <button
                      class="ec-react-btn"
                      type="button"
                      :class="{ active: commentReacted(r) }"
                      :disabled="!loggedIn || reactPosting === r.id"
                      :title="!loggedIn ? '登录后才能发表表情回应' : '发表表情回应'"
                      @click="toggleReaction(r.id)"
                    >
                      <svg class="ec-heart" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                    </button>
                    <ReactionPicker v-if="reactingTo === r.id" :reacted="reactedValues(r)" @select="(v) => onReact(r, v)" />
                  </div>

                  <!-- 楼中楼 -->
                  <div v-if="r.replies && r.replies.length" class="ec-replies">
                    <div v-for="sub in r.replies" :key="sub.id" class="ec-reply">
                      <img v-if="sub.creator.avatar" :src="sub.creator.avatar" class="ec-r-avatar" alt="" />
                      <div v-else class="ec-r-avatar ec-avatar-ph"></div>
                      <div class="ec-r-body">
                        <div class="ec-r-head">
                          <span class="ec-r-name">{{ sub.creator.nickname || sub.creator.username || '匿名' }}</span>
                          <span class="ec-c-time">{{ fmtTime(sub.createdAt) }}</span>
                          <button
                            class="ec-react-btn tb-sub-react"
                            type="button"
                            :class="{ active: commentReacted(sub) }"
                            :disabled="!loggedIn || reactPosting === sub.id"
                            :title="!loggedIn ? '登录后才能发表表情回应' : '发表表情回应'"
                            @click="toggleReaction(sub.id)"
                          >
                            <svg class="ec-heart" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                          </button>
                          <ReactionPicker v-if="reactingTo === sub.id" :reacted="reactedValues(sub)" @select="(v) => onReact(sub, v)" />
                        </div>
                        <BgmBbcode :text="sub.content" as="div" class="ec-c-content" />
                        <CommentReactions
                          v-if="sub.reactions && sub.reactions.length"
                          :reactions="sub.reactions"
                          :me="me"
                          :logged-in="loggedIn"
                          @quick-react="(v) => quickReact(sub, v)"
                        />
                      </div>
                    </div>
                  </div>

                  <!-- 楼中楼回复框（replyTo 指向所属顶层楼层） -->
                  <div v-if="replyingTo === r.id" class="ec-reply-box">
                    <textarea
                      v-model="replyDraft"
                      class="ec-textarea ec-reply-ta"
                      rows="2"
                      maxlength="2000"
                      :placeholder="'回复 #' + floorMap[r.id] + ' …'"
                    ></textarea>
                    <div class="ec-mine-foot">
                      <span v-if="replyPosting" class="ec-hint">发送中…</span>
                      <span v-else class="ec-hint"></span>
                      <div class="ec-reply-actions">
                        <button class="ec-reply-cancel" type="button" :disabled="replyPosting" @click="cancelReply">取消</button>
                        <button class="ec-send" type="button" :disabled="!replyDraft.trim() || replyPosting || !loggedIn" @click="onSendReply(r)">
                          {{ replyPosting ? '发送中…' : '回复' }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 遮罩：顶部对齐 8vh（与单集评论悬浮窗 swap-panel 的 top:8vh 一致，保证上下位置一致） */
.tb-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 32px 6vh;
  background: rgba(0, 0, 0, 0.55);
}
/* 宽高与单集评论悬浮窗一致：限宽 1000px、高度上限 80vh */
.tb-modal.ec-modal-size {
  width: min(1000px, 100%);
  max-height: 80vh;
  height: auto;
}
.tb-modal {
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.tb-head {
  padding: 14px 16px;
}
.tb-title {
  font-size: 17px;
}
.tb-tag {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
  background: rgba(255, 92, 138, 0.12);
  border-radius: 6px;
  padding: 2px 8px;
  flex-shrink: 0;
  align-self: center;
}
.tb-modal .ec-close {
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
.tb-modal .ec-close svg { width: 16px; height: 16px; display: block; }
.tb-modal .ec-close:hover { background: var(--accent-2); color: #fff; }
.tb-scroll-ok { min-height: 0; }
.tb-placeholder {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-dim);
}
.tb-placeholder.warn { color: #e6a23c; }
.tb-meta { align-items: center; }
.tb-open {
  margin-left: auto;
  font-size: 12px;
  color: var(--accent);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
}
.tb-open:hover { text-decoration: underline; }
/* 楼主帖高亮 */
.tb-op {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
  margin: 10px 16px 0;
  padding: 12px;
}
.tb-op-badge {
  font-size: 11px;
  line-height: 16px;
  color: #fff;
  background: var(--accent-2);
  border-radius: 4px;
  padding: 0 5px;
}
.tb-op-content { font-size: 14px; }
/* 楼层操作行（回复/爱心） */
.tb-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}
/* 我的回复卡 */
.tb-mine { margin-bottom: 2px; }
.tb-sub-react { width: 20px; height: 20px; }

/* ——以下样式类与单集评论悬浮窗(.ec-*)保持一致—— */
.ec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.ec-title {
  display: flex;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
  padding: 0 8px;
  flex-wrap: wrap;
}
.ec-name {
  color: var(--text);
  line-height: 1.4;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.ec-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.ec-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 16px 0;
  color: var(--text-dim);
  font-size: 12px;
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
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}
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
.ec-comment:last-child { border-bottom: none; }
.ec-c-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
  background: var(--bg-panel);
}
.ec-avatar-ph { background: var(--border); }
.ec-c-body { flex: 1; min-width: 0; }
.ec-c-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 3px;
}
.ec-c-name { font-size: 13px; font-weight: 600; color: var(--text); }
.ec-c-time { font-size: 11px; color: var(--text-dim); }
.ec-c-floor-meta {
  margin-left: auto;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.ec-c-floor {
  font-size: 11px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ec-c-floor::after { content: ' -'; }
.ec-c-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-all;
  overflow-wrap: anywhere;
}
/* 我的回复卡（同 .ec-mine） */
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
.ec-mine-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ec-mine-name { font-size: 13px; font-weight: 600; color: var(--text); }
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
.ec-textarea:focus { border-color: var(--accent-2); }
.ec-bb-bar { display: flex; flex-wrap: wrap; gap: 4px; }
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
.ec-bb-btn:hover { border-color: var(--accent-2); color: var(--accent-2); }
.ec-smiley-wrap { position: relative; display: inline-flex; }
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
.ec-smiley-item:hover { background: var(--bg-elev); }
.ec-mine-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ec-hint { font-size: 12px; color: var(--text-dim); }
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
.ec-send:disabled { opacity: 0.6; cursor: not-allowed; }
/* 楼层回复/爱心按钮（同 .ec-reply-btn/.ec-react-btn） */
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
.ec-reply-ico { width: 15px; height: 15px; display: block; }
.ec-reply-btn:hover { color: var(--accent-2); background: var(--bg-elev); }
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
.ec-heart { width: 16px; height: 16px; display: block; }
.ec-react-btn:hover:not(:disabled) { color: #ff5b7a; background: var(--bg-elev); }
.ec-react-btn.active { color: #ff5b7a; }
.ec-react-btn.active .ec-heart { fill: #ff5b7a; }
.ec-react-btn:disabled { opacity: 0.4; cursor: not-allowed; }
/* 楼中楼 */
.ec-replies {
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ec-reply { display: flex; gap: 8px; }
.ec-r-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
  background: var(--bg-panel);
}
.ec-r-body { flex: 1; min-width: 0; }
.ec-r-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 2px;
}
.ec-r-name { font-size: 12px; font-weight: 600; color: var(--text); }
.ec-reply-box { margin-top: 8px; }
.ec-reply-actions { display: flex; align-items: center; gap: 8px; }
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
.ec-reply-cancel:hover { border-color: var(--accent-2); color: var(--accent-2); }
</style>
