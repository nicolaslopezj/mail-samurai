# Mail Samurai

An Electron desktop app that connects to multiple email accounts over IMAP, polls for new messages every 5 minutes, and categorizes them with AI.

> Status: **skeleton** — the shell is in place, features are not implemented yet.

## Stack

- **Electron** + **Vite** (`electron-vite`) + **React 19** + **TypeScript**
- **shadcn/ui** + **Tailwind CSS v4**
- **Biome** for lint + format
- **IMAP** (planned) — `imapflow` + `mailparser`
- **AI SDK** (planned) — [Vercel AI SDK](https://sdk.vercel.ai) with user-configurable provider (Anthropic / OpenAI / Google)

## Development

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run lint         # Biome check
npm run format       # Biome format
npm run typecheck    # tsc --noEmit
npm run build        # electron-vite build
npm run build:mac    # package .dmg
```

## License

MIT — see [LICENSE](./LICENSE).
