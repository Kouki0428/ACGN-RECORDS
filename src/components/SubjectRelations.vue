<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SubjectRelation } from '@shared/types'
import { proxyImg } from '@/utils/imgProxy'

const props = defineProps<{
  subjectId?: number
  relations: SubjectRelation[]
  /** 过滤要渲染的关联分组：'single'=仅单行本，'other'=仅其它关联，不传=全部（默认） */
  filter?: 'single' | 'other'
}>()

// 点击关联条目时不再直接跳 Bangumi 网页，而是抛出 id，由父组件（详情页开新悬浮窗 / 作品悬浮窗内叠入导航栈）决定去向
defineEmits<{ (e: 'select', id: number): void }>()

// 本地副本：用于后台异步补全中文名时就地合并，避免整页刷新
const localRels = ref<SubjectRelation[]>(props.relations ?? [])
watch(
  () => props.relations,
  (val) => {
    localRels.value = val ?? []
  },
  { immediate: true }
)

// 把「单行本」关联从普通关联条目中拆出来单独成组（书籍常见关联，样式与关联条目一致）。
// 通过 filter 属性可让调用方把单行本单独放在「角色」与「关联条目」之间。
const SINGLE_BOOK_RELATION = '单行本'

// 按 relation 字段分组（保持首次出现顺序）：同一类型连续成组，便于组间画 1px 竖线、组内首图上方标类型。
function groupByRelation(list: SubjectRelation[]) {
  const order: string[] = []
  const map = new Map<string, SubjectRelation[]>()
  for (const r of list) {
    const rel = (r.relation || '').trim() || '其他'
    if (!map.has(rel)) {
      map.set(rel, [])
      order.push(rel)
    }
    map.get(rel)!.push(r)
  }
  return order.map((relation) => ({ relation, items: map.get(relation)! }))
}

const groups = computed(() => {
  const singleBooks = localRels.value.filter(
    (r) => (r.relation || '').trim() === SINGLE_BOOK_RELATION
  )
  const others = localRels.value.filter(
    (r) => (r.relation || '').trim() !== SINGLE_BOOK_RELATION
  )
  const out: { relation: string; items: SubjectRelation[] }[] = []
  // 各种类型之间在模板里用 1px 竖线分隔；单行本单独成组（其标题已由 h3 给出，无需再标类型）
  if (props.filter !== 'single' && others.length) out.push(...groupByRelation(others))
  if (props.filter !== 'other' && singleBooks.length) out.push(...groupByRelation(singleBooks))
  return out
})

const headerTitle = computed(() => {
  if (props.filter === 'single') {
    const n = localRels.value.filter(
      (r) => (r.relation || '').trim() === SINGLE_BOOK_RELATION
    ).length
    return `单行本 · ${n}`
  }
  return '关联条目'
})

// 仅在「其它关联」面板（含多种类型）显示每组的类型标注；单行本面板已有 h3 标题，不必重复
const showTags = computed(() => props.filter !== 'single')

// 仅「关联条目」分组（非单行本）才需要空状态提示；单行本没有时不渲染空卡片
const showEmpty = computed(() => props.filter !== 'single' && groups.value.length === 0)

// 登录态：用于空数据时的提示文案（是否已登录 Bangumi）
const loggedIn = ref(false)
let offCn: (() => void) | undefined
onMounted(async () => {
  try {
    const s = await window.acgn.auth.getStatus()
    loggedIn.value = !!s?.loggedIn
  } catch {
    /* 忽略 */
  }
  if (props.subjectId) {
    offCn = window.acgn.subjectExtra.onCnUpdated((payload: any) => {
      if (payload?.subjectId === props.subjectId && Array.isArray(payload.relations)) {
        mergeCn(payload.relations)
      }
    })
  }
})
onUnmounted(() => {
  offCn?.()
})

