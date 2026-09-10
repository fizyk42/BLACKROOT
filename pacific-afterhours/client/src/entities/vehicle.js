// Vehicles are modelled in code: a bevelled side-profile extrusion for the body,
// an explicit pillar-and-glass greenhouse, and wheels with rims. That means paint,
// upgrades and crash damage are all just parameters.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, angleDiff, resolveCircleVsBoxes } from '../core/util.js';

export const PAINTS = [
  { name: 'Bone White', hex: 0xe8e6df }, { name: 'Graphite', hex: 0x33383d },
  { name: 'Signal Red', hex: 0xb02c22 }, { name: 'Marine', hex: 0x1e4d6b },
  { name: 'Sand', hex: 0xc9ab72 }, { name: 'Forest', hex: 0x2c4a35 },
  { name: 'Sunset Orange', hex: 0xd2622a }, { name: 'Midnight', hex: 0x11141b },
  { name: 'Seafoam', hex: 0x6fbfa8 }, { name: 'Plum', hex: 0x4a2b44 },
];

/**
 * Handling numbers are deliberately arcade: readable differences between classes
 * matter more than simulation accuracy.
 */
export const VEHICLES = {
  sedan: {
    id: 'sedan', name: 'Corvella Line', class: 'Sedan', price: 9800,
    length: 4.62, width: 1.84, height: 1.44, wheelbase: 2.72, wheelR: 0.34,
    mass: 1450, power: 10.5, topSpeed: 47, grip: 12.5, steer: 0.55, brake: 20,
    accelCurve: 1.0, drift: 0.55, seats: 4, blurb: 'Reliable, forgettable, and it always starts.',
  },
  sports: {
    id: 'sports', name: 'Verano GT', class: 'Sports', price: 46000,
    length: 4.34, width: 1.92, height: 1.22, wheelbase: 2.55, wheelR: 0.35,
    mass: 1280, power: 17.5, topSpeed: 68, grip: 16.5, steer: 0.62, brake: 27,
    accelCurve: 1.25, drift: 0.72, seats: 2, blurb: 'Low, loud, and unhappy over speed bumps.',
    spoiler: true, lowered: true,
  },
  suv: {
    id: 'suv', name: 'Kestrel Ridgeline', class: 'SUV', price: 24500,
    length: 4.95, width: 2.0, height: 1.86, wheelbase: 2.95, wheelR: 0.42,
    mass: 2150, power: 12.0, topSpeed: 44, grip: 11.0, steer: 0.5, brake: 19,
    accelCurve: 0.86, drift: 0.42, seats: 5, blurb: 'Rides high, forgives kerbs, drinks fuel.',
    tall: true,
  },
  van: {
    id: 'van', name: 'Kestrel Freight Van', class: 'Van', price: 16800,
    length: 5.3, width: 2.02, height: 2.24, wheelbase: 3.2, wheelR: 0.38,
    mass: 2400, power: 10.0, topSpeed: 38, grip: 9.5, steer: 0.46, brake: 17,
    accelCurve: 0.78, drift: 0.32, seats: 2, blurb: 'Courier work pays better in this.',
    boxy: true, cargo: true,
  },
  pickup: {
    id: 'pickup', name: 'Foundry 250', class: 'Pickup', price: 19200,
    length: 5.45, width: 2.02, height: 1.9, wheelbase: 3.3, wheelR: 0.44,
    mass: 2300, power: 12.6, topSpeed: 42, grip: 10.5, steer: 0.48, brake: 18,
    accelCurve: 0.9, drift: 0.5, seats: 2, blurb: 'Half a workshop, half a battering ram.',
    bed: true, tall: true,
  },
  police: {
    id: 'police', name: 'SAPD Interceptor', class: 'Police', price: 0,
    length: 4.9, width: 1.94, height: 1.5, wheelbase: 2.9, wheelR: 0.36,
    mass: 1650, power: 15.5, topSpeed: 58, grip: 15.0, steer: 0.58, brake: 25,
    accelCurve: 1.1, drift: 0.6, seats: 4, blurb: 'Not for sale.',
    lightbar: true, noSell: true, livery: 'police',
  },
  taxi: {
    id: 'taxi', name: 'Sunline Cab', class: 'Taxi', price: 11500,
    length: 4.7, width: 1.86, height: 1.5, wheelbase: 2.78, wheelR: 0.34,
    mass: 1520, power: 10.8, topSpeed: 45, grip: 12.0, steer: 0.55, brake: 20,
    accelCurve: 0.95, drift: 0.5, seats: 4, blurb: 'Smells of pine air freshener.',
    taxiSign: true, fixedPaint: 0xd8a12a,
  },
};

