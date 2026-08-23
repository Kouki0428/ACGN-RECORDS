<script setup lang="ts">
// 首次关闭行为选择窗：主进程通过 closeBehavior:ask 事件触发显示，
// 用户选择后经 app:answerCloseBehavior 回传结果（并持久化到 settings 表）。
import { ref, onMounted, onUnmounted } from 'vue'

const visible = ref(false)
const remember = ref(false)

let offAsk: (() => void) | null = null

onMounted(() => {
  offAsk = window.acgn?.app?.onCloseBehaviorAsk(() => {
    visible.value = true
  })
})
onUnmounted(() => {
  offAsk?.()
})

function choose(pick: 'minimize' | 'exit') {
  visible.value = false
  window.acgn?.app?.answerCloseBehavior(pick, remember.value)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="cb-fade">
      <div v-if="visible" class="cb-overlay" @click.self="choose('minimize')">
        <div class="cb-card" @click.stop>
          <div class="cb-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="14" rx="3" />
              <path d="M8 21h8" />
              <path d="M12 18v3" />
            </svg>
          </div>
          <h3 class="cb-title">关闭窗口时</h3>
          <p class="cb-desc">希望点击关闭按钮时执行什么操作？</p>
          <div class="cb-options">
            <button type="button" class="cb-opt cb-opt--minimize" @click="choose('minimize')">
              <span class="cb-opt-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="3"/><line x1="2" y1="9" x2="22" y2="9"/><rect x="4" y="12" width="6" height="2" rx="1" fill="currentColor" stroke="none"/></svg>
              </span>
              <span class="cb-opt-label">缩到托盘</span>
              <span class="cb-opt-sub">后台同步不中断</span>
            </button>
            <button type="button" class="cb-opt cb-opt--exit" @click="choose('exit')">
              <span class="cb-opt-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              </span>
              <span class="cb-opt-label">直接退出</span>
              <span class="cb-opt-sub">完全关闭应用</span>
            </button>
          </div>
          <label class="cb-remember">
            <input v-model="remember" type="checkbox" />
            记住我的选择，不再询问
          </label>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cb-overlay {
  position: fixed;
  inset: 0;
  z-index: 30000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 10, 14, 0.55);
}
.cb-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 28px;
  max-width: 400px;
  width: calc(100% - 48px);
  text-align: center;
}
.cb-icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 14px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--accent-2);
}
.cb-icon svg {
  width: 26px;
  height: 26px;
}
.cb-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 4px;
}
.cb-desc {
  font-size: 13.5px;
  color: var(--text-dim);
  margin: 0 0 20px;
}
.cb-options {
  display: flex;
  gap: 12px;
  margin-bottom: 18px;
}
.cb-opt {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 16px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-elev);
  cursor: pointer;
  transition:
    border-color var(--dur-fast),
    box-shadow var(--dur-fast),
    transform 0.12s var(--ease-out);
}
.cb-opt:hover {
  border-color: var(--accent-2);
  box-shadow: 0 4px 14px rgba(91, 157, 255, 0.15);
  transform: translateY(-2px);
}
.cb-opt:active {
  transform: scale(0.97);
}
.cb-opt-icon svg {
  width: 22px;
  height: 22px;
  color: var(--text-dim);
}
.cb-opt:hover .cb-opt-icon svg {
  color: var(--accent-2);
}
.cb-opt-label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}
.cb-opt-sub {
  font-size: 11.5px;
  color: var(--text-dim);
}
.cb-remember {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}
.cb-remember input[type='checkbox'] {
  accent-color: var(--accent-2);
}

/* 进出场动画 */
.cb-fade-enter-active,
.cb-fade-leave-active {
  transition: opacity 0.2s ease;
}
.cb-fade-enter-active .cb-card,
.cb-fade-leave-active .cb-card {
  transition: transform 0.22s var(--ease-out), opacity 0.22s ease;
}
.cb-fade-enter-from,
.cb-fade-leave-to {
  opacity: 0;
}
.cb-fade-enter-from .cb-card,
.cb-fade-leave-to .cb-card {
  transform: scale(0.95) translateY(-6px);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .cb-fade-enter-active,
  .cb-fade-leave-active {
    transition: none;
  }
}
</style>
