import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox'] });
const page = await b.newPage({ viewport:{width:800,height:450} });
const errs=[]; page.on('pageerror',e=>{errs.push(String(e));console.log('PAGEERROR:',String(e).slice(0,500));});
page.on('console',m=>{ if(m.type()==='error'){errs.push(m.text());console.log('CONSOLE:',m.text().slice(0,500));} });
await page.goto('file:///home/claude/nightfall/dist/BLACKROOT.html');
await page.waitForFunction('!!window.BLACKROOT',null,{timeout:30000}).then(()=>console.log('step: booted')).catch(e=>{console.log('FAILED at boot');throw e;});
for(let i=0;i<6;i++){ await page.keyboard.press('Space'); await new Promise(r=>setTimeout(r,250)); }
await page.waitForFunction('window.BLACKROOT.state === "MENU"',null,{timeout:30000}).then(()=>console.log('step: menu')).catch(e=>{console.log('FAILED at menu, state=');throw e;});
await page.evaluate(()=>{ const S=window.BLACKROOT.settings; S.applyPreset('low'); S.set('renderScale',0.15); S.set('foliage',0.3); S.set('viewDistance',70); });
await page.evaluate(()=>window.BLACKROOT.startNewGame(0xC0FFEE));
await page.waitForFunction('window.BLACKROOT.state === "PLAYING"',null,{timeout:200000}).then(()=>console.log('step: playing')).catch(async e=>{console.log('FAILED at play, state=', await page.evaluate(()=>window.BLACKROOT.state));throw e;});
await new Promise(r=>setTimeout(r,3000));
const r = await page.evaluate(()=>({ state:window.BLACKROOT.state, ents:window.BLACKROOT.entities.active.length,
  lm:window.BLACKROOT.world.landmarks.length, hp:window.BLACKROOT.stats.health, tris:window.BLACKROOT.renderer.info.render.triangles }));
console.log('file:// run ->', JSON.stringify(r));
console.log('errors:', errs.filter(e=>!/Deprecat|SwiftShader|GroupMarker|Fontconfig/i.test(e)).slice(0,3));
await b.close();
