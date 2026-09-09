/** Full-resolution weapon screenshots, asserting the state at capture time. */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8531, EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer(async (q,s)=>{try{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(root,p);await stat(f);s.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});s.end(await readFile(f));}catch{s.writeHead(404).end('x');}});
await new Promise(r=>server.listen(PORT,r));
await mkdir(path.join(root,'tools/shots'),{recursive:true});
const b = await chromium.launch({executablePath:EXE,args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox']});
const page = await b.newPage({viewport:{width:1100,height:620}});
page.on('pageerror',e=>console.log('PAGEERROR',String(e).slice(0,300)));
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction('!!window.BLACKROOT',null,{timeout:20000});
for(let i=0;i<6;i++){await page.keyboard.press('Space');await sleep(200);}
await page.waitForFunction('window.BLACKROOT.state === "MENU"',null,{timeout:25000});
await page.evaluate(()=>{const S=window.BLACKROOT.settings;S.applyPreset('low');S.set('renderScale',0.12);S.set('viewDistance',90);S.set('foliage',0.5);S.set('shadows','off');});
await page.evaluate(()=>window.BLACKROOT.startNewGame(0x1234abcd));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"',null,{timeout:220000});
await sleep(1500);
await page.evaluate(()=>{
  const g=window.BLACKROOT; g.flashlight.on=true;
  for(const id of ['carbine','rifle','shotgun','smg','revolver']){ g.inventory.add(id,1); }
  for(const a of ['ammo556','ammo308','ammo12','ammo9','ammo357']) g.inventory.add(a,90);
  g.weapons.setAttachment('carbine','optic','holo');
  g.weapons.setAttachment('carbine','muzzle','suppressor');
  g.weapons.setAttachment('carbine','grip','vertical');
  g.weapons.setCamo('carbine',0x51A2B3);
  g.weapons.setAttachment('rifle','optic','sniper');
  g.weapons.setCamo('rifle',991133);
  g.weapons.setAttachment('shotgun','optic','reflex');
  g.weapons.setCamo('shotgun',5150);
});
const shot = async (name, setup, wantAds=false) => {
  await page.evaluate(setup);
  await sleep(600);
  await page.evaluate(()=>window.BLACKROOT.settings.set('renderScale',1.0));
  if (wantAds) {
    await page.evaluate(()=>window.BLACKROOT.input.setVirtualMouse(undefined,true));
    // wait until ADS is actually up before capturing
    await page.waitForFunction('window.BLACKROOT.weapons.ads > 0.97', null, {timeout: 60000}).catch(()=>{});
  }
  await sleep(3500);
  const st = await page.evaluate(()=>({ads:window.BLACKROOT.weapons.ads, scope:window.BLACKROOT.weapons.scopeActive, w:window.BLACKROOT.weapons.currentId}));
  await page.screenshot({path:path.join(root,`tools/shots/g-${name}.png`)});
  if (wantAds) await page.evaluate(()=>window.BLACKROOT.input.setVirtualMouse(undefined,false));
  await page.evaluate(()=>window.BLACKROOT.settings.set('renderScale',0.12));
  console.log(`  ${name}: weapon=${st.w} ads=${st.ads.toFixed(2)} scope=${st.scope}`);
};
await shot('carbine',()=>window.BLACKROOT.useItem('carbine'));
await shot('sniper-ads',()=>window.BLACKROOT.useItem('rifle'),true);
await shot('shotgun',()=>window.BLACKROOT.useItem('shotgun'));
await b.close(); server.close();
