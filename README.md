# Mail Samurai

An open-source macOS email client that connects to any IMAP account and uses AI to categorize every message the moment it arrives.

**[mail-samurai.com](https://mail-samurai.com)** · **[Download for macOS](https://github.com/nicolaslopezj/mail-samurai/releases/latest)**

## Highlights

- **AI categorization** — describe each category in plain English, an LLM tags every incoming message
- **Any IMAP account** — Gmail, iCloud, Fastmail, self-hosted; no OAuth apps, no API quotas
- **Bring your own model** — Anthropic, OpenAI or Google; paste an API key, swap anytime
- **Local-first** — messages and credentials live in a local SQLite database; API keys are encrypted with the OS keychain

## Stack

Electron + `electron-vite` + React 19 + TypeScript · shadcn/ui + Tailwind v4 · Biome · `imapflow` + `mailparser` · Vercel AI SDK.

## Development

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run lint         # Biome check
npm run typecheck    # tsc --noEmit
npm run build        # electron-vite build
npm run build:mac    # package .dmg
```

## License

MIT — see [LICENSE](./LICENSE).
