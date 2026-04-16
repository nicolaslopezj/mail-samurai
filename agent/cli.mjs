#!/usr/bin/env node
import { argv } from 'node:process'

const PORT = Number(process.env.AGENT_PORT || 9555)
const BASE = `http://127.0.0.1:${PORT}`

const USAGE = `usage: node agent/cli.mjs <command> [args]

start/stop:
  status                         show running state
  quit                           shut the server down

look:
  shot [name]                    screenshot -> agent/.shots/<name>.png
  html                           full rendered HTML
  text <selector>                innerText of the first match
  logs [n]                       last n lines of app.log (default 50)

interact:
  click <selector>
  fill <selector> <value...>
  press <key> [selector]
  wait <selector>                wait for it to be visible
  eval <js...>                   run JS in the renderer, returns the expression value
  reload

examples:
  node agent/cli.mjs shot initial
  node agent/cli.mjs click "button:has-text('Settings')"
  node agent/cli.mjs fill "input[name=email]" "me@example.com"
  node agent/cli.mjs eval "return document.title"
  node agent/cli.mjs logs 20
`

async function req(method, path, body) {
  let url = `${BASE}${path}`
  const opts = { method, headers: {} }
  if (body && method === 'GET') {
    const q = new URLSearchParams(body).toString()
    if (q) url += `?${q}`
  } else if (body) {
    opts.headers['content-type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  let r
  try {
    r = await fetch(url, opts)
  } catch (e) {
    const code = e.cause?.code || e.code
    if (code === 'ECONNREFUSED') {
      console.error('agent server not running. start with: npm run agent:serve')
      process.exit(2)
    }
    throw e
  }
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    console.error(text)
    process.exit(1)
  }
  if (!r.ok) {
    console.error('error:', json.error || text)
    process.exit(1)
  }
  return json
}

const print = (x) => {
  if (x === null || x === undefined) return
  if (typeof x === 'string') console.log(x)
  else console.log(JSON.stringify(x, null, 2))
}

const [, , cmd, ...args] = argv
if (!cmd || cmd === '-h' || cmd === '--help') {
  console.log(USAGE)
  process.exit(cmd ? 0 : 1)
}

switch (cmd) {
  case 'status':
    print(await req('GET', '/status'))
    break
  case 'shot': {
    const { path } = await req('POST', '/screenshot', { name: args[0] ?? 'shot' })
    print(path)
    break
  }
  case 'click':
    if (!args[0]) fatal('click needs a selector')
    await req('POST', '/click', { selector: args[0] })
    print('ok')
    break
  case 'fill':
    if (!args[0] || args.length < 2) fatal('fill needs <selector> <value>')
    await req('POST', '/fill', { selector: args[0], value: args.slice(1).join(' ') })
    print('ok')
    break
  case 'press':
    if (!args[0]) fatal('press needs a key')
    await req('POST', '/press', { key: args[0], selector: args[1] })
    print('ok')
    break
  case 'wait':
    if (!args[0]) fatal('wait needs a selector')
    await req('POST', '/wait', { selector: args[0] })
    print('ok')
    break
  case 'eval': {
    if (args.length === 0) fatal('eval needs a script')
    const { result } = await req('POST', '/eval', { script: args.join(' ') })
    print(result)
    break
  }
  case 'text': {
    if (!args[0]) fatal('text needs a selector')
    const { text } = await req('GET', '/text', { selector: args[0] })
    print(text)
    break
  }
  case 'html': {
    const { html } = await req('GET', '/html')
    print(html)
    break
  }
  case 'logs': {
    const { lines } = await req('GET', '/logs', args[0] ? { tail: args[0] } : {})
    for (const l of lines) console.log(l)
    break
  }
  case 'reload':
    await req('POST', '/reload')
    print('ok')
    break
  case 'quit':
    await req('POST', '/quit')
    print('bye')
    break
  default:
    fatal(`unknown command: ${cmd}\n\n${USAGE}`)
}

function fatal(msg) {
  console.error(msg)
  process.exit(1)
}
