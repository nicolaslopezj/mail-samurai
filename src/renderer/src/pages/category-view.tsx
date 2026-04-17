import type { Category } from '@shared/settings'
import { ListTodoIcon, TagIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

function EmptyView({
  title,
  icon,
  hint
}: {
  title: string
  icon: React.ReactNode
  hint: string
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
      </div>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-2 text-center">
          <div className="text-muted-foreground">{icon}</div>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
      </div>
    </div>
  )
}

export function TodoPage(): React.JSX.Element {
  return (
    <EmptyView
      title="To Do"
      icon={<ListTodoIcon className="size-8" />}
      hint="Messages you flag for follow-up will show up here. Nothing to do right now."
    />
  )
}

export function CategoryPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const [category, setCategory] = useState<Category | null | undefined>(undefined)

  useEffect(() => {
    if (!id) {
      setCategory(null)
      return
    }
    let cancelled = false
    window.api.settings.get().then((s) => {
      if (cancelled) return
      setCategory(s.categories.find((c) => c.id === id) ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (category === undefined) return <EmptyView title="Category" icon={null} hint="Loading…" />
  if (category === null) {
    return (
      <EmptyView
        title="Category"
        icon={<TagIcon className="size-8" />}
        hint="This category no longer exists. Pick another from the sidebar."
      />
    )
  }

  return (
    <EmptyView
      title={category.name}
      icon={<TagIcon className="size-8" />}
      hint="No messages matched this category yet. Sorting runs on the next sync."
    />
  )
}
