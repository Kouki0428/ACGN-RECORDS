<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useCollectionModal } from '@/composables/useCollectionModal'
import { useModalZ } from '@/composables/useModalZ'
import { useToast } from '@/composables/useToast'
import { parseAppError } from '@/utils/appError'
import { collectionClient } from '@/services/collectionClient'
import { statusVerbs } from '@/utils/collectionVerbs'

// 全局单例：状态由 open() 写入，本组件只负责渲染与提交
const modal = useCollectionModal()
const toast = useToast()
// 最后打开的悬浮窗抬到最上层
const z = useModalZ(modal.isOpen)

// 本地编辑副本（打开时从单例状态初始化）
const selectedStatus = ref(1)
const draftComment = ref('')
const draftPrivate = ref(false)
const saving = ref(false)
// 保存失败时展示给用户的可读错误信息（避免「点了没反应」却无任何提示）
const errorMsg = ref('')

// 「我的评价」10 星（仅 selectedStatus !== 1 时显示并随收藏保存）
const RATING_LABELS: Record<number, string> = {
  1: '不忍直视',
  2: '很差',
  3: '差',
  4: '较差',
  5: '不过不失',
  6: '还行',
  7: '推荐',
  8: '力荐',
  9: '神作',
  10: '超神作'
}
const myRating = ref<number | null>(null)
const hoverRating = ref<number | null>(null)
// 该作品「原本是否就有评分」：仅当原本有评分、现被清空时才让减号显示激活态（橙色）；
// 从未评分的作品不应显示激活态（保持灰色），避免误导「已清除」。
const hadRating = ref(false)
const displayRating = computed<number | null>(() => hoverRating.value ?? myRating.value)
const hoverLabel = computed<string | null>(() =>
  hoverRating.value == null ? null : (RATING_LABELS[hoverRating.value] ?? null)
)
// 展示「我的评价」评分区的条件：
// 仅「在x / x过 / 搁置 / 抛弃」（status !== 1）展示评分；「想x」不展示（原始需求）。
// 详情页打过分必然伴随非想x 状态（库里 rating>0 的收藏 status 无 1），
// 故无需为「想x+有评分」额外放开；放宽反而会让「想x」误显示评分。
const showRating = computed(() => selectedStatus.value !== 1)
function setMyRating(n: number) {
  // 点击第 n 颗星即记为 n 分（你没要「再点同颗取消」，这里直接设定，不做 toggle）
  myRating.value = n
  modal.rating.value = n
}
// 减号按钮：清除「我的评价」评分 → 保存时 rating 传 null → 同步发 rate:0 删除 Bangumi 评分
function clearMyRating() {
  myRating.value = null
  modal.rating.value = null
}

// 5 个状态按钮（按媒体类型动词：想看/看过/在看/…，对应 status 1-5）
const statusButtons = computed(() => {
  const list = statusVerbs(modal.category.value)
  return [1, 2, 3, 4, 5].map((s, i) => ({ status: s, label: list[i] }))
})

