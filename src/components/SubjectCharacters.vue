<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SubjectCharacter } from '@shared/types'
import { proxyImg } from '@/utils/imgProxy'
import { useEntityCard } from '@/composables/useEntityCard'

const props = defineProps<{
  characters: SubjectCharacter[]
  /** 当前作品在本地库的 id，用于匹配主进程后台推送的中文名补全 */
  subjectId?: number
  /**
   * 是否将角色/CV 点击「压入」卡片导航栈（而非重置）。
   * - false（默认）：用于作品详情页根上下文，点击角色开一张全新的卡片（open）。
   * - true：用于作品悬浮窗（SubjectCard）内部，点击角色延续「作品→角色→作品」链，可侧键逐级回退。
   */
  pushNav?: boolean
}>()

// 点击角色/CV 打开应用内详情卡片（替代跳转 bgm 网页）
const entity = useEntityCard()

// 本地维护一份角色列表，以便后台异步补全中文名时就地合并（无需父组件 reload）
const localChars = ref<SubjectCharacter[]>([])
let offCn: (() => void) | null = null
function mergeCn(fresh: SubjectCharacter[]) {
  if (!fresh?.length) return
  const map = new Map<number, SubjectCharacter>(localChars.value.map((c) => [c.id, c]))
  for (const f of fresh) {
    const cur = map.get(f.id)
    if (!cur) {
      map.set(f.id, f)
      continue
    }
    const freshCn = (f.nameCn && f.nameCn.trim()) || ''
    const baseCn = (cur.nameCn && cur.nameCn.trim()) || ''
    map.set(f.id, {
      ...cur,
      name: freshCn ? f.name : baseCn ? cur.name : f.name || cur.name,
      nameCn: freshCn || baseCn,
      image: f.image || cur.image,
      actors: f.actors ?? cur.actors
    })
  }
  localChars.value = [...map.values()]
}

// 登录态：用于空数据时的提示文案（是否已登录 Bangumi）
const loggedIn = ref(false)
onMounted(async () => {
  try {
    const s = await window.acgn.auth.getStatus()
    loggedIn.value = !!s?.loggedIn
  } catch {
    /* 忽略 */
  }
})

// 直接按 API 返回顺序展示：P1 已给出 Bangumi 网页的「作品内真实排序」（数组下标顺序，
// 主角置顶、与网页一字不差），故不再按关系类型做二次排序——否则会把 客串/闲角 推到末尾，
// 与用户要求的「原顺序展示」相悖。relation 仅作为徽章展示，不参与排序。
const sortedCharacters = computed<SubjectCharacter[]>(() => localChars.value)

// 角色/CV 点击：悬浮窗内压入历史（可逐级侧键回退）；详情页根上下文开全新卡片
function navigate(kind: 'character' | 'person', id: number, siblings: SubjectCharacter[]) {
  if (props.pushNav) entity.push(kind, id, siblings)
  else entity.open(kind, id, siblings)
}
function openCharacter(c: SubjectCharacter) {
  // 关联角色 = 同作品其他角色
  navigate('character', c.id, localChars.value.filter((x) => x.id !== c.id))
}
function openPerson(a?: { id?: number; name: string }) {
  if (a && typeof a.id === 'number') {
    // 人物卡无同作品上下文，关联角色由 API 的出演角色提供
    navigate('person', a.id, [])
  }
}

// ---- 自绘圆角滚动条（隐藏原生系统滚动条，避免直角；thumb 平时可见、可拖动）----
const gridEl = ref<HTMLUListElement | null>(null)
const thumbEl = ref<HTMLDivElement | null>(null)

type GridEl = HTMLUListElement & { __mo?: MutationObserver }
function updateScrollbar() {
  const grid = gridEl.value
  const thumb = thumbEl.value
  if (!grid || !thumb) return
  const { scrollWidth, clientWidth, scrollLeft } = grid
  if (scrollWidth <= clientWidth + 1) {
    thumb.style.display = 'none'
    return
  }
  thumb.style.display = ''
  const trackW = clientWidth
  const thumbW = Math.max(24, Math.floor((clientWidth / scrollWidth) * trackW))
  const maxScroll = scrollWidth - clientWidth
  const maxThumbX = trackW - thumbW
  const thumbX = maxScroll > 0 ? (scrollLeft / maxScroll) * maxThumbX : 0
  thumb.style.width = thumbW + 'px'
  thumb.style.transform = `translateX(${thumbX}px)`
}

let drag: { startX: number; startScroll: number; ratio: number } | null = null
function onThumbDown(e: MouseEvent) {
  const grid = gridEl.value
  if (!grid) return
  e.preventDefault()
  e.stopPropagation()
  const { scrollWidth, clientWidth, scrollLeft } = grid
  const trackW = clientWidth
  const thumbW = Math.max(24, Math.floor((clientWidth / scrollWidth) * trackW))
  const maxScroll = scrollWidth - clientWidth
  const maxThumbX = trackW - thumbW
  drag = {
    startX: e.clientX,
    startScroll: scrollLeft,
    ratio: maxThumbX > 0 ? maxScroll / maxThumbX : 0
  }
  window.addEventListener('mousemove', onThumbMove)
  window.addEventListener('mouseup', onThumbUp)
}
function onThumbMove(e: MouseEvent) {
  if (!drag || !gridEl.value) return
  const dx = e.clientX - drag.startX
  gridEl.value.scrollLeft = drag.startScroll + dx * drag.ratio
}
function onThumbUp() {
  drag = null
  window.removeEventListener('mousemove', onThumbMove)
  window.removeEventListener('mouseup', onThumbUp)
}

