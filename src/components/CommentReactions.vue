<script setup lang="ts">
// 评论表情回应行（从 EpisodeCommentModal 拆出的纯展示组件）。
// 顶层评论与子评论共用；点击某个表情 = 快速用该表情回应（toggle 语义由父级处理）。
import { reactionGifUrl } from '@/constants/bgmReactions'
import type { CommentReaction } from '@shared/types'

interface MeInfo {
  username?: string
  nickname?: string
  avatar?: string | null
}

const props = defineProps<{
  reactions: CommentReaction[]
  me: MeInfo
  loggedIn: boolean
}>()
const emit = defineEmits<{ (e: 'quick-react', value: string | number): void }>()

// 计数取 total，缺省用 users 长度
function rxTotal(rx: CommentReaction): number {
  return typeof rx.total === 'number' ? rx.total : rx.users ? rx.users.length : 0
}
// 悬停卡片只显示回应者昵称列表（最多 10 个，超出加「等」）
function rxNames(rx: CommentReaction): string {
  const users = (rx.users || []) as Array<{ nickname?: string; username?: string }>
  const names = users.map((u) => u.nickname || u.username || '用户')
  if (names.length > 10) return names.slice(0, 10).join('、') + ' 等'
  return names.join('、') || '暂无回应'
}
// 当前登录用户是否做过该表情回应
function meInReaction(rx: CommentReaction): boolean {
  const users = (rx.users || []) as Array<{ username?: string; nickname?: string }>
  return users.some(
    (u) =>
      (props.me.username && u.username === props.me.username) ||
      (props.me.nickname && u.nickname === props.me.nickname)
  )
}
</script>

<template>
  <div class="ec-reactions">
    <span
      v-for="(rx, ri) in reactions"
      :key="ri"
      class="ec-reaction"
      :class="{ 'ec-reaction--mine': meInReaction(rx) }"
      role="button"
      tabindex="0"
      :title="loggedIn ? '点击用此表情回应' : '登录后可用'"
      @click="emit('quick-react', rx.value)"
      @keydown.enter.prevent="emit('quick-react', rx.value)"
    >
      <img
        v-if="reactionGifUrl(rx.value)"
        :src="reactionGifUrl(rx.value)"
        class="ec-rx-img"
        alt=""
        referrerpolicy="no-referrer"
      />
      <template v-else>{{ rx.value }}</template>
      <span class="ec-rx-count">{{ rxTotal(rx) }}</span>
      <span class="ec-rx-tip">{{ rxNames(rx) }}</span>
    </span>
  </div>
</template>

<style scoped>
.ec-reactions {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ec-reaction {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  line-height: 1;
  color: var(--text-dim);
  background: color-mix(in srgb, var(--text-dim) 12%, var(--bg-elev));
  border: 1px solid var(--border);
  padding: 3px 7px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.ec-reaction:hover {
  border-color: color-mix(in srgb, var(--accent-aux) 55%, var(--border));
}
/* 浅色模式：表情卡片背景更浅 */
:global(:root[data-theme='light']) .ec-reaction {
  background: color-mix(in srgb, var(--text-dim) 6%, var(--bg-elev));
  border-color: color-mix(in srgb, var(--text-dim) 14%, var(--border));
}
/* 我自己做过的表情回应：高亮（强调色边框 + 淡底色 + 文字/数字强调色） */
.ec-reaction--mine {
  color: var(--accent-aux);
  background: color-mix(in srgb, var(--accent-aux) 16%, var(--bg-elev));
  border-color: color-mix(in srgb, var(--accent-aux) 55%, var(--border));
}
.ec-reaction--mine .ec-rx-count {
  color: var(--accent-aux);
}
:global(:root[data-theme='light']) .ec-reaction--mine {
  background: color-mix(in srgb, var(--accent-aux) 12%, var(--bg-elev));
  border-color: color-mix(in srgb, var(--accent-aux) 45%, var(--border));
}
.ec-rx-img {
  width: 18px;
  height: 18px;
  object-fit: contain;
  vertical-align: middle;
  border-radius: 0;
}
.ec-rx-count {
  margin-left: 3px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}
/* 悬停卡片：只显示回应者昵称列表，圆角浮层。
   左对齐到表情标签（而非水平居中），避免卡片左半超出悬浮窗左边界被裁切。 */
.ec-rx-tip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  transform: translateY(4px);
  width: max-content;
  max-width: min(280px, 80vw);
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 20;
}
.ec-reaction:hover .ec-rx-tip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
/* 浅色模式：悬停卡片用更实的浅色底，保证可读 */
:global(:root[data-theme='light']) .ec-rx-tip {
  background: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
}
</style>
