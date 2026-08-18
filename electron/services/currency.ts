// 币种 → 人民币（CNY）静态汇率表。
//
// 应用是离线优先的个人记账工具，未接入实时汇率 API，故采用近似静态汇率。
// 汇率会随市场波动，这里的数值仅作「统一折算展示」用途，非金融级精确值。
// 如需更新，直接改下表即可（单位：1 外币 = ? 人民币）。
//
// 覆盖 ACGN 消费常见币种：人民币、美元、日元、新台币、港币、欧元、英镑、韩元。
const CURRENCY_TO_CNY: Record<string, number> = {
  CNY: 1,
  RMB: 1,
  USD: 7.2,
  JPY: 0.048,
  TWD: 0.225,
  HKD: 0.92,
  EUR: 7.8,
  GBP: 9.1,
  KRW: 0.0053
}

/**
 * 将金额按币种折算为人民币。
 * @param amount 原币种金额
 * @param currency 币种代码（如 'USD'/'JPY'），缺省或无法识别时按 1:1 视为人民币（不丢数据）
 */
export function convertToCNY(amount: number, currency?: string | null): number {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return 0
  const code = (currency || 'CNY').toUpperCase()
  const rate = CURRENCY_TO_CNY[code]
  if (rate == null) return amount // 未知币种：原样返回，避免误清零
  return amount * rate
}
