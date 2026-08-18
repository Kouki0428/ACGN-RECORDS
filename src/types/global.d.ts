import type { AcgnApi } from '@shared/types'

declare global {
  interface Window {
    acgn: AcgnApi
  }
}

export {}
