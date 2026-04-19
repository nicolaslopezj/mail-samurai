import type { Account } from '@shared/settings'
import { useEffect, useRef, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { ComposeDialog } from '@/components/compose-dialog'
import { MainLayout } from '@/components/main-layout'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/lib/theme'
import { InboxPage } from '@/pages/inbox'
import { SettingsAboutPage } from '@/pages/settings/about'
import { SettingsAccountsPage } from '@/pages/settings/accounts'
import { SettingsAiPage } from '@/pages/settings/ai'
import { SettingsAppearancePage } from '@/pages/settings/appearance'
import { SettingsCategoriesPage } from '@/pages/settings/categories'
import { SettingsCloudPage } from '@/pages/settings/cloud'
import { SettingsContactsPage } from '@/pages/settings/contacts'
import { SettingsLayout } from '@/pages/settings/layout'
import { SettingsSyncPage } from '@/pages/settings/sync'

function GlobalShortcuts({ onNewMail }: { onNewMail: () => void }): null {
  const navigate = useNavigate()
  const location = useLocation()
  const targetsRef = useRef<string[]>([])

  useEffect(() => {
    let cancelled = false
    window.api.settings.get().then((s) => {
      if (cancelled) return
      const paths = s.categories.map((c) => `/category/${c.id}`)
      if (s.allowUncategorized) paths.push('/others')
      targetsRef.current = paths
    })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.altKey) return
      if (event.key === ',' && !event.shiftKey) {
        event.preventDefault()
        navigate('/settings')
        return
      }
      if (event.key.toLowerCase() === 'n' && !event.shiftKey) {
        event.preventDefault()
        onNewMail()
        return
      }
      if (!event.shiftKey && /^[0-9]$/.test(event.key)) {
        if (event.key === '0') {
          event.preventDefault()
          navigate('/')
          return
        }
        const index = Number(event.key) - 1
        const path = targetsRef.current[index]
        if (path) {
          event.preventDefault()
          navigate(path)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, onNewMail])
  return null
}

function NewMailDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element | null {
  const [accounts, setAccounts] = useState<Account[]>([])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.api.accounts.list().then((list) => {
      if (!cancelled) setAccounts(list)
    })
    return () => {
      cancelled = true
    }
  }, [open])
  if (!open) return null
  return (
    <TooltipProvider delayDuration={0}>
      <ComposeDialog
        open={open}
        onOpenChange={onOpenChange}
        mode="new"
        source={null}
        accounts={accounts}
        defaultAccountId={accounts[0]?.id}
      />
    </TooltipProvider>
  )
}

function App(): React.JSX.Element {
  const [newMailOpen, setNewMailOpen] = useState(false)
  return (
    <ThemeProvider>
      <HashRouter>
        <GlobalShortcuts onNewMail={() => setNewMailOpen(true)} />
        <NewMailDialog open={newMailOpen} onOpenChange={setNewMailOpen} />
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
            <Route path="about" element={<SettingsAboutPage />} />
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
