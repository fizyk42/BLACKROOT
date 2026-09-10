const { app, BrowserWindow, Menu, session, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

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
    // The production build is a single self-contained HTML file. Loading it
    // directly avoids the custom-protocol failure that could leave the
    // downloaded Windows build on a permanent black screen at startup.
    const gameFile = path.join(app.getAppPath(), 'docs', 'index.html');
    const gameUrl = pathToFileURL(gameFile).toString();

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const trusted = webContents.getURL().startsWith('file://');
      callback(trusted && ['pointerLock', 'fullscreen'].includes(permission));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      return Boolean(webContents?.getURL().startsWith('file://') && ['pointerLock', 'fullscreen'].includes(permission));
    });

    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      title: 'BLACKROOT — Nightfall in the Hollow',
      width: 1280, height: 800, minWidth: 800, minHeight: 600,
      backgroundColor: '#090c0e', show: false,
      icon: path.join(app.getAppPath(), 'assets', 'icon', 'icon-256.png'),
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      }
    });

    // Always surface renderer failures instead of leaving a silent black window.
    window.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
      const message = `Game page failed to load (${code}): ${description}\n${validatedURL || gameUrl}`;
      console.error(message);
      if (!smokeTest) dialog.showErrorBox('BLACKROOT could not start', message);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      const message = `Renderer stopped: ${details.reason || 'unknown error'}`;
      console.error(message, details);
      if (!smokeTest) dialog.showErrorBox('BLACKROOT renderer stopped', message);
    });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== gameUrl) event.preventDefault();
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        event.preventDefault();
        window.setFullScreen(!window.isFullScreen());
      }
      if (input.type === 'keyDown' && (input.control || input.meta) && ['r', 'R'].includes(input.key)) {
        event.preventDefault();
      }
    });

    window.once('ready-to-show', () => {
      window.show();
      if (!smokeTest) window.maximize();
    });

    await window.loadFile(gameFile);
    if (smokeTest) await require('./smoke.cjs').run(window, app);
  }).catch(error => {
    if (!smokeTest) dialog.showErrorBox('BLACKROOT could not start', error.message);
    console.error(error);
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
}
