<script setup lang="ts">
// 表情回应选择器（从 EpisodeCommentModal 拆出的纯展示组件）。
// 定位：absolute，锚定在评论头部（.ec-c-head / .ec-r-head 需为 positioned 祖先）。
import { reactionGifUrl, REACTION_VALUES } from '@/constants/bgmReactions'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()

defineProps<{
  /** 当前用户在该评论上已做过的表情 value 集合（用于高亮） */
  reacted: Set<string>
}>()
const emit = defineEmits<{ (e: 'select', value: string): void }>()
</script>

<template>
  <div class="ec-react-picker" :class="{ glass: settings.immersiveGlow && settings.subjectCardGlow }" @click.stop>
    <div class="ec-react-picker-title">发表表情回应</div>
    <div class="ec-react-grid">
      <button
        v-for="v in REACTION_VALUES"
        :key="v"
        type="button"
        class="ec-react-item"
        :class="{ on: reacted.has(v) }"
        :title="'表情 ' + v"
        @click="emit('select', v)"
      >
        <img :src="reactionGifUrl(v)" referrerpolicy="no-referrer" alt="" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.ec-react-picker {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  width: max-content;
  padding: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
/* 沉浸光感（跟随总开关 immersiveGlow，与悬浮窗本体开关独立）：面板与表情项半透明 */
.ec-react-picker.glass {
  background: color-mix(in srgb, var(--bg-panel) calc(70% * var(--glass-k)), transparent);
}
.ec-react-picker.glass .ec-react-item {
  background: color-mix(in srgb, var(--bg-elev) calc(70% * var(--glass-k)), transparent);
}
.ec-react-picker.glass .ec-react-item:hover {
  background: color-mix(in srgb, var(--accent-2) 12%, color-mix(in srgb, var(--bg-elev) calc(70% * var(--glass-k)), transparent));
}
.ec-react-picker.glass .ec-react-item.on {
  background: color-mix(in srgb, var(--accent-2) 18%, color-mix(in srgb, var(--bg-elev) calc(70% * var(--glass-k)), transparent));
}
.ec-react-picker-title {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.ec-react-grid {
  display: grid;
  grid-template-columns: repeat(4, auto);
  gap: 8px;
}
.ec-react-item {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease, transform 0.08s ease;
}
.ec-react-item img {
  width: 22px;
  height: 22px;
  object-fit: contain;
  pointer-events: none;
}
.ec-react-item:hover {
  border-color: var(--accent-2);
  background: color-mix(in srgb, var(--accent-2) 12%, var(--bg-elev));
}
.ec-react-item:active {
  transform: scale(0.94);
}
.ec-react-item.on {
  border-color: var(--accent-2);
  background: color-mix(in srgb, var(--accent-2) 18%, var(--bg-elev));
}
</style>
