/**
 * BLACKROOT — Nightfall in the Hollow
 * Ninefold Lantern Studios — prototype vertical slice
 *
 * Entry point: wire the canvas, start the boot sequence, expose a small debug
 * handle on window for testing.
 */
import { GameManager } from './core/GameManager.js';
import { Settings } from './core/Settings.js';
import { Audio } from './core/AudioManager.js';

function start() {
  const canvas = document.getElementById('gl');
  let game;
  try {
    game = new GameManager(canvas);
  } catch (err) {
    console.error(err);
    document.getElementById('fatal').classList.remove('hidden');
    document.getElementById('fatal-msg').textContent =
      'The renderer could not start.\n\n' + (err && err.stack ? err.stack : err) +
      '\n\nWebGL2 is required. Try a different browser, or enable hardware acceleration.';
    return;
  }

  // The first user gesture anywhere unlocks the audio context.
  const unlock = () => { Audio.init(); Audio.resume(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    if (Settings.get('fullscreen') !== isFs) Settings.set('fullscreen', isFs);
  });

  window.BLACKROOT = game;   // debug/automation handle
  game.boot();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
