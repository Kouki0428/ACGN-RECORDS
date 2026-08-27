import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

// ─────────────────────────────────────────────────────────────────────────────
// 响应式网格排布动画（纯 transform FLIP / position-chase）
// ─────────────────────────────────────────────────────────────────────────────
// 适用场景：CSS Grid auto-fill 响应式布局在「视口尺寸变化 / 跨断点重排」时，
// 卡片列数增减、位置重排的平滑过渡。
//
// ⚠️ 核心铁律（本文件长期踩坑结论）：
//   **绝不插值 gridTemplateColumns（绝不设置网格 inline 列宽）**。
//   插值列宽 + 用 max(旧列数,新列数) 保留多余列 → 减列时多出一条「0 宽列」，
//   卡片被吸进 0 宽列 → 正文宽度坍缩 → EpisodeGrid(auto-fill 29px) 全部竖排 →
//   卡片高度爆炸式变高，且绝大多数卡片几乎不动 = 「没有中间过程」。这是前几版反复翻车的根因。
//
// 正确做法（业界真正稳健的网格动画）：
//   网格始终自然 auto-fill；只让【卡片位置】靠 transform 逐帧惯性追向「当前真实自然布局」，
//   同时【卡片宽度】按同一 K 逐帧追向自然宽度（直接设置卡片 inline width，而非 transform:scale）。
//   - 列数一变（3↔2↔6）：所有卡片的自然位置与宽度都变了 → 全部「平移 + 宽度渐变」平滑过渡 = 必有可见中间过程，
//     且【宽度变化与位置移动同一节奏、完全匹配】。
//   - 绝不用 transform:scale 缩放整卡 → 封面/标题/格子字号等「内部内容像素尺寸」全程恒定、绝不随动画放大缩小/变形。
//   - 网格始终自然 auto-fill（不改网格 inline 列宽、不进 0 宽列）→ 卡片布局永远正确（EpisodeGrid 不换行爆炸）；
//     卡片 inline width 仅作用于网格项自身（不改 track 列宽），逐帧追向自然列宽，收敛后清除即回归 1fr 自然填充。
//   - 列数中途多次变化（连续拖拽 3→2→1）：tick 每帧把目标刷新为最新 natural，起点=上一帧视觉，
//     跨度恒为「上一帧视觉→最新目标」→ 平滑连续、跟手、永不乱飞、永不跳列。
//   - 起点(First) = 上一帧自然布局(lastRects)；目标(Last) = 当前自然布局(natural)。
//     起步同步把卡片钉回旧位置（inline transform），避免下一帧 tick 前出现一帧自然新位置闪烁。
//   - 动画期间临时 overflow:visible（让滑动出界的卡片完整可见，否则 overflow-x:clip 裁掉=看不到中间过程）
//     + 关闭卡片 transform-transition（避免与每帧 RAF 驱动冲突，否则 transform 被二次平滑→动画不可见）。
//   - 只钉「可见（含 80px 缓冲）卡片」；屏幕外保持自然流、滚入无动画（看不见、省性能）。
//   - ⚠️ 动画期间锁定滚动：跨列重排时禁止用户滚动（wheel/touch/方向键），
//     避免滚动与位置追向相互干扰导致页面抽动；动画结束即解锁还原。
//   - 收敛（最大位移 < 阈值）即落位清样式；宽松兜底 2.5s 仅防极端挂起。
//   - prefers-reduced-motion 降级（直接落位）。
// ─────────────────────────────────────────────────────────────────────────────

export interface GridResizeFlipOptions {
  /** 观察的容器选择器（宽度变化驱动断点重排；需始终存在于 DOM） */
  containerSelector?: string
  /** 卡片选择器（网格项） */
  cardSelector?: string
  /** 追向比例 K（每帧追向目标的 0~1 比例，越大越跟手；默认 0.3） */
  chaseK?: number
}

const CONVERGE = 0.6 // 收敛阈值 px（最大位移 < 此值即落位）
const OFFSCREEN = 80 // 屏幕外缓冲 px

