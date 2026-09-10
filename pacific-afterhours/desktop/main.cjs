const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'pacific', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true
} }]);
const smoke = process.argv.includes('--smoke-test');
const arg = name => process.argv.find(a => a.startsWith(name + '='))?.slice(name.length + 1);
if (smoke) {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.setPath('userData', path.join(app.getPath('temp'), 'pacific-smoke-' + process.pid));
}
if (!app.requestSingleInstanceLock()) app.quit();
let win;
const errors = [];
app.on('second-instance', () => { if (win) { win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '../client');
  protocol.handle('pacific', request => {
    const url = new URL(request.url);
    if (url.host !== 'game') return new Response('Not found', { status: 404 });
    let filename;
    try { filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
    catch { return new Response('Invalid path', { status: 400 }); }
    if (!filename.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filename).href);
  });
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'Pacific Afterhours', backgroundColor: '#071016', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('pacific://game/')) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === win.webContents && permission === 'pointerLock');
  });
  win.webContents.on('console-message', (event, level, message) => {
    const details = typeof level === 'object' ? level : {level: event.level ?? level, message: event.message ?? message};
    if (details.level === 'error' || details.level === 3) errors.push(details.message);
  });
  await win.loadURL('pacific://game/index.html');
  if (smoke) {
    const reportPath = arg('--report');
    try {
      const deadline = Date.now() + 180000;
      while (!(await win.webContents.executeJavaScript('!!window.__game'))) {
        const fatal = await win.webContents.executeJavaScript("document.querySelector('#boot')?.innerText || ''");
        if (/failed to build|needs WebGL/.test(fatal)) throw new Error(fatal);
        if (Date.now() > deadline) throw new Error('Game boot timeout');
        await new Promise(r => setTimeout(r, 500));
      }
      const startError = await win.webContents.executeJavaScript("(() => { try { window.__game.startGame('freeroam'); return null; } catch(e) { return e.stack; } })()", true);
      if (startError) throw new Error(startError);
      await new Promise(r => setTimeout(r, 6000));
      const state = await win.webContents.executeJavaScript(`({running: __game.running, mode: __game.mode,
        calls: __game.renderer.info.render.calls, triangles: __game.renderer.info.render.triangles,
        playtime: __game.playtime, x: __game.player.pos.x, z: __game.player.pos.z,
        cash: document.querySelector('#cash').textContent})`);
      if (!state.running || !state.calls || !state.triangles || !Number.isFinite(state.x) || !Number.isFinite(state.z))
        throw new Error('Game did not render a playable world: ' + JSON.stringify(state));
      const screenshotPath = arg('--screenshot');
      if (screenshotPath) fs.writeFileSync(screenshotPath, (await win.webContents.capturePage()).toJPEG(90));
      if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ passed: true, state, errors }, null, 2));
      app.exit(0);
    } catch (error) {
      if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: String(error), errors }, null, 2));
      app.exit(1);
    }
  }
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
