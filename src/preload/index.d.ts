import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AccountsApi,
  AiApi,
  AppApi,
  CloudApi,
  ContactsApi,
  MessagesApi,
  SettingsApi,
  SyncApi
} from '../shared/settings'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      settings: SettingsApi
      accounts: AccountsApi
      messages: MessagesApi
      sync: SyncApi
      ai: AiApi
      contacts: ContactsApi
      cloud: CloudApi
      app: AppApi
    }
  }
}
