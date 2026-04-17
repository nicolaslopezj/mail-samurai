import { THEME_DEFAULT, type ThemePreference } from '@shared/settings'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'mail-samurai:theme'

type Resolved = 'light' | 'dark'

type ThemeContextValue = {
  preference: ThemePreference
  resolved: Resolved
  setPreference: (next: ThemePreference) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function systemResolved(): Resolved {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolve(pref: ThemePreference): Resolved {
  return pref === 'system' ? systemResolved() : pref
}

function applyClass(resolved: Resolved): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

/**
 * Reads the cached preference synchronously so the very first paint matches
 * the user's setting — the authoritative value from the main process arrives
 * a tick later and we update if it differs.
 */
function initialPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    /* ignore — storage blocked */
  }
  return THEME_DEFAULT
}

// Apply the last-known theme before React paints so the first frame isn't
// a flash of the wrong colors.
applyClass(resolve(initialPreference()))

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference)
  const [resolved, setResolved] = useState<Resolved>(() => resolve(initialPreference()))

  useEffect(() => {
    applyClass(resolved)
  }, [resolved])

  useEffect(() => {
    setResolved(resolve(preference))
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
      /* ignore */
    }
    if (preference !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (): void => setResolved(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [preference])

  useEffect(() => {
    let cancelled = false
    window.api.settings.get().then((current) => {
      if (cancelled) return
      setPreferenceState((prev) => (prev === current.theme ? prev : current.theme))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setPreference = useCallback(async (next: ThemePreference): Promise<void> => {
    setPreferenceState(next)
    await window.api.settings.setTheme(next)
  }, [])

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
