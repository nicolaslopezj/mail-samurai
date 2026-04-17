import {
  CATEGORY_ACTIONS,
  type Category,
  type CategoryAction,
  type CategoryActionKind,
  type UiSettings
} from '@shared/settings'
import { CheckIcon, Loader2Icon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ipcErrorMessage } from '@/lib/ipc-error'

function AutoTextarea(props: React.ComponentProps<typeof Textarea>): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [props.value])
  return <Textarea {...props} ref={ref} />
}

type SaveState = 'idle' | 'loading' | 'error'

type DraftCategory = Category

function newCategory(): DraftCategory {
  return {
    id: crypto.randomUUID(),
    name: '',
    instructions: '',
    action: { kind: 'none' }
  }
}

/**
 * Change the action's `kind` while keeping any parameter value already typed
 * for the param-bearing kinds. Lets the user flip between "Move to folder" and
 * "Run a command" without losing what they typed if they toggle back.
 */
function switchActionKind(current: CategoryAction, nextKind: CategoryActionKind): CategoryAction {
  const folder = current.kind === 'moveToFolder' ? current.folder : ''
  const command = current.kind === 'runCommand' ? current.command : ''
  switch (nextKind) {
    case 'moveToFolder':
      return { kind: 'moveToFolder', folder }
    case 'runCommand':
      return { kind: 'runCommand', command }
    default:
      return { kind: nextKind }
  }
}

function actionsEqual(a: CategoryAction, b: CategoryAction): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'moveToFolder' && b.kind === 'moveToFolder') return a.folder === b.folder
  if (a.kind === 'runCommand' && b.kind === 'runCommand') return a.command === b.command
  return true
}

function sameList(a: DraftCategory[], b: DraftCategory[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.instructions !== y.instructions ||
      !actionsEqual(x.action, y.action)
    ) {
      return false
    }
  }
  return true
}

function actionParamMissing(action: CategoryAction): boolean {
  if (action.kind === 'moveToFolder') return action.folder.trim().length === 0
  if (action.kind === 'runCommand') return action.command.trim().length === 0
  return false
}

function actionHint(kind: CategoryActionKind): string {
  return CATEGORY_ACTIONS.find((a) => a.value === kind)?.hint ?? ''
}

