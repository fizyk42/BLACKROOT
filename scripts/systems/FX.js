/**
 * FX — pooled visual effects: tracers, impact sparks, blood, dust, embers,
 * muzzle flashes and floating fog motes. Everything is preallocated; nothing
 * allocates during combat.
 */
import * as THREE from 'three';
import { softDot } from '../world/Textures.js';

const MAX_PARTICLES = 900;
const MAX_TRACERS = 24;

export class FXSystem {
  constructor(scene, viewScene) {
    this.scene = scene;
    this.viewScene = viewScene;

    /* ---- particles ---- */
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    this.pDrag = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    this.pGeo = geo;
    this.pMat = new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, map: softDot(), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.pMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.pHead = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) { this.pPos[i * 3 + 1] = -9999; }

    // Non-additive (blood, dirt) uses a second cloud so it does not glow.
    const geo2 = new THREE.BufferGeometry();
    this.dPos = new Float32Array(MAX_PARTICLES * 3);
    this.dCol = new Float32Array(MAX_PARTICLES * 3);
    this.dVel = new Float32Array(MAX_PARTICLES * 3);
    this.dLife = new Float32Array(MAX_PARTICLES);
    this.dMax = new Float32Array(MAX_PARTICLES);
    geo2.setAttribute('position', new THREE.BufferAttribute(this.dPos, 3));
    geo2.setAttribute('color', new THREE.BufferAttribute(this.dCol, 3));
    this.dGeo = geo2;
    this.dMat = new THREE.PointsMaterial({
      size: 0.07, vertexColors: true, map: softDot(), transparent: true,
      depthWrite: false, opacity: 0.95, sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo2, this.dMat);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this.dHead = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) { this.dPos[i * 3 + 1] = -9999; }

