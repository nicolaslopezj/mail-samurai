/**
 * Minimal HTTP client for Turso / libSQL. We don't pull in `@libsql/client`
 * because the HTTP "pipeline" endpoint is trivial to hit with `fetch` and
 * the SDK would add WebSocket + worker code we don't need.
 *
 * Protocol (v2 pipeline):
 *   POST ${databaseUrl}/v2/pipeline
 *   Authorization: Bearer ${authToken}
 *   Body: { requests: [ {type:'execute',stmt:{sql,args}}, ..., {type:'close'} ] }
 *
 * Response:
 *   {
 *     results: [
 *       { type: 'ok', response: { type: 'execute', result: { cols, rows, ... } } },
 *       ...
 *       { type: 'ok', response: { type: 'close' } }
 *     ]
 *   }
 *
 * Rows come back as arrays of typed cells (`{type:'integer',value:'42'}` etc.)
 * so we flatten them into plain JS objects keyed by column name.
 */

export type LibsqlCredentials = {
  /** e.g. `https://my-db-user.turso.io` — the Turso console shows this as "URL". */
  databaseUrl: string
  /** Bearer token issued alongside the database. */
  authToken: string
}

export type LibsqlStatement = {
  sql: string
  params?: unknown[]
}

type LibsqlValue =
  | { type: 'null' }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: number }
  | { type: 'text'; value: string }
  | { type: 'blob'; base64: string }

type ExecuteResult = {
  cols: { name: string; decltype?: string | null }[]
  rows: LibsqlValue[][]
  affected_row_count: number
  last_insert_rowid: string | null
}

type PipelineResponse = {
  results: (
    | { type: 'ok'; response: { type: 'execute'; result: ExecuteResult } | { type: 'close' } }
    | { type: 'error'; error: { message: string; code?: string } }
  )[]
}

/** Plain JS row as the caller sees it — one entry per column. */
type Row = Record<string, unknown>

export type LibsqlQueryResult<R = Row> = {
  rows: R[]
  affected: number
  lastInsertRowid: number | null
}

/**
 * The Turso dashboard surfaces URLs with a `libsql://` scheme — that scheme
 * is only understood by the native driver. For our plain-`fetch` HTTP
 * pipeline we need `https://`. Swap the scheme (and drop any trailing `/`)
 * so either form the user pasted works.
 */
function endpoint(creds: LibsqlCredentials): string {
  let base = creds.databaseUrl.trim().replace(/\/$/, '')
  if (base.startsWith('libsql://')) base = `https://${base.slice('libsql://'.length)}`
  else if (!/^https?:\/\//i.test(base)) base = `https://${base}`
  return `${base}/v2/pipeline`
}

function toValue(input: unknown): LibsqlValue {
  if (input === null || input === undefined) return { type: 'null' }
  if (typeof input === 'number') {
    if (Number.isInteger(input)) return { type: 'integer', value: String(input) }
    return { type: 'float', value: input }
  }
  if (typeof input === 'bigint') return { type: 'integer', value: input.toString() }
  if (typeof input === 'boolean') return { type: 'integer', value: input ? '1' : '0' }
  if (typeof input === 'string') return { type: 'text', value: input }
  if (input instanceof Uint8Array) {
    return { type: 'blob', base64: Buffer.from(input).toString('base64') }
  }
  // Fallback: serialize anything else as JSON text so callers can't trip us
  // up with structured values they probably didn't mean to send raw.
  return { type: 'text', value: JSON.stringify(input) }
}

function fromValue(cell: LibsqlValue): unknown {
  switch (cell.type) {
    case 'null':
      return null
    case 'integer':
      return Number(cell.value)
    case 'float':
      return cell.value
    case 'text':
      return cell.value
    case 'blob':
      return Buffer.from(cell.base64, 'base64')
  }
}

function rowsToObjects(result: ExecuteResult): Row[] {
  const names = result.cols.map((c) => c.name)
  return result.rows.map((cells) => {
    const obj: Row = {}
    for (let i = 0; i < names.length; i++) {
      obj[names[i]] = fromValue(cells[i])
    }
    return obj
  })
}

/**
 * Run one or more statements in a single HTTPS round-trip. Returns one result
 * per statement, in order. Throws on HTTP failure or any per-statement error.
 */
export async function libsqlQuery<R = Row>(
  creds: LibsqlCredentials,
  statements: LibsqlStatement | LibsqlStatement[]
): Promise<LibsqlQueryResult<R>[]> {
  const list = Array.isArray(statements) ? statements : [statements]
  if (list.length === 0) return []

  const requests = list.map((s) => ({
    type: 'execute' as const,
    stmt: {
      sql: s.sql,
      args: (s.params ?? []).map(toValue)
    }
  }))
  requests.push({ type: 'close' } as unknown as (typeof requests)[number])

  const response = await fetch(endpoint(creds), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ requests })
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `libsql request failed (${response.status} ${response.statusText}): ${text.slice(0, 200)}`
    )
  }

  let payload: PipelineResponse
  try {
    payload = JSON.parse(text) as PipelineResponse
  } catch {
    throw new Error(`libsql non-JSON response: ${text.slice(0, 200)}`)
  }

  const out: LibsqlQueryResult<R>[] = []
  // Skip the trailing `close` result.
  const executeResults = payload.results.slice(0, list.length)
  for (const entry of executeResults) {
    if (entry.type === 'error') {
      throw new Error(`libsql statement error: ${entry.error.message}`)
    }
    if (entry.response.type !== 'execute') continue
    const exec = entry.response.result
    out.push({
      rows: rowsToObjects(exec) as R[],
      affected: exec.affected_row_count,
      lastInsertRowid: exec.last_insert_rowid !== null ? Number(exec.last_insert_rowid) : null
    })
  }
  return out
}

/** Convenience: single-statement query returning just the rows. */
export async function libsqlRows<R = Row>(
  creds: LibsqlCredentials,
  sql: string,
  params: unknown[] = []
): Promise<R[]> {
  const [result] = await libsqlQuery<R>(creds, { sql, params })
  return result?.rows ?? []
}

/** `SELECT 1` — used by the Settings "Test connection" button. */
export async function libsqlPing(creds: LibsqlCredentials): Promise<void> {
  const [result] = await libsqlQuery<{ one: number }>(creds, { sql: 'SELECT 1 AS one' })
  if (!result || result.rows.length !== 1 || result.rows[0].one !== 1) {
    throw new Error('libsql ping did not return the expected row.')
  }
}
