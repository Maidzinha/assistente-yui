import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { startLicensing } from './license'
import { stopAllWorkers } from './voice/workers'

// Configurações e histórico ficam sempre em %APPDATA%\Assistente.
app.setName('Assistente')
if (process.platform === 'win32') app.setAppUserModelId('Assistente.Yui')
app.setPath('userData', join(app.getPath('appData'), 'Assistente'))

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)

function isAppOrigin(url: string): boolean {
  if (isDev) return url.startsWith(process.env.ELECTRON_RENDERER_URL!)
  return url.startsWith('file://')
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    show: false,
    title: 'Assistente Yui',
    backgroundColor: '#1a1218',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1218', symbolColor: '#f2dde6', height: 56 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Fora do instalador (aberto pelo Electron do projeto), ensina ao Windows como reabrir a Yui
  // quando a janela é fixada na barra de tarefas; sem isso o ícone fixado abriria só o Electron vazio.
  if (process.platform === 'win32' && !app.isPackaged) {
    const exe = process.execPath
    const appDir = app.getAppPath()
    win.setAppDetails({
      appId: 'Assistente.Yui',
      relaunchCommand: `"${exe}" "${appDir}"`,
      relaunchDisplayName: 'Yui',
      appIconPath: 'C:\\Program Files\\Assistente\\Assistente.exe',
      appIconIndex: 0
    })
  }

  // A interface nunca navega para fora nem abre janelas novas.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppOrigin(url)) e.preventDefault()
  })

  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

// Só uma Yui aberta por vez: abrir de novo apenas traz a janela atual para frente.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return
  // A licença é conferida antes de abrir a janela; sem ela, a interface mostra a tela de ativação.
  await startLicensing().catch(() => undefined)
  // Somente o microfone é liberado, e somente para a própria interface.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const media = details as { mediaTypes?: string[] }
    const audioOnly = permission === 'media' && (media.mediaTypes ?? []).every((t) => t === 'audio')
    callback(audioOnly && isAppOrigin(wc.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return permission === 'media' && !!wc && isAppOrigin(wc.getURL())
  })

  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => stopAllWorkers())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
