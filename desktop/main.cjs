const { app, BrowserWindow, Menu, protocol, net, session, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}
protocol.registerSchemesAsPrivileged([{ scheme: 'blackroot', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true
} }]);
app.setName('BLACKROOT');
app.setAppUserModelId('com.blackroot.game');
const gotLock = smokeTest || app.requestSingleInstanceLock();
let window;

if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.whenReady().then(async () => {
    const gameFile = path.join(app.getAppPath(), 'docs', 'index.html');
    protocol.handle('blackroot', request => {
      const url = new URL(request.url);
      if (url.hostname !== 'game' || !['/', '/index.html'].includes(url.pathname)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(gameFile).toString());
    });
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const trusted = webContents.getURL().startsWith('blackroot://game/');
      callback(trusted && ['pointerLock', 'fullscreen'].includes(permission));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      return Boolean(webContents?.getURL().startsWith('blackroot://game/') && ['pointerLock', 'fullscreen'].includes(permission));
    });
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      title: 'BLACKROOT — Nightfall in the Hollow',
      width: 1280, height: 800, minWidth: 800, minHeight: 600,
      backgroundColor: '#090c0e', show: false,
      icon: path.join(app.getAppPath(), 'assets', 'icon', 'icon-256.png'),
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== 'blackroot://game/index.html') event.preventDefault();
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        event.preventDefault(); window.setFullScreen(!window.isFullScreen());
      }
      if (input.type === 'keyDown' && (input.control || input.meta) && ['r', 'R'].includes(input.key)) event.preventDefault();
    });
    window.once('ready-to-show', () => { window.show(); if (!smokeTest) window.maximize(); });
    await window.loadURL('blackroot://game/index.html');
    if (smokeTest) await require('./smoke.cjs').run(window, app);
  }).catch(error => {
    if (!smokeTest) dialog.showErrorBox('BLACKROOT could not start', error.message);
    console.error(error); app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
}
