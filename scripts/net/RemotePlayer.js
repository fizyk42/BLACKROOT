/**
 * RemotePlayer — somebody else, drawn in your world.
 *
 * The server sends positions fifteen times a second; the screen draws sixty.
 * Rather than snapping (which looks like a slideshow) or extrapolating (which
 * overshoots every time somebody stops), this keeps a short buffer of
 * timestamped snapshots and renders the world as it was ~110 ms ago,
 * interpolating between the two samples that bracket that moment. That is the
 * standard trade in co-op shooters: everyone else is slightly in the past, and
 * in exchange nobody teleports.
 *
 * The avatar is the same operator model the armoury previews, wearing that
 * player's own loadout choices, plus a nameplate that fades with distance and
 * a torch when they have theirs on — which is what you actually navigate by
 * when you are trying to find your friend in a black forest.
 */
import * as THREE from 'three';
import { buildOperator, poseLocomotion, disposeOperator } from '../entities/OperatorModel.js';

/** Flags packed into the snapshot's `f` byte. */
export const FLAG = {
  CROUCH: 1, SPRINT: 2, AIM: 4, FIRE: 8, LIGHT: 16, DOWN: 32, WATER: 64,
};

const DELAY = 0.11;          // seconds of interpolation lag
const BUFFER = 24;           // samples kept; ~1.6 s at 15 Hz

export class RemotePlayer {
  constructor(profile, scene) {
    this.id = profile.id;
    this.name = profile.name || 'OPERATOR';
    this.operator = profile.op || {};
    this.weapon = profile.w || '';
    this.down = !!profile.down;
    this.health = 100;
    this.flags = 0;
    this.scene = scene;

    this.group = new THREE.Group();
    this.group.name = `remote:${this.id}`;
    this.model = buildOperator(this.operator);
    this.group.add(this.model);

    this.buffer = [];          // [{ t, x, y, z, yaw, pitch, flags, hp }]
    this.clock = 0;
    this.speed = 0;
    this._lastPos = new THREE.Vector3();
    this._smoothSpeed = 0;
    this._anim = Math.random() * 40;   // desynchronised stride phase

    this._buildLight();
    this._buildPlate();
    scene.add(this.group);
  }

  /* ---------------- attachments ---------------- */

