<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useImagePreview } from '@/composables/useImagePreview'

const { visible, src, alt, closeImage } = useImagePreview()

// ESC 关闭
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeImage()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="imglb-fade">
      <div v-if="visible" class="img-lightbox" @click="closeImage">
        <button
          class="img-lightbox-close"
          type="button"
          aria-label="关闭"
          title="关闭"
          @click.stop="closeImage"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
        <img v-if="src" :src="src" :alt="alt" class="img-lightbox-img" @click.stop />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 全屏遮罩：盖在所有悬浮窗（z 从 10000 起）之上；点击遮罩或右上角叉关闭，
   点击图片本身不关闭（@click.stop）。 */
.img-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.82);
  cursor: zoom-out;
}
.img-lightbox-img {
  max-width: 92vw;
  max-height: 92vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: var(--radius-sm);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  cursor: default;
  background: #fff;
}
.img-lightbox-close {
  position: fixed;
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease;
  z-index: 1;
}
.img-lightbox-close:hover {
  background: var(--accent);
  color: #fff;
}
.img-lightbox-close:active {
  background: #ff3d77;
  color: #fff;
  transform: scale(0.94);
}
.imglb-fade-enter-active,
.imglb-fade-leave-active {
  transition: opacity 0.18s ease;
}
.imglb-fade-enter-from,
.imglb-fade-leave-to {
  opacity: 0;
}
</style>
