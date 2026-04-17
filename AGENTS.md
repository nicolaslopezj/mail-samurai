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

## How Codex controls the app

The Electron window is a GUI. **Codex never runs `npm run dev`** — that's the human's window.

Codex uses the **agent control server** in `agent/`: one persistent Electron instance driven by single-shot CLI commands over localhost HTTP. Think Playwright MCP, minus MCP. State (the window, renderer DOM, main process) survives between commands, so the flow is conversational, not test-at-a-time.

### When to spin it up

Start the server the **first time** the user asks Codex to do anything involving the running app this session — clicking, looking at the UI, reproducing a bug, checking a log, filling a form, taking a screenshot. Don't start it pre-emptively for purely code-only tasks (editing, typechecking, reading the repo).

### Start-or-reuse protocol

**Always check first.** A previous tool call in the same session may have started it. Check before spawning a duplicate (the second one will fail on the port).

```bash
# 1. Is it already up?
node agent/cli.mjs status 2>/dev/null && echo "reuse" || echo "need-start"
```

If it's not up, launch in the background (this is the Bash tool's `run_in_background: true`), then poll until ready:

```bash
# 2. Start (as a background Bash call):
npm run agent:serve
# stdout will show "[agent] ready on http://127.0.0.1:9555"

# 3. Block until it answers (foreground):
until node agent/cli.mjs status 2>/dev/null; do sleep 0.5; done
```

The server dies with the Codex session. No manual cleanup needed between conversations — but do call `quit` if the user explicitly says they're done with the live app.

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

### Recipes (what to do when the user says…)

**"Show me the app" / "abrí la app"**
```bash
node agent/cli.mjs shot current      # then Read agent/.shots/current.png
```

**"Click on Settings"**
```bash
node agent/cli.mjs click "button:has-text('Settings')"
node agent/cli.mjs shot after-click  # verify visually
```
For ambiguous text, fall back to role (`role=button[name="Settings"]`) or a specific CSS selector. If the click fails with a timeout, first try `node agent/cli.mjs html | grep -i settings` to understand what's actually rendered.

**"Fill the email field with X"**
```bash
node agent/cli.mjs fill "input[type=email]" "user@example.com"
node agent/cli.mjs shot filled
```

**"I changed some code, see it in the app"**
```bash
npx electron-vite build && node agent/cli.mjs reload
node agent/cli.mjs shot after-change
```
The server doesn't watch files — no build + reload means the app keeps showing the previous build.

**"Why isn't X working / what's in the console"**
```bash
node agent/cli.mjs logs 100          # main stdout/stderr + renderer console + pageerrors
node agent/cli.mjs html | head -50   # DOM sanity check
node agent/cli.mjs eval "return { path: location.pathname, errors: window.__errors }"
```

**"Walk through the onboarding flow"**
Issue each step as a separate `click` / `fill` / `press` / `wait`, with a `shot` between steps so the user can watch progress in the chat.

**After driving the UI manually for debugging:** `node agent/cli.mjs reload` to wipe DOM mutations before reporting that a feature "works."

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
