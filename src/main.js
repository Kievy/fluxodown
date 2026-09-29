const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { YtDlp, validateUrl } = require('./core');

let window, engine, inspected, busy = false, lastFile, folder;
const entry = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== entry) return { ok: false, error: 'Origem inválida.' };
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
async function operation(fn) {
  if (busy) throw new Error('Aguarde a operação atual terminar.');
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    folder = path.join(app.getPath('downloads'), 'Fluxo');
    try { const settings = JSON.parse(await fs.readFile(settingsFile(), 'utf8')); if (typeof settings.folder === 'string' && path.isAbsolute(settings.folder)) folder = settings.folder; } catch {}
    engine = new YtDlp(path.join(__dirname, '..', 'bin'), event => {
      if (window && !window.isDestroyed()) window.webContents.send('download:event', event);
    });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window = new BrowserWindow({
      width: 1060, height: 870, minWidth: 760, minHeight: 740,
      backgroundColor: '#0c1017', title: 'Fluxo — Video Downloader', autoHideMenuBar: true,
      show: !process.argv.includes('--smoke-hide'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    handle('app:init', () => { engine.check(); return { folder }; });
    handle('video:inspect', url => operation(async () => {
      inspected = null;
      const normalized = validateUrl(url);
      const info = await engine.inspect(normalized);
      inspected = { url: normalized, info };
      return info;
    }));
    handle('folder:choose', async () => {
      if (busy) throw new Error('Aguarde a operação atual terminar.');
      const result = await dialog.showOpenDialog(window, { defaultPath: folder, properties: ['openDirectory', 'createDirectory'] });
      if (!result.canceled) {
        folder = result.filePaths[0];
        await fs.writeFile(settingsFile(), JSON.stringify({ folder }));
      }
      return folder;
    });
    handle('download:start', options => operation(async () => {
      if (!inspected || validateUrl(options.url) !== inspected.url) throw new Error('Consulte o vídeo antes de baixar.');
      lastFile = null;
      await fs.mkdir(folder, { recursive: true });
      lastFile = await engine.download({ url: inspected.url, format: options.format, quality: options.quality, directory: folder }, inspected.info);
      return { file: lastFile, name: path.basename(lastFile) };
    }));
    handle('download:cancel', () => engine.cancel());
    handle('folder:open', async () => {
      if (lastFile) shell.showItemInFolder(lastFile);
      else { await fs.mkdir(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error(error); }
    });
    window.on('close', event => {
      if (!busy) return;
      const answer = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['Continuar baixando', 'Cancelar e sair'], defaultId: 0, cancelId: 0, title: 'Operação em andamento', message: 'Há uma operação em andamento. Deseja cancelar e sair?' });
      if (answer === 0) event.preventDefault(); else engine.cancel();
    });
    await window.loadFile(path.join(__dirname, 'ui', 'index.html'));
  }).catch(error => { dialog.showErrorBox('Falha ao abrir o Fluxo', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
