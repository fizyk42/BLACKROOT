/**
 * Build script.
 *
 *   node build.mjs            -> dist/ (index.html + game.js + ui.css)  and
 *                                dist/BLACKROOT.html (single self-contained file)
 *   node build.mjs --watch    -> rebuild on change
 *   node build.mjs --nomin    -> unminified, for debugging
 */
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const minify = !process.argv.includes('--nomin');
const watch = process.argv.includes('--watch');

/**
 * Turn the full document into page *content* for a host that supplies its own
 * <html>/<head>/<body>.
 *
 * Everything the head carried that still matters is kept and hoisted: the
 * title, and the stylesheet as an inline <style>. The favicon link, the
 * viewport meta and the theme-color meta are dropped — the host owns those and
 * a duplicate in the body is either ignored or, in the favicon's case, wrong.
 */
function buildHosted(html, css, safeJs) {
  // A browser tab can carry "NAME — subtitle" comfortably. A hosted page's
  // title is also its name in a gallery of many, where the subtitle is dead
  // weight and the name is the half that has to survive, so the hosted build
  // keeps everything before the first dash or colon.
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const fullTitle = titleMatch ? titleMatch[1].trim() : 'BLACKROOT';
  const title = fullTitle.split(/\s+[—–:-]\s+/)[0].trim() || fullTitle;

  // Take only what is between <body> and </body>.
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) throw new Error('build: index.html has no <body> to extract');
  let body = bodyMatch[1];

  body = body.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
  if (!body.includes('<script type="module" src="scripts/main.js"></script>')) {
    throw new Error('build: hosted build could not find the module script tag');
  }

  // Verify the extracted markup carries no document shell of its own, and do
  // it now — before the megabyte of minified bundle goes in, so the check is
  // reading markup rather than scanning JS string literals for tag names.
  // The boundaries matter: <header> is not <head>, and the first draft of this
  // guard rejected every build because of exactly that.
  const shell = [
    [/<!doctype/i, '<!doctype'],
    [/<html[\s>]/i, '<html>'],
    [/<head[\s>]/i, '<head>'],
    [/<body[\s>]/i, '<body>'],
    [/<\/head>/i, '</head>'],
    [/<\/body>/i, '</body>'],
    [/<\/html>/i, '</html>'],
  ];
  for (const [re, name] of shell) {
    if (re.test(body)) throw new Error(`build: hosted build still contains ${name}`);
  }

  body = body.replace(
    '<script type="module" src="scripts/main.js"></script>',
    () => `<script>\n${safeJs}\n</script>`,
  );

  // Keyboard input goes to whichever document has focus. In an iframe that is
  // the parent until something inside is clicked, so a player who clicks NEW
  // GAME and then presses W gets nothing. One focus call on the first pointer
  // event fixes it, and it is a no-op outside a frame.
  const focusShim = `<script>
(function () {
  var claimed = false;
  function claim() {
    if (claimed) return;
    claimed = true;
    try { window.focus(); } catch (e) {}
  }
  window.addEventListener('pointerdown', claim, { once: true, capture: true });
  window.addEventListener('keydown', claim, { once: true, capture: true });
})();
</script>`;

  const out = [
    `<title>${title}</title>`,
    `<style>\n${css}\n</style>`,
    focusShim,
    body.trim(),
  ].join('\n');

  return out + '\n';
}

async function build() {
  await rm(path.join(root, 'dist'), { recursive: true, force: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });

  const result = await esbuild.build({
    entryPoints: [path.join(root, 'scripts/main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify,
    legalComments: 'none',
    write: false,
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  const js = result.outputFiles[0].text;
  const css = await readFile(path.join(root, 'styles/ui.css'), 'utf8');
  const html = await readFile(path.join(root, 'index.html'), 'utf8');

  // Replacements go through a function so that `$&`, `$'` and friends inside
  // the minified bundle are inserted literally instead of being interpreted as
  // replacement patterns — that silently corrupts the output otherwise.
  const put = (str, find, replacement) => {
    if (!str.includes(find)) throw new Error(`build: could not find ${JSON.stringify(find)} in index.html`);
    return str.replace(find, () => replacement);
  };
  // A literal </script> inside inlined JS would close the tag early.
  const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

  const stripped = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');

  // --- served build ---
  const served = put(stripped, '<script type="module" src="scripts/main.js"></script>', '<script src="game.js"></script>');
  await writeFile(path.join(root, 'dist/index.html'), served);
  await writeFile(path.join(root, 'dist/game.js'), js);
  await writeFile(path.join(root, 'dist/ui.css'), css);

  // --- single-file build (runs straight off the filesystem) ---
  let single = put(stripped, '<link rel="stylesheet" href="styles/ui.css" />', `<style>\n${css}\n</style>`);
  single = put(single, '<script type="module" src="scripts/main.js"></script>', `<script>\n${safeJs}\n</script>`);
  if (single.includes('src="scripts/main.js"')) throw new Error('build: inlining failed, script tag survived');
  await writeFile(path.join(root, 'dist/BLACKROOT.html'), single);

  // --- hosted build (a published page, not a downloaded file) ---
  //
  // Hosts that wrap a page in their own document shell — Claude Artifacts and
  // most embed/CDN previews — supply the doctype, <html>, <head> and <body>
  // themselves and expect only the *content*. Shipping a second full document
  // inside theirs makes browsers close the outer <body> early and drop
  // everything after it, so this build strips the shell and hoists the <title>
  // and <style> to the top where a host head would have put them.
  const artifact = buildHosted(html, css, safeJs);
  await writeFile(path.join(root, 'dist/BLACKROOT-hosted.html'), artifact);

  // --- GitHub Pages copy ---
  // docs/index.html is what Pages serves, and it is committed while dist/ is
  // ignored. Writing it here rather than copying it by hand is the only way to
  // guarantee the published game is the one that was just built; a stale copy
  // in docs/ would be invisible until somebody played the wrong version.
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs/index.html'), single);
  await writeFile(path.join(root, 'docs/.nojekyll'), '');

  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
  console.log(
    `built  dist/game.js ${kb(js)}   dist/BLACKROOT.html ${kb(single)}   dist/BLACKROOT-hosted.html ${kb(artifact)}`,
  );
}

if (watch) {
  const ctx = await esbuild.context({
    entryPoints: [path.join(root, 'scripts/main.js')],
    bundle: true, format: 'iife', target: ['es2020'], minify: false,
    outfile: path.join(root, 'dist/game.js'),
  });
  await build();
  await ctx.watch();
  console.log('watching…');
} else {
  await build();
}
