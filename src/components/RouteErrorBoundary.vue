<script setup lang="ts">
// 路由错误边界：捕获路由视图 setup/渲染阶段抛出的异常，
// 把「整页白屏」变成屏幕上可见的错误卡（消息 + 堆栈 + 自救按钮）。
import { ref, onErrorCaptured } from 'vue'

interface CapturedErr {
  message: string
  stack: string
}

const err = ref<CapturedErr | null>(null)
const attempt = ref(0)
const copied = ref(false)

onErrorCaptured((e) => {
  err.value = {
    message: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error && e.stack ? e.stack.slice(0, 1200) : ''
  }
  // eslint-disable-next-line no-console
  console.error('[route-boundary] 路由视图渲染错误：', e)
  return false // 阻止继续向全局 errorHandler 冒泡（避免重复 Toast）
})

function retry() {
  err.value = null
  copied.value = false
  attempt.value++ // 强制重建子树，重新挂载目标视图
}

function copyErr() {
  const text = err.value ? `${err.value.message}\n${err.value.stack}` : ''
  navigator.clipboard
    .writeText(text)
    .then(() => {
      copied.value = true
    })
    .catch(() => {})
}

function reloadApp() {
  location.reload()
}
</script>

<template>
  <div class="route-wrap">
    <!-- 正常路径：attempt 变化强制重建子树 -->
    <div v-if="!err" :key="attempt" class="route-wrap-inner">
      <slot />
    </div>

    <!-- 错误路径：可见的错误卡替代白屏 -->
    <div v-else class="rb-card">
      <div class="rb-icon">!</div>
      <h2 class="rb-title">页面加载出错</h2>
      <p class="rb-msg">{{ err.message }}</p>
      <pre v-if="err.stack" class="rb-stack">{{ err.stack }}</pre>
      <div class="rb-actions">
        <button type="button" class="btn btn--primary" @click="retry">重试</button>
        <button type="button" class="btn btn--ghost" @click="copyErr">
          {{ copied ? '已复制' : '复制错误信息' }}
        </button>
        <button type="button" class="btn btn--ghost" @click="reloadApp">刷新应用</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.route-wrap {
  min-height: 100%;
}
.rb-card {
  padding: 48px 32px;
  text-align: center;
  color: var(--text);
}
.rb-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 14px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  font-weight: 800;
  color: #fff;
  background: var(--err);
}
.rb-title {
  margin: 0 0 8px;
  font-size: 18px;
}
.rb-msg {
  margin: 0 auto 14px;
  max-width: 640px;
  color: var(--err);
  font-size: 13.5px;
  word-break: break-word;
}
.rb-stack {
  margin: 0 auto 18px;
  max-width: 760px;
  max-height: 200px;
  overflow: auto;
  text-align: left;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.rb-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
</style>