export const UPGRADES = {
  engine: { name: 'Engine', levels: [0, 1, 2, 3], cost: [0, 2400, 6200, 14500], effect: 'power', per: 0.14 },
  tyres: { name: 'Tyres', levels: [0, 1, 2, 3], cost: [0, 1200, 3400, 7800], effect: 'grip', per: 0.11 },
  brakes: { name: 'Brakes', levels: [0, 1, 2, 3], cost: [0, 900, 2600, 5900], effect: 'brake', per: 0.13 },
  armour: { name: 'Armour', levels: [0, 1, 2, 3], cost: [0, 1800, 4600, 9800], effect: 'armour', per: 0.22 },
};

// ------------------------------------------------------------------ modelling

function bodyProfile(s) {
  const L = s.length, H = s.height;
  const belt = s.boxy ? H * 0.55 : H * 0.62;
  const noseY = s.boxy ? belt * 0.95 : belt * 0.86;
  const p = [];
  const x = (t) => -L / 2 + t * L;
  p.push([x(0.00), 0.16]);
  p.push([x(0.00), noseY * 0.55]);
  p.push([x(0.03), noseY]);
  p.push([x(0.22), noseY * 1.03]);
  p.push([x(0.50), belt]);
  p.push([x(0.78), belt * (s.bed ? 0.78 : 1.0)]);
  p.push([x(0.97), belt * (s.bed ? 0.74 : 0.96)]);
  p.push([x(1.00), belt * 0.6]);
  p.push([x(1.00), 0.16]);
  return p;
}

function shapeFrom(points) {
  const sh = new THREE.Shape();
  sh.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) sh.lineTo(points[i][0], points[i][1]);
  sh.closePath();
  return sh;
}

function extrudeSide(points, width, bevel = 0.14) {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(points), {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 3, curveSegments: 2,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  return geo;
}

function wheelGeo(r, w) {
  const parts = [];
  const tyre = new THREE.CylinderGeometry(r, r, w, 16, 1);
  tyre.rotateZ(Math.PI / 2);
  parts.push(tyre);
  return { tyre: mergeGeometries(parts, false) };
}

function rimGeo(r, w) {
  const parts = [];
  const hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.04, 12);
  hub.rotateZ(Math.PI / 2);
  parts.push(hub);
  for (let k = 0; k < 5; k++) {
    const s = new THREE.BoxGeometry(w * 1.06, r * 0.92, r * 0.14);
    s.rotateX((k / 5) * Math.PI);
    parts.push(s);
  }
  return mergeGeometries(parts, false);
}

