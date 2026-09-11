const { app, BrowserWindow, Menu, protocol, net, session, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

protocol.registerSchemesAsPrivileged([{ scheme: 'blackroot', privileges: {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true,
} }]);

app.setName('BLACKROOT');
app.setAppUserModelId('com.blackroot.game');
const gotLock = smokeTest || app.requestSingleInstanceLock();
let window;

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    const docsRoot = path.join(app.getAppPath(), 'docs');
    const entryFile = path.join(docsRoot, 'index.html');

    protocol.handle('blackroot', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'game') return new Response('Not found', { status: 404 });

        let rel = decodeURIComponent(url.pathname || '/');
        if (rel === '/' || rel === '/index.html') rel = '/index.html';
        rel = rel.replace(/^\/+/, '');

        const file = path.resolve(docsRoot, rel);
        const root = path.resolve(docsRoot) + path.sep;
        if (file !== path.resolve(entryFile) && !file.startsWith(root)) {
          return new Response('Forbidden', { status: 403 });
        }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return new Response('Not found', { status: 404 });
        }

        const response = await net.fetch(pathToFileURL(file).toString());
        const headers = new Headers(response.headers);
        headers.set('Content-Type', contentType(file));
        headers.set('Cache-Control', 'no-store');
        return new Response(response.body, { status: response.status, headers });
      } catch (error) {
        console.error('blackroot protocol error', error);
        return new Response('Internal error', { status: 500 });
      }
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
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      backgroundColor: '#090c0e',
      show: false,
      icon: path.join(app.getAppPath(), 'assets', 'icon', 'icon-256.png'),
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('blackroot://game/')) event.preventDefault();
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('console-message', (_event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    window.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
      const message = `Game page failed to load (${code}): ${description}\n${validatedURL || ''}`;
      console.error(message);
      if (!smokeTest) dialog.showErrorBox('BLACKROOT could not start', message);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      const message = `Renderer stopped: ${details.reason || 'unknown error'}`;
      console.error(message, details);
      if (!smokeTest) dialog.showErrorBox('BLACKROOT renderer stopped', message);
    });
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

    await window.loadURL('blackroot://game/index.html');
    if (smokeTest) await require('./smoke.cjs').run(window, app);
  }).catch(error => {
    if (!smokeTest) dialog.showErrorBox('BLACKROOT could not start', error.message);
    console.error(error);
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
}
