import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import log from 'electron-log/main'

let initialized = false

export function initLogger(): void {
  if (initialized) return
  initialized = true

  log.initialize()
  log.transports.file.level = 'info'
  log.transports.console.level = 'silly'
  // Rotate at 5 MB → electron-log moves the current file to `main.old.log`.
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

  // Redirect existing `console.*` calls so modules that log via plain console
  // still land in the file.
  Object.assign(console, log.functions)

  log.errorHandler.startCatching({ showDialog: false })
}

export function getLogFilePath(): string {
  return log.transports.file.getFile().path
}

/**
 * Return the contents of the current + rotated log files, newest first. Returns
 * an empty string when no log file exists yet.
 */
export async function readLogFiles(): Promise<string> {
  const current = getLogFilePath()
  const parts: string[] = []
  try {
    parts.push(`===== ${current} =====\n${await readFile(current, 'utf8')}`)
  } catch {
    // File may not exist yet if nothing has been logged.
  }
  const oldPath = join(dirname(current), 'main.old.log')
  if (existsSync(oldPath)) {
    try {
      parts.unshift(`===== ${oldPath} =====\n${await readFile(oldPath, 'utf8')}`)
    } catch {
      // ignore
    }
  }
  return parts.join('\n\n')
}
