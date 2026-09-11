// Exercise real game entities and the unified input in the installed application.
(async () => {
  const { input } = await import('pacific://game/src/core/input.js');
  const { Vehicle } = await import('pacific://game/src/entities/vehicle.js');
  const game = window.__game, p = game.player;
  const original = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
  let pads = [];
  const check = (value, label) => { if (!value) throw new Error('Driving smoke: ' + label); };
  const clear = () => { input.down.clear(); input.endFrame(); input.gamepad.reset(); pads = []; };
  const frame = (mode, world = false) => {
    input.update(1/60, mode);
    if (mode === 'foot') p.updateOnFoot(1/60, input, null, {input});
    else p.updateDriving(1/60, input, {colliders: world ? game.world.colliders : null, otherVehicles: []});
    input.endFrame();
  };
  const repeat = (n, fn) => { for (let i=0;i<n;i++) fn(); };
  try {
    game.paused = true;
    Object.defineProperty(navigator, 'getGamepads', {configurable:true, value:()=>pads});
    input.focused = true;
    const v = game.ownedVehicles[0], spawn = v.pos.clone(), spawnYaw = v.yaw;
    check(!!v, 'free roam provides a starter car');
    p.enterVehicle(v); clear(); input.down.add('KeyW');
    repeat(60, () => frame('vehicle', true));
    check(v.health === 100 && v.pos.distanceTo(spawn) > 2, 'starter drives clear of real world colliders');
    for (const device of ['Keyboard', 'DualSense Wireless Controller', 'DualShock 4 Wireless Controller', 'Xbox Wireless Controller']) {
      p.exitVehicle(true); clear();
      const pad = {id:device,index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))};
      if (device !== 'Keyboard') pads = [pad];
      input.update(1/60, 'foot'); input.endFrame();
      for (const [key, axes, expected] of [
        ['KeyD',[1,0],[-1,0]], ['KeyA',[-1,0],[1,0]],
        ['KeyW',[0,-1],[0,1]], ['KeyS',[0,1],[0,-1]],
      ]) {
        input.down.clear(); pad.axes = [axes[0],axes[1],0,0];
        if (device === 'Keyboard') input.down.add(key);
        p.teleport(spawn.x, 0, spawn.z, 0); p.vel.set(0,0,0);
        repeat(30, () => frame('foot'));
        const delta = p.pos.clone().sub(spawn);
        check(delta.x*expected[0]+delta.z*expected[1] > 1, device+' walking '+key);
      }
      input.down.clear();pad.axes=[0,0,0,0];
      v.pos.copy(spawn);v.yaw=0;v.speed=0;v.yawRate=0;v.steerAngle=0;v.skid=0;v.health=100;
      p.enterVehicle(v);
      if(device==='Keyboard')input.down.add('KeyW');else pad.buttons[7]={pressed:true,value:1};
      repeat(60,()=>frame('vehicle'));
      check(v.pos.z-spawn.z > 2 && Math.abs(v.pos.x-spawn.x)<.01,device+' accelerator drives forward');
      const before=v.pos.clone();
      if(device==='Keyboard')input.down.add('KeyD');else pad.axes[0]=1;
      repeat(30,()=>frame('vehicle'));
      check(v.pos.x < before.x-.1,device+' right steering');
      input.down.clear();pad.axes=[0,0,0,0];pad.buttons[7]={pressed:false,value:0};
      v.speed=0;v.yawRate=0;v.steerAngle=0;v.yaw=0;v.skid=0;
      const stopped=v.pos.clone();
      if(device==='Keyboard')input.down.add('KeyS');else pad.buttons[6]={pressed:true,value:1};
      repeat(60,()=>frame('vehicle'));
      check(v.pos.z < stopped.z-1,device+' brake reverses from rest');
    }
    p.exitVehicle(true);clear();
    const taken = new Vehicle('sedan', game.roadSpawn('sedan', spawn.x, spawn.z));
    taken.attach(game.scene);game.traffic.parked.push(taken);p.enterVehicle(taken);
    check(!game.traffic.parked.includes(taken) && game.allVehicles().includes(taken), 'taken parked car stays registered');
    p.exitVehicle(true);p.enterCooldown=0;
    check(game.findInteraction().vehicle===taken, 'exited car can be entered again');
    check(p.enterVehicle(taken), 're-enter taken car');p.exitVehicle(true);
    // Restore a fresh playable session for the render capture.
    game.newGame('freeroam');
    const fresh=game.ownedVehicles[0];p.enterVehicle(fresh);
    p.updateDriving(1/60,{axes:{throttle:0,brake:0,steer:0},isDown:()=>false,pressed:()=>false},{colliders:game.world.colliders,otherVehicles:[]});
    p.camYaw=fresh.yaw+.5;p.camPitch=.18;
    return {passed:true,devices:['Keyboard','DualSense','DualShock 4','Xbox'],checks:['four walking directions','forward acceleration','right steering','reverse','starter world collision clearance','parked car handover','exit and re-entry'],physicalHardwareTested:false};
  } catch (error) { return {passed:false,error:String(error.stack)}; }
  finally {
    clear();game.paused=false;
    if(original)Object.defineProperty(navigator,'getGamepads',original);else delete navigator.getGamepads;
    input.pad=null;input.lastDevice='kbm';
  }
})()
