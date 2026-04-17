import {
  type Account,
  accountDisplayName,
  type Category,
  type MessageCounts
} from '@shared/settings'
import {
  ArchiveIcon,
  InboxIcon,
  MailsIcon,
  PenSquareIcon,
  SettingsIcon,
  TagIcon
} from 'lucide-react'
import { ComposeDialog } from '@/components/compose-dialog'
import { Button } from '@/components/ui/button'
import { categoryIconComponent } from '@/lib/category-icon'
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
import { cn } from '@/lib/utils'

const EMPTY_COUNTS: MessageCounts = {
  inboxUnread: {},
  inboxUnreadTotal: 0,
  categoryUnread: {},
  categoryTotal: {},
  otherUnread: 0,
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
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [overPosition, setOverPosition] = useState<'above' | 'below'>('above')
  const [composeOpen, setComposeOpen] = useState(false)

  function clearCategoryDrag(): void {
    setDragIndex(null)
    setOverIndex(null)
  }

  function handleCategoryDrop(targetIndex: number): void {
    const source = dragIndex
    clearCategoryDrag()
    if (source === null) return
    const insertBase = overPosition === 'above' ? targetIndex : targetIndex + 1
    // After removing the source, subsequent indices shift left by 1.
    const insertAt = source < insertBase ? insertBase - 1 : insertBase
    if (source === insertAt) return
    const previous = categories
    const next = previous.slice()
    const [moved] = next.splice(source, 1)
    next.splice(insertAt, 0, moved)
    setCategories(next)
    window.api.settings
      .reorderCategories(next.map((c) => c.id))
      .then((s) => setCategories(s.categories))
      .catch((err) => {
        setCategories(previous)
        console.error('[categories] reorder failed:', err)
      })
  }

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
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setComposeOpen(true)}
              className="no-drag w-full justify-start gap-2"
            >
              <PenSquareIcon />
              <span>New Message</span>
            </Button>
          </SidebarGroupContent>
        </SidebarGroup>

        {categories.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Categories</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {categories.map((category, index) => {
                  const path = `/category/${category.id}`
                  const isDragging = dragIndex === index
                  const isDropTarget = overIndex === index && dragIndex !== null
                  return (
                    <SidebarMenuItem
                      key={category.id}
                      draggable
                      onDragStart={(e) => {
                        setDragIndex(index)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', category.id)
                      }}
                      onDragOver={(e) => {
                        if (dragIndex === null) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        const rect = e.currentTarget.getBoundingClientRect()
                        const position =
                          e.clientY - rect.top < rect.height / 2 ? 'above' : 'below'
                        if (overIndex !== index) setOverIndex(index)
                        if (overPosition !== position) setOverPosition(position)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        handleCategoryDrop(index)
                      }}
                      onDragEnd={clearCategoryDrag}
                      className={cn(
                        'no-drag cursor-grab active:cursor-grabbing',
                        isDragging && 'opacity-40'
                      )}
                    >
                      {isDropTarget && overPosition === 'above' && (
                        <div className="pointer-events-none absolute inset-x-1 -top-px z-10 h-0.5 rounded-full bg-primary" />
                      )}
                      {isDropTarget && overPosition === 'below' && (
                        <div className="pointer-events-none absolute inset-x-1 -bottom-px z-10 h-0.5 rounded-full bg-primary" />
                      )}
                      <SidebarMenuButton
                        asChild
                        className="no-drag"
                        isActive={location.pathname === path}
                      >
                        <Link to={path} draggable={false}>
                          {(() => {
                            const Icon = categoryIconComponent(category.icon)
                            return <Icon />
                          })()}
                          <span>{category.name}</span>
                        </Link>
                      </SidebarMenuButton>
                      <CountBadge
                        count={
                          (category.countMode === 'total'
                            ? counts.categoryTotal[category.id]
                            : counts.categoryUnread[category.id]) ?? 0
                        }
                      />
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
      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        mode="new"
        accounts={accounts}
        defaultAccountId={accounts[0]?.id}
      />
    </Sidebar>
  )
}
