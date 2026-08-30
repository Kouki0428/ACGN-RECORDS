<script setup lang="ts">
import { playToggleClick } from '@/utils/uiSound'

const props = defineProps<{
  modelValue: boolean
  disabled?: boolean
  ariaLabel?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

function onToggle() {
  const next = !props.modelValue
  playToggleClick(next)
  emit('update:modelValue', next)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="ariaLabel"
    :disabled="disabled"
    class="toggle-switch"
    :class="{ on: modelValue }"
    @click="onToggle"
  >
    <span class="toggle-knob"></span>
  </button>
</template>

<style scoped>
.toggle-switch {
  position: relative;
  flex: 0 0 auto;
  width: 40px;
  height: 22px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s;
}
.toggle-switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.toggle-switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-dim);
  transition: transform 0.18s, background 0.18s;
}
.toggle-switch.on {
  background: var(--accent);
  border-color: var(--accent);
}
.toggle-switch.on .toggle-knob {
  transform: translateX(18px);
  background: #fff;
}
</style>