// Bangumi 评论表情包面板数据（从 EpisodeCommentModal 拆出）。
// 仅列出真实存在的表情（URL 已逐一验证可达）；发出评论时插入 (代码) 文本，Bangumi 端自行渲染成图。
const SMILEY_BASE = 'https://lain.bgm.tv/img/smiles/'
const p2 = (n: number) => String(n).padStart(2, '0')

export interface BgmSmiley {
  code: string
  src: string
}

export const SMILEYS: BgmSmiley[] = [
  // 早期 bgm 系列（bgm/NN.png，已验证 01-10/12-22 存在）
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((n) => ({
    code: `(bgm${n})`,
    src: `${SMILEY_BASE}bgm/${p2(n)}.png`
  })),
  // 主 bgm 系列（tv/NN.gif，bgm24..85 → tv/01..tv/62）
  ...Array.from({ length: 62 }, (_, k) => {
    const n = k + 24
    return { code: `(bgm${n})`, src: `${SMILEY_BASE}tv/${p2(n - 23)}.gif` }
  }),
  // tv_vs 系列（bgm200..238 → tv_vs/bgm_N.png，即“b2xx”系列）
  ...Array.from({ length: 39 }, (_, k) => {
    const n = k + 200
    return { code: `(bgm${n})`, src: `${SMILEY_BASE}tv_vs/bgm_${n}.png` }
  }),
  // tv_500 特殊系列（仅 500/501/505/515..519 真实存在）
  ...[500, 501, 505, 515, 516, 517, 518, 519].map((n) => ({
    code: `(bgm${n})`,
    src: `${SMILEY_BASE}tv_500/bgm_${n}.gif`
  })),
  // musume / blake 娘系列（06..41 已验证存在）
  ...Array.from({ length: 36 }, (_, k) => {
    const n = k + 6
    return { code: `(musume_${p2(n)})`, src: `${SMILEY_BASE}musume/musume_${p2(n)}.gif` }
  }),
  ...Array.from({ length: 36 }, (_, k) => {
    const n = k + 6
    return { code: `(blake_${p2(n)})`, src: `${SMILEY_BASE}blake/blake_${p2(n)}.gif` }
  })
]
