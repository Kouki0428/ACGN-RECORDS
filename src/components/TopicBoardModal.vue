<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useModalZ } from '@/composables/useModalZ'
import { subjectClient } from '@/services/subjectClient'
import BgmBbcode from '@/components/BgmBbcode.vue'
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

// 楼层号：按发布时间升序 1-based（replies[0] 是楼主帖 = #1）
const floorMap = computed<Record<number, number>>(() => {
  const map: Record<number, number> = {}
  let n = 0
  for (const r of detail.value?.replies ?? []) {
    n += 1
    map[r.id] = n
    // 楼中楼不单独编号（与单集评论 #x-y 不同，这里保持简单：只标顶层楼层）
  }
  return map
})

// 除楼主帖外的回复列表
const replyList = computed<BgmTopicReply[]>(() => (detail.value?.replies ?? []).slice(1))
const opPost = computed<BgmTopicReply | null>(() => detail.value?.replies?.[0] ?? null)

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

async function load() {
  detail.value = null
  error.value = ''
  if (!props.topicId) return
  loading.value = true
  try {
    const d = await subjectClient.getTopicDetail(props.topicId)
    if (!d) error.value = '该讨论不存在，或需登录后才能查看。'
    else detail.value = d
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.topicId != null) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

watch(() => props.topicId, () => load(), { immediate: true })
</script>

<template>
  <Teleport to="body">
    <div v-if="topicId != null" class="tb-backdrop" :style="{ zIndex: z }" @click.self="emit('close')">
      <div class="tb-modal" @click.stop>
        <header class="ec-head tb-head">
          <div class="ec-title tb-title">
            <span class="tb-tag">讨论板</span>
            <span class="ec-name">{{ detail?.title || '加载中…' }}</span>
          </div>
          <button class="ec-close" type="button" title="关闭" aria-label="关闭" @click="emit('close')">
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
            <div v-if="opPost" class="tb-op">
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
                  <!-- 楼中楼 -->
                  <div v-if="r.replies && r.replies.length" class="ec-replies">
                    <div v-for="sub in r.replies" :key="sub.id" class="ec-reply">
                      <img v-if="sub.creator.avatar" :src="sub.creator.avatar" class="ec-r-avatar" alt="" />
                      <div v-else class="ec-r-avatar ec-avatar-ph"></div>
                      <div class="ec-r-body">
                        <div class="ec-r-head">
                          <span class="ec-r-name">{{ sub.creator.nickname || sub.creator.username || '匿名' }}</span>
                          <span class="ec-c-time">{{ fmtTime(sub.createdAt) }}</span>
                        </div>
                        <BgmBbcode :text="sub.content" as="div" class="ec-c-content" />
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
/* 遮罩 + 居中面板（视觉语言对齐单集评论悬浮窗 .ec-*） */
.tb-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 16px;
  background: rgba(0, 0, 0, 0.55);
}
.tb-modal {
  width: min(680px, 100%);
  max-height: 84vh;
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
.ec-close svg { width: 16px; height: 16px; display: block; }
.ec-close:hover { background: var(--accent-2); color: #fff; }
.ec-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.tb-meta {
  align-items: center;
}
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
.tb-placeholder {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-dim);
}
.tb-placeholder.warn { color: #e6a23c; }
/* 楼主帖高亮卡 */
.tb-op {
  display: flex;
  gap: 10px;
  margin: 10px 16px 0;
  padding: 12px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.tb-op-badge {
  font-size: 11px;
  line-height: 16px;
  color: #fff;
  background: var(--accent-2);
  border-radius: 4px;
  padding: 0 5px;
}
.tb-op-content {
  font-size: 14px;
}
.tb-list { border-top: none; }
/* ——以下复用单集评论的样式类（scoped 内复制关键部分）—— */
.ec-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 16px 0;
  color: var(--text-dim);
  font-size: 12px;
}
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
  align-items: baseline;
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
.ec-avatar-ph { background: var(--border); }
.ec-r-body { flex: 1; min-width: 0; }
.ec-r-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 2px;
}
.ec-r-name { font-size: 12px; font-weight: 600; color: var(--text); }
</style>
