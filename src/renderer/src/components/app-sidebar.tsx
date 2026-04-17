import {
  type Account,
  accountDisplayName,
  type Category,
  type MessageCounts
} from '@shared/settings'
import {
  ArchiveIcon,
  InboxIcon,
  ListTodoIcon,
  MailsIcon,
  SettingsIcon,
  TagIcon
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'

const EMPTY_COUNTS: MessageCounts = {
  inboxUnread: {},
  inboxUnreadTotal: 0,
  categoryUnread: {},
  otherUnread: 0,
  todoTotal: 0,
  archiveUnread: {},
  archiveUnreadTotal: 0
}

function CountBadge({ count }: { count: number }): React.JSX.Element | null {
  if (count <= 0) return null
  return <SidebarMenuBadge>{count}</SidebarMenuBadge>
}

export function AppSidebar(): React.JSX.Element {
  const location = useLocation()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [counts, setCounts] = useState<MessageCounts>(EMPTY_COUNTS)

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

  const refreshCounts = useCallback(() => {
    window.api.messages.counts().then((c) => {
      setCounts(c)
    })
  }, [])

  // Refresh on mount, on navigation, and whenever the main process tells us
  // messages changed (sync finished, flag flipped, category reassigned).
  useEffect(() => {
    refreshCounts()
  }, [refreshCounts, location.pathname])

  useEffect(() => {
    return window.api.messages.onChanged(() => {
      refreshCounts()
    })
  }, [refreshCounts])

  return (
    <Sidebar collapsible="none" className="drag w-full">
      <SidebarHeader className="h-10 p-0" />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className="no-drag"
                  isActive={location.pathname === '/todo'}
                >
                  <Link to="/todo">
                    <ListTodoIcon />
                    <span>To Do</span>
                  </Link>
                </SidebarMenuButton>
                <CountBadge count={counts.todoTotal} />
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
                      <SidebarMenuButton
                        asChild
                        className="no-drag"
                        isActive={location.pathname === path}
                      >
                        <Link to={path}>
                          <TagIcon />
                          <span>{category.name}</span>
                        </Link>
                      </SidebarMenuButton>
                      <CountBadge count={counts.categoryUnread[category.id] ?? 0} />
                    </SidebarMenuItem>
                  )
                })}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    className="no-drag"
                    isActive={location.pathname === '/others'}
                  >
                    <Link to="/others">
                      <TagIcon />
                      <span>Other</span>
                    </Link>
                  </SidebarMenuButton>
                  <CountBadge count={counts.otherUnread} />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Mailboxes</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className="no-drag" isActive={location.pathname === '/'}>
                  <Link to="/">
                    <MailsIcon />
                    <span>All Inboxes</span>
                  </Link>
                </SidebarMenuButton>
                <CountBadge count={counts.inboxUnreadTotal} />
              </SidebarMenuItem>
              {accounts.map((account) => {
                const path = `/inbox/${account.id}`
                return (
                  <SidebarMenuItem key={account.id}>
                    <SidebarMenuButton
                      asChild
                      className="no-drag"
                      isActive={location.pathname === path}
                    >
                      <Link to={path}>
                        <InboxIcon />
                        <span>{accountDisplayName(account)}</span>
                      </Link>
                    </SidebarMenuButton>
                    <CountBadge count={counts.inboxUnread[account.id] ?? 0} />
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Archived</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className="no-drag"
                  isActive={location.pathname === '/archive'}
                >
                  <Link to="/archive">
                    <ArchiveIcon />
                    <span>All Archived</span>
                  </Link>
                </SidebarMenuButton>
                <CountBadge count={counts.archiveUnreadTotal} />
              </SidebarMenuItem>
              {accounts.map((account) => {
                const path = `/archive/${account.id}`
                return (
                  <SidebarMenuItem key={account.id}>
                    <SidebarMenuButton
                      asChild
                      className="no-drag"
                      isActive={location.pathname === path}
                    >
                      <Link to={path}>
                        <ArchiveIcon />
                        <span>{accountDisplayName(account)}</span>
                      </Link>
                    </SidebarMenuButton>
                    <CountBadge count={counts.archiveUnread[account.id] ?? 0} />
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
            <SidebarMenuButton
              asChild
              className="no-drag"
              isActive={location.pathname.startsWith('/settings')}
            >
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
