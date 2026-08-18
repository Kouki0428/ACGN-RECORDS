import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AuthStatus } from '@shared/types'
import { authClient, type AppCredentials } from '@/services/apiClient'

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>({ loggedIn: false })
  const busy = ref(false)
  const error = ref<string | null>(null)

  async function refresh() {
    status.value = await authClient.getStatus()
  }

  async function saveToken(token: string) {
    await authClient.saveToken(token)
    await refresh()
  }

  /** OAuth 一键登录（打开浏览器授权，等待回调后自动保存令牌）。 */
  async function login() {
    busy.value = true
    error.value = null
    try {
      status.value = await authClient.login()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      busy.value = false
    }
  }

  async function getAppCredentials(): Promise<AppCredentials> {
    return authClient.getAppCredentials()
  }

  async function saveAppCredentials(appId: string, secret: string) {
    await authClient.saveAppCredentials(appId, secret)
  }

  async function logout() {
    await authClient.logout()
    status.value = { loggedIn: false }
  }

  return { status, busy, error, refresh, saveToken, login, getAppCredentials, saveAppCredentials, logout }
})
