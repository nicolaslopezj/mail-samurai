import { app } from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'

const CHECK_INTERVAL_MS = 30 * 60 * 1000

let started = false

export function startAutoUpdater(): void {
  if (started) return
  started = true

  log.transports.file.level = 'info'
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  if (!app.isPackaged) {
    log.info('[auto-updater] dev mode — skipping')
    return
  }

  autoUpdater.on('error', (err) => log.error('[auto-updater]', err))
  autoUpdater.on('update-available', (info) =>
    log.info('[auto-updater] update available', info.version)
  )
  autoUpdater.on('update-not-available', () => log.info('[auto-updater] up to date'))
  autoUpdater.on('update-downloaded', (info) =>
    log.info('[auto-updater] downloaded', info.version, '— will install on quit')
  )

  autoUpdater.checkForUpdatesAndNotify().catch((err) => log.error('[auto-updater] check', err))

  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => log.error('[auto-updater] poll', err))
  }, CHECK_INTERVAL_MS)
}
