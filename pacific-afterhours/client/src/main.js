// Entry point. Boots the engine, shows progress, then hands over to the menu.

import { Game } from './game/game.js';
import { Menu } from './ui/menu.js';
import { loadSettings, settings } from './core/settings.js';
import { audio } from './core/audio.js';
import { ControllerUI } from './ui/controller.js';
import { input } from './core/input.js';

const boot = document.getElementById('boot');
const fill = document.getElementById('loadfill');
const msg = document.getElementById('loadmsg');
const menuEl = document.getElementById('menu');

const BUILD = '0.3.3';
document.getElementById('buildver').textContent = BUILD;

function setProgress(p, text) {
  fill.style.width = Math.round(p * 100) + '%';
  if (text) msg.textContent = text;
}

function fatal(title, detail) {
  boot.innerHTML = `<div class="boot-inner">
    <div class="marquee"><span class="marquee-pacific">PACIFIC</span><span class="marquee-after">AFTERHOURS</span></div>
    <p class="tagline" style="color:#ff5145">${title}</p>
    <p class="loadmsg">${detail}</p></div>`;
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2'));
  } catch (e) { return false; }
}

async function main() {
  loadSettings();

  if (!hasWebGL2()) {
    fatal('This game needs WebGL 2.',
      'Try a current version of Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled.');
    return;
  }

  const canvas = document.getElementById('viewport');
  let game;
  try {
    game = new Game(canvas);
    await game.boot(setProgress);
  } catch (e) {
    console.error(e);
    fatal('The city failed to build.', String(e && e.message ? e.message : e));
    return;
  }

  // The menu asks the game to start; the game hides the menu.
  game.startGame = (mode, slot) => {
    menuEl.classList.add('hidden');
    audio.init();
    audio.resume();
    game.start(mode, slot);
  };

  const menu = new Menu(game);
  game.controllerUI = new ControllerUI(game);
  let menuFrameTime = performance.now();
  const pollMenu = now => {
    const dt = Math.min(.05, (now - menuFrameTime) / 1000);
    menuFrameTime = now;
    if (!game.running) {
      input.update(dt);
      game.controllerUI.update(dt);
      input.endFrame();
    }
    requestAnimationFrame(pollMenu);
  };
  requestAnimationFrame(pollMenu);
  window.__game = game;   // handy for debugging from the console

  boot.classList.add('hidden');
  menu.show();

  // Any click resumes audio (browsers require a gesture).
  addEventListener('pointerdown', () => audio.resume(), { once: false });

  // Clicking the canvas while playing re-acquires pointer lock.
  canvas.addEventListener('click', () => {
    if (game.running && !game.paused && !game.shop.open) input.requestLock();
  });

  addEventListener('beforeunload', () => {
    if (game.running && game.mode !== 'online') game.saveGame('auto');
  });
}

main();
