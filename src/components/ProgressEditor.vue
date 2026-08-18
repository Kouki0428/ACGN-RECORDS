<script setup lang="ts">
// 通用进度编辑器：卷 / 话 / 路线数（按模块传不同 label）
// 可选 total：在一行内显示「label 输入框 / total」；未获取到总量（非数字）时显示「/ ??」。
defineProps<{ label: string; value: number; total?: number | null }>()
const emit = defineEmits<{ (e: 'update', value: number): void }>()
</script>

<template>
  <div class="progress-editor">
    <label>{{ label }}</label>
    <input
      type="number"
      min="0"
      :value="value"
      @change="emit('update', Number(($event.target as HTMLInputElement).value))"
    />
    <span class="pe-total">/ {{ typeof total === 'number' && total > 0 ? total : '??' }}</span>
  </div>
</template>

