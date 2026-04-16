# Mail Samurai — Agent Guide

Electron desktop app (macOS-first) that connects to multiple email accounts over **IMAP**, polls every 5 minutes, and categorizes messages with **AI**. Open source under MIT.

## Stack

- **Shell:** Electron + `electron-vite` + React 19 + TypeScript
- **UI:** shadcn/ui (New York) + Tailwind CSS v4 + lucide-react icons
- **Tooling:** Biome 2.x (lint + format) — no ESLint, no Prettier
- **Email:** IMAP via `imapflow` + `mailparser` (planned — not yet installed)
- **AI:** Vercel AI SDK (`ai`) with user-configurable provider (Anthropic / OpenAI / Google). **Do not hardcode a single vendor.** (planned)
- **Storage:** `better-sqlite3` in `app.getPath('userData')` (planned)
- **Secrets:** Electron `safeStorage` (planned — **never** store credentials in plain text)

## Project layout

```
src/
  main/        # Electron main process (Node)
  preload/     # Context-bridge — typed API surface exposed to renderer
  renderer/    # React app (Vite)
    src/
      assets/  # main.css + base.css (Tailwind v4 + shadcn tokens)
      components/ui/   # shadcn-generated components (do not edit by hand — use `npx shadcn@latest add`)
      lib/utils.ts     # `cn()` helper
electron.vite.config.ts
electron-builder.yml
biome.json
components.json        # shadcn config
```

Import aliases (configured in `tsconfig.web.json` + `electron.vite.config.ts`):

- `@/*` and `@renderer/*` → `src/renderer/src/*`

## Conventions

- **Never** introduce ESLint or Prettier. Lint/format runs through Biome only.
- **Never** add OAuth/Google-Cloud-app-based integrations for this project. Use IMAP with app-specific passwords.
- **Never** hardcode an AI provider. Provider + model + API key are user-configurable via Settings.
- Credentials and API keys must be encrypted via `safeStorage` before being persisted.
- Renderer must not import Node/Electron APIs directly. Go through the preload `api` bridge.
- Native deps (`better-sqlite3`, etc.) must be externalized via `externalizeDepsPlugin()` in `electron.vite.config.ts` (already set up) and rebuilt for Electron via the `postinstall` script.
- Poll interval default is **5 minutes**; keep it configurable.

## Scripts

| script                   | purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `npm run dev`            | Electron + Vite dev with HMR (for the human)     |
| `npm run lint`           | Biome check on `src` + `e2e`                     |
| `npm run format`         | Biome format on `src` + `e2e`                    |
| `npm run check`          | Biome with auto-fix + organize imports           |
| `npm run typecheck`      | Node + web + e2e tsc projects                    |
| `npm run build`          | typecheck + `electron-vite build`                |
| `npm run build:mac`      | package unsigned `.dmg`                          |
| `npm run test:e2e`       | build, then Playwright (Electron) headless       |
| `npm run test:e2e:headed`| same, but with a visible window                  |

## How Claude controls the app

The Electron window is a GUI that belongs to the human. **Claude never runs `npm run dev`** — that would leave a window open the user has to dismiss.

Claude drives the app through Playwright's Electron integration: each run builds the app, launches a fresh headless instance, executes a spec, captures screenshots and logs, and exits. A full round trip is ~1–2 seconds on this machine.

### The agent loop

1. Edit code.
2. Run a spec:
   ```bash
   # Fast iteration on a single spec (builds first, then runs only that file):
   npx electron-vite build && npx playwright test e2e/<spec>.spec.ts
   # Or the full suite:
   npm run test:e2e
   ```
3. Observe:
   - **Playwright stdout** (from `Bash` tool output) — test pass/fail + anything the spec `console.log`'d.
   - **Screenshot PNGs** at `e2e/.artifacts/screenshots/<name>.png` — `Read` them to actually see the UI.
   - **Combined log file** at `e2e/.artifacts/logs/<label>.log` — `Read` to see main stdout/stderr + renderer console + page errors, timestamped.
4. Iterate.

Never `npm run build` just to iterate — `npx electron-vite build` skips the tsc pass and is enough since Playwright + the next test:e2e run will catch issues. Run `npm run typecheck` at the end of a change set.

### Writing an exploration spec

When you need to "see" a screen or reproduce a bug, drop a scratch spec under `e2e/` using `launchApp(label)`. The label controls the log filename so the artifacts are easy to find.

```ts
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('explore settings view', async () => {
  const { app, window, screenshot, logPath } = await launchApp('settings-explore')
  try {
    // Drive the UI
    await window.getByRole('button', { name: 'Settings' }).click()

    // Assert what should be there
    await expect(window.getByText('AI provider')).toBeVisible()

    // Save a screenshot — read the PNG afterwards to see the result
    await screenshot('settings')

    // Dump DOM text to stdout if you want it in Playwright's output
    console.log('body:', await window.locator('body').innerText())

    // logPath is e2e/.artifacts/logs/settings-explore.log — main + renderer logs
    console.log('logs at', logPath)
  } finally {
    await app.close()
  }
})
```

**Delete the exploration spec when done.** Permanent regression tests belong alongside `smoke.spec.ts` with stable names; scratch specs don't.

### What the helper gives you

`launchApp(label?)` returns:

| field        | what it is                                                                         |
| ------------ | ---------------------------------------------------------------------------------- |
| `app`        | `ElectronApplication` — `app.close()` at the end (always in a `finally`).          |
| `window`     | Playwright `Page` for the main window — use `getByRole`, `locator`, `evaluate`, … |
| `screenshot` | `(name) => Promise<string>` — writes `e2e/.artifacts/screenshots/<name>.png`.      |
| `logPath`    | Absolute path to the captured log file for this session.                           |

The helper automatically streams into `logPath`:
- `app.process().stdout` / `stderr` prefixed `[main stdout]` / `[main stderr]`
- `window.on('console')` prefixed `[renderer <type>]`
- `window.on('pageerror')` prefixed `[renderer error]`

### Quirks (observed, not theoretical)

- **`window.viewportSize()` returns `null`** for Electron windows. If you need content dimensions, use `await window.evaluate(() => ({ w: innerWidth, h: innerHeight }))`.
- **Main-process `console.log` shows up in `[main stdout]`** in the log file, not in Playwright's test stdout. Read the log file to see it.
- **One window per launch.** If your feature opens a second `BrowserWindow`, wait for it with `app.waitForEvent('window')` rather than `firstWindow()`.
- **Screenshots are DOMContentLoaded-timed.** If you need a post-render capture (async data, fonts), `await expect(...).toBeVisible()` on the new content before calling `screenshot()`.
- **`app.close()` must be in a `finally`** — a thrown assertion leaves Electron running otherwise, and subsequent runs fail with a port-in-use-style error.

### When to ask the human for `npm run dev` instead

- The user wants to click around manually.
- You're iterating on fast-changing CSS/Tailwind where HMR is faster than the ~1s build loop.
- You explicitly need DevTools open.

In those cases, ask them to run it; do not start or kill it yourself.

## Adding shadcn components

```bash
npx shadcn@latest add button dialog input
```

Generated files land in `src/renderer/src/components/ui/`.

## What to do / not do

- Do prefer editing existing files over creating new ones.
- Do keep the main process thin: IPC handlers + orchestration. Business logic lives in focused modules under `src/main/`.
- Do not write documentation files (`*.md`) unless asked.
- Do not add features, abstractions, or error handling beyond what a task requires.
