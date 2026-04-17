import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import { MainLayout } from '@/components/main-layout'
import { InboxPage } from '@/pages/inbox'
import { SettingsAccountsPage } from '@/pages/settings/accounts'
import { SettingsAiPage } from '@/pages/settings/ai'
import { SettingsLayout } from '@/pages/settings/layout'
import { SettingsSyncPage } from '@/pages/settings/sync'

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="ai" replace />} />
          <Route path="ai" element={<SettingsAiPage />} />
          <Route path="accounts" element={<SettingsAccountsPage />} />
          <Route path="sync" element={<SettingsSyncPage />} />
        </Route>
        <Route element={<MainLayout />}>
          <Route path="/" element={<InboxPage />} />
          <Route path="/inbox/:accountId" element={<InboxPage accountScoped />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