    /* ---- tracers ---- */
    this.tracers = [];
    const tGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true);
    tGeo.rotateX(Math.PI / 2);
    const tMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tGeo, tMat.clone());
      m.visible = false; m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }

    /* ---- muzzle flash (view space) ---- */
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot(), color: 0xffd7a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    this.flashSprite.scale.set(0.42, 0.42, 1);
    this.flashSprite.visible = false;
    viewScene.add(this.flashSprite);
    this.flashLight = new THREE.PointLight(0xffce88, 0, 22, 2.0);
    scene.add(this.flashLight);
    this.flashTime = 0;

    /* ---- ambient motes ---- */
    this.motes = null;
  }

  /* ---------------- emitters ---------------- */

  spark(pos, normal, count, color = [1.0, 0.72, 0.32], speed = 5) {
    for (let i = 0; i < count; i++) {
      const i3 = this.pHead * 3;
      this.pPos[i3] = pos.x; this.pPos[i3 + 1] = pos.y; this.pPos[i3 + 2] = pos.z;
      const sx = normal.x + (Math.random() - 0.5) * 1.5;
      const sy = normal.y + (Math.random() - 0.5) * 1.5;
      const sz = normal.z + (Math.random() - 0.5) * 1.5;
      const s = speed * (0.35 + Math.random());
      this.pVel[i3] = sx * s; this.pVel[i3 + 1] = sy * s; this.pVel[i3 + 2] = sz * s;
      this.pCol[i3] = color[0]; this.pCol[i3 + 1] = color[1]; this.pCol[i3 + 2] = color[2];
      this.pSize[this.pHead] = 0.5 + Math.random();
      this.pMax[this.pHead] = this.pLife[this.pHead] = 0.18 + Math.random() * 0.35;
      this.pGrav[this.pHead] = 9;
      this.pDrag[this.pHead] = 2.4;
      this.pHead = (this.pHead + 1) % MAX_PARTICLES;
    }
    this.pGeo.attributes.position.needsUpdate = true;
  }

  /** One particle, fully specified. Everything above is sugar over this. */
  emit(pos, vx, vy, vz, color, size, life, drag, grav) {
    const i3 = this.pHead * 3;
    this.pPos[i3] = pos.x; this.pPos[i3 + 1] = pos.y; this.pPos[i3 + 2] = pos.z;
    this.pVel[i3] = vx; this.pVel[i3 + 1] = vy; this.pVel[i3 + 2] = vz;
    this.pCol[i3] = color[0]; this.pCol[i3 + 1] = color[1]; this.pCol[i3 + 2] = color[2];
    this.pSize[this.pHead] = size * 14;
    this.pMax[this.pHead] = this.pLife[this.pHead] = life;
    this.pGrav[this.pHead] = grav;
    this.pDrag[this.pHead] = drag;
    this.pHead = (this.pHead + 1) % MAX_PARTICLES;
  }

  glow(pos, count, color, speed, life, grav = 0.4) {
    for (let i = 0; i < count; i++) {
      const i3 = this.pHead * 3;
      this.pPos[i3] = pos.x; this.pPos[i3 + 1] = pos.y; this.pPos[i3 + 2] = pos.z;
      this.pVel[i3] = (Math.random() - 0.5) * speed;
      this.pVel[i3 + 1] = Math.random() * speed;
      this.pVel[i3 + 2] = (Math.random() - 0.5) * speed;
      this.pCol[i3] = color[0]; this.pCol[i3 + 1] = color[1]; this.pCol[i3 + 2] = color[2];
      this.pSize[this.pHead] = 0.7 + Math.random() * 1.2;
      this.pMax[this.pHead] = this.pLife[this.pHead] = life * (0.6 + Math.random() * 0.8);
      this.pGrav[this.pHead] = grav;
      this.pDrag[this.pHead] = 1.2;
      this.pHead = (this.pHead + 1) % MAX_PARTICLES;
    }
  }

  debris(pos, normal, count, color = [0.22, 0.18, 0.13], speed = 3.5) {
    for (let i = 0; i < count; i++) {
      const i3 = this.dHead * 3;
      this.dPos[i3] = pos.x; this.dPos[i3 + 1] = pos.y; this.dPos[i3 + 2] = pos.z;
      const s = speed * (0.3 + Math.random());
      this.dVel[i3] = (normal.x + (Math.random() - 0.5) * 1.8) * s;
      this.dVel[i3 + 1] = (normal.y + Math.random() * 1.2) * s;
      this.dVel[i3 + 2] = (normal.z + (Math.random() - 0.5) * 1.8) * s;
      this.dCol[i3] = color[0]; this.dCol[i3 + 1] = color[1]; this.dCol[i3 + 2] = color[2];
      this.dMax[this.dHead] = this.dLife[this.dHead] = 0.5 + Math.random() * 0.9;
      this.dHead = (this.dHead + 1) % MAX_PARTICLES;
    }
  }

  blood(pos, dir, count = 14) {
    this.debris(pos, dir, count, [0.30, 0.020, 0.020], 4.2);
    this.debris(pos, dir, Math.floor(count / 2), [0.14, 0.010, 0.012], 2.0);
  }

  impact(pos, normal, material) {
    switch (material) {
      case 'metal': this.spark(pos, normal, 12, [1.0, 0.85, 0.5], 7); this.debris(pos, normal, 4, [0.3, 0.3, 0.32], 2.5); break;
      case 'rock': this.spark(pos, normal, 7, [1.0, 0.8, 0.55], 5); this.debris(pos, normal, 10, [0.26, 0.25, 0.24], 3); break;
      case 'wood': this.debris(pos, normal, 14, [0.22, 0.15, 0.09], 3.4); this.spark(pos, normal, 2, [1, 0.6, 0.25], 2.5); break;
      case 'flesh': this.blood(pos, normal, 16); break;
      case 'foliage': this.debris(pos, normal, 10, [0.11, 0.16, 0.07], 2.6); break;
      case 'water': this.debris(pos, normal, 16, [0.32, 0.40, 0.44], 4.0); break;
      default: this.debris(pos, normal, 12, [0.19, 0.16, 0.12], 3.0); break;
    }
  }

  tracer(from, to, color = 0xffd9a0, width = 1) {
    for (const t of this.tracers) {
      if (t.life > 0) continue;
      const d = _v1.copy(to).sub(from);
      const len = d.length();
      if (len < 0.01) return;
      t.mesh.visible = true;
      t.mesh.position.copy(from).addScaledVector(d, 0.5);
      t.mesh.scale.set(width, width, len);
      t.mesh.lookAt(to);
      t.mesh.material.color.setHex(color);
      t.mesh.material.opacity = 0.85;
      t.life = 0.055;
      return;
    }
  }

  muzzleFlash(localPos, scale = 1, intensity = 1) {
    this.flashSprite.position.copy(localPos);
    this.flashSprite.scale.set(0.32 * scale, 0.32 * scale, 1);
    this.flashSprite.material.rotation = Math.random() * 6.28;
    this.flashSprite.visible = true;
    this.flashTime = 0.045;
    this.flashLight.intensity = 34 * intensity;
  }

  setFlashWorldPos(p) { this.flashLight.position.copy(p); }

  /** Drifting fog motes near the player — cheap atmosphere. */
  spawnMotes(center, count, radius) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * radius;
      _v1.set(center.x + Math.cos(a) * r, center.y + Math.random() * 4 - 0.5, center.z + Math.sin(a) * r);
      this.glow(_v1, 1, [0.16, 0.18, 0.20], 0.22, 7.5, -0.02);
    }
  }

  /**
   * Weather. One emitter, four behaviours, all of them just particles with
   * different gravity — which is the honest way to do falling snow, rising
   * bubbles, drifting spores and embers that lift on their own heat.
   */
  weather(kind, center, count, radius, color) {
    if (!kind) return;
    const c = color || [0.7, 0.75, 0.8];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * radius;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (kind === 'snow') {
        _v1.set(x, center.y + 9 + Math.random() * 8, z);
        this.emit(_v1, (Math.random() - 0.5) * 0.6, -1.2 - Math.random(), (Math.random() - 0.5) * 0.6,
          c, 0.055 + Math.random() * 0.05, 9, 0.06, 0.0);
      } else if (kind === 'embers') {
        _v1.set(x, center.y - 0.5 + Math.random() * 2.5, z);
        this.emit(_v1, (Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 1.4, (Math.random() - 0.5) * 0.5,
          c, 0.05 + Math.random() * 0.055, 5.5, 0.1, -0.55);
      } else if (kind === 'bubbles') {
        _v1.set(x, center.y - 1.5 + Math.random() * 2, z);
        this.emit(_v1, (Math.random() - 0.5) * 0.25, 1.1 + Math.random() * 1.1, (Math.random() - 0.5) * 0.25,
          c, 0.045 + Math.random() * 0.06, 7, 0.35, -0.35);
      } else {
        // spores: almost weightless, they hang and drift
        _v1.set(x, center.y + Math.random() * 6 - 1, z);
        this.emit(_v1, (Math.random() - 0.5) * 0.5, -0.05 - Math.random() * 0.12, (Math.random() - 0.5) * 0.5,
          c, 0.05 + Math.random() * 0.06, 11, 0.05, 0.01);
      }
    }
  }

  update(dt) {
    // additive particles
    let anyP = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      anyP = true;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      if (this.pLife[i] <= 0) { this.pPos[i3 + 1] = -9999; this.pSize[i] = 0; continue; }
      const drag = 1 - Math.min(0.95, this.pDrag[i] * dt);
      this.pVel[i3] *= drag; this.pVel[i3 + 2] *= drag;
      this.pVel[i3 + 1] = this.pVel[i3 + 1] * drag - this.pGrav[i] * dt;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      const f = this.pLife[i] / this.pMax[i];
      this.pSize[i] = f * 1.1;
    }
    if (anyP) {
      this.pGeo.attributes.position.needsUpdate = true;
      this.pGeo.attributes.color.needsUpdate = true;
      this.pGeo.attributes.size.needsUpdate = true;
    }

    // dust / blood
    let anyD = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.dLife[i] <= 0) continue;
      anyD = true;
      this.dLife[i] -= dt;
      const i3 = i * 3;
      if (this.dLife[i] <= 0) { this.dPos[i3 + 1] = -9999; continue; }
      this.dVel[i3] *= 0.96; this.dVel[i3 + 2] *= 0.96;
      this.dVel[i3 + 1] -= 12 * dt;
      this.dPos[i3] += this.dVel[i3] * dt;
      this.dPos[i3 + 1] += this.dVel[i3 + 1] * dt;
      this.dPos[i3 + 2] += this.dVel[i3 + 2] * dt;
    }
    if (anyD) {
      this.dGeo.attributes.position.needsUpdate = true;
      this.dGeo.attributes.color.needsUpdate = true;
    }

    // tracers
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.055) * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }

    // muzzle flash
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flashLight.intensity *= Math.pow(0.0006, dt);
      if (this.flashTime <= 0) { this.flashSprite.visible = false; this.flashLight.intensity = 0; }
    }
  }

  dispose() {
    // The flash sprite lives in the session-long view scene, not the per-run
    // world scene, so it has to be taken out by hand or it accumulates.
    this.viewScene?.remove(this.flashSprite);
    this.flashSprite?.material?.map?.dispose?.();
    this.flashSprite?.material?.dispose?.();
    if (this.flashLight?.parent) this.flashLight.parent.remove(this.flashLight);
    this.pGeo.dispose(); this.pMat.dispose();
    this.dGeo.dispose(); this.dMat.dispose();
    for (const t of this.tracers) { t.mesh.material.dispose(); }
  }
}

const _v1 = new THREE.Vector3();
