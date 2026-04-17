import {
  type Account,
  type AccountDraft,
  IMAP_PRESETS,
  IMAP_PROVIDERS,
  type ImapProvider
} from '@shared/settings'
import { ExternalLinkIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ipcErrorMessage } from '@/lib/ipc-error'

type Props = {
  trigger: React.ReactNode
  onAdded: (account: Account) => void
}

export function AddAccountDialog({ trigger, onAdded }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<ImapProvider>('gmail')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setProvider('gmail')
      setEmail('')
      setPassword('')
      setHost('')
      setPort('993')
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  const providerMeta = useMemo(() => IMAP_PROVIDERS.find((p) => p.value === provider), [provider])
  const isCustom = provider === 'custom'
  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    (!isCustom || (host.trim().length > 0 && /^\d+$/.test(port)))

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const draft: AccountDraft = {
      provider,
      email: email.trim(),
      password,
      host: isCustom ? host.trim() : undefined,
      port: isCustom ? Number(port) : undefined
    }
    try {
      const account = await window.api.accounts.add(draft)
      onAdded(account)
      setOpen(false)
    } catch (err) {
      setError(ipcErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Add email account</DialogTitle>
            <DialogDescription>
              Mail Samurai uses IMAP with an app-specific password. Your Google or Apple account
              password won&apos;t work here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="account-provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as ImapProvider)}
              disabled={submitting}
            >
              <SelectTrigger id="account-provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAP_PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {providerMeta?.helpText && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {providerMeta.helpText}
              {providerMeta.helpUrl && (
                <>
                  {' '}
                  <a
                    href={providerMeta.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2"
                  >
                    Open settings
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="account-email">Email address</Label>
            <Input
              id="account-email"
              type="email"
              autoComplete="off"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account-password">App password</Label>
            <Input
              id="account-password"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste the app-specific password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
            />
          </div>

          {isCustom && (
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <div className="space-y-2">
                <Label htmlFor="account-host">IMAP host</Label>
                <Input
                  id="account-host"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="imap.example.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-port">Port</Label>
                <Input
                  id="account-port"
                  inputMode="numeric"
                  pattern="\d*"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          )}

          {!isCustom && (
            <p className="text-xs text-muted-foreground">
              Connects to{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                {IMAP_PRESETS[provider].host}:{IMAP_PRESETS[provider].port}
              </code>
            </p>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting && <Loader2Icon className="animate-spin" />}
              {submitting ? 'Testing connection…' : 'Add account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