/** Greenhouse: explicit pillars + roof so glass can be a separate material. */
function greenhouse(s) {
  const L = s.length, W = s.width, H = s.height;
  const belt = s.boxy ? H * 0.55 : H * 0.62;
  const roofY = H;
  const gw = W - 0.16;
  const front = s.boxy ? -L * 0.34 : -L * 0.10;
  const back = s.bed ? L * 0.06 : s.boxy ? L * 0.42 : L * 0.30;
  const frame = [];
  const glass = [];

  const roof = new THREE.BoxGeometry(back - front, 0.07, gw);
  roof.translate((front + back) / 2, roofY, 0);
  frame.push(roof);

  const pillar = (px, lean, wdt = 0.09) => {
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(wdt, roofY - belt + 0.12, 0.1);
      g.translate(0, (roofY - belt) / 2, 0);
      g.rotateZ(lean);
      g.translate(px, belt, side * (gw / 2 - 0.03));
      frame.push(g);
    }
  };
  const aLean = s.boxy ? 0.22 : 0.62;
  pillar(front, -aLean, 0.11);                       // A-pillar
  if (!s.bed && back - front > 1.6) pillar((front + back) / 2, 0, 0.09); // B-pillar
  pillar(back, s.boxy ? 0.18 : 0.5, 0.11);           // C-pillar

  // Glazing: windscreen, rear screen, and one long side light per side.
  const ws = new THREE.PlaneGeometry(gw - 0.1, Math.max(0.45, (roofY - belt) / Math.cos(aLean)));
  ws.rotateY(Math.PI / 2);
  ws.rotateZ(Math.PI / 2 - aLean);
  ws.translate(front + Math.sin(aLean) * (roofY - belt) / 2 - 0.02, (belt + roofY) / 2, 0);
  glass.push(ws);

  const rs = new THREE.PlaneGeometry(gw - 0.1, Math.max(0.4, (roofY - belt) / Math.cos(s.boxy ? 0.18 : 0.5)));
  rs.rotateY(Math.PI / 2);
  rs.rotateZ(Math.PI / 2 + (s.boxy ? 0.18 : 0.5));
  rs.translate(back - Math.sin(s.boxy ? 0.18 : 0.5) * (roofY - belt) / 2 + 0.02, (belt + roofY) / 2, 0);
  glass.push(rs);

  for (const side of [-1, 1]) {
    const sg = new THREE.PlaneGeometry(back - front - 0.5, roofY - belt - 0.1);
    if (side < 0) sg.rotateY(Math.PI);
    sg.translate((front + back) / 2, (belt + roofY) / 2 + 0.02, side * (gw / 2 + 0.005));
    glass.push(sg);
  }
  return { frame: mergeGeometries(frame, false), glass: mergeGeometries(glass, false) };
}

const _sharedGeoCache = new Map();

