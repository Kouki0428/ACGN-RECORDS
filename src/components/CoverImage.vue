<script setup lang="ts">
import { useAttrs } from 'vue'
import { proxyImg } from '@/utils/imgProxy'

// 单根（运行时只会渲染 img 或 div 之一），关闭自动继承 class 便于手动合并尺寸类
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** 封面地址；为空 / undefined / null 时显示「无封面」占位 */
  src?: string | null
  alt?: string
}>()

const attrs = useAttrs()
</script>

<template>
  <img
    v-if="props.src"
    :src="proxyImg(props.src)"
    :alt="props.alt"
    :class="[attrs.class, 'cover-media']"
  />
  <div
    v-else
    :class="[attrs.class, 'cover-media', 'cover-placeholder']"
    role="img"
    :aria-label="(props.alt as string) || '无封面'"
  >
    无封面
  </div>
</template>

<style scoped>
/* 真实封面：仅负责 object-fit，尺寸由外部传入的尺寸类（detail__poster / card-cover 等）决定 */
.cover-media {
  display: block;
  object-fit: cover;
}
/* 占位：复用外部尺寸类获得宽高，这里只负责居中文字与虚线边框 */
.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elev, #1b212c);
  color: var(--text-dim, #8b94a3);
  font-size: 12px;
  border: 1px dashed var(--border, #2a3342);
  text-align: center;
  /* 兜底：万一外部尺寸类缺失，也能保持 2:3 比例与最低高度，避免塌成 0 */
  aspect-ratio: 2 / 3;
  min-height: 80px;
}
</style>