onMounted(() => {
  updateScrollbar()
  const grid = gridEl.value as GridEl | null
  if (grid) {
    grid.addEventListener('scroll', updateScrollbar, { passive: true })
    window.addEventListener('resize', updateScrollbar)
    const mo = new MutationObserver(() => updateScrollbar())
    mo.observe(grid, { childList: true, subtree: true })
    grid.__mo = mo
  }
  if (props.subjectId) {
    offCn = window.acgn.subjectExtra.onCnUpdated((payload: any) => {
      if (payload?.subjectId === props.subjectId && Array.isArray(payload.characters)) {
        mergeCn(payload.characters)
      }
    })
  }
})
onUnmounted(() => {
  const grid = gridEl.value as GridEl | null
  if (grid) {
    grid.removeEventListener('scroll', updateScrollbar)
    grid.__mo?.disconnect()
  }
  window.removeEventListener('resize', updateScrollbar)
  onThumbUp()
  offCn?.()
})

watch(
  () => props.characters,
  (val) => {
    localChars.value = val ?? []
    nextTick(() => setTimeout(updateScrollbar, 60))
  },
  { immediate: true }
)
</script>

<template>
  <section class="panel ch-panel">
    <h3>角色</h3>
    <ul v-if="sortedCharacters.length" ref="gridEl" class="ch-grid">
      <li
        v-for="c in sortedCharacters"
        :key="c.id"
        class="ch-card"
        :title="`查看角色：${c.name}`"
        @click="openCharacter(c)"
      >
        <div class="ch-avatar">
          <img v-if="c.image" :src="proxyImg(c.image)" :alt="c.name" loading="lazy" />
          <span v-else class="ch-avatar--empty">无头像</span>
        </div>
        <div class="ch-name" :title="c.name">{{ c.name }}</div>
        <div v-if="c.relation" class="ch-badge">{{ c.relation }}</div>
        <div v-if="c.actors && c.actors.length" class="ch-cv">
          <span
            v-for="a in c.actors"
            :key="a.name"
            class="ch-cv-item"
          >
            <span class="ch-cv-label">CV</span>
            <span
              class="ch-cv-name"
              :class="{ 'ch-cv-link': typeof a.id === 'number' }"
              :title="typeof a.id === 'number' ? `查看声优：${a.name}` : a.name"
              @click.stop="openPerson(a)"
            >
              {{ a.name }}
            </span>
          </span>
        </div>
      </li>
    </ul>
    <div v-if="sortedCharacters.length" class="ch-scrollbar">
      <div ref="thumbEl" class="ch-thumb" @mousedown="onThumbDown"></div>
    </div>
    <p v-else class="panel-empty">
      {{
        loggedIn
          ? '该作品暂无角色数据'
          : '登录 Bangumi 或下载「离线数据库」（设置页）后可显示角色与声优'
      }}
    </p>
  </section>
</template>

<style scoped>
.ch-panel h3 {
  margin: 0 0 10px;
  font-size: 15px;
}
/* 单行横排、不换行：角色多时通过左右无极滑动查看，卡片内 图 → 名 → 关系 → CV 纵向堆叠 */
.ch-grid {
  list-style: none;
  margin: 0;
  padding: 4px 2px 8px;
  display: flex;
  flex-wrap: nowrap;
  gap: 12px 10px;
  overflow-x: auto;
  overflow-y: hidden;
}
.ch-card {
  flex: 0 0 auto;
  width: 86px;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  text-align: center;
}
.ch-avatar {
  width: 86px;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-elev, #1c2230);
  border: 1px solid var(--border, #2a3342);
}
.ch-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
  display: block;
}
.ch-avatar--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 10px;
  color: var(--text-dim, #8b94a3);
}
.ch-name {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.25;
  color: var(--text, #e6e9ef);
  width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ch-badge {
  margin-top: 3px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-dim, #8b94a3);
  font-size: 10px;
  white-space: nowrap;
}
.ch-cv {
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  font-size: 10px;
  color: var(--accent, #f09199);
}
.ch-cv-item {
  width: 100%;
  text-align: center;
  line-height: 1.3;
}
.ch-cv-label {
  display: inline-block;
  vertical-align: middle;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-dim, #8b94a3);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.ch-cv-name {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: default;
  display: inline;
  white-space: normal;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.ch-cv-link {
  cursor: pointer;
  text-decoration: underline dotted;
}
.ch-cv-link:hover {
  color: var(--text);
}
.panel-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim, #8b94a3);
}
.ch-scrollbar {
  margin-top: 6px;
  height: 6px;
  border-radius: 999px;
  background: transparent;
  position: relative;
}
.ch-thumb {
  position: absolute;
  top: 0;
  left: 0;
  height: 6px;
  min-width: 24px;
  border-radius: 999px;
  background: var(--scroll-thumb, rgba(255, 255, 255, 0.25));
  cursor: pointer;
}
.ch-scrollbar:hover .ch-thumb,
.ch-thumb:hover {
  background: var(--scroll-thumb-hover, rgba(255, 255, 255, 0.4));
}
</style>

<!-- 全局作用域：自定义滚动条伪元素。Vue <style scoped> 编译后会给 ::-webkit-scrollbar 加属性选择器，
     导致 Chromium 忽略规则、回退原生（直角）滚动条；移到全局块可确保伪元素样式真正生效。 -->
<style>
.ch-grid {
  -webkit-appearance: none;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.ch-grid::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
</style>
