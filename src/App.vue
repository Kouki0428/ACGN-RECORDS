<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import SidebarNav from './components/SidebarNav.vue'
import SearchOverlay from './components/SearchOverlay.vue'
import EntitySubjectCard from './components/EntitySubjectCard.vue'
import CollectionModal from './components/CollectionModal.vue'
import ContentScrollbar from './components/ContentScrollbar.vue'
import ImageLightbox from './components/ImageLightbox.vue'
import ToastHost from './components/ToastHost.vue'
import ContextMenu from './components/ContextMenu.vue'
import RouteErrorBoundary from './components/RouteErrorBoundary.vue'
import CloseBehaviorDialog from './components/CloseBehaviorDialog.vue'
import { useGridResizeFlip } from './composables/useGridResizeFlip'
import { useNavHistory } from './composables/useNavHistory'
import { useSearchOverlay } from './composables/searchOverlay'
import { useEntityCard } from './composables/useEntityCard'
import { useCollectionModal } from './composables/useCollectionModal'
import { useUserStatsModal } from './composables/useUserStatsModal'
import { useAppHotkeys } from './composables/useAppHotkeys'
import { installGridNav } from './utils/gridNav'
import { installClickSound } from './utils/uiSound'

// 窗口缩放时作品卡片的 FLIP 补间（列数跨阈值时平滑滑动）
useGridResizeFlip()
// 全局键盘快捷键（Ctrl+K 搜索 / Ctrl+, 设置）
useAppHotkeys()

// 鼠标侧键前进/后退：3 = 后退(X1)，4 = 前进(X2)
const router = useRouter()
const nav = useNavHistory()
const search = useSearchOverlay()
const searchOpen = search.isOpen
const entity = useEntityCard()
const entityOpen = entity.isOpen
const collection = useCollectionModal()
const collectionOpen = collection.isOpen
const statsModal = useUserStatsModal()
const statsOpen = statsModal.isOpen

// 全局模糊遮罩：搜索 / 实体卡 打开时显示唯一一层 backdrop-filter 模糊。
// 各悬浮窗自身不再带 backdrop-filter（见各 *-overlay 样式），因此悬浮窗之间
// 互跳时这层模糊始终稳定在背后、绝不重算/闪烁；仅当「最后一个悬浮窗关闭」时才淡出。
// 注：单集评论（kind==='episode'）已并入 EntitySubjectCard 同一 overlay，不再独立计入；
//     收藏悬浮窗（CollectionModal）不计入 —— 其后不加任何暗化/模糊遮罩（用户要求）。
const anyModalOpen = computed(
  () => searchOpen.value || entityOpen.value
)

// 防抖：一次物理按键在某些鼠标/系统上会连续派发多个 mousedown/mouseup，
// 用时间窗口合并，只响应第一次，避免「按一下跳两次」。
let lastSideAt = 0

// 仅拦截侧键的默认行为（阻止原生前进/后退），不做导航
function blockSide(e: MouseEvent) {
  if (e.button === 3 || e.button === 4) e.preventDefault()
}

// 导航只在 mousedown 触发一次（配合防抖）
function onSideDown(e: MouseEvent) {
  if (e.button !== 3 && e.button !== 4) return
  e.preventDefault()
  const now = Date.now()
  if (now - lastSideAt < 400) return
  lastSideAt = now
  // 实体详情卡片（角色/CV/作品/单集评论）打开时：侧键驱动卡片内部导航栈历史
  // （角色↔角色 / 人物↔人物 / 角色→作品→单集→…），不影响背后的场景；
  // 到达卡片历史根部再按后退则关闭卡片（回到详情页或搜索卡片）。
  // 单集评论（kind==='episode'）已并入同一 overlay，后退会从单集返回作品，而非直接关闭。
  if (entityOpen.value) {
    const handled = e.button === 3 ? entity.back() : entity.forward()
    if (e.button === 3 && !handled) entity.close()
    return
  }
  // 收藏悬浮窗（无内部历史）：同上，后退关闭自身而非导航背景。
  if (collectionOpen.value) {
    if (e.button === 3) collection.close()
    return
  }
  // 数据统计悬浮窗（无内部历史）：同上，后退关闭自身而非导航背景。
  if (statsOpen.value) {
    if (e.button === 3) statsModal.close()
    return
  }
  // 搜索卡片打开（且无实体卡片）：后退关闭搜索卡片（不触碰背后场景）；
  // 前进在该模态下无历史，保持无操作。
  if (searchOpen.value) {
    if (e.button === 3) search.close()
    return
  }
  // 普通场景：优先交给内容视图处理，否则退回 SPA 路由历史
  if (e.button === 3) {
    if (!nav.invokeBack()) router.back()
  } else {
    if (!nav.invokeForward()) router.forward()
  }
}

