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

The Electron window is a GUI that belongs to the human developer. Claude does **not** run `npm run dev` — that would leave a window open for the user to dismiss and tie up a background process.

Instead, Claude drives the app through Playwright's Electron integration, which launches a fresh instance per test, drives it programmatically, captures screenshots/logs, and exits.

### The loop

1. Edit code.
2. Run `npm run test:e2e` (or a single spec: `npx playwright test e2e/smoke.spec.ts`).
3. Read Playwright's stdout for failures, and inspect screenshots under `e2e/.artifacts/screenshots/`.
4. Iterate.

### Writing a one-off exploration test

When Claude needs to "see" a new screen or reproduce a bug, add a temporary spec under `e2e/` and use the `launchApp()` helper:

```ts
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('explore settings view', async () => {
  const { app, window, screenshot } = await launchApp()
  try {
    await window.getByRole('button', { name: 'Settings' }).click()
    await screenshot('settings')        // → e2e/.artifacts/screenshots/settings.png
    // Read the PNG with the Read tool to actually "see" the UI state.
  } finally {
    await app.close()
  }
})
```

Delete the exploration spec when done — it's scratch work, not a permanent test.

### Reading logs

Playwright captures main-process stdout/stderr automatically — they print inline with test output. For renderer console logs:

```ts
window.on('console', (msg) => console.log('[renderer]', msg.type(), msg.text()))
```

### When to ask the human to run `npm run dev`

- When the user wants to manually try a feature.
- When HMR-driven feedback is faster than the build-then-test cycle.
- Claude should not start or kill that process.

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
