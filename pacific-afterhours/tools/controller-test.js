import assert from 'node:assert/strict';
import { GamepadState, deadzone, padType } from '../client/src/core/gamepad.js';
const events = new EventTarget(), canvas = new EventTarget();
globalThis.addEventListener = events.addEventListener.bind(events);
globalThis.document = {getElementById:()=>canvas, addEventListener:()=>{}, querySelector:()=>null};
let pads = [];
Object.defineProperty(globalThis,'navigator',{value:{getGamepads:()=>pads},configurable:true});
const {input} = await import('../client/src/core/input.js');
const {settings} = await import('../client/src/core/settings.js');
const pad = (id,index=0) => ({id,index,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:18},()=>({value:0,pressed:false}))});
const set = (p,i,v) => {p.buttons[i]={value:v,pressed:v>.5};};
const tick = (context='foot',dt=1/60) => {input.endFrame();input.update(dt,context);};
for (const id of ['DualSense Wireless Controller (Vendor: 054c Product: 0ce6)','DualShock 4 (Vendor: 054c Product: 09cc)','Xbox Wireless Controller']) {
  const p=pad(id,2);pads=[null,null,p];tick();
  p.axes=[1,-1,0,0];tick();assert.ok(Math.abs(Math.hypot(input.axes.moveX,input.axes.moveY)-1)<1e-6);
  assert.equal(input.glyph('interact'),id.startsWith('Xbox')?'Y':'△');
  p.axes=[0,0,0,0];set(p,7,.7);tick();assert.equal(input.pressed('fire'),true);assert.equal(input.isDown('fire'),true);
  tick();assert.equal(input.pressed('fire'),false);set(p,7,0);tick();set(p,7,.7);tick();assert.equal(input.pressed('fire'),true);
  set(p,7,0);set(p,2,1);tick();assert.equal(input.pressed('reload'),true);assert.equal(input.isDown('crouch'),false);
  set(p,2,0);set(p,11,1);tick();assert.equal(input.isDown('crouch'),true);set(p,11,0);tick();
  set(p,7,.6);set(p,6,.4);set(p,2,1);set(p,10,1);tick('vehicle');
  assert.ok(input.axes.throttle>0 && input.axes.throttle<1);assert.ok(input.axes.brake>0 && input.axes.brake<1);
  assert.equal(input.isDown('fire'),false);assert.equal(input.pressed('headlights'),true);assert.equal(input.pressed('horn'),true);
  p.buttons.forEach((_,i)=>set(p,i,0));p.axes=[0,0,1,0];
  let at30=0,at120=0;for(let i=0;i<30;i++){tick('foot',1/30);at30+=input.axes.lookX;}for(let i=0;i<120;i++){tick('foot',1/120);at120+=input.axes.lookX;}
  assert.ok(Math.abs(at30-at120)<1e-9,'controller camera must not depend on frame rate');
  p.axes=[0,0,0,0];set(p,0,1);tick();input.consumePadPresses();assert.equal(input.pressed('jump'),false);
  pads=[];tick();assert.equal(input.pad,null);assert.equal(input.axes.throttle,0);assert.equal(input.isDown('jump'),false);
  pads=[null,null,p];tick();assert.equal(input.pressed('jump'),false,'held button after reconnect must not activate');
  pads=[];tick();console.log(id+': controls, triggers, menus, reconnect, camera timing passed');
}
assert.equal(deadzone(.1,.18),0);assert.equal(deadzone(NaN,.18),0);assert.equal(deadzone(1,.18),1);
const state=new GamepadState(), idle=pad('Xbox',0), active=pad('DualSense',1);state.sample([idle,active]);set(active,3,1);assert.equal(state.sample([idle,active]),active);
assert.equal(state.sample([{...active,mapping:''}]),null,'unknown raw layout must not be misread as standard');
assert.equal(padType('Sony Interactive Entertainment'), 'playstation');
const event=new Event('keydown');Object.defineProperty(event,'code',{value:'KeyW'});events.dispatchEvent(event);tick();assert.equal(input.axes.moveY,1);
events.dispatchEvent(new Event('blur'));tick();assert.equal(input.axes.moveY,0);assert.equal(input.pressed('forward'),false);
console.log('Controller selection, deadzones and keyboard fallback passed. Physical hardware is not simulated transport validation.');