function vehicleGeometry(s) {
  if (_sharedGeoCache.has(s.id)) return _sharedGeoCache.get(s.id);
  const L = s.length, W = s.width, H = s.height;

  const bodyParts = [extrudeSide(bodyProfile(s), W, s.boxy ? 0.10 : 0.16)];
  // Sills, bumpers and, where relevant, a load bed or spoiler.
  const sill = new THREE.BoxGeometry(L * 0.62, 0.1, W + 0.03);
  sill.translate(0, 0.18, 0);
  bodyParts.push(sill);
  if (s.bed) {
    const wallH = 0.42;
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(L * 0.36, wallH, 0.09);
      g.translate(L * 0.28, H * 0.55 + wallH / 2, side * (W / 2 - 0.05));
      bodyParts.push(g);
    }
    const tail = new THREE.BoxGeometry(0.09, wallH, W - 0.1);
    tail.translate(L * 0.46, H * 0.55 + wallH / 2, 0);
    bodyParts.push(tail);
  }
  if (s.spoiler) {
    const blade = new THREE.BoxGeometry(0.34, 0.06, W * 0.8);
    blade.translate(L * 0.44, H * 0.78, 0);
    bodyParts.push(blade);
    for (const side of [-1, 1]) {
      const st = new THREE.BoxGeometry(0.12, 0.2, 0.07);
      st.translate(L * 0.44, H * 0.68, side * W * 0.3);
      bodyParts.push(st);
    }
  }
  // Wing mirrors — small, but their absence is very noticeable.
  for (const side of [-1, 1]) {
    const m = new THREE.BoxGeometry(0.1, 0.09, 0.22);
    m.translate(-L * 0.08, H * 0.66, side * (W / 2 + 0.1));
    bodyParts.push(m);
  }

  const gh = greenhouse(s);
  bodyParts.push(gh.frame);

  // Extruded panels are non-indexed; normalize the indexed box panels before merging.
  const normalizedBody = bodyParts.map(geo => geo.index ? geo.toNonIndexed() : geo);
  const body = mergeGeometries(normalizedBody, false);
  for (const geo of new Set([...bodyParts, ...normalizedBody])) geo.dispose();

  // Bumpers + grille in dark trim.
  const trimParts = [];
  const bf = new THREE.BoxGeometry(0.22, 0.3, W * 0.94);
  bf.translate(-L / 2 + 0.06, 0.42, 0);
  trimParts.push(bf);
  const br = new THREE.BoxGeometry(0.22, 0.3, W * 0.94);
  br.translate(L / 2 - 0.06, 0.42, 0);
  trimParts.push(br);
  const grille = new THREE.BoxGeometry(0.08, 0.22, W * 0.6);
  grille.translate(-L / 2 + 0.02, 0.72, 0);
  trimParts.push(grille);
  const trim = mergeGeometries(trimParts, false);

  // Lamps.
  const headParts = [], tailParts = [];
  for (const side of [-1, 1]) {
    const h = new THREE.BoxGeometry(0.09, 0.16, 0.36);
    h.translate(-L / 2 + 0.03, 0.76, side * (W * 0.32));
    headParts.push(h);
    const t = new THREE.BoxGeometry(0.07, 0.14, 0.32);
    t.translate(L / 2 - 0.03, s.bed ? H * 0.55 : 0.82, side * (W * 0.33));
    tailParts.push(t);
  }

  const wr = s.wheelR;
  const ww = s.tall ? 0.3 : 0.26;
  const out = {
    body, trim,
    head: mergeGeometries(headParts, false),
    tail: mergeGeometries(tailParts, false),
    glass: gh.glass,
    tyre: wheelGeo(wr, ww).tyre,
    rim: rimGeo(wr, ww),
  };
  _sharedGeoCache.set(s.id, out);
  return out;
}

const _matCache = new Map();
function sharedMat(key, make) {
  if (!_matCache.has(key)) _matCache.set(key, make());
  return _matCache.get(key);
}