onMounted(() => {
  window.addEventListener('mousedown', onSideDown)
  window.addEventListener('mouseup', blockSide)
  window.addEventListener('auxclick', blockSide)
  // 方向键在网格卡片间移动焦点（键盘可达下半场）
  installGridNav()
  // 全局点击音效（受设置页「音效」总开关控制）
  installClickSound()
})
onUnmounted(() => {
  window.removeEventListener('mousedown', onSideDown)
  window.removeEventListener('mouseup', blockSide)
  window.removeEventListener('auxclick', blockSide)
})
</script>

<template>
  <div class="app-shell">
    <div class="app-body">
      <SidebarNav />
      <main class="content">
        <div class="content-inner">
        <!-- 路由视图：不加 Transition。
             曾用 <Transition mode="out-in"> 做切换淡入淡出，但会偶发「新视图已挂载却停留在
             opacity:0 的 enter-from 态」→ 整页空白、刷新才恢复（诊断：DOM 存在但不可见，
             Console 仅有 EllipsisTitle fragment 警告；详见 .workbuddy/memory/2026-08-21）。
             纯 CSS 进场动画如需再引入，须避开 Vue 过渡状态机（用 animation 而非 transition）。 -->
        <router-view v-slot="{ Component }">
          <RouteErrorBoundary>
            <component :is="Component" />
          </RouteErrorBoundary>
        </router-view>
      </div>
    </main>
    </div>
    <!-- 液态玻璃折射滤镜（全局唯一）：feTurbulence 大尺度平滑噪声 → feDisplacementMap
         扰动背板像素，产生水波折射。供 backdrop-filter: url(#liquid-glass-distortion) 引用 -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <filter id="liquid-glass-distortion" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.02" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2" result="soft-noise" />
          <feDisplacementMap in="SourceGraphic" in2="soft-noise" scale="10" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
    <!-- 全局唯一模糊遮罩：所有悬浮窗共用，避免逐个悬浮窗切换时模糊层反复重算闪烁 -->
    <Transition name="backdrop-fade">
      <div v-if="anyModalOpen" class="modal-backdrop"></div>
    </Transition>
    <!-- 全局模态搜索：点击边栏搜索按钮叠加显示 -->
    <SearchOverlay />
    <!-- 全局角色/人物/作品/单集评论详情卡片：单一 overlay 容器，点击详情页角色/CV/作品/
         单集打开；同一条导航栈内 角色↔CV↔作品↔单集 互跳时 overlay 不卸载，仅换内容
         （不再整屏重载）。单集评论作为第 4 种 body（kind==='episode'）并入此容器。 -->
    <EntitySubjectCard />
    <CollectionModal />
    <!-- 全局图片放大预览：点击作品/角色/人物悬浮窗封面时弹出全屏大图 -->
    <ImageLightbox />
    <!-- 全局 Toast 操作反馈（保存成功/失败等），最顶层 -->
    <ToastHost />
    <!-- 全局右键菜单（列表卡片快速改状态 / Bangumi 打开 / 删除收藏） -->
    <ContextMenu />
    <!-- 首次关闭行为选择窗（主进程触发） -->
    <CloseBehaviorDialog />
    <!-- 自定义覆盖式滚动条：替代 .content 原生滚动条，使封面横幅可铺满窗口右缘 -->
    <ContentScrollbar />
  </div>
</template>

<style scoped>
/* 全局唯一模糊遮罩：只负责 backdrop-filter 模糊 + 极淡底色，不承载暗化/点击。
   各悬浮窗自己的 *-overlay 保留半透明暗化 scrim（用于盖住下层悬浮窗）。
   本层 z-index 低于所有悬浮窗（useModalZ 从 10000 起），位于应用内容之上。 */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgba(8, 10, 14, 0.42);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
/* 仅「最后一个悬浮窗关闭」时才淡出；悬浮窗之间互跳时 anyModalOpen 恒为 true，
   本层不进不出，模糊始终稳定 → 不再闪。 */
.backdrop-fade-enter-active,
.backdrop-fade-leave-active {
  transition: opacity 0.22s ease;
}
.backdrop-fade-enter-from,
.backdrop-fade-leave-to {
  opacity: 0;
}
</style>
