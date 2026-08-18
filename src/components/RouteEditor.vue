<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import type { RouteItem } from '@shared/types'
import { collectionClient } from '@/services/collectionClient'

const props = defineProps<{
  /** 本地收藏 id；为 null 时（尚未加入收藏）点击加号会先请求父组件建收藏 */
  collectionId: number | null
}>()

const emit = defineEmits<{
  (e: 'count', value: number): void
  /** 尚无收藏时点击加号，请父组件先建立收藏（建完 collectionId 变非 null 后本组件自动补一个输入框） */
  (e: 'request-add'): void
}>()

// 路线列表；id 为负表示「尚未落库」的临时输入框（用户已点 + 但还没输入/保存）
const routes = ref<RouteItem[]>([])
const inputRefs = new Map<number, HTMLInputElement>()
const pendingAdd = ref(false)

// 输入框自适应宽度：用 canvas 测量文字像素宽度
let measureCtx: CanvasRenderingContext2D | null = null
function measureWidth(el: HTMLInputElement, text: string): number {
  if (!measureCtx) {
    const c = document.createElement('canvas')
    measureCtx = c.getContext('2d')
  }
  if (!measureCtx) return 0
  measureCtx.font = getComputedStyle(el).font
  return measureCtx.measureText(text).width
}
const ROUTE_MIN_W = 84
const ROUTE_MAX_W = 320
function autoSize(idx: number) {
  const item = routes.value[idx]
  if (!item) return
  const el = inputRefs.get(item.id)
  if (!el) return
  const text = item.name || ''
  const w = measureWidth(el, text) + 22
  el.style.width = Math.min(ROUTE_MAX_W, Math.max(ROUTE_MIN_W, w)) + 'px'
}
function autoSizeAll() {
  routes.value.forEach((_, i) => autoSize(i))
}

function savedCount(): number {
  return routes.value.filter((r) => r.id > 0).length
}

async function load() {
  if (props.collectionId == null) {
    routes.value = []
    return
  }
  try {
    routes.value = await collectionClient.routes(props.collectionId)
  } catch {
    routes.value = []
  }
  emit('count', savedCount())
  await nextTick()
  autoSizeAll()
}

onMounted(load)

// collectionId 由 null 变为非 null（父组件刚建好收藏）：若是因为点 + 触发的，自动补一个输入框
watch(
  () => props.collectionId,
  (cid, old) => {
    if (cid != null && old == null) {
      void load().then(() => {
        if (pendingAdd.value) {
          pendingAdd.value = false
          addRoute()
        }
      })
    }
  }
)

function focusRoute(id: number) {
  nextTick(() => inputRefs.get(id)?.focus())
}

/** 点击加号：有收藏直接加输入框；无收藏先请求父组件建收藏 */
function addRoute() {
  if (props.collectionId == null) {
    pendingAdd.value = true
    emit('request-add')
    return
  }
  const tempId = -Date.now()
  routes.value.push({ id: tempId, name: '' })
  nextTick(() => {
    focusRoute(tempId)
    const idx = routes.value.findIndex((r) => r.id === tempId)
    if (idx >= 0) autoSize(idx)
  })
}

async function onInput(idx: number) {
  const item = routes.value[idx]
  if (!item) return
  // 临时路线（id<0）：失焦时仍为空则直接丢弃，不残留空输入框
  if (item.id < 0) {
    if (item.name.trim() === '') {
      routes.value.splice(idx, 1)
      return
    }
    if (props.collectionId) {
      const { id } = await collectionClient.routeAdd(props.collectionId, item.name)
      item.id = id
      emit('count', savedCount())
    }
    return
  }
  // 已落库的路线：直接改名
  await collectionClient.routeUpdate(item.id, item.name)
}

async function removeRoute(idx: number) {
  const item = routes.value[idx]
  if (props.collectionId && item.id > 0) {
    await collectionClient.routeDelete(item.id)
  }
  routes.value.splice(idx, 1)
  emit('count', savedCount())
}
</script>

<template>
  <div class="route-editor">
    <div class="route-bar">
      <span class="route-title">已通关路线</span>

      <div
        v-for="(r, idx) in routes"
        :key="r.id < 0 ? 't' + r.id : 'r' + r.id"
        class="route-row"
      >
        <input
          :ref="(el) => { if (el) inputRefs.set(r.id, el as HTMLInputElement) }"
          class="route-input"
          type="text"
          v-model="r.name"
          @input="autoSize(idx)"
          @change="onInput(idx)"
        />
        <button class="route-del" type="button" title="删除路线" aria-label="删除路线" @click="removeRoute(idx)">
          ×
        </button>
      </div>

      <button class="route-add" type="button" title="添加路线" aria-label="添加路线" @click="addRoute">
        +
      </button>
    </div>

    <p v-if="routes.length === 0" class="route-empty">还没有记录通关路线，点击 + 添加一条</p>
  </div>
</template>

<style scoped>
.route-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.route-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}
.route-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.route-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: 1px dashed var(--border);
  background: var(--bg-elev);
  color: var(--accent-2);
  font-size: 18px;
  line-height: 1;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.route-add:hover {
  background: var(--accent-2);
  border-color: var(--accent-2);
  color: #fff;
}
.route-empty {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0;
}
.route-row {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}
.route-input {
  min-width: 84px;
  max-width: 320px;
  field-sizing: content;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
  text-align: center;
}
.route-input:focus {
  outline: none;
  border-color: var(--accent-2);
  box-shadow: 0 0 0 3px rgba(91, 157, 255, 0.18);
}
.route-del {
  position: absolute;
  top: -7px;
  right: -7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.route-row:hover .route-del {
  opacity: 1;
  pointer-events: auto;
}
.route-del:hover {
  background: rgba(255, 90, 90, 0.16);
  color: #ff7a7a;
  border-color: rgba(255, 90, 90, 0.4);
}
</style>