async function syncFromSingleton() {
  selectedStatus.value = modal.currentStatus.value
  draftComment.value = modal.comment.value
  draftPrivate.value = modal.isPrivate.value
  hoverRating.value = null
  saving.value = false
  errorMsg.value = ''
  hadRating.value = false
  // 调用方传入的评分（edit 模式由 CollectionBar 已 load 的缓存提供，最可信、不依赖本次自取）
  const passedRating = modal.rating.value
  let r: number | null = passedRating
  let existingStatus: number | null = null
  let existingKeys: string[] | null = null
  try {
    const existing = await collectionClient.getExisting(modal.providerSubjectId.value)
    existingKeys = Object.keys(existing ?? {})
    existingStatus = existing?.status ?? null
    hadRating.value = !!(existing && typeof existing.rating === 'number' && existing.rating > 0)
    // 自取到有效评分（>0）则以自取为准（比调用方缓存更新鲜）；
    // 自取无评分且调用方也没传，则保持 null；自取失败则回退调用方传入值。
    if (existing && typeof existing.rating === 'number' && existing.rating > 0) {
      r = existing.rating
    } else if (passedRating == null) {
      r = null
    }
  } catch (e) {
    console.warn('[CollectionModal] 自取评分失败，回退使用传入值：', e)
    r = passedRating
  }
  // 关键：调用方默认预选「想x」(status=1) 时，评分区被 v-if 隐藏，看不到已打的星。
  // 若库里其实已收藏（非 1 状态），回退到真实状态，让评分区可见并正确点亮。
  if (
    modal.currentStatus.value === 1 &&
    modal.mode.value !== 'edit' &&
    existingStatus != null &&
    existingStatus !== 1
  ) {
    selectedStatus.value = existingStatus
  }
  myRating.value = r
  modal.rating.value = r
  // 临时调试：打开收藏悬浮窗后按 F12 看 Console 搜 [CollectionModal][debug]，
  // 即可确认 pid / 自取评分 / 最终选中状态 / 评分区是否显示，便于定位“评分不显示”。
  console.log('[CollectionModal][debug] sync:', {
    pid: modal.providerSubjectId.value,
    existingKeys,
    existingStatus,
    passedRating,
    finalRating: r,
    selectedStatus: selectedStatus.value,
    showRating: selectedStatus.value !== 1
  })
}

watch(
  () => [modal.isOpen.value, modal.providerSubjectId.value, modal.mode.value],
  () => {
    if (modal.isOpen.value) syncFromSingleton()
  },
  { immediate: true }
)

async function onSave() {
  if (saving.value) return
  saving.value = true
  errorMsg.value = ''
  try {
    await modal.save(selectedStatus.value, {
      comment: draftComment.value,
      private: draftPrivate.value,
      rating: showRating.value ? modal.rating.value : undefined
    })
    toast.ok('收藏已保存')
  } catch (e) {
    const info = parseAppError(e, '收藏保存失败')
    errorMsg.value = info.hint ? `${info.message}（${info.hint}）` : info.message
    toast.err('收藏保存失败')
    console.warn('[CollectionModal] 保存收藏失败：', e)
    saving.value = false
  }
}

