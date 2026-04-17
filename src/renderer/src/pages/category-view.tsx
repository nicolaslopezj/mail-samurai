import { ListTodoIcon } from 'lucide-react'

export function TodoPage(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="truncate text-sm font-semibold">To Do</h2>
      </div>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-2 text-center">
          <div className="text-muted-foreground">
            <ListTodoIcon className="size-8" />
          </div>
          <p className="text-sm text-muted-foreground">
            Messages you flag for follow-up will show up here. Nothing to do right now.
          </p>
        </div>
      </div>
    </div>
  )
}
