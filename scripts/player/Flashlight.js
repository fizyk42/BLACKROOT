/**
 * Flashlight — the single most important item in the Hollow.
 *
 * A spotlight that lags behind the camera (so it feels hand-held), drains a
 * battery, dims and flickers as the cell dies, and exposes a cone test the
 * mutant AI uses to decide whether it is being looked at.
 */
import * as THREE from 'three';
import { Settings } from '../core/Settings.js';
import { Audio } from '../core/AudioManager.js';

export class Flashlight {
  constructor(scene) {
    this.on = false;
    this.battery = 100;          // percent
    this.drain = 0.42;           // percent per second while on
    this.maxRange = 78;          // it is a lamp, not a candle
    this.baseAngle = 0.52;       // a cone wide enough to walk by

    // Decay well under the physical 2.0, and a correspondingly low intensity.
    // A torch that throws eighty metres under inverse-square needs an enormous
    // intensity, and that intensity turns anything within four metres into a
    // flat white hole — which is exactly where the player is looking most of
    // the time. Flattening the falloff keeps the far throw and hands the near
    // field back its texture.
    this.spot = new THREE.SpotLight(0xfff2d8, 0, this.maxRange, this.baseAngle, 0.62, 0.9);
    this.spot.castShadow = false;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.camera.near = 0.4;
    this.spot.shadow.camera.far = this.maxRange;
    this.spot.shadow.bias = -0.0016;
    this.spot.shadow.normalBias = 0.05;
    this.target = new THREE.Object3D();
    this.spot.target = this.target;
    scene.add(this.spot);
    scene.add(this.target);

    // A short-range fill so the ground at your feet is not pitch black. This
    // is what stops you walking off a ledge you were standing on.
    this.fill = new THREE.PointLight(0xd8ddf0, 0, 14, 1.05);
    scene.add(this.fill);

    this.dir = new THREE.Vector3(0, 0, -1);
    this.smoothDir = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3();
    this._flicker = 0;
    this._flickerTimer = 0;
    this.applyQuality();
    Settings.onChange((k) => { if (k === 'shadows' || k === 'quality') this.applyQuality(); });
  }

  applyQuality() {
    const s = Settings.get('shadows');
    this.spot.castShadow = s === 'high' || s === 'ultra';
    const size = s === 'high' ? 1024 : 512;
    if (this.spot.shadow.mapSize.x !== size) {
      this.spot.shadow.mapSize.set(size, size);
      this.spot.shadow.map?.dispose();
      this.spot.shadow.map = null;
    }
  }

  toggle() {
    if (this.battery <= 0 && !this.on) { Audio.denied(); return false; }
    this.on = !this.on;
    Audio.flashlightClick();
    return this.on;
  }

  addBattery(pct) {
    this.battery = Math.min(100, this.battery + pct);
  }

  /** Is `point` inside the illuminated cone right now? Used by mutant AI. */
  illuminates(point, extraDot = 0) {
    if (!this.on || this.intensityNow <= 0.05) return 0;
    _v.copy(point).sub(this.pos);
    const dist = _v.length();
    if (dist > this.maxRange) return 0;
    _v.divideScalar(dist);
    const dot = _v.dot(this.smoothDir);
    const cone = Math.cos(this.spot.angle * (1 + extraDot));
    if (dot < cone) return 0;
    const falloff = 1 - dist / this.maxRange;
    return falloff * ((dot - cone) / (1 - cone));
  }

  get intensityNow() { return this._currentIntensity || 0; }

  update(dt, eyePos, forward, moving) {
    // battery
    if (this.on) {
      this.battery = Math.max(0, this.battery - this.drain * dt);
      if (this.battery <= 0) { this.on = false; Audio.flashlightClick(); }
    }

    // hand-held lag: the beam trails the camera slightly, more while moving
    const lag = moving ? 9.0 : 13.0;
    this.smoothDir.lerp(forward, Math.min(1, dt * lag)).normalize();

    // hold the lamp slightly below and to the right of the eye
    this.pos.copy(eyePos);
    _right.set(-forward.z, 0, forward.x).normalize();
    this.pos.addScaledVector(_right, 0.17).addScaledVector(_up, -0.16);

    this.spot.position.copy(this.pos);
    this.target.position.copy(this.pos).addScaledVector(this.smoothDir, 10);
    this.fill.position.copy(this.pos).addScaledVector(this.smoothDir, 1.2);

    // dying-cell flicker
    let mul = 1;
    if (this.battery < 22) {
      this._flickerTimer -= dt;
      if (this._flickerTimer <= 0) {
        this._flickerTimer = 0.05 + Math.random() * (this.battery / 22) * 0.9;
        this._flicker = Math.random() < 0.42 ? Math.random() * 0.65 : 1;
      }
      mul = this._flicker * (0.35 + this.battery / 22 * 0.65);
    }

    // The brightness setting is deliberately sub-linear on the lamp: past a
    // point, more torch is only more glare. The rest of the setting is spent
    // on the world's ambient fill and exposure, which is what actually makes
    // a night forest navigable.
    const bright = Settings.get('brightness');
    const lampGain = 0.66 + 0.34 * bright;
    const target = this.on ? 30 * mul * lampGain : 0;
    this._currentIntensity = (this._currentIntensity || 0) + (target - (this._currentIntensity || 0)) * Math.min(1, dt * 18);
    this.spot.intensity = this._currentIntensity;
    this.fill.intensity = (this.on ? 1.5 * mul : 0) * lampGain;
    this.spot.distance = this.maxRange;
    this.spot.angle = this.baseAngle;
    this.spot.penumbra = 0.55;
  }

  serialize() { return { on: this.on, battery: this.battery }; }
  deserialize(d) { if (d) { this.on = !!d.on; this.battery = d.battery ?? 100; } }
}

const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