export function buildVehicleMesh(spec, colourHex) {
  const g = vehicleGeometry(spec);
  const grp = new THREE.Group();
  const chassis = new THREE.Group();  // everything that leans on the suspension
  grp.add(chassis);

  const paint = new THREE.MeshStandardMaterial({
    color: spec.fixedPaint ?? colourHex, roughness: 0.28, metalness: 0.55,
  });
  const body = new THREE.Mesh(g.body.clone(), paint);
  body.castShadow = true;
  chassis.add(body);

  const trim = new THREE.Mesh(g.trim, sharedMat('vtrim', () => new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.3 })));
  trim.castShadow = true;
  chassis.add(trim);

  const glass = new THREE.Mesh(g.glass, sharedMat('vglass', () => new THREE.MeshStandardMaterial({
    color: 0x0e1a22, roughness: 0.06, metalness: 0.35, transparent: true, opacity: 0.68, side: THREE.DoubleSide,
  })));
  chassis.add(glass);

  const headMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ea, emissive: 0xfff2d0, emissiveIntensity: 0, roughness: 0.15 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x8a1c14, emissive: 0xff2a17, emissiveIntensity: 0, roughness: 0.3 });
  const head = new THREE.Mesh(g.head, headMat);
  const tail = new THREE.Mesh(g.tail, tailMat);
  chassis.add(head, tail);

  // Lightbar for police cars.
  let lightbar = null;
  if (spec.lightbar) {
    lightbar = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, spec.width * 0.78),
      sharedMat('vtrim', () => new THREE.MeshStandardMaterial({ color: 0x2a2d31 })));
    lightbar.add(bar);
    const redM = new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xff2200, emissiveIntensity: 0 });
    const bluM = new THREE.MeshStandardMaterial({ color: 0x112255, emissive: 0x2255ff, emissiveIntensity: 0 });
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, spec.width * 0.36), redM);
    l1.position.z = -spec.width * 0.2;
    const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, spec.width * 0.36), bluM);
    l2.position.z = spec.width * 0.2;
    lightbar.add(l1, l2);
    lightbar.position.set(-spec.length * 0.02, spec.height + 0.08, 0);
    lightbar.userData = { redM, bluM };
    chassis.add(lightbar);
  }
  if (spec.taxiSign) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.75),
      new THREE.MeshStandardMaterial({ color: 0x2a2d31, emissive: 0xffcc44, emissiveIntensity: 0.4 }));
    sign.position.set(-spec.length * 0.02, spec.height + 0.1, 0);
    chassis.add(sign);
  }

  // Wheels.
  const tyreMat = sharedMat('vtyre', () => new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.95 }));
  const rimMat = sharedMat('vrim', () => new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.3, metalness: 0.85 }));
  const wheels = [];
  const hw = spec.wheelbase / 2;
  const track = spec.width / 2 - 0.1;
  const wy = spec.wheelR - (spec.lowered ? 0.04 : 0);
  const corners = [[-hw, -track, true], [-hw, track, true], [hw, -track, false], [hw, track, false]];
  for (const [wx, wz, steered] of corners) {
    const w = new THREE.Group();
    const t = new THREE.Mesh(g.tyre, tyreMat);
    const r = new THREE.Mesh(g.rim, rimMat);
    t.castShadow = true;
    w.add(t, r);
    w.position.set(wx, wy, wz);
    w.userData.steered = steered;
    chassis.add(w);
    wheels.push(w);
  }

  grp.userData = { paint, headMat, tailMat, lightbar, wheels, chassis, body, spec };
  return grp;
}

// ------------------------------------------------------------------ physics

const _tmpBoxes = [];

export class Vehicle {
  constructor(specId, opts = {}) {
    this.spec = VEHICLES[specId] || VEHICLES.sedan;
    this.id = opts.id || 'veh_' + Math.random().toString(36).slice(2, 9);
    this.colour = opts.colour ?? PAINTS[Math.floor(Math.random() * PAINTS.length)].hex;
    this.upgrades = Object.assign({ engine: 0, tyres: 0, brakes: 0, armour: 0 }, opts.upgrades);
    this.owned = !!opts.owned;
    this.plate = opts.plate || randomPlate();

    this.pos = new THREE.Vector3(opts.x || 0, 0, opts.z || 0);
    this.yaw = opts.yaw || 0;
    this.vel = new THREE.Vector3();
    this.speed = 0;          // signed forward speed, m/s
    this.steerAngle = 0;
    this.yawRate = 0;
    this.rpm = 0.12;
    this.gear = 1;
    this.wheelSpin = 0;
    this.health = opts.health ?? 100;
    this.engineOn = false;
    this.headlights = false;
    this.brakeLight = 0;
    this.driver = null;       // 'player' | 'traffic' | 'police' | 'remote' | null
    this.handbrake = false;
    this.skid = 0;
    this.stuckTimer = 0;
    this.destroyed = false;
    this.lastImpact = 0;
    this.mesh = null;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.sirenOn = false;
    this._sirenT = 0;
    this.locked = false;
    this.active = true;
    this._wet = 0;
  }

  get displayName() { return this.spec.name; }

  stat(key) {
    const base = this.spec[key];
    const up = Object.values(UPGRADES).find((u) => u.effect === key);
    if (!up) return base;
    const lvl = this.upgrades[Object.keys(UPGRADES).find((k) => UPGRADES[k] === up)] || 0;
    return base * (1 + up.per * lvl);
  }

  get armour() { return 1 + 0.22 * (this.upgrades.armour || 0); }

