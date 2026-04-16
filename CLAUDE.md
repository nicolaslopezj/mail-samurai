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

| script              | purpose                                  |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Electron + Vite dev with HMR             |
| `npm run lint`      | `biome check src`                        |
| `npm run format`    | `biome format --write src`               |
| `npm run check`     | Biome with auto-fix + organize imports   |
| `npm run typecheck` | Node + web tsc projects                  |
| `npm run build`     | typecheck + `electron-vite build`        |
| `npm run build:mac` | package unsigned `.dmg`                  |

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
