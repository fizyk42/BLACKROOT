import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8140 + Math.floor(Math.random()*40);
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css' };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const server = http.createServer(async (req,res)=>{ try{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html'; const f=path.join(root,p); await stat(f); res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); res.end(await readFile(f)); }catch{ res.writeHead(404).end('x'); }});
await new Promise(r=>server.listen(PORT,r));
await mkdir(path.join(root,'tools/shots'),{recursive:true});
const browser = await chromium.launch({ executablePath: EXE, args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror', e=>console.log('PAGEERROR',String(e)));
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT',null,{timeout:20000});
for(let i=0;i<6;i++){ await page.keyboard.press('Space'); await sleep(200); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"',null,{timeout:25000});
// Generate at a cheap render scale (SwiftShader would otherwise crawl through
// the loading frames), then switch to full resolution just for the capture.
await page.evaluate(()=>{ const S=window.BLACKROOT.settings; S.applyPreset('low'); S.set('renderScale',0.15); S.set('viewDistance',110); S.set('foliage',0.6); S.set('shadows','low'); S.set('showFps',false); });
await page.evaluate(()=>window.BLACKROOT.startNewGame(0x1234abcd));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"',null,{timeout:240000});
await sleep(2000);
await page.evaluate(()=>{ window.BLACKROOT.settings.set('renderScale', 1.0); });
await sleep(6000);
const probe = await page.evaluate(()=>{
  const g = window.BLACKROOT;
  g.flashlight.on = true;
  const w = g.weapons;
  const out = { equipped: w.currentId, hasModel: !!w.model, inScene: !!(w.model && w.model.parent), rootParent: w.root.parent === g.viewScene, viewChildren: g.viewScene.children.length, meshes: [] };
  if (w.model) {
    out.pos = w.model.position.toArray().map(n=>+n.toFixed(3));
    out.visible = w.model.visible;
    w.model.updateMatrixWorld(true);
    w.model.traverse(o=>{ if(o.isMesh && out.meshes.length<3) out.meshes.push({ vis:o.visible, col:'#'+o.material.color.getHexString(), metal:o.material.metalness, env:!!g.viewScene.environment }); });
    const v = new (window.BLACKROOT.constructor === undefined ? Object : Object)();
  }
  out.envMap = !!g.viewScene.environment;
  out.sceneEnv = !!g.scene.environment;
  return out;
});
console.log(JSON.stringify(probe,null,1));
await sleep(3500);
await page.screenshot({ path: path.join(root,'tools/shots/probe-viewmodel.png') });
await page.evaluate(()=>{ const g=window.BLACKROOT; const T=g.world.terrain; const s=T.findWalkable(120,60,Math.random,40,60); g.player.position.set(s.x,s.y+0.2,s.z); g.player.yaw=1.1; g.player.pitch=-0.06; });
await sleep(5000);
await page.screenshot({ path: path.join(root,'tools/shots/probe-forest.png') });
console.log('done');
await browser.close(); server.close();
