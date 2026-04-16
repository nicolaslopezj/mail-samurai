import { Outlet } from 'react-router-dom'

import { AppSidebar } from '@/components/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export function MainLayout(): React.JSX.Element {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <div className="flex h-svh">
          <aside className="w-96 shrink-0 border-r bg-background" />
          <main className="flex-1 bg-background">
            <Outlet />
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
