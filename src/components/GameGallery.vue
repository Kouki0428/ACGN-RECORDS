<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GameGallery, GameGalleryImage } from '@shared/types'
import { useSettingsStore } from '@/stores/settings'
import ToggleSwitch from './ToggleSwitch.vue'

const props = defineProps<{
  gallery: GameGallery | null
  loading?: boolean
  note?: string
}>()

const emit = defineEmits<{ (e: 'refresh'): void }>()

const settings = useSettingsStore()

type SourceKey = 'vndb' | 'dlsite' | 'steam'

const SOURCE_ORDER: SourceKey[] = ['vndb', 'dlsite', 'steam']
const SOURCE_LABEL: Record<SourceKey, string> = { vndb: 'VNDB', dlsite: 'DLsite', steam: 'Steam' }

const activeSource = ref<SourceKey>('dlsite')
// R18 显隐走全局设置（带记忆），非单条目
const showR18 = computed({
  get: () => settings.galleryR18,
  set: (v: boolean) => void settings.set('galleryR18', v ? '1' : '0')
})

/** 当前有图可显示（非空）的来源 */
const availableSources = computed<SourceKey[]>(() => {
  if (!props.gallery) return []
  return SOURCE_ORDER.filter((s) => (props.gallery?.[s]?.length ?? 0) > 0)
})

const currentImages = computed<GameGalleryImage[]>(() => {
  if (!props.gallery) return []
  if (!availableSources.value.includes(activeSource.value)) return []
  return props.gallery[activeSource.value] ?? []
})

// 切换作品时，把默认来源对齐到组件逻辑（dlsite → vndb → steam 优先）
watch(
  () => props.gallery,
  (g) => {
    if (!g) return
    const want: SourceKey = g.defaultSource
    activeSource.value = availableSources.value.includes(want)
      ? want
      : (availableSources.value[0] ?? 'dlsite')
  },
  { immediate: true }
)

// ---------- 灯箱 ----------
const lb = ref<{ open: boolean; index: number }>({ open: false, index: 0 })
// 新图是否加载完成：false 时先显示黑屏 + "加载中"，加载完再淡入，避免停在旧图
const lbLoaded = ref(false)
const lbUrl = computed(() => currentImages.value[lb.value.index]?.url ?? '')

// ---------- 缩略图加载兜底 ----------
// 记录「缩略图加载失败」的图片：key 为 img.url（原图）。失败时回退到真实图；
// 真实图也失败则视为死链，显示占位块（避免破图空洞）。
const thumbFailed = ref<Set<string>>(new Set())
const imgDead = ref<Set<string>>(new Set())
function onThumbError(img: GameGalleryImage) {
  if (thumbFailed.value.has(img.url)) {
    imgDead.value = new Set(imgDead.value).add(img.url) // 缩略图与原图都失败 → 死链
    thumbFailed.value = new Set(thumbFailed.value)
  } else if (img.thumb) {
    thumbFailed.value = new Set(thumbFailed.value).add(img.url) // 缩略图失败 → 换原图重试
  } else {
    imgDead.value = new Set(imgDead.value).add(img.url) // 无缩略图且原图失败 → 死链
  }
}
function thumbUrlOf(img: GameGalleryImage): string {
  return thumbFailed.value.has(img.url) ? img.url : img.thumb || img.url
}

function open(i: number) {
  if (!currentImages.value.length) return
  lb.value = { open: true, index: i }
  lbLoaded.value = false
}
function close() {
  lb.value.open = false
}
function nav(delta: number) {
  const len = currentImages.value.length
  if (!len) return
  lb.value.index = (lb.value.index + delta + len) % len
  lbLoaded.value = false // 先切到空白（黑屏），等新图加载出来再显示
}

