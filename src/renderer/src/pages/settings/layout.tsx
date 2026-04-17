import {
  ArrowLeftIcon,
  CloudIcon,
  InfoIcon,
  MailIcon,
  PaletteIcon,
  RefreshCwIcon,
  SparklesIcon,
  TagsIcon,
  UsersIcon
} from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type NavItem = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV: NavItem[] = [
  { to: '/settings/ai', label: 'AI provider', icon: SparklesIcon },
  { to: '/settings/accounts', label: 'Accounts', icon: MailIcon },
  { to: '/settings/contacts', label: 'Contacts', icon: UsersIcon },
  { to: '/settings/categories', label: 'Categories', icon: TagsIcon },
  { to: '/settings/sync', label: 'Sync', icon: RefreshCwIcon },
  { to: '/settings/cloud', label: 'Cloud sync', icon: CloudIcon },
  { to: '/settings/appearance', label: 'Appearance', icon: PaletteIcon },
  { to: '/settings/about', label: 'About', icon: InfoIcon }
]

export function SettingsLayout(): React.JSX.Element {
  return (
    <div className="flex h-svh flex-col">
      <header className="drag flex h-11 shrink-0 items-center gap-2 border-b pr-3 pl-20">
        <Button asChild variant="ghost" size="sm" className="no-drag">
          <Link to="/">
            <ArrowLeftIcon />
            Back
          </Link>
        </Button>
        <h1 className="text-sm font-semibold">Settings</h1>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav
          aria-label="Settings sections"
          className="drag w-52 shrink-0 border-r bg-sidebar/40 px-2 py-4"
        >
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'no-drag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                    )
                  }
                >
                  <item.icon className="size-4" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-xl px-6 py-8">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