function onOverlayClick() {
  modal.close()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && modal.isOpen.value) modal.close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="overlay">
    <div v-if="modal.isOpen.value" class="col-overlay" :style="{ zIndex: z }" @click="onOverlayClick">
      <div class="col-modal" @click.stop>
        <div class="col-head">
          <span class="col-title">加入收藏</span>
          <button class="col-close" type="button" title="关闭" aria-label="关闭" @click="modal.close()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div class="col-status-row">
          <button
            v-for="b in statusButtons"
            :key="b.status"
            type="button"
            class="col-status-btn"
            :class="{ active: selectedStatus === b.status }"
            @click="selectedStatus = b.status"
          >
            {{ b.label }}
          </button>
        </div>

        <div v-if="showRating" class="col-rating">
          <div class="col-rating-head">
            <span class="col-rating-label">我的评价</span>
            <span v-if="hoverLabel" class="col-rating-hover">{{ hoverLabel }}</span>
          </div>
          <div class="col-rating-stars">
            <button
              type="button"
              class="col-clear-btn"
              :class="{ 'is-active': myRating == null && hadRating }"
              title="清除评分（删除我的评价）"
              aria-label="清除评分"
              @click="clearMyRating"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
                <line x1="6" y1="12" x2="18" y2="12" />
              </svg>
            </button>
            <button
              type="button"
              class="col-star-btn"
              v-for="n in 10"
              :key="n"
              :class="{ 'is-active': displayRating != null && n <= displayRating }"
              :aria-label="`评分 ${n}`"
              @click="setMyRating(n)"
              @mouseenter="hoverRating = n"
              @mouseleave="hoverRating = null"
            >★</button>
          </div>
        </div>

        <div class="col-tucao">
          <textarea
            v-model="draftComment"
            class="col-textarea"
            rows="4"
            maxlength="300"
            placeholder="写点吐槽…（将作为「我的收藏评论」保存并同步到 Bangumi）"
          ></textarea>
        </div>

        <div class="col-foot">
          <button class="col-save" type="button" :disabled="saving" @click="onSave">
            {{ saving ? '保存中…' : '保存' }}
          </button>
          <label class="col-private">
            <input v-model="draftPrivate" type="checkbox" />
            <span>仅自己可见</span>
          </label>
        </div>
        <p v-if="errorMsg" class="col-error">保存失败：{{ errorMsg }}</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.col-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  /* 自带一层暗化 + 高斯模糊：当本悬浮窗叠在搜索/实体卡片等其它悬浮窗之上时，
     能遮住并模糊其下方的内容（全局 .modal-backdrop 只模糊应用主内容，叠在上面的
     其它悬浮窗并不在它背后），从而收藏窗后面始终有模糊。 */
  background: rgba(8, 10, 14, 0.42);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  /* 内容高于视口（如未评分作品展开评分区）时允许滚动，确保底部「保存」按钮始终可达，
     不再被 overflow 裁掉导致「点不到保存」。顶部留白 + 底部留白，滚动时上下都有缓冲。 */
  overflow-y: auto;
  padding: 18vh 16px 24px;
}
.col-modal {
  width: calc(100% - 32px);
  max-width: 420px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
}
.col-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.col-close {
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
.col-close svg {
  width: 16px;
  height: 16px;
  display: block;
}
.col-close:hover {
  background: var(--accent-2);
  color: #fff;
}
.col-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px 16px 4px;
}
.col-status-btn {
  flex: 1 1 auto;
  min-width: 56px;
  padding: 8px 10px;
  font-size: 13px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.col-status-btn:hover {
  border-color: var(--accent-2);
}
.col-status-btn.active {
  background: var(--accent-2);
  border-color: var(--accent-2);
  color: #fff;
  font-weight: 600;
}
.col-tucao {
  padding: 12px 16px 4px;
}

/* 我的评价 10 星（仅 status !== 1 时显示） */
.col-rating {
  padding: 4px 16px 0;
}
.col-rating-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 6px;
}
.col-rating-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim, #8b94a3);
}
.col-rating-hover {
  font-size: 12px;
  font-weight: 700;
  color: #ff5a5a;
}
.col-rating-stars {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
}
/* 减号按钮：清除「我的评价」评分；is-active 表示当前无评分（已清除） */
.col-clear-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  margin-right: 4px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg-elev);
  color: var(--text-dim);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.col-clear-btn svg {
  width: 14px;
  height: 14px;
  display: block;
}
.col-clear-btn:hover {
  border-color: var(--accent-2);
  color: var(--accent-2);
}
.col-clear-btn.is-active {
  border-color: var(--accent-2);
  color: var(--accent-2);
  background: var(--rating-bg, rgba(255, 206, 107, 0.14));
}
.col-star-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
  color: var(--text-dim, #8b94a3);
  transition: color 0.12s, transform 0.1s;
}
.col-star-btn:hover {
  transform: scale(1.12);
}
.col-star-btn.is-active {
  color: var(--rating-color, #f7b500);
}
.col-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  font-family: inherit;
}
.col-textarea:focus {
  border-color: var(--accent-2);
}
.col-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 16px;
}
.col-save {
  padding: 8px 22px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  background: var(--accent-2);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.col-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.col-private {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}
.col-private input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent-2);
  cursor: pointer;
}
.col-error {
  margin: 0 16px 14px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--err, #ff5a5a);
  background: rgba(255, 90, 90, 0.1);
  border: 1px solid rgba(255, 90, 90, 0.35);
  border-radius: 8px;
}

/* 进入/离开动画 */
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.2s ease;
}
.overlay-enter-active .col-modal,
.overlay-leave-active .col-modal {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
.overlay-enter-from .col-modal,
.overlay-leave-to .col-modal {
  transform: translateY(12px) scale(0.98);
  opacity: 0;
}
</style>
