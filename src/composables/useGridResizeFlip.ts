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
//   - ⚠️ 滚动锚定（长列表滚到底缩放跨列必备）：列数一变网格整体重组 → 固定 scrollTop 会让视口
//     显示的卡片被整批替换（=「整个大规模重排」）。故跨列时选「视口中央最近可见卡」为锚点，每帧微调
//     滚动容器 scrollTop 让其停在原视口位置 → 阅读位置不丢、所有卡片平滑滑动而非整批跳换。
//     transform 计算统一用 post-scroll 自然位置(natural.top - delta)，visRects 同步平移 delta。
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
  // 速度滑条语义：0 = 最快（左），1 = 最慢（右），默认 0.2（偏快）。
  // 滑条值 s∈[0,1] 反相映射到追向比例 K：s=0(快)→K=0.55，s=1(慢)→K=0.015（更慢），s=0.2(默认)→K≈0.45（跟手快）。
  // 滑条实时映射到 K（tick 每帧读 getK）；显式传入 chaseK 时优先（测试/特殊场景）。
  function getK(): number {
    if (options?.chaseK != null) return options.chaseK
    const s = Math.min(1, Math.max(0, settings.gridAnimSpeed ?? 0.2))
    return 0.55 - s * 0.535
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
  let scrollEl: HTMLElement | null = null // 滚动容器（长列表 .content），用于缩放/跨列时锚定阅读位置
  let anchorEl: HTMLElement | null = null // 锚定卡片（视口中央最近可见卡）
  let anchorVpTarget = 0 // 锚定卡片希望保持的视口 top

  // 基线：上一帧「自然布局」矩形（crossing 时的 First 来源） + 当前稳定列数。
  let lastRects = new Map<HTMLElement, DOMRect>()
  let lastCols = -1

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

  // 从给定矩形集里挑「视口内、中心离视口垂直中点最近」的卡片作为滚动锚点。
  function pickAnchor(
    cs: HTMLElement[],
    rects: Map<HTMLElement, DOMRect>,
    vh: number
  ): { el: HTMLElement; top: number } | null {
    let best = Infinity
    let el: HTMLElement | null = null
    let top = 0
    for (const c of cs) {
      const r = rects.get(c)
      if (!r || !c.isConnected) continue
      if (r.top >= vh || r.bottom <= 0) continue
      const center = r.top + r.height / 2
      const d = Math.abs(center - vh / 2)
      if (d < best) {
        best = d
        el = c
        top = r.top
      }
    }
    return el ? { el, top } : null
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
    anchorEl = null // 动画结束，清除滚动锚点（阅读位置已由锚定保留）
    // 重置基线：记录当前自然布局（作为下次 crossing 的 First）
    const natural = measureNatural(cs)
    lastRects = natural
    lastCols = naturalCols()
  }

  // 宽松兜底：仅在极端未收敛时强制落位（届时已≈收敛 → 无跳）；拖拽中 natural 持续变化不会到点（自然跟手）。
  function resetCleanupTimer() {
    if (cleanupTimer) clearTimeout(cleanupTimer)
    cleanupTimer = window.setTimeout(() => {
      cleanupTimer = 0
      if (animActive) finish()
    }, 2500)
  }

  // 单一 tick：卡片位置(transform)逐帧惯性追向「当前自然布局」。
  // 网格始终自然(auto-fill) → 卡片永远在正确宽度/高度（EpisodeGrid 不会换行爆炸），列数变几次都不乱飞。
  // 滚动锚定：长列表滚到底缩放跨列时，网格整体重组会改变 scrollTop 对应的可见内容 →
  //   每帧微调滚动容器 scrollTop 让「锚点卡片」停在视口原位置，阅读位置不丢、不再整批重排。
  function tick() {
    const K = getK() // 每帧读取最新速度（滑条实时生效）
    const cs = cards()
    if (!cs.length) {
      finish()
      return
    }
    const natural = measureNatural(cs) // 清零 transform 后测量的「自然」矩形（当前 scrollTop 下）
    const vh = window.innerHeight

    // ── 滚动锚定：保持锚点卡片视口位置不变 ──
    let delta = 0 // 本帧需要平移的滚动量（正值=内容上移）
    if (scrollEl) {
      // 锚点离开视口/失联 → 重新选一个当前可见卡，避免被强制拉回导致抖动
      if (
        !anchorEl ||
        !anchorEl.isConnected ||
        (() => {
          const a = natural.get(anchorEl)
          return !a || a.top <= -400 || a.top >= vh + 400
        })()
      ) {
        const pick = pickAnchor(cs, natural, vh)
        if (pick) {
          anchorEl = pick.el
          anchorVpTarget = pick.top
        }
      }
      if (anchorEl && anchorEl.isConnected) {
        const aNat = natural.get(anchorEl)
        if (aNat) {
          const d = aNat.top - anchorVpTarget
          if (Math.abs(d) > 0.3) {
            const maxS = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
            const ns = Math.min(Math.max(scrollEl.scrollTop + d, 0), maxS)
            delta = ns - scrollEl.scrollTop
            scrollEl.scrollTop = ns
          }
        }
      }
    }

    // 屏幕外判定 / 目标位置均以「post-scroll 自然位置」(natural.top - delta) 为准
    const next = new Map<HTMLElement, DOMRect>()
    let maxDiff = 0
    for (const c of cs) {
      if (!c.isConnected) continue
      const r = natural.get(c)
      if (!r) continue
      const nt = r.top - delta // post-scroll 自然 top
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
      const pTop = (prev ? prev.top : nt) - delta
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

    const natural = measureNatural(cs)
    const cols = naturalCols()

    if (cols === lastCols || lastCols === -1) {
      // 同列数（或无基线）：持续记录「上一帧自然布局」
      lastRects = natural
      lastCols = cols
      return
    }

    // 关闭动画（用户开关 / 系统 reduce-motion）：直接跟随自然流，无 FLIP、无过渡。
    if (!settings.gridAnimEnabled || reduceMotion) {
      if (animActive) finish()
      lastRects = natural
      lastCols = cols
      return
    }
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
    // 选滚动锚点 + 解析滚动容器：长列表缩放跨列时锚定阅读位置，避免整列表大幅重排。
    const vh = window.innerHeight
    scrollEl = resolveScrollEl()
    anchorEl = null
    let best = Infinity
    for (const c of cs) {
      const r = lastRects.get(c)
      if (!r) continue
      if (r.top >= vh || r.bottom <= 0) continue
      const center = r.top + r.height / 2
      const d = Math.abs(center - vh / 2)
      if (d < best) {
        best = d
        anchorEl = c
      }
    }
    if (anchorEl) anchorVpTarget = lastRects.get(anchorEl)!.top
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
    ro = new ResizeObserver(() => schedule())
    ro.observe(container)
    // 卡片异步加载 / 切换 tab 后补全基线
    mo = new MutationObserver(() => {
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
