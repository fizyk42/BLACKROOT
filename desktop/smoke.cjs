const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async (window, app) => {
  const reportArg = process.argv.find(arg => arg.startsWith('--smoke-report='));
  const reportPath = reportArg ? reportArg.slice('--smoke-report='.length) : path.join(app.getPath('temp'), 'blackroot-smoke.json');
  const report = { passed: false, errors: [], checks: {} };
  const deadline = setTimeout(() => { report.errors.push('Desktop smoke test timed out'); finish(1); }, 240000);
  function finish(code) {
    clearTimeout(deadline);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    app.exit(code);
  }
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await window.webContents.executeJavaScript('Boolean(window.BLACKROOT)')) break;
      await delay(500);
    }
    report.checks.boot = await window.webContents.executeJavaScript('Boolean(window.BLACKROOT)');
    if (!report.checks.boot) throw new Error('Game failed to initialize');
    report.checks.isolation = await window.webContents.executeJavaScript('typeof require === "undefined" && typeof process === "undefined"');
    for (let i = 0; i < 8; i++) {
      window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Space'});
      window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Space'});
      await delay(300);
    }
    report.checks.storage = await window.webContents.executeJavaScript(`(() => {
      localStorage.setItem('blackroot.desktop-smoke', 'ok');
      const result = localStorage.getItem('blackroot.desktop-smoke') === 'ok';
      localStorage.removeItem('blackroot.desktop-smoke'); return result;
    })()`);
    await window.webContents.executeJavaScript(`(() => {
      const game = window.BLACKROOT;
      game.settings.applyPreset('low');
      game.settings.set('renderScale', 0.2);
      game.settings.set('foliage', 0.3);
      game.settings.set('viewDistance', 70);
      game.startNewGame(0xC0FFEE);
    })()`);
    for (let i = 0; i < 180; i++) {
      const state = await window.webContents.executeJavaScript('window.BLACKROOT.state');
      if (state === 'PLAYING' || state === 'PAUSED') break;
      await delay(1000);
    }
    report.game = await window.webContents.executeJavaScript(`(() => {
      const g = window.BLACKROOT;
      return { state: g.state, health: g.stats.health, entities: g.entities.active.length, triangles: g.renderer.info.render.triangles };
    })()`);
    report.checks.play = ['PLAYING', 'PAUSED'].includes(report.game.state) && report.game.health > 0 && report.game.entities > 0 && report.game.triangles > 0;
    report.passed = Object.values(report.checks).every(Boolean);
    if (!report.passed) throw new Error('A desktop check failed');
    finish(0);
  } catch (error) { report.errors.push(error.stack || error.message); finish(1); }
};
