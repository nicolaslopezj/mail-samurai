import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'

import { MainLayout } from '@/components/main-layout'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/lib/theme'
import { InboxPage } from '@/pages/inbox'
import { SettingsAccountsPage } from '@/pages/settings/accounts'
import { SettingsAiPage } from '@/pages/settings/ai'
import { SettingsAppearancePage } from '@/pages/settings/appearance'
import { SettingsCategoriesPage } from '@/pages/settings/categories'
import { SettingsCloudPage } from '@/pages/settings/cloud'
import { SettingsContactsPage } from '@/pages/settings/contacts'
import { SettingsLayout } from '@/pages/settings/layout'
import { SettingsSyncPage } from '@/pages/settings/sync'

function GlobalShortcuts(): null {
  const navigate = useNavigate()
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== ',' || !(event.metaKey || event.ctrlKey)) return
      if (event.shiftKey || event.altKey) return
      event.preventDefault()
      navigate('/settings')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])
  return null
}

function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <HashRouter>
        <GlobalShortcuts />
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="ai" replace />} />
            <Route path="ai" element={<SettingsAiPage />} />
            <Route path="accounts" element={<SettingsAccountsPage />} />
            <Route path="contacts" element={<SettingsContactsPage />} />
            <Route path="categories" element={<SettingsCategoriesPage />} />
            <Route path="sync" element={<SettingsSyncPage />} />
            <Route path="cloud" element={<SettingsCloudPage />} />
            <Route path="appearance" element={<SettingsAppearancePage />} />
          </Route>
          <Route element={<MainLayout />}>
            <Route path="/" element={<InboxPage />} />
            <Route path="/inbox/:accountId" element={<InboxPage accountScoped />} />
            <Route path="/others" element={<InboxPage otherScoped />} />
            <Route path="/archive" element={<InboxPage archiveScoped />} />
            <Route path="/archive/:accountId" element={<InboxPage archiveScoped accountScoped />} />
            <Route path="/category/:id" element={<InboxPage categoryScoped />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
      <Toaster position="bottom-right" richColors closeButton />
    </ThemeProvider>
  )
}

export default App
