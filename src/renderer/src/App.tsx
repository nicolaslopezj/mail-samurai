import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import { MainLayout } from '@/components/main-layout'
import { InboxPage } from '@/pages/inbox'
import { SettingsPage } from '@/pages/settings'

function App(): React.JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route element={<MainLayout />}>
          <Route path="/" element={<InboxPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
