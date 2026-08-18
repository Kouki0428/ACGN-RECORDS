import electron from 'electron'
const { ipcMain } = electron
import {
  getAuthStatus,
  saveToken,
  clearToken,
  beginOAuthLogin,
  getAppCredentials,
  saveAppCredentials
} from '../services/auth/oauth'

/** 注册 Bangumi 鉴权相关 IPC（个人令牌 + OAuth 一键登录）。 */
export function registerAuthIpc(): void {
  ipcMain.handle('auth:getStatus', async () => getAuthStatus())

  // 个人令牌模式：粘贴保存
  ipcMain.handle('auth:saveToken', async (_event, token: string) => {
    await saveToken(token)
  })

  // OAuth 一键登录：打开浏览器授权 → 本地回调 → 换令牌
  ipcMain.handle('auth:login', async () => beginOAuthLogin())

  // 开发者应用凭据（设置页查看/修改）
  ipcMain.handle('auth:getAppCredentials', async () => getAppCredentials())
  ipcMain.handle('auth:saveAppCredentials', async (_event, appId: string, secret: string) => {
    await saveAppCredentials(appId, secret)
  })

  ipcMain.handle('auth:clearToken', async () => {
    await clearToken()
  })
}