  attach(scene) {
    if (this.mesh) return this.mesh;
    this.mesh = buildVehicleMesh(this.spec, this.colour);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    scene.add(this.mesh);
    this._bodyGeo = this.mesh.userData.body.geometry;
    this._bodyBase = this._bodyGeo.attributes.position.array.slice();
    return this.mesh;
  }

  detach(scene) {
    if (!this.mesh) return;
    scene.remove(this.mesh);
    this.mesh.userData.body.geometry.dispose();
    this.mesh = null;
  }

  setColour(hex) {
    this.colour = hex;
    if (this.mesh) this.mesh.userData.paint.color.setHex(hex);
  }

  /**
   * Arcade bicycle model. `ctl` = {throttle, brake, steer, handbrake}
   */
  update(dt, ctl, colliders, others) {
    const s = this.spec;
    const power = this.stat('power') * (this.destroyed ? 0 : 1) * (0.55 + 0.45 * (this.health / 100));
    const grip = this.stat('grip');
    const brakeF = this.stat('brake');

    const throttle = clamp(ctl.throttle || 0, 0, 1);
    const brake = clamp(ctl.brake || 0, 0, 1);
    const steerIn = clamp(ctl.steer || 0, -1, 1);
    this.handbrake = !!ctl.handbrake;

    // Steering falls off with speed so cars stay controllable.
    const speedFactor = 1 / (1 + Math.abs(this.speed) * 0.055);
    const targetSteer = steerIn * s.steer * speedFactor;
    this.steerAngle = damp(this.steerAngle, targetSteer, 12, dt);

    // Longitudinal forces.
    const topSpeed = s.topSpeed * (1 + 0.1 * (this.upgrades.engine || 0));
    let accel = 0;
    if (throttle > 0) {
      const curve = Math.pow(clamp(1 - Math.abs(this.speed) / topSpeed, 0, 1), 0.7) * s.accelCurve;
      accel += throttle * power * curve;
    }
    if (brake > 0) {
      if (this.speed > 0.4) accel -= brake * brakeF;
      else accel -= brake * power * 0.55;      // reverse
    }
    // Drag + rolling resistance.
    accel -= this.speed * Math.abs(this.speed) * 0.0055;
    accel -= this.speed * 0.55;
    if (this.handbrake) accel -= Math.sign(this.speed) * brakeF * 0.6;

    this.speed += accel * dt;
    if (Math.abs(this.speed) < 0.06 && throttle < 0.05) this.speed = 0;
    this.speed = clamp(this.speed, -topSpeed * 0.35, topSpeed);

    // Yaw from steering.
    const wb = s.wheelbase;
    let yawRate = (this.speed / wb) * Math.tan(this.steerAngle);
    // Drifting: handbrake or too much speed for the grip available.
    const latLoad = Math.abs(yawRate * this.speed);
    const gripLimit = grip * (this.handbrake ? 0.32 : 1) * (1 - this._wet * 0.28);
    const slipping = latLoad > gripLimit;
    if (slipping) {
      const over = clamp((latLoad - gripLimit) / gripLimit, 0, 2.4);
      yawRate *= 1 + over * s.drift;
      this.skid = Math.min(1, this.skid + dt * 4 * over);
    } else {
      this.skid = Math.max(0, this.skid - dt * 2.2);
    }
    this.yawRate = damp(this.yawRate, yawRate, 14, dt);
    this.yaw += this.yawRate * dt;

    // Integrate along the heading, with a little lateral slide while drifting.
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = fz, rz = -fx;
    const slide = this.skid * this.speed * 0.16;
    let nx = this.pos.x + (fx * this.speed + rx * slide * Math.sign(this.steerAngle || 1)) * dt;
    let nz = this.pos.z + (fz * this.speed + rz * slide * Math.sign(this.steerAngle || 1)) * dt;

    // Static world collision: sample the four corners of the footprint.
    if (colliders) {
      const r = Math.max(s.width, 1.6) * 0.5;
      const hl = s.length * 0.5 - r * 0.5;
      let bumped = false, bnx = 0, bnz = 0, depth = 0;
      for (const t of [-1, 0, 1]) {
        const px = nx + fx * hl * t, pz = nz + fz * hl * t;
        colliders.query(px - r - 1, pz - r - 1, px + r + 1, pz + r + 1, _tmpBoxes);
        const res = resolveCircleVsBoxes(px, pz, r, _tmpBoxes, 2.5, 0.6);
        if (res.hit) {
          nx += res.x - px; nz += res.z - pz;
          if (res.depth > depth) { depth = res.depth; bnx = res.nx; bnz = res.nz; }
          bumped = true;
        }
      }
      if (bumped) this.impact(depth, bnx, bnz, fx, fz);
    }

    // Vehicle-vs-vehicle: cheap circle separation with mass weighting.
    if (others) {
      for (const o of others) {
        if (o === this || !o.active) continue;
        const dx = nx - o.pos.x, dz = nz - o.pos.z;
        const rr = (s.length + o.spec.length) * 0.33;
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) / 2;
        const ux = dx / d, uz = dz / d;
        const mine = o.spec.mass / (s.mass + o.spec.mass);
        nx += ux * push * 2 * mine; nz += uz * push * 2 * mine;
        o.pos.x -= ux * push * 2 * (1 - mine); o.pos.z -= uz * push * 2 * (1 - mine);
        const rel = Math.abs(this.speed - o.speed);
        if (rel > 6) {
          this.impact(push, ux, uz, fx, fz, 0.7);
          o.impact(push, -ux, -uz, Math.sin(o.yaw), Math.cos(o.yaw), 0.7);
        }
        this.speed *= 0.86;
      }
    }

