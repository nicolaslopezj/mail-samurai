# agent/ — interactive Electron control

A tiny HTTP-wrapped Electron session that Claude (or you) can drive with single CLI commands. Think Playwright MCP, minus the MCP.

## How it works

`agent/server.mjs` launches the built Electron app via Playwright, keeps the window alive, and exposes a localhost HTTP API. `agent/cli.mjs` is a thin client — it posts JSON and prints the response.

## Start

```bash
npm run agent:serve
# builds the renderer+main, launches Electron, prints:
#   [agent] ready on http://127.0.0.1:9555
```

Leave it running. When you're done:

```bash
node agent/cli.mjs quit
```

## Commands

```
node agent/cli.mjs <command> [args]

status                          running state + paths
shot [name]                     screenshot -> agent/.shots/<name>.png
html                            full rendered HTML
text <selector>                 innerText of first match
logs [n]                        last n lines of app.log (default 50)
click <selector>
fill <selector> <value...>
press <key> [selector]
wait <selector>                 wait until visible
eval <js...>                    run in renderer, returns expression value
reload
quit
```

Selectors are Playwright selectors (CSS, `text=…`, `:has-text(…)`, `role=…`, etc.).

## Artifacts

- `agent/.shots/` — screenshots
- `agent/.logs/app.log` — streamed main stdout/stderr + renderer console + page errors, timestamped

Both dirs are gitignored.

## Env

- `AGENT_PORT` — override the HTTP port (default `9555`)
