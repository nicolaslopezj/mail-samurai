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

| script              | purpose                                           |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Electron + Vite dev with HMR (for the human)      |
| `npm run lint`      | Biome check on `src` + `agent`                    |
| `npm run format`    | Biome format on `src` + `agent`                   |
| `npm run check`     | Biome with auto-fix + organize imports            |
| `npm run typecheck` | Node + web tsc projects                           |
| `npm run build`     | typecheck + `electron-vite build`                 |
| `npm run build:mac` | package unsigned `.dmg`                           |
| `npm run agent:serve` | build + launch persistent agent-controlled Electron |
| `npm run agent`     | run the agent CLI (`node agent/cli.mjs`)          |

## How Claude controls the app

The Electron window is a GUI. **Claude never runs `npm run dev`** — that's the human's window.

Claude uses the **agent control server** in `agent/`: one persistent Electron instance driven by single-shot CLI commands over localhost HTTP. Think Playwright MCP, minus MCP. State (the window, renderer DOM, main process) survives between commands, so the flow is conversational, not test-at-a-time.

### Starting the session

Run this **once** per session, in the background:

```bash
npm run agent:serve
# builds, launches Electron via Playwright, and listens on http://127.0.0.1:9555
# stdout prints "[agent] ready on http://127.0.0.1:9555"
```

Then wait for it to answer:

```bash
until node agent/cli.mjs status 2>/dev/null; do sleep 0.5; done
```

From then on every command is a sub-second HTTP call.

### Commands

```
node agent/cli.mjs <command> [args]

status                     running state + artifact paths
shot [name]                screenshot -> agent/.shots/<name>.png  (Read the PNG)
html                       full rendered HTML
text <selector>            innerText of first match
logs [n]                   last n lines of app.log (default 50)
click <selector>
fill <selector> <value...>
press <key> [selector]
wait <selector>            wait until visible
eval <js...>               run in renderer, returns the expression value
reload
quit                       shut the server down
```

Selectors are Playwright selectors: CSS, `text=foo`, `button:has-text('Save')`, `role=button[name="Save"]`, etc.

### The loop

1. Edit code.
2. Rebuild so the agent sees the new code:
   ```bash
   npx electron-vite build && node agent/cli.mjs reload
   ```
3. Drive it:
   ```bash
   node agent/cli.mjs click "button:has-text('Settings')"
   node agent/cli.mjs fill "input[name=email]" "me@example.com"
   node agent/cli.mjs shot after-fill
   ```
4. Observe via `shot`, `text`, `html`, `eval`, `logs`.
5. Iterate. `quit` when done.

### Quirks (verified against the live app)

- **DOM mutations persist** across commands until `reload`. Useful for poking, noisy for real testing — `reload` to reset.
- **Always pass scripts as `return …`-style one-liners** to `eval`; the server wraps them in `async () => { <your script> }`.
- **`eval` returns `null` when the script returns `undefined`** — the CLI drops it to nothing on stdout.
- **Screenshots are saved to `agent/.shots/<name>.png`** — the CLI prints the absolute path; `Read` it to see the UI.
- **Logs are empty until something logs.** The renderer won't log on its own unless the code calls `console.*`.
- **Second window?** The CLI targets `app.firstWindow()`. If a feature opens a second window, extend the server.
- **Code changes require `npx electron-vite build` + `reload`.** The server doesn't watch files.

### When to ask the human for `npm run dev` instead

- They want to click around themselves.
- They want DevTools open.
- Fast CSS/Tailwind iteration where HMR beats build + reload.

Never start or kill `npm run dev` yourself.

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
