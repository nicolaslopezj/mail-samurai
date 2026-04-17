import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import { MainLayout } from '@/components/main-layout'
import { ThemeProvider } from '@/lib/theme'
import { TodoPage } from '@/pages/category-view'
import { InboxPage } from '@/pages/inbox'
import { SettingsAccountsPage } from '@/pages/settings/accounts'
import { SettingsAiPage } from '@/pages/settings/ai'
import { SettingsAppearancePage } from '@/pages/settings/appearance'
import { SettingsCategoriesPage } from '@/pages/settings/categories'
import { SettingsLayout } from '@/pages/settings/layout'
import { SettingsSyncPage } from '@/pages/settings/sync'

function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="ai" replace />} />
            <Route path="ai" element={<SettingsAiPage />} />
            <Route path="accounts" element={<SettingsAccountsPage />} />
            <Route path="categories" element={<SettingsCategoriesPage />} />
            <Route path="sync" element={<SettingsSyncPage />} />
            <Route path="appearance" element={<SettingsAppearancePage />} />
          </Route>
          <Route element={<MainLayout />}>
            <Route path="/" element={<InboxPage />} />
            <Route path="/inbox/:accountId" element={<InboxPage accountScoped />} />
            <Route path="/todo" element={<TodoPage />} />
            <Route path="/others" element={<InboxPage otherScoped />} />
            <Route path="/archive" element={<InboxPage archiveScoped />} />
            <Route path="/archive/:accountId" element={<InboxPage archiveScoped accountScoped />} />
            <Route path="/category/:id" element={<InboxPage categoryScoped />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}

export default App