  _buildLight() {
    // A cheap point light rather than a second shadow-casting spot: eight of
    // those would cost more than the forest. It sits out in front of the chest
    // rather than inside it — a bright point light *within* the model lights
    // the holder's own arms and torso from a few centimetres away and turns
    // them into a white cut-out.
    const l = new THREE.PointLight(0xffe6bd, 0, 22, 1.25);
    l.position.set(0.16, 1.48, -0.62);
    this.lamp = l;
    this.group.add(l);

    // A visible shaft of light, so a torch across the valley reads as somebody
    // rather than as a floating dot. The cone is built apex-first at the lamp
    // and opening away down -Z: a cone left in its default orientation is
    // *widest at the holder*, which puts a six-metre white sheet over the face
    // of anyone standing in front of you.
    const H = 7;
    const beamGeo = new THREE.ConeGeometry(1.05, H, 12, 1, true);
    beamGeo.translate(0, -H / 2, 0);
    beamGeo.rotateX(Math.PI / 2);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: 0xffe2b4, transparent: true, opacity: 0.05,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      fog: true,
    }));
    beam.position.set(0, 1.5, 0);
    beam.visible = false;
    beam.frustumCulled = false;
    this.beam = beam;
    this.group.add(beam);
  }

  _buildPlate() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    this._plateCanvas = c;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._plateTex = tex;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
      sizeAttenuation: true, opacity: 0.9,
    }));
    sprite.scale.set(1.5, 0.375, 1);
    sprite.position.y = 2.12;
    sprite.renderOrder = 900;
    this.plate = sprite;
    this.group.add(sprite);
    this._drawPlate();
  }

  _drawPlate() {
    const c = this._plateCanvas;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const hp = Math.max(0, Math.min(1, this.health / 100));
    const label = this.down ? `${this.name}  ·  DOWN` : this.name;

    g.font = '600 30px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.95)';
    g.shadowBlur = 8;
    g.fillStyle = this.down ? '#ff6a5a' : '#dfe8ef';
    g.fillText(label, 128, 22);
    g.shadowBlur = 0;

    // A health pip under the name: enough to know whether to go and help.
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(48, 44, 160, 6);
    g.fillStyle = this.down ? '#ff5546' : hp > 0.5 ? '#8fd694' : hp > 0.22 ? '#e0c268' : '#e0705c';
    g.fillRect(48, 44, 160 * hp, 6);
    this._plateTex.needsUpdate = true;
  }

  /* ---------------- network in ---------------- */

  /** One snapshot row. `now` is the client's own receive clock, in seconds. */
  push(now, x, y, z, yaw, pitch, flags, hp) {
    const b = this.buffer;
    // Out-of-order or duplicate frames are dropped rather than sorted: at
    // 15 Hz over TCP they are rare enough not to be worth the work.
    if (b.length && now <= b[b.length - 1].t) return;
    b.push({ t: now, x, y, z, yaw, pitch, flags, hp });
    while (b.length > BUFFER) b.shift();
    if (hp !== this.health || ((flags & FLAG.DOWN) !== 0) !== this.down) {
      this.health = hp;
      this.down = (flags & FLAG.DOWN) !== 0;
      this._drawPlate();
    }
    this.flags = flags;
  }

  setProfile(profile) {
    if (profile.name && profile.name !== this.name) { this.name = profile.name; this._drawPlate(); }
    if (profile.w !== undefined) this.weapon = profile.w;
    if (profile.op) this.setOperator(profile.op);
  }

  setOperator(op) {
    this.operator = op;
    this.group.remove(this.model);
    disposeOperator(this.model);
    this.model = buildOperator(op);
    this.group.add(this.model);
  }

  /* ---------------- per-frame ---------------- */

  update(dt, now, cameraPos) {
    this.clock = now;
    const target = now - DELAY;
    const b = this.buffer;
    if (!b.length) return;

    let a = b[0], c = b[0];
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= target) { a = b[i]; c = b[Math.min(b.length - 1, i + 1)]; break; }
      if (i === 0) { a = b[0]; c = b[0]; }
    }
    const span = c.t - a.t;
    const k = span > 1e-4 ? Math.max(0, Math.min(1, (target - a.t) / span)) : 0;

    const x = a.x + (c.x - a.x) * k;
    const y = a.y + (c.y - a.y) * k;
    const z = a.z + (c.z - a.z) * k;
    const yaw = a.yaw + shortestAngle(a.yaw, c.yaw) * k;

    // Speed is measured from the *rendered* motion, not from the snapshots, so
    // the stride never runs while the figure is standing still on a stale
    // buffer.
    const moved = Math.hypot(x - this._lastPos.x, z - this._lastPos.z);
    const inst = dt > 1e-4 ? moved / dt : 0;
    this._smoothSpeed += (Math.min(12, inst) - this._smoothSpeed) * Math.min(1, dt * 9);
    this._lastPos.set(x, y, z);

    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;

    const flags = c.flags;
    this._anim += dt * (1 + this._smoothSpeed * 0.02);
    const crouch = (flags & FLAG.CROUCH) !== 0;

    if (this.down) {
      // Face down in the dirt, not standing there at zero health.
      this.model.rotation.set(-Math.PI / 2.15, 0, 0);
      this.model.position.y = 0.32;
    } else {
      this.model.rotation.set(0, 0, 0);
      this.model.position.y = 0;
      poseLocomotion(this.model, this._anim, this._smoothSpeed, crouch, !!this.weapon);
    }

    const lampOn = (flags & FLAG.LIGHT) !== 0 && !this.down;
    const dist = cameraPos ? this.group.position.distanceTo(cameraPos) : 30;
    // Distant torches still matter — that is how you find each other — but
    // eight point lights inside the same room would wash it out, so the light
    // itself only burns close in while the beam carries the rest.
    this.lamp.intensity = lampOn ? (dist < 34 ? 13 : 0) : 0;
    // Standing inside a teammate should not fill the screen with their coat.
    this.model.visible = dist > 0.85;
    // Inside the cone there is nothing to see but white. Close in you can see
    // the person anyway, so the shaft is only drawn once it is a shaft rather
    // than a screenful.
    this.beam.visible = lampOn && dist > 9;
    this.beam.material.opacity = 0.05 * Math.min(1, (dist - 9) / 6);

    // The nameplate is legible up close, fades out by 90 m, and never occludes
    // the fight in front of you.
    const fade = dist < 3 ? 0 : dist > 90 ? 0 : Math.min(1, (dist - 3) / 6) * (1 - Math.max(0, (dist - 55) / 35));
    this.plate.material.opacity = this.down ? Math.max(fade, dist < 90 ? 0.85 : 0) : fade * 0.9;
    this.plate.visible = this.plate.material.opacity > 0.01;
    const s = 1 + Math.min(1.6, dist / 45);
    this.plate.scale.set(1.5 * s, 0.375 * s, 1);
  }

  /** Where a bullet fired by this player should appear to come from. */
  muzzle(out = new THREE.Vector3()) {
    return out.set(this.group.position.x, this.group.position.y + 1.5, this.group.position.z);
  }

  dispose() {
    this.scene.remove(this.group);
    disposeOperator(this.model);
    this.beam.geometry.dispose();
    this.beam.material.dispose();
    this.plate.material.map?.dispose();
    this.plate.material.dispose();
  }
}

function shortestAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
