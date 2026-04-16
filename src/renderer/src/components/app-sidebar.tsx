import { ArchiveIcon, FileIcon, InboxIcon, SendIcon, SettingsIcon, TrashIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'

const mailboxes = [
  { title: 'Inbox', icon: InboxIcon },
  { title: 'Sent', icon: SendIcon },
  { title: 'Drafts', icon: FileIcon },
  { title: 'Archive', icon: ArchiveIcon },
  { title: 'Trash', icon: TrashIcon }
]

export function AppSidebar(): React.JSX.Element {
  const location = useLocation()

  return (
    <Sidebar>
      <SidebarHeader className="h-10 p-0" />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Mailboxes</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mailboxes.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton>
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location.pathname === '/settings'}>
              <Link to="/settings">
                <SettingsIcon />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
