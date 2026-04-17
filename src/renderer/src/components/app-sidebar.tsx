import { type Account, accountDisplayName } from '@shared/settings'
import { InboxIcon, MailsIcon, SettingsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
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

export function AppSidebar(): React.JSX.Element {
  const location = useLocation()
  const [accounts, setAccounts] = useState<Account[]>([])

  useEffect(() => {
    window.api.accounts.list().then(setAccounts)
  }, [])

  return (
    <Sidebar collapsible="none" className="w-full">
      <SidebarHeader className="h-10 p-0" />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Mailboxes</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/'}>
                  <Link to="/">
                    <MailsIcon />
                    <span>All Inboxes</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {accounts.map((account) => {
                const path = `/inbox/${account.id}`
                return (
                  <SidebarMenuItem key={account.id}>
                    <SidebarMenuButton asChild isActive={location.pathname === path}>
                      <Link to={path}>
                        <InboxIcon />
                        <span>{accountDisplayName(account)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location.pathname.startsWith('/settings')}>
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
