import { ref, watch, type Ref } from 'vue'

/**
 * 悬浮窗层级管理器。
 *
 * 问题：各全屏悬浮窗原本写死 z-index（单集评论窗 1300、作品/角色卡 1000 等），
 * 导致「从某悬浮窗里点 Bangumi 站内链接唤起另一个悬浮窗」时，新窗因 z-index 较小
 * 被旧窗盖在后面、看不见（例如单集评论窗 1300 压住作品卡 1000）。
 *
 * 方案：维护一个全局递增计数器，每当某个悬浮窗 open，就把它抬到当前最大值之上，
 * 保证「最后打开的悬浮窗永远在最上层」，与打开顺序无关。
 * 各悬浮窗在 overlay 根元素上绑定 :style="{ zIndex: z }" 即可。
 */
const BASE = 10000 // 高于应用内其它固定层级（如 GameGallery/预览图 9999）
let top = BASE

export function useModalZ(isOpen: Ref<boolean>) {
  const z = ref(BASE)
  watch(
    isOpen,
    (open) => {
      if (open) {
        top += 1
        z.value = top
      }
    }
  )
  return z
}
