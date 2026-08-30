// 极简 UI 音效：Web Audio 实时合成短促「咔嗒」声，无需音频资源文件。
// 任何时刻调用都安全（未就绪 / 失败静默忽略，不影响功能）。
let ctx: AudioContext | null = null

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

/** 播放一个短促柔和的「咔嗒」声；high=true 音调略高（用于开启），false 偏低（用于关闭） */
export function playToggleClick(high = true) {
  const ac = getCtx()
  if (!ac) return
  try {
    const t0 = ac.currentTime
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(high ? 660 : 440, t0)
    osc.frequency.exponentialRampToValueAtTime(high ? 880 : 560, t0 + 0.03)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06)
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.start(t0)
    osc.stop(t0 + 0.07)
  } catch {
    /* ignore */
  }
}