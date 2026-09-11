// Runs only under --smoke-test, inside the installed renderer.
(async () => {
  const { input } = await import('pacific://game/src/core/input.js');
  const game = window.__game, ui = game.controllerUI;
  const original = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
  const pad = {id:'DualSense Wireless Controller (Vendor: 054c)',index:1,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))};
  let pads = [null,pad];
  const tick = () => {input.update(1/60,game.player.vehicle?'vehicle':'foot');ui.update(1/60);input.endFrame();};
  const press = i => {pad.buttons[i]={pressed:true,value:1};tick();pad.buttons[i]={pressed:false,value:0};tick();};
  const check = (value,label) => {if(!value)throw new Error('Controller smoke: '+label);};
  try {
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>pads});
    input.focused = true;
    tick();press(13);
    check(ui.focus?.dataset.act==='freeroam','D-pad chooses Free Roam');
    press(0);check(ui.focus?.textContent==='Start free roam','Cross enters selected menu');
    press(5);press(5); // Free Roam -> Online -> Settings
    check(document.getElementById('m-preset'),'shoulder buttons switch categories');
    press(0); // category to first setting
    const before=ui.focus.selectedIndex;press(14);
    check(ui.focus.selectedIndex===Math.max(0,before-1),'D-pad adjusts graphics select');
    press(4);press(4);press(0);press(0);
    check(game.running && game.mode==='freeroam','Cross starts game');
    check(!input.pressed('jump'),'menu confirm does not leak into gameplay');
    game.paused=true;game.overlay.show('settings');tick();press(1);
    check(!game.paused && !game.overlay.open,'Circle resumes gameplay');
    pads=[];tick();check(game.paused && game.overlay.open,'disconnect pauses the game');
    pad.id='Xbox Wireless Controller';pads=[null,pad];tick();press(9);
    check(!game.paused && !game.overlay.open,'Xbox Menu resumes after reconnect');
    return {passed:true,virtualControllers:['DualSense','Xbox'],checks:['menu navigation','settings adjustment','game start','no confirm leakage','back','disconnect pause','reconnect resume'],physicalHardwareTested:false};
  } catch (error) { return {passed:false,error:String(error.stack)}; }
  finally {
    if(original)Object.defineProperty(navigator,'getGamepads',original);else delete navigator.getGamepads;
    input.gamepad.reset();input.pad=null;input.lastDevice='kbm';ui.lastPad='';
  }
})()
