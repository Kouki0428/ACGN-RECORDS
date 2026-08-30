<script setup lang="ts">
import { ref, onMounted, useAttrs, computed } from 'vue'
import { proxyImg } from '@/utils/imgProxy'

// 单根（运行时只会渲染 img 或 div 之一），关闭自动继承 class 便于手动合并尺寸类
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** 封面地址；为空 / undefined / null 时显示「无封面」占位 */
  src?: string | null
  alt?: string
}>()

const attrs = useAttrs()
// 透传非 class 的属性（含 @click 等事件监听），便于外部在封面上挂载点击行为（如点击放大）
const restAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})

// blur-up：图片未就绪时半透明 + 底色微光，onload 后淡入（缓存命中时 complete 直接就绪，无闪烁）
const loaded = ref(false)
const imgEl = ref<HTMLImageElement | null>(null)
onMounted(() => {
  if (imgEl.value?.complete && imgEl.value.naturalWidth > 0) loaded.value = true
})
</script>

<template>
  <img
    v-if="props.src"
    ref="imgEl"
    :src="proxyImg(props.src)"
    :alt="props.alt"
    loading="lazy"
    decoding="async"
    :class="[attrs.class, 'cover-media', { 'is-loaded': loaded }]"
    v-bind="restAttrs"
    @load="loaded = true"
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
/* blur-up：加载中半透明 + 底色微光脉动；就绪后淡入。背景透出占位观感，
   不改布局、不影响外部尺寸类。加载失败保持隐藏（等同灰块占位）。 */
img.cover-media {
  opacity: 0;
  background-color: var(--bg-elev);
  animation: cover-pulse 1.6s ease-in-out infinite;
  transition: opacity 0.28s ease;
}
img.cover-media.is-loaded {
  opacity: 1;
  animation: none;
}
@keyframes cover-pulse {
  0%, 100% { background-color: var(--bg-elev); }
  50% { background-color: var(--bg-deep); }
}
@media (prefers-reduced-motion: reduce) {
  img.cover-media {
    animation: none;
    transition: none;
    opacity: 1;
  }
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
