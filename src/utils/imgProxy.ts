/**
 * 把 Bangumi 图片地址交给 <img> 使用。
 *
 * 经历：早期直连 lain.bgm.tv 在用户环境可用（详情页主封面一直是直连），但曾尝试用
 * 主进程 acgn-img:// 代理统一拉图，结果该协议在渲染端未生效，反而把所有改成代理的
 * 列表/角色/关联图全部变成空白（详情页主封面因直连反而正常）。
 *
 * 现改为【直连原 URL】：acgn-img:// 代理协议先停用（主进程 imageProxy.ts 仍保留，
 * 若日后确属 lain.bgm.tv 被墙的环境再按需启用；需先在渲染端验证 acgn-img 可用）。
 * 空值 / 非 http(s) 原样返回。
 */
export function proxyImg(url?: string | null): string | undefined {
  if (!url) return undefined
  return url
}
