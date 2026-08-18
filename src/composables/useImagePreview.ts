import { ref } from 'vue'

// 全局单例的图片放大预览状态：任意组件调用 openImage 即可弹出全屏大图，
// 由 <ImageLightbox />（挂在 App.vue）渲染到 body 顶层，盖在所有悬浮窗之上。
const visible = ref(false)
const src = ref<string | null>(null)
const alt = ref('')

export function useImagePreview() {
  function openImage(s: string | null | undefined, a = '') {
    if (!s) return
    src.value = s
    alt.value = a
    visible.value = true
  }
  function closeImage() {
    visible.value = false
  }
  return { visible, src, alt, openImage, closeImage }
}
