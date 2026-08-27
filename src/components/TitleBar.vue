<script setup lang="ts">
import { useWindowChrome } from '@/composables/useWindowChrome'

const { maximized, minimize, toggleMaximize, close } = useWindowChrome()
</script>

<template>
  <div class="title-bar" @dblclick="toggleMaximize">
    <!-- 独立拖拽层：与按钮平级（非父子），规避 no-drag 子元素在原生拖拽时闪烁的问题 -->
    <div class="title-bar__hit"></div>
    <span class="title-bar__title">Bangumi</span>
    <div class="title-bar__actions" @dblclick.stop>
      <button class="tb-btn" type="button" title="最小化" @click="minimize" aria-label="最小化">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="5" y1="19" x2="19" y2="19" />
        </svg>
      </button>
      <button
        class="tb-btn"
        type="button"
        :title="maximized ? '还原' : '最大化'"
        @click="toggleMaximize"
        aria-label="最大化"
      >
        <svg
          v-if="!maximized"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="5" y="5" width="14" height="14" rx="1.5" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="5" y="5" width="11" height="11" rx="1.2" />
          <rect x="9" y="9" width="11" height="11" rx="1.2" fill="var(--sidebar-bg)" />
        </svg>
      </button>
      <button class="tb-btn tb-btn--close" type="button" title="关闭" @click="close" aria-label="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  position: relative;
  height: 32px;
  flex-shrink: 0;
  user-select: none;
  overflow: hidden;
  /* 沉浸光感：底色叠一层自上而下的微透光，顶部更亮、向下渐隐 */
  background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.07) 0%,
      rgba(255, 255, 255, 0.025) 42%,
      rgba(255, 255, 255, 0) 100%
    ),
    var(--sidebar-bg);
  border-bottom: 1px solid var(--border-soft);
  /* 顶部内描边高光，强化玻璃般的边光 */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
/* 原生拖拽层：覆盖整条标题栏，单独成层（与按钮平级） */
.title-bar__hit {
  position: absolute;
  inset: 0;
  -webkit-app-region: drag;
}
/* 顶部环境光辉：模拟来自上方的光在玻璃表面折射，营造沉浸感 */
.title-bar::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    130% 170% at 50% -65%,
    rgba(255, 255, 255, 0.12),
    rgba(255, 255, 255, 0) 55%
  );
  pointer-events: none;
}
/* 底部一道极淡辉光线，让标题栏与内容区「浮」出层次 */
.title-bar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.14),
    transparent
  );
  pointer-events: none;
}
.title-bar__title {
  position: absolute;
  left: 12px;
  top: 0;
  height: 32px;
  line-height: 32px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.3px;
  pointer-events: none;
  z-index: 1;
}
.title-bar__actions {
  position: absolute;
  right: 0;
  top: 0;
  height: 32px;
  display: flex;
  -webkit-app-region: no-drag;
  z-index: 1;
}
.tb-btn {
  width: 40px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.tb-btn:hover {
  background: var(--bg-elev);
  color: var(--text);
}
.tb-btn--close:hover {
  background: #e81123;
  color: #fff;
}
.tb-btn svg {
  width: 14px;
  height: 14px;
}
</style>
