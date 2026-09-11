const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async (window, app) => {
  const reportArg = process.argv.find(arg => arg.startsWith('--smoke-report='));
  const reportPath = reportArg ? reportArg.slice('--smoke-report='.length) : path.join(app.getPath('temp'), 'blackroot-smoke.json');
  const report = { passed: false, errors: [], renderer: [], checks: {} };
  let finished = false;

  const recordConsole = (_event, level, message, line, sourceId) => {
    report.renderer.push({ level, message, line, sourceId });
  };
  window.webContents.on('console-message', recordConsole);

  const deadline = setTimeout(() => {
    report.errors.push('Desktop smoke test timed out');
    finish(1);
  }, 240000);

  function finish(code) {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    try { window.webContents.removeListener('console-message', recordConsole); } catch {}
    try { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); } catch {}
    app.exit(code);
  }

  async function evalSafe(source, label) {
    try {
      return await window.webContents.executeJavaScript(source, true);
    } catch (error) {
      const recent = report.renderer.slice(-12).map(x => x.message).join(' | ');
      throw new Error(`${label} failed: ${error.message}${recent ? ` | renderer: ${recent}` : ''}`);
    }
  }

  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      const ready = await evalSafe('Boolean(window.BLACKROOT)', 'boot probe');
      if (ready) break;
      await delay(500);
    }

    report.checks.boot = await evalSafe('Boolean(window.BLACKROOT)', 'boot check');
    if (!report.checks.boot) throw new Error('Game failed to initialize window.BLACKROOT');

    report.checks.isolation = await evalSafe('typeof require === "undefined" && typeof process === "undefined"', 'isolation check');

    for (let i = 0; i < 8; i++) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
      await delay(250);
    }

    report.checks.storage = await evalSafe(`(() => {
      localStorage.setItem('blackroot.desktop-smoke', 'ok');
      const result = localStorage.getItem('blackroot.desktop-smoke') === 'ok';
      localStorage.removeItem('blackroot.desktop-smoke');
      return result;
    })()`, 'storage check');

    // Start a real world build and await it. The previous smoke test fired the
    // async method without awaiting it, so renderer/build failures surfaced as
    // generic executeJavaScript errors instead of the actual failure reason.
    await evalSafe(`(async () => {
      const game = window.BLACKROOT;
      game.settings.applyPreset('low');
      game.settings.set('renderScale', 0.35);
      game.settings.set('foliage', 0.3);
      game.settings.set('viewDistance', 70);
      await game.startNewGame(0xC0FFEE);
      return game.state;
    })()`, 'startNewGame');

    for (let i = 0; i < 60; i++) {
      const state = await evalSafe('window.BLACKROOT && window.BLACKROOT.state', 'state check');
      if (state === 'PLAYING' || state === 'PAUSED') break;
      await delay(1000);
    }

    report.game = await evalSafe(`(() => {
      const g = window.BLACKROOT;
      return {
        state: g.state,
        health: g.stats && g.stats.health,
        entities: g.entities && g.entities.active ? g.entities.active.length : 0,
        triangles: g.renderer && g.renderer.info ? g.renderer.info.render.triangles : 0,
        canvasWidth: g.canvas ? g.canvas.width : 0,
        canvasHeight: g.canvas ? g.canvas.height : 0
      };
    })()`, 'gameplay check');

    report.checks.play = ['PLAYING', 'PAUSED'].includes(report.game.state)
      && report.game.health > 0
      && report.game.canvasWidth > 0
      && report.game.canvasHeight > 0;

    report.passed = Object.values(report.checks).every(Boolean);
    if (!report.passed) throw new Error(`Desktop checks failed: ${JSON.stringify(report.checks)}`);
    finish(0);
  } catch (error) {
    report.errors.push(error.stack || error.message || String(error));
    finish(1);
  }
};
