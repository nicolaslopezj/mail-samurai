import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/settings'

const CHECK_INTERVAL_MS = 30 * 60 * 1000

let started = false
let state: UpdateState = { status: 'idle' }

function setState(next: UpdateState): void {
  state = next
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('app:updateState', state)
  }
}

export function getUpdateState(): UpdateState {
  return state
}

export async function checkForUpdatesManually(): Promise<UpdateState> {
  if (!app.isPackaged) {
    setState({ status: 'dev', message: 'Updates are only available in packaged builds.' })
    return state
  }
  try {
    setState({ status: 'checking' })
    await autoUpdater.checkForUpdates()
  } catch (err) {
    log.error('[auto-updater] manual check failed', err)
    setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  return state
}

export function startAutoUpdater(): void {
  if (started) return
  started = true

  log.transports.file.level = 'info'
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  if (!app.isPackaged) {
    log.info('[auto-updater] dev mode — skipping')
    setState({ status: 'dev', message: 'Updates are only available in packaged builds.' })
    return
  }

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }))
  autoUpdater.on('error', (err) => {
    log.error('[auto-updater]', err)
    setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
  })
  autoUpdater.on('update-available', (info) => {
    log.info('[auto-updater] update available', info.version)
    setState({ status: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', (info) => {
    log.info('[auto-updater] up to date')
    setState({ status: 'not-available', version: info?.version })
  })
  autoUpdater.on('download-progress', (progress) => {
    setState({
      status: 'downloading',
      progress: typeof progress?.percent === 'number' ? progress.percent / 100 : undefined
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[auto-updater] downloaded', info.version, '— will install on quit')
    setState({ status: 'downloaded', version: info.version })
  })

  autoUpdater.checkForUpdatesAndNotify().catch((err) => log.error('[auto-updater] check', err))

  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => log.error('[auto-updater] poll', err))
  }, CHECK_INTERVAL_MS)
}
