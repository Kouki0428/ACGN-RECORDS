import { ref, computed, nextTick } from 'vue'
import type { SubjectCharacter } from '@shared/types'

/** 实体/作品卡片类型：角色 / 人物（CV） / 作品 / 单集评论 / 标签作品列表 */
export type CardKind = 'character' | 'person' | 'subject' | 'episode' | 'tag'

/** 卡片打开时携带的状态（轻量；详情数据由各卡片组件自行按需拉取） */
export interface CardState {
  kind: CardKind
  id: number
  /**
   * 关联角色来源（同作品其他角色）。仅角色卡使用；人物卡/作品卡为空，
   * 其「出演角色」/「关联作品」由对应 API 提供。
   */
  siblings: SubjectCharacter[]
  /** 标签作品列表的标签名（仅 kind==='tag' 使用） */
  tag?: string
  /**
   * 该卡片实例**自身**记录的滚动位置（scrollTop）。用于在卡片导航栈里
   * 前进/后退时还原各作品的停留位置：新跳转的作品此项为 undefined → 滚到顶部；
   * 返回/前进到已访问作品 → 还原上次记录的 scrollTop。由各 body 组件直接写回本对象。
   */
  scrollTop?: number
}

// 模块级单例：SubjectCharacters（打开）与 EntityCard/SubjectCard（读取/关闭）共享
const isOpen = ref(false)
const state = ref<CardState | null>(null)
// 瞬时打开标志：从搜索悬浮窗点结果唤起实体卡时置 true，使 EntitySubjectCard 的
// 进入过渡被禁用（卡片瞬间出现、遮罩连续不闪烁），与卡片内互跳体验一致。
// 仅影响「进入」当次；挂载后由 EntitySubjectCard 复位，后续关闭/导航走正常动画。
const instantOpen = ref(false)

// 卡片内部导航历史（角色↔角色 / 人物↔人物 / 角色→作品→…），与浏览器/SPA 路由完全无关。
// 这样侧键前进/后退只在卡片内穿梭，不会误伤背后的场景。
let stack: CardState[] = []
const idx = ref(-1)
// 最近一次导航方向：'forward'（打开/前进/点关联作品前进）→ 目标作品滚到顶部；
// 'back'（返回）→ 目标作品还原上次停留位置。用于在悬浮窗内区分「前进就置顶 / 返回才还原」。
const navDir = ref<'forward' | 'back' | null>(null)

function apply(s: CardState) {
  state.value = s
  isOpen.value = true
}

export function useEntityCard() {
  const canBack = computed(() => idx.value > 0)
  const canForward = computed(() => idx.value < stack.length - 1)

  return {
    isOpen,
    state,
    instantOpen,
    navDir,
    canBack,
    canForward,
    /**
     * 从外部（详情页 / 搜索结果 / 角色卡出演作品）打开：重置历史为单条。
     */
    open: (kind: CardKind, id: number, siblings: SubjectCharacter[] = []) => {
      instantOpen.value = false
      navDir.value = 'forward'
      const s = { kind, id, siblings }
      stack = [s]
      idx.value = 0
      apply(s)
    },
    /**
     * 打开标签作品悬浮窗（从作品卡标签点击）：压入导航栈，使返回可回原作品卡。
     * 标签本身无 Bangumi id，固定 0。
     */
    openTag: (tag: string) => {
      instantOpen.value = false
      navDir.value = 'forward'
      const s = { kind: 'tag', id: 0, siblings: [], tag } as CardState
      stack = stack.slice(0, idx.value + 1)
      stack.push(s)
      idx.value = stack.length - 1
      apply(s)
    },
    /**
     * 瞬时打开（从搜索悬浮窗点结果唤起）：跳过 EntitySubjectCard 的进入过渡，
     * 使卡片瞬间出现（搜索遮罩作为底层透明基底保持挂载，故遮罩连续不闪）。
     * 挂载后由 EntitySubjectCard 复位 instantOpen，故仅影响本次进入。
     */
    openInstant: (kind: CardKind, id: number, siblings: SubjectCharacter[] = []) => {
      instantOpen.value = true
      navDir.value = 'forward'
      const s = { kind, id, siblings }
      stack = [s]
      idx.value = 0
      apply(s)
      // 等进入渲染提交后复位，确保后续关闭/卡片内导航走正常动画；
      // setTimeout 作为兜底（即使 isOpen 本已为 true 也会在下一刷新周期复位）。
      nextTick(() => {
        instantOpen.value = false
      })
      setTimeout(() => {
        if (instantOpen.value) instantOpen.value = false
      }, 400)
    },
    /**
     * 卡片内导航（关联角色 / 出演角色 / CV / 出演作品）：压入历史，并截断既有的「前进」分支。
     */
    push: (kind: CardKind, id: number, siblings: SubjectCharacter[] = []) => {
      // 与栈顶相同则忽略（避免重复压入自己）
      if (idx.value >= 0 && stack[idx.value] && stack[idx.value].kind === kind && stack[idx.value].id === id) return
      navDir.value = 'forward'
      const s = { kind, id, siblings }
      stack = stack.slice(0, idx.value + 1)
      stack.push(s)
      idx.value = stack.length - 1
      apply(s)
    },
    /**
     * 内部后退：返回 true 表示已处理（卡片内向上穿梭一层）；
     * 返回 false 表示已在卡片历史根部（调用方通常应关闭卡片）。
     */
    back: (): boolean => {
      if (idx.value > 0) {
        navDir.value = 'back'
        idx.value--
        apply(stack[idx.value])
        return true
      }
      return false
    },
    /**
     * 内部前进：返回 true 表示已处理；false 表示已到历史末端。
     */
    forward: (): boolean => {
      if (idx.value < stack.length - 1) {
        navDir.value = 'forward'
        idx.value++
        apply(stack[idx.value])
        return true
      }
      return false
    },
    close: () => {
      // 仅关闭实体卡层。若它由搜索悬浮窗点结果唤起，搜索作为底层透明基底一直保持挂载，
      // 故关闭实体卡后底层搜索自然显现（回到搜索），无需额外重开。
      isOpen.value = false
      // 清空导航历史：关闭后栈顶不再保留，避免下次从外部（如详情页点剧集）以相同
      // kind+id 调 push 时被「栈顶相同则忽略」的守卫误判、导致悬浮窗打不开（单集评论二次点击 bug）。
      stack = []
      idx.value = -1
    }
  }
}
