// Bangumi 单集评论「表情回应（贴贴）」的 value -> 表情 GIF 映射。
//
// 权威来源：bangumi/frontend 仓库 packages/utils/reactions.ts。
// 该文件定义 REACTION_EMOJI_MAP（reaction value 整数 -> tv 表情图片文件名），
// 并导出 ALLOWED_REACTIONS（用户可选的反应值列表，共 12 个，与服务端 ALLOWED_COMMON_REACTIONS 一致）。
// 下方仅保留这 12 个合法值；其余 value 在服务端不存在，发出会失败（此前 picker 误列 22 个即此坑）。
//
// 实际 GIF 托管在 https://bgm.tv/img/smiles/tv/{NN}.gif（编号零填充两位）。
// 注意：reactions 字段仅在登录态返回；匿名请求时 c.reactions 为 undefined。
// 未知 value（映射表外）返回 undefined，调用方降级为「value × N」文字。
const FACE_KEY_GIF_MAPPING: Record<string, string> = {
  '0': '44',
  '79': '40',
  '54': '15',
  '140': '101',
  '62': '23',
  '122': '83',
  '104': '65',
  '80': '41',
  '141': '102',
  '88': '49',
  '85': '46',
  '90': '51'
}

const BASE = 'https://bgm.tv/img/smiles/tv/'

/**
 * 根据 reaction.value 返回对应的表情 GIF 完整 URL；
 * 未知 value 返回 undefined（调用方降级为文字）。
 */
export function reactionGifUrl(value: string | number | null | undefined): string | undefined {
  if (value == null) return undefined
  const code = FACE_KEY_GIF_MAPPING[String(value)]
  if (!code) return undefined
  return BASE + code + '.gif'
}

export const REACTION_FACE_MAP = FACE_KEY_GIF_MAPPING

/** 全部可用的表情回应类别（FACE_KEY_GIF_MAPPING 的 key，字符串数字，如 '0'/'104'）。供表情选择器列出。 */
export const REACTION_VALUES: string[] = Object.keys(FACE_KEY_GIF_MAPPING)
