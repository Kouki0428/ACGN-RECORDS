import { ref, type Ref } from 'vue'

/**
 * 鼠标侧键前进/后退的导航处理器。
 * - back：尝试「后退」（如从详情回到列表）。返回 true 表示已被本视图处理，
 *   此时 App 不需要再调用 router.back()；返回 false 表示本视图无内层可退，
 *   由 App 退到顶层路由历史。
 * - forward：尝试「前进」（如重开上次被关闭的详情）。返回 true 表示已处理，
 *   否则由 App 调用 router.forward()。
 */
export interface NavHandlers {
  back: () => boolean
  forward: () => boolean
}

// 模块级单例：当前挂载的内容视图（动画/小说/漫画/游戏）注册自己的处理器。
// 同一时刻只有一个内容视图被挂载，故用单个槽位即可。
const handlers: Ref<NavHandlers | null> = ref(null)

export function useNavHistory() {
  function register(h: NavHandlers) {
    handlers.value = h
  }
  function unregister(h: NavHandlers) {
    if (handlers.value === h) handlers.value = null
  }
  /** 触发后退；返回是否被内容视图处理（否则调用方应 router.back()） */
  function invokeBack(): boolean {
    return handlers.value ? handlers.value.back() : false
  }
  /** 触发前进；返回是否被内容视图处理（否则调用方应 router.forward()） */
  function invokeForward(): boolean {
    return handlers.value ? handlers.value.forward() : false
  }
  return { register, unregister, invokeBack, invokeForward }
}
