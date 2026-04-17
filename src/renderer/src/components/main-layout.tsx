import { Outlet } from 'react-router-dom'

import { AppSidebar } from '@/components/app-sidebar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SidebarProvider } from '@/components/ui/sidebar'

export function MainLayout(): React.JSX.Element {
  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel
          id="sidebar"
          defaultSize="18%"
          minSize="12%"
          maxSize="35%"
          className="bg-sidebar"
        >
          <AppSidebar />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="content" defaultSize="82%" minSize="40%">
          <main className="h-full w-full bg-background">
            <Outlet />
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
    </SidebarProvider>
  )
}