export function SettingsCategoriesPage(): React.JSX.Element {
  const [settings, setSettings] = useState<UiSettings | null>(null)
  const [drafts, setDrafts] = useState<DraftCategory[]>([])
  const [uncategorized, setUncategorized] = useState<CategoryAction>({ kind: 'none' })
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((current) => {
      setSettings(current)
      setDrafts(current.categories)
      setUncategorized(current.uncategorizedAction)
    })
  }, [])

  function updateDraft(id: string, patch: Partial<DraftCategory>): void {
    setDrafts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function setActionKind(id: string, kind: CategoryActionKind): void {
    setDrafts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, action: switchActionKind(c.action, kind) } : c))
    )
  }

  function setActionFolder(id: string, folder: string): void {
    setDrafts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, action: { kind: 'moveToFolder', folder } } : c))
    )
  }

  function setActionCommand(id: string, command: string): void {
    setDrafts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, action: { kind: 'runCommand', command } } : c))
    )
  }

  function addDraft(): void {
    setDrafts((prev) => [...prev, newCategory()])
  }

  function removeDraft(id: string): void {
    setDrafts((prev) => prev.filter((c) => c.id !== id))
  }

  const trimmed = useMemo<DraftCategory[]>(
    () =>
      drafts.map((c) => {
        const action: CategoryAction =
          c.action.kind === 'moveToFolder'
            ? { kind: 'moveToFolder', folder: c.action.folder.trim() }
            : c.action.kind === 'runCommand'
              ? { kind: 'runCommand', command: c.action.command.trim() }
              : c.action
        return {
          id: c.id,
          name: c.name.trim(),
          instructions: c.instructions.trim(),
          action
        }
      }),
    [drafts]
  )

  const trimmedUncategorized = useMemo<CategoryAction>(() => {
    if (uncategorized.kind === 'moveToFolder')
      return { kind: 'moveToFolder', folder: uncategorized.folder.trim() }
    if (uncategorized.kind === 'runCommand')
      return { kind: 'runCommand', command: uncategorized.command.trim() }
    return uncategorized
  }, [uncategorized])

  const hasEmptyName = trimmed.some((c) => c.name.length === 0)
  const hasMissingActionParam =
    trimmed.some((c) => actionParamMissing(c.action)) || actionParamMissing(trimmedUncategorized)
  const categoriesChanged = settings ? !sameList(trimmed, settings.categories) : false
  const uncategorizedChanged = settings
    ? !actionsEqual(trimmedUncategorized, settings.uncategorizedAction)
    : false
  const changed = categoriesChanged || uncategorizedChanged
  const canSave = changed && !hasEmptyName && !hasMissingActionParam

  async function handleSave(): Promise<void> {
    if (!canSave) return
    setSaveState('loading')
    setSaveError(null)
    try {
      const next = await window.api.settings.setCategories(trimmed, trimmedUncategorized)
      setSettings(next)
      setDrafts(next.categories)
      setUncategorized(next.uncategorizedAction)
      setSaveState('idle')
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch (err) {
      setSaveError(ipcErrorMessage(err))
      setSaveState('error')
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Categories</h2>
        <p className="text-sm text-muted-foreground">
          Mail Samurai sorts incoming messages into these buckets. Each category has a name and
          free-form instructions the AI uses to decide whether a message belongs in it.
        </p>
      </div>

      <div className="space-y-4">
        {drafts.length === 0 && (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No categories yet. Add one to get started.
          </p>
        )}

        {drafts.map((category, index) => (
          <div key={category.id} className="space-y-3 rounded-md border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor={`cat-name-${category.id}`}>Name</Label>
                <Input
                  id={`cat-name-${category.id}`}
                  placeholder="e.g. Receipts"
                  value={category.name}
                  onChange={(e) => updateDraft(category.id, { name: e.target.value })}
                  autoFocus={index === drafts.length - 1 && category.name === ''}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeDraft(category.id)}
                aria-label="Remove category"
                className="mt-7 text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`cat-instr-${category.id}`}>Instructions</Label>
              <AutoTextarea
                id={`cat-instr-${category.id}`}
                placeholder="Describe which messages belong in this category. The AI reads this to decide."
                value={category.instructions}
                onChange={(e) => updateDraft(category.id, { instructions: e.target.value })}
                rows={3}
                className="resize-none overflow-hidden"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`cat-action-${category.id}`}>When a message matches</Label>
              <Select
                value={category.action.kind}
                onValueChange={(v) => setActionKind(category.id, v as CategoryActionKind)}
              >
                <SelectTrigger id={`cat-action-${category.id}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{actionHint(category.action.kind)}</p>

              {category.action.kind === 'moveToFolder' && (
                <div className="space-y-1 pt-1">
                  <Label htmlFor={`cat-folder-${category.id}`} className="text-xs">
                    Folder name
                  </Label>
                  <Input
                    id={`cat-folder-${category.id}`}
                    placeholder="e.g. Receipts or Archive/2026"
                    value={category.action.folder}
                    onChange={(e) => setActionFolder(category.id, e.target.value)}
                  />
                </div>
              )}

              {category.action.kind === 'runCommand' && (
                <div className="space-y-1 pt-1">
                  <Label htmlFor={`cat-cmd-${category.id}`} className="text-xs">
                    Command
                  </Label>
                  <Input
                    id={`cat-cmd-${category.id}`}
                    placeholder="e.g. /usr/local/bin/notify {{subject}}"
                    value={category.action.command}
                    onChange={(e) => setActionCommand(category.id, e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" onClick={addDraft}>
          <PlusIcon />
          Add category
        </Button>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <div>
          <h3 className="text-sm font-semibold">When a message matches no category</h3>
          <p className="text-xs text-muted-foreground">
            Fallback action for incoming mail that doesn't fit any of the categories above.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uncategorized-action">Action</Label>
          <Select
            value={uncategorized.kind}
            onValueChange={(v) =>
              setUncategorized((prev) => switchActionKind(prev, v as CategoryActionKind))
            }
          >
            <SelectTrigger id="uncategorized-action" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_ACTIONS.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{actionHint(uncategorized.kind)}</p>

          {uncategorized.kind === 'moveToFolder' && (
            <div className="space-y-1 pt-1">
              <Label htmlFor="uncategorized-folder" className="text-xs">
                Folder name
              </Label>
              <Input
                id="uncategorized-folder"
                placeholder="e.g. Unsorted"
                value={uncategorized.folder}
                onChange={(e) => setUncategorized({ kind: 'moveToFolder', folder: e.target.value })}
              />
            </div>
          )}

          {uncategorized.kind === 'runCommand' && (
            <div className="space-y-1 pt-1">
              <Label htmlFor="uncategorized-cmd" className="text-xs">
                Command
              </Label>
              <Input
                id="uncategorized-cmd"
                placeholder="e.g. /usr/local/bin/notify {{subject}}"
                value={uncategorized.command}
                onChange={(e) => setUncategorized({ kind: 'runCommand', command: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={handleSave} disabled={!canSave || saveState === 'loading'}>
          {saveState === 'loading' && <Loader2Icon className="animate-spin" />}
          Save
        </Button>
        {hasEmptyName && (
          <span className="text-xs text-destructive">Each category needs a name.</span>
        )}
        {!hasEmptyName && hasMissingActionParam && (
          <span className="text-xs text-destructive">
            Fill in the folder or command for each action.
          </span>
        )}
        {savedFlash && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckIcon className="size-3.5" />
            Saved
          </span>
        )}
        {saveError && <span className="text-xs text-destructive">{saveError}</span>}
      </div>
    </section>
  )
}