// 按 id 合并后台推送的关联条目中文名（优先中文名，不覆盖已取到的）
function mergeCn(patch: any[]) {
  const pm = new Map(patch.map((p) => [p.id, p]))
  localRels.value = localRels.value.map((b: any) => {
    const p = pm.get(b.id)
    if (!p) return b
    const pCn = (p.nameCn && p.nameCn.trim()) || ''
    const bCn = (b.nameCn && b.nameCn.trim()) || ''
    const mergedCn = pCn || bCn
    return {
      ...b,
      name: mergedCn ? p.name || b.name : b.name,
      nameCn: mergedCn,
      image: p.image || b.image
    }
  })
}
</script>

<template>
  <template v-if="groups.length">
    <section class="panel rel-panel">
      <h3>{{ headerTitle }}</h3>
      <div class="rel-flow">
        <template v-for="(grp, gi) in groups" :key="grp.relation">
          <div
            v-for="(r, ri) in grp.items"
            :key="r.id"
            class="rel-card"
            :class="{ 'is-group-first': ri === 0, 'is-single': grp.relation === '单行本' }"
            :title="`${grp.relation} · ${r.name}`"
            @click="$emit('select', r.id)"
          >
            <!-- 该类型第一个条目的图片上方标注关联类型（如 角色出演）；其余条目不标，保持对齐 -->
            <div v-if="showTags" class="rel-tag">{{ ri === 0 ? grp.relation : '' }}</div>
            <div class="rel-cover">
              <img v-if="r.image" :src="proxyImg(r.image)" :alt="r.name" loading="lazy" />
              <span v-else class="rel-cover--empty">无封面</span>
            </div>
            <div class="rel-name" :title="r.name">{{ r.name }}</div>
          </div>
        </template>
      </div>
    </section>
  </template>
  <section v-else-if="showEmpty" class="panel rel-panel">
    <h3>关联条目</h3>
    <p class="panel-empty">
      {{
        loggedIn
          ? '该作品暂无关联条目数据'
          : '登录 Bangumi 或下载「离线数据库」（设置页）后可显示关联条目'
      }}
    </p>
  </section>
</template>

<style scoped>
.rel-panel h3 {
  margin: 0 0 10px;
  font-size: 15px;
}
/* 关联条目横向流：各种类型连续成组排列，组间用 1px 竖线（首卡 ::before）分隔，满排自动换行。
   padding-left 给开头竖线留固定可见沟槽（恒定值，不随竖线增删改变宽度）。 */
.rel-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 10px;
  position: relative;
  padding-left: 6px;
}
/* 类型之间的 1px 竖线：绝对定位、零布局宽度 → 加/去竖线，两个条目总宽度不变。
   非首个组的竖线落在组间 10px 列间隙正中（距首卡左缘 -5px）；首个组的竖线落在最前面（见下）。 */
.rel-card {
  position: relative;
  flex: 0 0 auto;
  width: 86px;
  display: flex;
  flex-direction: column;
  cursor: pointer;
}
.rel-card.is-group-first::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -5px;
  width: 1px;
  background: var(--border, #2a3342);
}
/* 小说/漫画等的单行本卡片：去除其首卡前面的竖线（开头竖线与组间竖线均不显示） */
.rel-card.is-single.is-group-first::before,
.rel-card.is-single:first-child::before {
  display: none;
}
/* 开头最前面的竖线：落在左侧 6px 沟槽内，与组间竖线视觉对齐 */
.rel-flow > .rel-card:first-child::before {
  left: -6px;
}
/* 组内首图上方标注关联类型（如 角色出演）；非首条留等高空槽以保证所有封面顶端对齐 */
.rel-tag {
  height: 16px;
  margin-bottom: 5px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  color: var(--text-dim, #8b94a3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rel-cover {
  width: 86px;
  aspect-ratio: 1 / 1;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-elev, #1c2230);
  border: 1px solid var(--border, #2a3342);
}
.rel-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.rel-cover--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 10px;
  color: var(--text-dim, #8b94a3);
}
.rel-name {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.25;
  color: var(--text, #e6e9ef);
  width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.panel-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim, #8b94a3);
}
</style>