    this.pos.x = nx; this.pos.z = nz;
    this.pos.y = 0;

    // Stuck detection for the recovery feature.
    if (Math.abs(this.speed) < 0.6 && (throttle > 0.4 || brake > 0.4)) this.stuckTimer += dt;
    else this.stuckTimer = Math.max(0, this.stuckTimer - dt * 1.4);

    this.rpm = clamp(0.12 + Math.abs(this.speed) / topSpeed * 0.9 + (throttle * 0.12), 0, 1.15);
    this.gear = this.speed < -0.2 ? 'R' : Math.max(1, Math.min(6, Math.floor(Math.abs(this.speed) / (topSpeed / 6)) + 1));
    this.wheelSpin += (this.speed / s.wheelR) * dt;
    this.brakeLight = damp(this.brakeLight, brake > 0.05 || this.handbrake ? 1 : 0, 14, dt);

    // Body attitude from acceleration.
    this.bodyPitch = damp(this.bodyPitch, clamp(-accel * 0.0055, -0.08, 0.08), 6, dt);
    this.bodyRoll = damp(this.bodyRoll, clamp(this.yawRate * this.speed * 0.006, -0.09, 0.09), 6, dt);

    this.syncMesh(dt);
  }

  set wet(v) { this._wet = v; }
  get wet() { return this._wet || 0; }

  impact(depth, nx, nz, fx, fz, scale = 1) {
    const relative = Math.abs(this.speed);
    if (relative < 2.2 && depth < 0.3) { this.speed *= 0.8; return; }
    // Reflect off the surface and bleed speed.
    const dot = fx * nx + fz * nz;
    this.speed *= dot < -0.3 ? -0.16 : 0.55;
    this.yawRate *= 0.35;
    const dmg = clamp(relative * 0.85 * scale / this.armour, 0, 40);
    if (dmg > 0.7) {
      this.health = clamp(this.health - dmg, 0, 100);
      this.lastImpact = dmg;
      this.dent(-nx, -nz, dmg);
      if (this.health <= 0 && !this.destroyed) this.destroyed = true;
      if (this.onImpact) this.onImpact(dmg);
    }
  }

  /** Push body vertices in toward the impact so crashes leave visible damage. */
  dent(dirX, dirZ, amount) {
    if (!this._bodyGeo) return;
    const attr = this._bodyGeo.attributes.position;
    const arr = attr.array;
    // Impact point in local space.
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    const lx = dirX * c - dirZ * s;
    const lz = dirX * s + dirZ * c;
    const px = lx * this.spec.length * 0.5;
    const pz = lz * this.spec.width * 0.5;
    const R = 1.0, str = clamp(amount * 0.006, 0, 0.10);
    for (let i = 0; i < arr.length; i += 3) {
      const dx = arr[i] - px, dz = arr[i + 2] - pz;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const w = (1 - d / R) ** 2 * str;
      arr[i] -= lx * w;
      arr[i + 2] -= lz * w;
      arr[i + 1] -= w * 0.35;
    }
    attr.needsUpdate = true;
    this._bodyGeo.computeVertexNormals();
  }

  repair() {
    this.health = 100;
    this.destroyed = false;
    if (this._bodyGeo && this._bodyBase) {
      this._bodyGeo.attributes.position.array.set(this._bodyBase);
      this._bodyGeo.attributes.position.needsUpdate = true;
      this._bodyGeo.computeVertexNormals();
    }
  }

  syncMesh(dt = 0.016) {
    if (!this.mesh) return;
    const m = this.mesh;
    m.position.set(this.pos.x, 0, this.pos.z);
    m.rotation.y = this.yaw;
    const u = m.userData;
    u.chassis.rotation.z = this.bodyRoll;
    u.chassis.rotation.x = this.bodyPitch;
    u.chassis.position.y = this.spec.lowered ? -0.02 : 0;
    for (const w of u.wheels) {
      w.rotation.x = this.wheelSpin;
      w.rotation.y = w.userData.steered ? this.steerAngle : 0;
    }
    u.headMat.emissiveIntensity = this.headlights ? 2.6 : 0;
    u.tailMat.emissiveIntensity = this.headlights ? 0.9 + this.brakeLight * 2.4 : this.brakeLight * 2.6;
    if (u.lightbar) {
      if (this.sirenOn) {
        this._sirenT += dt * 9;
        const f = Math.sin(this._sirenT) > 0;
        u.lightbar.userData.redM.emissiveIntensity = f ? 5 : 0;
        u.lightbar.userData.bluM.emissiveIntensity = f ? 0 : 5;
      } else {
        u.lightbar.userData.redM.emissiveIntensity = 0;
        u.lightbar.userData.bluM.emissiveIntensity = 0;
      }
    }
  }

  /** Where a character should stand to get in, in world space. */
  doorPosition(side = -1) {
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return new THREE.Vector3(
      this.pos.x + rx * side * (this.spec.width / 2 + 0.75),
      0,
      this.pos.z + rz * side * (this.spec.width / 2 + 0.75),
    );
  }

  serialise() {
    return {
      id: this.id, spec: this.spec.id, colour: this.colour,
      upgrades: { ...this.upgrades }, health: Math.round(this.health),
      plate: this.plate, owned: this.owned,
      x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), yaw: +this.yaw.toFixed(3),
    };
  }

  static deserialise(data) {
    const v = new Vehicle(data.spec, {
      id: data.id, colour: data.colour, upgrades: data.upgrades,
      x: data.x, z: data.z, yaw: data.yaw, health: data.health, owned: data.owned,
    });
    v.plate = data.plate || v.plate;
    return v;
  }
}

export function randomPlate() {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const d = () => Math.floor(Math.random() * 10);
  const l = () => L[Math.floor(Math.random() * L.length)];
  return `${d()}${l()}${l()}${l()}${d()}${d()}${d()}`;
}

export function speedKmh(v) { return Math.abs(v.speed) * 3.6; }
export function speedMph(v) { return Math.abs(v.speed) * 2.23694; }
