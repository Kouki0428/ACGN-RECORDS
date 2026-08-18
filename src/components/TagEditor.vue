<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ tags: string[] }>()
const emit = defineEmits<{ (e: 'update', tags: string[]): void }>()
const draft = ref('')

function add() {
  const t = draft.value.trim()
  if (t && !props.tags.includes(t)) {
    emit('update', [...props.tags, t])
  }
  draft.value = ''
}

function remove(t: string) {
  emit(
    'update',
    props.tags.filter((x) => x !== t)
  )
}
</script>

<template>
  <div class="tag-editor">
    <span v-for="t in tags" :key="t" class="tag" @click="remove(t)">{{ t }} ✕</span>
    <input v-model="draft" @keyup.enter="add" placeholder="添加标签后回车" />
  </div>
</template>

<style scoped>
.tag-editor {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}
.tag {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.tag-editor input {
  background: transparent;
  border: none;
  color: var(--text);
  outline: none;
}
</style>
