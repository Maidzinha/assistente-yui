import { app, BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { getSettings, saveSettings } from './config/store'

/**
 * Modelo 3D da Yui (.vrm, feito por exemplo no VRoid Studio). O arquivo escolhido é copiado
 * para a pasta do app, para continuar funcionando mesmo se o original for movido.
 */
const avatarFile = () => join(app.getPath('userData'), 'yui.vrm')
const MAX_BYTES = 150 * 1024 * 1024

/** Abre a janela para escolher o .vrm. Devolve o nome do modelo ou null se cancelar. */
export async function pickAvatar(win: BrowserWindow | null): Promise<string | null> {
  const opts = {
    title: 'Escolha o modelo 3D da Yui',
    filters: [{ name: 'Modelo VRM', extensions: ['vrm'] }],
    properties: ['openFile' as const]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  const src = res.filePaths[0]
  const stat = await fs.stat(src)
  if (stat.size > MAX_BYTES) throw new Error('O modelo é grande demais (mais de 150 MB).')
  // Confere a assinatura glTF binário ("glTF") para não aceitar arquivos trocados.
  const head = Buffer.alloc(4)
  const fh = await fs.open(src, 'r')
  try { await fh.read(head, 0, 4, 0) } finally { await fh.close() }
  if (head.toString('ascii') !== 'glTF') throw new Error('Esse arquivo não parece um modelo VRM válido.')
  await fs.copyFile(src, avatarFile())
  const name = basename(src).replace(/\.vrm$/i, '')
  const s = await getSettings()
  await saveSettings({ ...s, avatar: { ...s.avatar, vrmName: name, mode: '3d' } })
  return name
}

/** Bytes do modelo importado, ou null se ainda não houver. */
export async function loadAvatar(): Promise<ArrayBuffer | null> {
  try {
    const buf = await fs.readFile(avatarFile())
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    return null
  }
}

export async function removeAvatar(): Promise<void> {
  await fs.rm(avatarFile(), { force: true })
  const s = await getSettings()
  await saveSettings({ ...s, avatar: { ...s.avatar, vrmName: '' } })
}