function onKey(e: KeyboardEvent) {
  if (!lb.value.open) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') nav(-1)
  else if (e.key === 'ArrowRight') nav(1)
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- 卡片始终先显示，内部再区分 加载中 / 空 / 有图 状态 -->
  <section class="game-gallery">
    <div class="gg-head">
      <h3>游戏画廊</h3>
      <div class="gg-tabs" v-if="gallery">
        <span
          v-for="s in availableSources"
          :key="s"
          class="gg-tab"
          :class="{ active: s === activeSource }"
          @click="activeSource = s"
          >{{ SOURCE_LABEL[s] }}</span
        >
      </div>
      <label class="gg-nsfw" v-if="gallery && gallery.vndb.some((i) => i.nsfw)">
        <ToggleSwitch v-model="showR18" aria-label="显示 R18 截图" />
        <span>R18</span>
      </label>
      <span class="gg-rating" v-if="gallery && gallery.vndbRating != null">
        VNDB
        <span class="star">★</span>
        <span class="score">{{ gallery.vndbRating.toFixed(2) }}</span>
        <small v-if="gallery.vndbRatingCount">({{ gallery.vndbRatingCount }})</small>
      </span>
      <button class="gg-refresh" :disabled="loading" @click="emit('refresh')" title="重新联网抓取">
        ↻
      </button>
    </div>

    <div class="gg-strip" v-if="currentImages.length">
      <div
        v-for="(img, i) in currentImages"
        :key="i"
        class="gg-thumb"
        :class="{ nsfw: img.nsfw && !showR18, dead: imgDead.has(img.url) }"
        @click="open(i)"
      >
        <img v-if="imgDead.has(img.url)" src="" :alt="img.caption" class="gg-dead" />
        <img v-else :src="thumbUrlOf(img)" :alt="img.caption" loading="lazy" @error="onThumbError(img)" />
        <div v-if="img.nsfw && !showR18" class="gg-mask">R18</div>
      </div>
    </div>

    <p v-else-if="loading" class="hint">正在从 VNDB / DLsite / Steam 抓取…</p>
    <p v-else-if="note" class="hint">{{ note }}</p>
    <p v-else class="hint">该作暂无可显示的 CG / 截图（可能未在 Bangumi 维基登记对应外链）。</p>

    <!-- 灯箱 -->
    <div v-if="lb.open" class="gg-lightbox" @click.self="close">
      <button class="gg-lb-close" @click="close" title="关闭 (Esc)">✕</button>
      <button class="gg-lb-prev" @click.stop="nav(-1)" title="上一张 (←)">❮</button>
      <button class="gg-lb-next" @click.stop="nav(1)" title="下一张 (→)">❯</button>
      <div class="gg-lb-stage">
        <img
          class="gg-lb-img"
          :class="{ hidden: !lbLoaded }"
          :src="lbUrl"
          alt="preview"
          @load="lbLoaded = true"
          @error="lbLoaded = true"
          @click.stop
        />
        <div v-if="!lbLoaded" class="gg-lb-loading">加载中…</div>
      </div>
      <div class="gg-lb-counter">{{ lb.index + 1 }} / {{ currentImages.length }}</div>
    </div>
  </section>
</template>

<style scoped>
.game-gallery {
  background: var(--bg-panel, #1c2129);
  border: 1px solid var(--border, #2a3342);
  border-radius: var(--radius);
  padding: 14px 16px 16px;
  margin-top: 14px;
}

.gg-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.gg-head h3 {
  margin: 0;
  font-size: 15px;
}
.gg-tabs {
  display: flex;
  gap: 6px;
  margin-left: 4px;
}
.gg-tab {
  cursor: pointer;
  border: 1px solid var(--border, #2a3342);
  border-radius: var(--radius-lg);
  padding: 2px 10px;
  font-size: 12px;
  color: var(--text-dim, #8b97a8);
  user-select: none;
}
.gg-tab:hover {
  color: #fff;
}
.gg-tab.active {
  cursor: default;
  color: #fff;
  border-color: var(--accent, #f09199);
  background: var(--accent, #f09199);
}

.gg-nsfw {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-dim, #8b97a8);
  cursor: pointer;
  user-select: none;
}

.gg-rating {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  margin-left: 6px;
  padding: 2px 9px;
  border-radius: var(--radius-sm);
  background: var(--bg-elev, #2a313c);
  border: 1px solid var(--border, #3a4554);
  font-size: 12px;
  color: var(--text-dim, #8b97a8);
}
.gg-rating .star {
  color: #f7b500;
}
.gg-rating .score {
  font-size: 14px;
  font-weight: 700;
  color: #f7b500;
}
.gg-rating small {
  color: var(--text-dim, #8b97a8);
  font-size: 11px;
}

.gg-refresh {
  margin-left: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border, #2a3342);
  background: transparent;
  color: var(--text-dim, #8b97a8);
  font-size: 15px;
  cursor: pointer;
  transition: transform 0.2s ease, color 0.15s, border-color 0.15s;
}
.gg-refresh:hover:not(:disabled) {
  color: #fff;
  border-color: var(--accent, #f09199);
  transform: rotate(90deg);
}
.gg-refresh:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 横向滚动缩略图条（复刻组件 #vndb-grid） */
.gg-strip {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  gap: 6px;
  padding: 10px 2px 4px;
  scrollbar-width: thin;
}
.gg-thumb {
  position: relative;
  flex-shrink: 0;
  width: 150px;
  height: 95px;
  overflow: hidden;
  cursor: zoom-in;
  border-radius: var(--radius-sm);
  background: var(--bg-elev, #252c37);
  border: 1px solid var(--border, #2a3342);
  transition: transform 0.12s ease, border-color 0.15s;
}
.gg-thumb:hover {
  transform: translateY(-2px);
  border-color: var(--accent, #f09199);
}
.gg-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gg-thumb.nsfw .gg-mask,
.gg-thumb.nsfw img {
  filter: blur(12px);
}
.gg-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1px;
  background: rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

/* 灯箱 */
.gg-lightbox {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.88);
}
.gg-lb-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100px;
  min-height: 60px;
}
.gg-lb-img {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
  transition: opacity 0.15s ease;
}
/* 切换图片时先隐藏（露出上方黑屏），加载完成再淡入，避免停在旧图 */
.gg-lb-img.hidden {
  opacity: 0;
}
.gg-lb-loading {
  position: absolute;
  color: #ccc;
  font-size: 14px;
}
.gg-lb-close,
.gg-lb-prev,
.gg-lb-next {
  position: fixed;
  z-index: 2;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  cursor: pointer;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: background 0.15s;
}
.gg-lb-close:hover,
.gg-lb-prev:hover,
.gg-lb-next:hover {
  background: rgba(255, 255, 255, 0.3);
}
.gg-lb-close {
  top: 16px;
  right: 16px;
}
.gg-lb-close:hover {
  background: var(--accent);
  color: #fff;
}
.gg-lb-close:active {
  background: #ff3d77;
  color: #fff;
  transform: scale(0.94);
}
.gg-lb-prev {
  top: 50%;
  left: 16px;
  transform: translateY(-50%);
}
.gg-lb-next {
  top: 50%;
  right: 16px;
  transform: translateY(-50%);
}
.gg-lb-counter {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  color: #ccc;
  font-size: 13px;
  z-index: 2;
  white-space: nowrap;
}
</style>
