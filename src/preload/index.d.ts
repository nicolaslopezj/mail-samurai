import type { ElectronAPI } from '@electron-toolkit/preload'
import type { SettingsApi } from '../shared/settings'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      settings: SettingsApi
    }
  }
}
