<script setup lang="ts">
// 详情页吸顶锚点条：点击平滑跳转到对应区块（[data-anchor]），滚动时高亮当前区。
// 纯渲染层通用组件，四个详情视图共用；依赖全局 [data-anchor] 的 scroll-margin-top。
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'

export interface AnchorItem {
  key: string
  label: string
}

const props = defineProps<{ items: AnchorItem[] }>()

const activeKey = ref('')
// 仅展示「目标元素真实存在」的锚点：动画/游戏没有单行本区块（SubjectRelations
// 空数据不渲染根节点），按存在性过滤后对应 chip 自动隐藏，无需各视图硬编码。
const shownItems = ref<AnchorItem[]>([])
let scroller: HTMLElement | null = null
let raf = 0

function refreshShown() {
  shownItems.value = props.items.filter(
    (it) => !!document.querySelector(`[data-anchor="${it.key}"]`)
  )
}

function querySections(): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const it of shownItems.value) {
    const el = document.querySelector<HTMLElement>(`[data-anchor="${it.key}"]`)
    if (el) out.push(el)
  }
  return out
}

function updateActive() {
  const sections = querySections()
  if (!sections.length) return
  // 以「吸顶栏下沿」为判定线：最后一个越线的区块即当前区
  const line = (scroller?.getBoundingClientRect().top ?? 0) + 96
  let cur = sections[0]
  for (const el of sections) {
    if (el.getBoundingClientRect().top <= line) cur = el
  }
  activeKey.value = cur.getAttribute('data-anchor') ?? ''
}

function onScroll() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    updateActive()
  })
}

function jump(key: string) {
  const el = document.querySelector<HTMLElement>(`[data-anchor="${key}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(async () => {
  scroller = document.querySelector('.content')
  scroller?.addEventListener('scroll', onScroll, { passive: true })
  await nextTick()
  refreshShown()
  updateActive()
  // 部分区块由异步数据驱动渲染（如角色/关联补全后才有根节点），延迟复查一次
  window.setTimeout(() => {
    refreshShown()
    updateActive()
  }, 600)
})
onUnmounted(() => {
  scroller?.removeEventListener('scroll', onScroll)
  if (raf) cancelAnimationFrame(raf)
})
watch(
  () => props.items,
  async () => {
    await nextTick()
    refreshShown()
    updateActive()
  },
  { deep: true }
)
</script>

<template>
  <div class="anchor-bar">
    <button
      v-for="it in shownItems"
      :key="it.key"
      type="button"
      class="anchor-chip"
      :class="{ active: activeKey === it.key }"
      @click="jump(it.key)"
    >
      {{ it.label }}
    </button>
  </div>
</template>

<style scoped>
.anchor-bar {
  position: sticky;
  /* Chromium 的 sticky 相对「滚动容器内边距盒」定位：.content 顶部有 26px 内边距，
     用 -28px 抵消并微调（用户校准），使条体精确贴住窗口最顶沿。 */
  top: -28px;
  z-index: 5; /* 压过详情封面横幅（同为 positioned，否则按树序被横幅盖住/参与其渐隐） */
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  /* 左右顶满窗口：抵消 .content(左 30px) 与 .content-inner(右 30px) 的内边距 */
  margin-inline: -30px;
  /* 内容缩进保持与页面正文对齐（30px 外边距补偿 + 原 2px + 10px 呼吸位） */
  padding: 8px 42px;
  margin-bottom: 4px;
}
.anchor-chip {
  position: relative;
  overflow: hidden;
  padding: 4px 12px;
  font-size: 12.5px;
  border-radius: 999px;
  /* 液态玻璃：低模糊高饱和的「透镜」层（非磨砂）——中心通透、靠边缘环光与折射暗部塑形 */
  border: 1px solid color-mix(in srgb, #fff 26%, transparent);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #fff 16%, transparent) 0%,
    color-mix(in srgb, #fff 4%, transparent) 45%,
    color-mix(in srgb, #fff 12%, transparent) 100%
  );
  backdrop-filter: blur(5px) saturate(1.9) brightness(1.1);
  -webkit-backdrop-filter: blur(5px) saturate(1.9) brightness(1.1);
  /* 玻璃厚度感：四周内高光环 + 上下明暗收边 + 外部柔影 */
  box-shadow:
    inset 0 1px 1px color-mix(in srgb, #fff 38%, transparent),
    inset 0 -1px 1px color-mix(in srgb, #000 22%, transparent),
    inset 1px 0 1px color-mix(in srgb, #fff 14%, transparent),
    inset -1px 0 1px color-mix(in srgb, #fff 14%, transparent),
    0 3px 12px color-mix(in srgb, #000 24%, transparent);
  color: var(--text-dim);
  cursor: pointer;
  transition:
    color var(--dur-fast) ease,
    border-color var(--dur-fast) ease,
    background var(--dur-fast) ease,
    box-shadow var(--dur-fast) ease,
    transform 0.12s var(--ease-out);
}
/* 玻璃表面的斜向环境光反射（静态高光带） */
.anchor-chip::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    115deg,
    transparent 18%,
    color-mix(in srgb, #fff 30%, transparent) 46%,
    color-mix(in srgb, #fff 6%, transparent) 58%,
    transparent 75%
  );
  pointer-events: none;
}
.anchor-chip:hover {
  color: var(--text);
  transform: translateY(-1px);
  border-color: color-mix(in srgb, #fff 40%, transparent);
  box-shadow:
    inset 0 1px 1px color-mix(in srgb, #fff 46%, transparent),
    inset 0 -1px 1px color-mix(in srgb, #000 18%, transparent),
    inset 1px 0 1px color-mix(in srgb, #fff 18%, transparent),
    inset -1px 0 1px color-mix(in srgb, #fff 18%, transparent),
    0 5px 16px color-mix(in srgb, #000 30%, transparent);
}
.anchor-chip:active {
  transform: scale(0.95);
}
.anchor-chip.active {
  color: #fff;
  background: var(--accent-grad);
  border-color: color-mix(in srgb, #fff 42%, transparent);
  font-weight: 600;
  /* 选中态：品牌渐变透过玻璃，顶缘高光 + 品牌色柔影 */
  box-shadow:
    inset 0 1px 1px color-mix(in srgb, #fff 44%, transparent),
    inset 0 -1px 1px color-mix(in srgb, #000 18%, transparent),
    0 3px 14px color-mix(in srgb, #ff5c8a 42%, transparent);
}
</style>