export function useGridResizeFlip(options?: GridResizeFlipOptions) {
  const containerSelector = options?.containerSelector ?? '.content'
  const cardSelector = options?.cardSelector ?? '.card'
  const settings = useSettingsStore()
  // 速度滑条语义：0 = 最快（左），1 = 最慢（右），默认 0.2。
  // 为使「滑条等距位移 = 感知动画时长等距变化」（线性手感），按【收敛帧数】线性映射 s，
  // 再反解每帧追向比例 K（指数缓出下 收敛帧数 ∝ 1/|ln(1-K)|）：
  //   K(s) = 1 - exp(-1 / (A + B·s))，A = 1/|ln(1-K0)|，B = 1/|ln(1-K1)| - A
  //   端点严格保持：s=0 → K0=0.55（快），s=1 → K1=0.015（慢）。
  // 滑条实时映射到 K（tick 每帧读 getK）；显式传入 chaseK 时优先（测试/特殊场景）。
  function getK(): number {
    if (options?.chaseK != null) return options.chaseK
    const s = Math.min(1, Math.max(0, settings.gridAnimSpeed ?? 0.2))
    const A = 1.252 // 1 / |ln(1 - 0.55)|
    const B = 64.93 // 1 / |ln(1 - 0.015)| - A
    return 1 - Math.exp(-1 / (A + B * s))
  }
  // 用户在设置中关闭动画开关时，若正在动画则立即落位（静默跟手停止）。
  watch(
    () => settings.gridAnimEnabled,
    (on) => {
      if (!on && animActive) finish()
    }
  )

  let container: HTMLElement | null = null
  let ro: ResizeObserver | null = null
  let mo: MutationObserver | null = null
  let motionMq: MediaQueryList | null = null

  let observeRaf = 0 // onObserve 合并 rAF（每帧最多一次）
  let flipRaf = 0 // tick rAF
  let cleanupTimer = 0 // 宽松兜底（仅防极端挂起）
  let reduceMotion = false
  let savedOverflow: string | null = null // 动画期间临时解除网格容器裁切时保存的原 overflow
  let scrollEl: HTMLElement | null = null // 滚动容器（长列表 .content），动画期间锁定其滚动
  let lockedScrollTop = 0 // 动画开始时记录的 scrollTop，锁定期间保持不变
  let scrollLockCleanup: (() => void) | null = null // 解除滚动锁定的清理函数

  // 基线：上一帧「自然布局」矩形（crossing 时的 First 来源） + 当前稳定列数。
  let lastRects = new Map<HTMLElement, DOMRect>()
  let lastCols = -1
  // 自然布局缓存：列数不变时复用，避免 tick/同列期每帧强制重排（关 GPU 合成器仍流畅的关键）。
  let cachedNatural = new Map<HTMLElement, DOMRect>()
  let cachedCols = -1

  // 动画状态（位置追向模型）
  let animActive = false
  let tickRunning = false
  let visRects = new Map<HTMLElement, DOMRect>() // 卡片当前视觉矩形（追向自然布局）

  function cards(): HTMLElement[] {
    if (!container) return []
    return Array.from(container.querySelectorAll<HTMLElement>(cardSelector))
  }

  // 找到承载卡片的真实网格容器（向上找最近的 display:grid 祖先）
  function gridEl(): HTMLElement | null {
    const cs = cards()
    if (!cs.length) return container
    let el: HTMLElement | null = cs[0].parentElement
    while (el && el !== container) {
      const disp = getComputedStyle(el).display
      if (disp === 'grid' || disp === 'inline-grid') return el
      el = el.parentElement
    }
    return container
  }

  // 读网格当前自然列数（本模型绝不设置网格 inline 列宽，故直接读计算值即可）
  function naturalCols(): number {
    const g = gridEl()
    if (!g) return 0
    const t = getComputedStyle(g)
      .gridTemplateColumns.trim()
      .split(/\s+/)
    return t.filter((s) => s && !isNaN(parseFloat(s))).length
  }

  // 测量「自然」矩形：清零卡片 transform → 一次 reflow → 读各卡真实矩形。
  // 调用方须在同步块内立即重新设置 transform，避免画出「未变换」的中间态。
  function measureNatural(cs: HTMLElement[]): Map<HTMLElement, DOMRect> {
    for (const c of cs) {
      if (!c.isConnected) continue
      c.style.transform = ''
      c.style.width = '' // 清除动画期 inline 宽度，测得「网格自然列宽」(1fr)，而非被钉的旧宽度
    }
    void document.body.offsetHeight // 强制 reflow，使自然布局落盘
    const m = new Map<HTMLElement, DOMRect>()
    for (const c of cs) if (c.isConnected) m.set(c, c.getBoundingClientRect())
    return m
  }

  // 仅读取当前视觉矩形（不清除 transform，无 style 写入 → 强制 layout 但远比 measureNatural 便宜）。
  // 用于「同列连续拖拽」期的基线更新：卡片随浏览器原生 resize，这里只同步记录当前几何，不跑 FLIP。
  function readRects(cs: HTMLElement[]): Map<HTMLElement, DOMRect> {
    const m = new Map<HTMLElement, DOMRect>()
    for (const c of cs) if (c.isConnected) m.set(c, c.getBoundingClientRect())
    return m
  }

  // 带列数缓存的自然矩形：列数不变直接复用，仅在跨断点（列数变化）时重新强制一次 reflow。
  // tick 与 onObserve 跨列分支据此拿到「当前自然布局」，稳定期内零重排 → CPU 合成下流畅。
  function refreshNatural(cs: HTMLElement[]): Map<HTMLElement, DOMRect> {
    const cols = naturalCols()
    if (cols !== cachedCols) {
      cachedNatural = measureNatural(cs)
      cachedCols = cols
    }
    return cachedNatural
  }

  // 某元素是否可纵向滚动（作为滚动锚定容器）
  function isScrollable(el: HTMLElement): boolean {
    const s = getComputedStyle(el)
    const oy = s.overflowY
    return (
      (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
      el.scrollHeight > el.clientHeight + 1
    )
  }

  // 解析滚动容器：优先 container 本身，否则向上找可滚动祖先（网格/卡片的滚动容器）。
  function resolveScrollEl(): HTMLElement | null {
    if (!container) return null
    if (isScrollable(container)) return container
    let el: HTMLElement | null = container.parentElement
    while (el) {
      if (isScrollable(el)) return el
      el = el.parentElement
    }
    return null
  }

  // 收敛 / 急切收尾：清卡片内联样式，回归自然流，重置基线。
  function finish() {
    if (cleanupTimer) {
      clearTimeout(cleanupTimer)
      cleanupTimer = 0
    }
    if (flipRaf) {
      cancelAnimationFrame(flipRaf)
      flipRaf = 0
    }
    tickRunning = false
    const g = gridEl()
    const cs = cards()
    if (g && savedOverflow !== null) {
      g.style.overflow = savedOverflow
      savedOverflow = null
    }
    cs.forEach((c) => {
      if (!c.isConnected) return
      c.style.transition = ''
      c.style.transform = ''
      c.style.width = ''
      c.style.transformOrigin = ''
      c.style.zIndex = ''
    })
    animActive = false
    visRects.clear()
    if (scrollLockCleanup) {
      scrollLockCleanup()
      scrollLockCleanup = null
    }
    // 重置基线：记录当前自然布局（作为下次 crossing 的 First）
    const natural = measureNatural(cs)
    lastRects = natural
    lastCols = naturalCols()
    cachedNatural = natural
    cachedCols = lastCols
  }

  // 宽松兜底：仅在极端未收敛时强制落位（届时已≈收敛 → 无跳）；拖拽中 natural 持续变化不会到点（自然跟手）。
  function resetCleanupTimer() {
    if (cleanupTimer) clearTimeout(cleanupTimer)
    cleanupTimer = window.setTimeout(() => {
      cleanupTimer = 0
      if (animActive) finish()
    }, 2500)
  }

  // 动画期间锁定滚动容器：阻断 wheel / touchmove / 方向键等滚动输入，并兜底拉回锁定位置。
  // 仅在真实滚动容器(scrollEl)上生效；动画结束 finish() 中调用 scrollLockCleanup 解锁。
  function lockScroll() {
    const el = scrollEl
    if (!el || scrollLockCleanup) return
    lockedScrollTop = el.scrollTop
    const preventWheel = (e: WheelEvent) => e.preventDefault()
    const preventTouch = (e: TouchEvent) => e.preventDefault()
    const preventKeys = (e: KeyboardEvent) => {
      const block = [' ', 'PageUp', 'PageDown', 'Home', 'End',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      if (block) e.preventDefault()
    }
    // 兜底：万一仍发生滚动（惯性/程序触发），拉回锁定位置（钳制到可滚动范围，避免缩短时死循环）
    const onScroll = () => {
      const maxS = Math.max(0, el.scrollHeight - el.clientHeight)
      const target = Math.min(lockedScrollTop, maxS)
      if (Math.abs(el.scrollTop - target) > 0.5) el.scrollTop = target
    }
    el.addEventListener('wheel', preventWheel, { passive: false, capture: true })
    el.addEventListener('touchmove', preventTouch, { passive: false, capture: true })
    window.addEventListener('keydown', preventKeys, { capture: true, passive: false })
    el.addEventListener('scroll', onScroll, { passive: true })
    scrollLockCleanup = () => {
      el.removeEventListener('wheel', preventWheel, { capture: true })
      el.removeEventListener('touchmove', preventTouch, { capture: true })
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', preventKeys, { capture: true })
    }
  }

  // 单一 tick：卡片位置(transform)逐帧惯性追向「当前自然布局」。
  // 网格始终自然(auto-fill) → 卡片永远在正确宽度/高度（EpisodeGrid 不会换行爆炸），列数变几次都不乱飞。
  // 动画期间滚动已锁定（见 onObserve 的 lockScroll），本 tick 不操纵 scrollTop。
  function tick() {
    const K = getK() // 每帧读取最新速度（滑条实时生效）
    const cs = cards()
    if (!cs.length) {
      finish()
      return
    }
    const natural = refreshNatural(cs) // 列数不变时复用缓存，稳定拖拽期零每帧强制重排
    const vh = window.innerHeight

    // 动画期间滚动已锁定（见 onObserve 的 lockScroll），scrollTop 不变，无需锚定/平移。

    // 屏幕外判定 / 目标位置均以自然位置 natural.top 为准（动画期间滚动已锁定）
    const next = new Map<HTMLElement, DOMRect>()
    let maxDiff = 0
    for (const c of cs) {
      if (!c.isConnected) continue
      const r = natural.get(c)
      if (!r) continue
      const nt = r.top // 自然 top（滚动已锁定）
      const nl = r.left // 纵向滚动不影响水平
      // 屏幕外 → 释放（不再钉），自然流（滚入已是新布局）
      if (nt < -OFFSCREEN || nt > vh + OFFSCREEN) {
        c.style.transform = ''
        c.style.width = ''
        c.style.zIndex = ''
        next.set(c, new DOMRect(nl, nt, r.width, r.height))
        continue
      }
      // 位置 + 宽度按同一 K 追向「当前自然布局」；直接设 inline width（不改 transform:scale）→
      // 内部内容(封面/标题/格子字号)像素尺寸恒定、不放大缩小、不变形；宽度与位置同一节奏、完全匹配。
      const nw = r.width
      const nh = r.height
      const prev = visRects.get(c)
      const pTop = prev ? prev.top : nt
      const pLeft = prev ? prev.left : nl
      const pW = prev ? prev.width : nw
      const cl = pLeft + (nl - pLeft) * K
      const ct = pTop + (nt - pTop) * K
      const cw = pW + (nw - pW) * K // 宽度逐帧追向自然列宽
      const dx = cl - nl
      const dy = ct - nt
      const dw = cw - nw
      next.set(c, new DOMRect(cl, ct, cw, nh))
      maxDiff = Math.max(maxDiff, Math.hypot(dx, dy), Math.abs(dw))
      if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4 && Math.abs(dw) < 0.4) {
        c.style.transform = ''
        c.style.width = ''
        c.style.zIndex = ''
      } else {
        c.style.width = `${cw}px`
        c.style.transform = `translate(${dx}px, ${dy}px)`
        c.style.zIndex = '5'
      }
    }
    visRects = next

    // 收敛即落位
    if (maxDiff < CONVERGE) {
      finish()
      return
    }
    flipRaf = requestAnimationFrame(tick)
  }

  // 每帧（rAF 合并）检查：
  //  - 动画进行中：tick 自行逐帧追向最新 natural（支持列数中途多次变化、跟手），这里只续命兜底。
  //  - 非动画同列 / 无基线：持续记录「上一帧自然布局」(lastRects)，作为下次 crossing 的 First。
  //  - 非动画跨列：以 lastRects(旧布局) 作起点、当前 natural 作目标 → 启动位置追向；
  //    起步同步把卡片钉回旧位置，避免下一帧 tick 前出现一帧自然新位置闪烁。
  function onObserve() {
    const cs = cards()
    if (!cs.length) return

    if (animActive) {
      resetCleanupTimer() // 拖拽中 natural 持续变化 → 续命兜底（tick 自行追向）
      return
    }

    const cols = naturalCols()

    if (cols === lastCols || lastCols === -1) {
      // 同列数（或无基线）：让浏览器原生 resize 卡片（零每帧强制重排），
      // 仅同步记录当前几何作为下次 crossing 的 First 起点。
      lastRects = readRects(cs)
      lastCols = cols
      return
    }

    // 关闭动画（用户开关 / 系统 reduce-motion）：直接跟随自然流，无 FLIP、无过渡。
    if (!settings.gridAnimEnabled || reduceMotion) {
      if (animActive) finish()
      lastRects = readRects(cs)
      lastCols = cols
      return
    }

    // 跨断点：以 lastRects(当前旧布局) 作起点、refreshNatural(新自然布局) 作目标 → 位置追向。
    const natural = refreshNatural(cs) // 列数已变 → 重新测量一次
    const g = gridEl()
    if (g) {
      // 动画期间临时解除网格容器裁切（overflow:visible），让滑动出界的卡片完整可见，
      // 否则 overflow-x:clip 把移动中的卡片裁掉 → 看不到中间过程。
      savedOverflow = g.style.overflow
      g.style.overflow = 'visible'
    }
    // 关闭卡片 transform-transition，避免与每帧 RAF 驱动冲突（否则 transform 被二次平滑→动画不可见）
    cs.forEach((c) => {
      if (c.isConnected) c.style.transition = 'none'
    })
    // 解析滚动容器并锁定滚动：动画期间禁止用户滚动，避免与位置追向相互干扰导致抽动。
    scrollEl = resolveScrollEl()
    lockScroll()
    visRects = new Map(lastRects) // 起点 = 旧布局位置
    // 立即把卡片钉在「旧位置 + 旧宽度」（First），避免下一帧 tick 前出现一帧自然新位置/新宽度闪烁。
    // 直接设 inline width = 旧宽度（不改 transform:scale）→ 内部内容像素尺寸恒定、不变形；
    // 宽度与位置随后按同一 K 逐帧追向自然值，二者同一节奏、完全匹配。
    for (const c of cs) {
      const v = visRects.get(c)
      const nat = natural.get(c)
      if (!v || !nat) continue
      const dx = v.left - nat.left
      const dy = v.top - nat.top
      const ow = v.width // 旧宽度
      const near = Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4 && Math.abs(ow - nat.width) < 0.4
      if (near) {
        c.style.transform = ''
        c.style.width = ''
      } else {
        c.style.width = `${ow}px`
        c.style.transform = `translate(${dx}px, ${dy}px)`
      }
    }
    lastCols = cols
    animActive = true
    resetCleanupTimer()
    if (!tickRunning) {
      tickRunning = true
      flipRaf = requestAnimationFrame(tick)
    }
  }

  function schedule() {
    if (observeRaf) return
    observeRaf = requestAnimationFrame(() => {
      observeRaf = 0
      onObserve()
    })
  }

  function onMotionChange(e: MediaQueryListEvent) {
    reduceMotion = e.matches
    if (reduceMotion) finish()
  }

  onMounted(() => {
    container = document.querySelector<HTMLElement>(containerSelector)
    if (!container) return
    // prefers-reduced-motion：尊重系统“减少动态效果”设置
    motionMq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduceMotion = motionMq.matches
    motionMq.addEventListener?.('change', onMotionChange)

    const cs = cards()
    lastRects = measureNatural(cs) // 首帧建立基线（卡片可能尚未加载，稍后由 MutationObserver 补全）
    lastCols = naturalCols()
    cachedNatural = lastRects
    cachedCols = lastCols
    ro = new ResizeObserver(() => schedule())
    ro.observe(container)
    // 卡片异步加载 / 切换 tab 后补全基线
    mo = new MutationObserver(() => {
      cachedCols = -1 // 卡片增删使自然缓存失效，下次 refreshNatural 重新测量
      schedule()
    })
    mo.observe(container, { childList: true, subtree: true })
  })

  onBeforeUnmount(() => {
    ro?.disconnect()
    mo?.disconnect()
    motionMq?.removeEventListener?.('change', onMotionChange)
    finish()
    if (observeRaf) {
      cancelAnimationFrame(observeRaf)
      observeRaf = 0
    }
  })
}
