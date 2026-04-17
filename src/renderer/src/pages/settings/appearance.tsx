import { THEME_PREFERENCES, type ThemePreference } from '@shared/settings'
import { CheckIcon } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

export function SettingsAppearancePage(): React.JSX.Element {
  const { preference, resolved, setPreference } = useTheme()

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Choose a color scheme. Automatic follows your macOS appearance — currently{' '}
          <strong>{resolved === 'dark' ? 'dark' : 'light'}</strong>.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">Theme</legend>
        {THEME_PREFERENCES.map((option) => {
          const isActive = option.value === preference
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                isActive ? 'border-primary bg-accent/40' : 'hover:bg-accent/30'
              )}
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={isActive}
                onChange={() => setPreference(option.value as ThemePreference)}
                className="sr-only"
              />
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                  isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                )}
                aria-hidden
              >
                {isActive && <CheckIcon className="size-3" />}
              </span>
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          )
        })}
      </fieldset>
    </section>
  )
}
