import electron from 'electron'
const { safeStorage } = electron

/** 使用 Electron safeStorage 加解密敏感数据（Bangumi token 等），落盘不以明文存储。 */
export function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // 无加密后端时回退为 base64（仅混淆，非安全），并提示
    return `b64:${Buffer.from(plain, 'utf-8').toString('base64')}`
  }
  return `enc:${safeStorage.encryptString(plain).toString('base64')}`
}

export function decrypt(payload: string): string | null {
  if (payload.startsWith('enc:')) {
    try {
      const buf = Buffer.from(payload.slice(4), 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      // 密文无法解密（safeStorage 密钥环境变化 / 数据损坏）：返回 null，
      // 由调用方按「无有效令牌」处理，而不是抛出导致 IPC（如 auth:login）整体失败。
      return null
    }
  }
  if (payload.startsWith('b64:')) {
    return Buffer.from(payload.slice(4), 'base64').toString('utf-8')
  }
  return payload
}
