import type { CategoryIcon } from '@shared/settings'
import * as LucideIcons from 'lucide-react'
import { type LucideIcon, TagIcon } from 'lucide-react'

type IconEntry = { name: string; Component: LucideIcon }

/**
 * Every icon lucide-react ships, keyed by its PascalCase name without the
 * `Icon` suffix (e.g. `Mail`, `CircleCheckBig`). We also filter out the
 * generic `Icon` factory and any `Lucide…` aliases.
 */
const ICON_ENTRIES: IconEntry[] = Object.entries(LucideIcons as Record<string, unknown>)
  .filter((entry) => {
    const [name, value] = entry
    if (typeof value !== 'object' && typeof value !== 'function') return false
    if (!name.endsWith('Icon')) return false
    if (name === 'Icon') return false
    // Only PascalCase names are pre-built icon components; factories like
    // `createLucideIcon` or aliases like `LucideFoo` are not renderable here.
    if (!/^[A-Z]/.test(name)) return false
    if (name.startsWith('Lucide')) return false
    return true
  })
  .map(([name, Component]) => ({ name: name.slice(0, -4), Component: Component as LucideIcon }))
  .sort((a, b) => a.name.localeCompare(b.name))

const ICON_BY_NAME: Map<string, LucideIcon> = new Map(
  ICON_ENTRIES.map((e) => [e.name, e.Component])
)

export const ALL_CATEGORY_ICONS: IconEntry[] = ICON_ENTRIES

export function categoryIconComponent(name: CategoryIcon | null | undefined): LucideIcon {
  if (!name) return TagIcon
  return ICON_BY_NAME.get(name) ?? TagIcon
}
