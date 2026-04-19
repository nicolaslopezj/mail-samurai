import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, shell } from 'electron'
import icon from '../../resources/icon.png?asset'
import { list as listAccounts } from './accounts-store'
import { startAutoUpdater } from './auto-updater'
import { backfillFromMessages, isEmpty as contactsEmpty } from './contacts-store'
import { initDb } from './db'
import { registerIpcHandlers } from './ipc'
import { initLogger } from './logger'
import { initPendingArchive } from './pending-archive'
import { initSettings } from './settings-store'
import { startScheduler, stopScheduler } from './sync-scheduler'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

initLogger()

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.nicolaslopezj.mail-samurai')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDb()
  await initSettings()
  // One-shot: populate the derived contacts address book from existing
  // cached messages. Only runs on the first launch after shipping contacts
  // (or after a user wiped the DB). Subsequent writes come from imap-sync
  // and smtp-send hooks.
  if (contactsEmpty()) {
    try {
      const accounts = await listAccounts()
      const byEmail = new Map<string, { id: string; email: string }>()
      for (const a of accounts) byEmail.set(a.email.toLowerCase(), { id: a.id, email: a.email })
      const n = backfillFromMessages(byEmail)
      if (n > 0) console.log(`[contacts] backfilled ${n} sightings from cached messages`)
    } catch (err) {
      console.error('[contacts] backfill failed:', err)
    }
  }
  registerIpcHandlers()
  // Re-schedule any archive/unarchive batches that survived a restart.
  // Must run after the DB is open but before the first window loads so the
  // renderer's initial `listPendingBatches` call sees a warm state.
  initPendingArchive()
  startScheduler()
  startAutoUpdater()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopScheduler()
})
