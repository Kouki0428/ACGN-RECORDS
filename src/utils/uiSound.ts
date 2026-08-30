// 界面操作音效：Web Audio 实时合成短促音，无需音频资源文件。
// 每款音效在开头统一检查设置页「音效」总开关（uiSound），关闭后全部静音。
// 任何时刻调用都安全（未就绪 / 失败静默忽略，不影响功能）。
import { useSettingsStore } from '@/stores/settings'

let ctx: AudioContext | null = null

type SoundKind = 'click' | 'confirm' | 'close' | 'pop' | 'toggle-on' | 'toggle-off'

// 每款音效：起频 / 止频（指数扫频）/ 时长 / 音量。保持短促、柔和，不与系统提示音混淆。
const SPEC: Record<SoundKind, [number, number, number, number]> = {
  click: [1500, 1750, 0.035, 0.05],
  confirm: [560, 920, 0.09, 0.14],
  close: [520, 340, 0.07, 0.08],
  pop: [660, 1000, 0.05, 0.1],
  'toggle-on': [660, 880, 0.06, 0.12],
  'toggle-off': [440, 560, 0.06, 0.12]
}

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function play(kind: SoundKind) {
  if (!useSettingsStore().uiSound) return
  const ac = getCtx()
  if (!ac) return
  try {
    const [f0, f1, dur, vol] = SPEC[kind]
    const t0 = ac.currentTime
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f0, t0)
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.01)
  } catch {
    /* ignore */
  }
}

export function playClick() {
  play('click')
}
export function playConfirm() {
  play('confirm')
}
export function playClose() {
  play('close')
}
export function playPop() {
  play('pop')
}
/** 开关切换音：high=true（开启）偏高音，false（关闭）偏低音 */
export function playToggleClick(high = true) {
  play(high ? 'toggle-on' : 'toggle-off')
}

// 全局点击音效：一次委派覆盖所有按钮 / 返回 / 选择 / 卡片打开等点击。
// 优先级：元素带 data-sound 属性（click/confirm/close/pop）→ 主按钮类 → 返回 → 卡片 → 通用点击。
// 与 ToggleSwitch 自带音效互不冲突（其类名 toggle-switch 不在匹配范围，避免重复发声）。
export function installClickSound() {
  if (typeof document === 'undefined') return
  document.addEventListener('click', onDocClick)
}

function onDocClick(e: MouseEvent) {
  const target = e.target as Element | null
  const el = target?.closest?.(
    '[data-sound], .back-btn, .btn, .seg-item, .tc-page-btn, .card, .tc-item'
  )
  if (!el) return
  const ds = el.getAttribute?.('data-sound')
  if (ds && (ds === 'click' || ds === 'confirm' || ds === 'close' || ds === 'pop')) {
    play(ds)
    return
  }
  if (el.classList.contains('back-btn')) {
    playClose()
  } else if (
    el.classList.contains('btn--primary') ||
    el.classList.contains('btn--accent') ||
    el.classList.contains('btn--danger')
  ) {
    playConfirm()
  } else if (el.classList.contains('card') || el.classList.contains('tc-item')) {
    playPop()
  } else {
    playClick()
  }
}