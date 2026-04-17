import { type Account, accountDisplayName, type Category } from '@shared/settings'
import { InboxIcon, ListTodoIcon, MailsIcon, SettingsIcon, TagIcon } from 'lucide-react'
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
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    window.api.accounts.list().then(setAccounts)
  }, [])

  // Re-read categories on every route change so edits made in Settings show
  // up as soon as the user navigates away from there. Cheap — it's a single
  // JSON file read in the main process.
  useEffect(() => {
    let cancelled = false
    window.api.settings.get().then((s) => {
      if (!cancelled) setCategories(s.categories)
    })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

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

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/todo'}>
                  <Link to="/todo">
                    <ListTodoIcon />
                    <span>To Do</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {categories.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Categories</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {categories.map((category) => {
                  const path = `/category/${category.id}`
                  return (
                    <SidebarMenuItem key={category.id}>
                      <SidebarMenuButton asChild isActive={location.pathname === path}>
                        <Link to={path}>
                          <TagIcon />
                          <span>{category.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
