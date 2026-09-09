/**
 * WeaponSystem — handling, spread, recoil, reloads, melee arcs and the hitscan
 * that ties shooting to the damage system.
 *
 * Magazines live here (per weapon id) and reserve ammunition lives in the
 * inventory, which is what makes ammo scarcity readable to the player.
 *
 * Attachments and finishes are per-weapon and persist across equips, so a
 * weapon you have built stays built.
 *
 * Magnified optics get a real second render pass: the world is drawn again
 * through a narrow-FOV camera into a texture, and that texture is mapped onto
 * the scope lens. The image inside the tube is therefore the actual world at
 * actual magnification, and everything outside the tube stays visible — you
 * are looking *through* the optic, not at a zoomed screen.
 */
import * as THREE from 'three';
import { WEAPONS } from './ItemDatabase.js';
import { Input } from '../core/Input.js';
import { Settings } from '../core/Settings.js';
import { Audio } from '../core/AudioManager.js';
import { buildViewModel, HIP_POSE } from './ViewModels.js';
import { defaultLoadoutFor, resolveWeapon } from './Attachments.js';
import { dressModel, camoTextureSize } from './GunDress.js';
import { applyUpgrades } from './Upgrades.js';
import { ensureForged } from './WeaponForge.js';

// How far in front of the eye the sight sits when aiming, in camera metres.
// Magnified glass comes closer so the tube fills a useful part of the screen.
const ADS_EYE_DIST = { magnified: 0.135, reflex: 0.155, iron: 0.175 };
const SCOPE_RT_SIZE = { low: 256, medium: 384, high: 512, ultra: 640 };

export class WeaponSystem {
  /**
   * Tear the viewmodel out of the shared view scene.
   *
   * The world scene is thrown away and rebuilt between runs, but `viewScene`
   * is not — it is created once and lives for the whole session, because it
   * holds the viewmodel light rig. Anything a per-run system adds to it is
   * therefore still there on the next run: after dying and restarting, the
   * previous run's gun stayed parented in the view scene, frozen in whatever
   * pose it died in, floating next to the new one.
   */
  dispose() {
    this.viewScene.remove(this.root);
    this.viewScene.remove(this.scopeOverlay);
    for (const m of this.models.values()) {
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose?.();
        const mat = o.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose?.());
        else mat?.dispose?.();
      });
    }
    this.models.clear();
    this.model = null;
    for (const o of this.scopeOverlay.children) {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    }
    this.scopeRT?.dispose?.();
  }

  constructor(game) {
    this.game = game;
    this.viewScene = game.viewScene;
    this.viewCamera = game.viewCamera;

    this.root = new THREE.Group();
    this.root.scale.setScalar(0.78);   // final framing trim
    this.viewScene.add(this.root);

    this.models = new Map();          // viewModel key -> Group
    this.mags = new Map();            // weaponId -> rounds in magazine
    this.fits = new Map();            // weaponId -> attachment loadout
    this.camos = new Map();           // weaponId -> camo seed (or null)
    this.current = null;              // resolved weapon stats
    this.base = null;                 // unmodified definition
    this.currentId = null;
    this.model = null;
    this.attachmentObjects = {};      // slot -> {group, parts}
    this.opticEye = new THREE.Vector3(0, 0.045, -0.1);

    this.state = 'idle';              // idle | firing | reloading | equipping | melee
    this.stateTime = 0;
    this.cooldown = 0;
    this.ads = 0;                     // 0..1
    this.adsTarget = 0;
    this.spreadBloom = 0;
    this.reloadProgress = 0;
    this.reloadTotal = 0;
    this.boltPending = false;

    this.swayPos = new THREE.Vector3();
    this.swayVel = new THREE.Vector3();
    this.kick = 0;
    this.kickVel = 0;
    this.meleeSwing = 0;

    this._lastLookX = 0;
    this._lastLookY = 0;
    this._triggerHeld = false;

    this._initScope();
  }

  /* ================= scope render target ================= */

  _initScope() {
    const q = Settings.get('quality');
    const size = SCOPE_RT_SIZE[q] || 512;
    this.scopeRT = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.SRGBColorSpace,
    });
    this.scopeCamera = new THREE.PerspectiveCamera(20, 1, 0.08, 1200);
    this.scopeActive = false;

    // Screen-space scope view. The lens on the model sells the optic while you
    // are bringing it up; once you are settled behind it, this takes over and
    // fills the screen the way a real eye relief would — still fed by the same
    // second render of the world, so it is a true magnified image.
    this.scopeOverlay = new THREE.Group();
    this.scopeOverlay.visible = false;
    this.scopeOverlay.renderOrder = 100;
    const Z = -0.35, R = 0.205;
    this.scopeImage = new THREE.Mesh(
      new THREE.CircleGeometry(R, 64),
      makeScopeImageMaterial(this.scopeRT.texture)
    );
    this.scopeImage.position.set(0, 0, Z);
    this.scopeImage.renderOrder = 100;
    this.scopeMask = new THREE.Mesh(
      new THREE.RingGeometry(R, R * 7, 64, 1),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, toneMapped: false })
    );
    this.scopeMask.position.set(0, 0, Z + 0.001);
    this.scopeMask.renderOrder = 101;
    this.scopeRing = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.985, R, 64, 1),
      new THREE.MeshBasicMaterial({ color: 0x14181c, transparent: true, opacity: 0, depthTest: false, toneMapped: false })
    );
    this.scopeRing.position.set(0, 0, Z + 0.002);
    this.scopeRing.renderOrder = 102;
    this.scopeReticle = new THREE.Mesh(
      new THREE.PlaneGeometry(R * 2, R * 2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, toneMapped: false })
    );
    this.scopeReticle.position.set(0, 0, Z + 0.003);
    this.scopeReticle.renderOrder = 103;
    this.scopeOverlay.add(this.scopeImage, this.scopeMask, this.scopeRing, this.scopeReticle);
    for (const o of this.scopeOverlay.children) o.frustumCulled = false;
    this.viewScene.add(this.scopeOverlay);
  }

  /**
   * Render the world through the optic. Called by GameManager between the
   * world pass and the viewmodel pass so the lens texture is current.
   */
  renderScope(renderer, scene) {
    const w = this.current;
    const lens = this.attachmentObjects.optic && this.attachmentObjects.optic.parts.lens;
    const wantScope = !!(w && w.magnified && this.ads > 0.25 && this.model && lens);
    this.scopeActive = wantScope;

    if (!lens) {
      // No magnified optic on this weapon. The early return here used to skip
      // the tear-down below, which left the screen-space scope disc up —
      // a frozen picture of the last thing the scope saw, sitting over the
      // weapon you had just switched to. Clear it before leaving.
      this._setOverlay(0);
      if (this.model) this.model.visible = true;
      return false;
    }

    if (!wantScope) {
      if (lens.material.uniforms) lens.material.uniforms.opacity.value = 0;
      else lens.material.opacity = 0;
      lens.visible = false;
      this._setOverlay(0);
      if (this.model) this.model.visible = true;
      return false;
    }
    lens.visible = true;
    const a = Math.min(1, (this.ads - 0.25) / 0.4);
    if (lens.material.uniforms) lens.material.uniforms.opacity.value = a;
    else lens.material.opacity = a;

    // Past ~85% ADS the eye is behind the glass: swap to the full scope view
    // and drop the weapon body, which is what you would actually see.
    const overlay = Math.max(0, Math.min(1, (this.ads - 0.86) / 0.12));
    this._setOverlay(overlay, w);
    if (this.model) this.model.visible = overlay < 0.98;

    const cam = this.game.camera;
    this.scopeCamera.fov = cam.fov / Math.max(1.01, w.zoom);
    this.scopeCamera.aspect = 1;
    this.scopeCamera.near = cam.near;
    this.scopeCamera.far = cam.far;
    cam.getWorldPosition(this.scopeCamera.position);
    cam.getWorldQuaternion(this.scopeCamera.quaternion);
    this.scopeCamera.updateProjectionMatrix();

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.scopeRT);
    renderer.clear(true, true, false);
    renderer.render(scene, this.scopeCamera);
    renderer.setRenderTarget(prevTarget);
    return true;
  }

  /** Fade the screen-space scope view in and out. */
  _setOverlay(t, w) {
    if (!this.scopeOverlay) return;
    this.scopeOverlay.visible = t > 0.001;
    if (!this.scopeOverlay.visible) return;
    this.scopeImage.material.opacity = t;
    this.scopeMask.material.opacity = t;
    this.scopeRing.material.opacity = t;
    this.scopeReticle.material.opacity = t;
    if (w && this._overlayOptic !== w.optic.id) {
      this._overlayOptic = w.optic.id;
      const opt = this.attachmentObjects.optic;
      const ret = opt && opt.parts.reticle;
      if (ret && ret.material.map) {
        this.scopeReticle.material.map = ret.material.map;
        this.scopeReticle.material.needsUpdate = true;
      }
      if (w.thermal && !(this.scopeImage.material instanceof THREE.ShaderMaterial)) {
        this.scopeImage.material.dispose();
        this.scopeImage.material = makeThermalLensMaterial(this.scopeRT.texture);
        this.scopeImage.material.depthTest = false;
      } else if (!w.thermal && this.scopeImage.material instanceof THREE.ShaderMaterial) {
        this.scopeImage.material.dispose();
        this.scopeImage.material = makeScopeImageMaterial(this.scopeRT.texture);
        this.scopeImage.material.uniforms.opacity.value = t;
      }
      if (this.scopeImage.material.uniforms) this.scopeImage.material.uniforms.opacity.value = t;
    }
    if (this.scopeImage.material.uniforms) this.scopeImage.material.uniforms.opacity.value = t;
  }

  /* ================= equipping ================= */

  /**
   * The build (attachments, finish, tuning) lives in the armoury, because it
   * has to outlive any one run — you can open the armoury from the main menu
   * with no world loaded. This system only reads it.
   */
  get armoury() { return this.game.armoury; }

  fitFor(id) {
    if (this.armoury) return this.armoury.fitFor(id);
    if (!this.fits.has(id)) this.fits.set(id, defaultLoadoutFor());
    return this.fits.get(id);
  }

  camoFor(id) {
    if (this.armoury) return this.armoury.camoFor(id);
    return this.camos.has(id) ? this.camos.get(id) : null;
  }

  upgradesFor(id) { return this.armoury ? this.armoury.upgradesFor(id) : null; }

  setAttachment(id, slot, attachmentId) {
    const fit = this.fitFor(id);
    fit[slot] = attachmentId;
    if (this.currentId === id) this._rebuild();
    return fit;
  }

  setCamo(id, seed) {
    if (this.armoury) this.armoury.camos.set(id, seed);
    else this.camos.set(id, seed);
    if (this.currentId === id) this._rebuild();
  }

  /** Rebuild the held weapon after the armoury changed its build. */
  refit() { this._rebuild(); }

  equip(id) {
    if (this.currentId === id) return;
    // a forged weapon out of a save file has to be re-forged before it exists
    if (id) ensureForged(id);
    if (this.model) {
      // Models are cached and reused, so anything the scope did to this one
      // has to be undone before it goes back in the cache — otherwise a
      // weapon that was hidden behind a scope stays invisible next time you
      // draw it.
      this.model.visible = true;
      this.root.remove(this.model);
    }
    this._setOverlay(0);
    this.currentId = id;
    this.base = id ? WEAPONS[id] : null;
    const vm = this.base ? this.base.viewModel : 'none';
    if (!this.models.has(vm)) this.models.set(vm, buildViewModel(vm));
    this.model = this.models.get(vm);
    this.model.visible = true;
    this.root.add(this.model);
    this._rebuild();
    this.state = 'equipping';
    this.stateTime = 0.32;
    this.cooldown = 0.32;
    this.ads = 0; this.adsTarget = 0;
    if (this.base && this.base.kind === 'gun' && !this.mags.has(id)) {
      this.mags.set(id, 0);
      this.reloadIfEmpty();
    }
  }

  /** Re-fit attachments and finish onto the current model. */
  _rebuild() {
    if (!this.model || !this.base) {
      this.current = this.base ? { ...this.base } : null;
      return;
    }
    const fit = this.fitFor(this.currentId);
    this.current = resolveWeapon(this.base, fit);
    if (this.base.kind === 'gun') {
      applyUpgrades(this.current, this.upgradesFor(this.currentId), this.base.mag);
    }
    // forge traits that are not stat multipliers
    if (this.base.forgeNoise) this.current.noiseMul *= this.base.forgeNoise;
    if (this.base.forgeFlash) this.current.flashMul *= this.base.forgeFlash;

    // Attachments and finish are mounted by the same code the armoury preview
    // uses, so the gun you built is the gun you carry.
    this.attachmentObjects = dressModel(
      this.model, fit, this.camoFor(this.currentId),
      camoTextureSize(Settings.get('textureQuality'))
    );

    const mounts = this.model.userData.mounts || {};

    // where ADS aligns: the optic's eye point, or the irons
    const opt = this.attachmentObjects.optic;
    if (opt && opt.parts.eye && mounts.optic) {
      this.opticEye.copy(mounts.optic.position).add(opt.parts.eye);
    } else {
      this.opticEye.copy(this.model.userData.sight);
    }

    // scope lens gets the live render target
    if (opt && opt.parts.lens) {
      const lens = opt.parts.lens;
      lens.material.dispose?.();
      lens.material = this.current.thermal
        ? makeThermalLensMaterial(this.scopeRT.texture)
        : new THREE.MeshBasicMaterial({ map: this.scopeRT.texture, toneMapped: false, transparent: true, opacity: 0 });
      lens.visible = false;
    }
  }

  get magazine() { return this.currentId ? (this.mags.get(this.currentId) || 0) : 0; }
  set magazine(v) { if (this.currentId) this.mags.set(this.currentId, v); }
  get reserve() {
    if (!this.current || this.current.kind !== 'gun') return 0;
    return this.game.inventory.count(this.current.ammo);
  }

  reloadIfEmpty() {
    if (this.current && this.current.kind === 'gun' && this.magazine === 0 && this.reserve > 0) this.startReload();
  }

  /* ================= reload ================= */

  startReload() {
    const w = this.current;
    if (!w || w.kind !== 'gun') return false;
    if (this.state === 'reloading') return false;
    if (this.magazine >= w.mag) return false;
    if (this.reserve <= 0) { Audio.denied(); this.game.ui.toast('No ammunition in reserve', 'bad'); return false; }
    this.state = 'reloading';
    this.reloadTotal = w.reload;
    this.reloadProgress = 0;
    this.adsTarget = 0;
    Audio.reloadStep(w.shellReload ? 'shell' : 'magOut');
    return true;
  }

  _finishReloadStep() {
    const w = this.current;
    if (w.shellReload) {
      if (this.magazine < w.mag && this.reserve > 0) {
        this.game.inventory.remove(w.ammo, 1);
        this.magazine += 1;
        Audio.reloadStep('shell');
        if (this.magazine < w.mag && this.reserve > 0) { this.reloadProgress = 0; return; }
      }
      this.state = 'idle';
      this.cooldown = Math.max(this.cooldown, 0.25);
      Audio.reloadStep('bolt');
    } else {
      const need = w.mag - this.magazine;
      const take = Math.min(need, this.reserve);
      this.game.inventory.remove(w.ammo, take);
      this.magazine += take;
      this.state = 'idle';
      Audio.reloadStep('magIn');
      this.cooldown = Math.max(this.cooldown, 0.12);
    }
  }

  /* ================= firing ================= */

  get spread() {
    const w = this.current;
    if (!w) return 0;
    const p = this.game.player;
    const base = w.spread * (1 - this.ads) + (w.adsSpread ?? w.spread * 0.25) * this.ads;
    let m = 1;
    if (p.moving) m *= p.sprinting ? 2.6 : 1.5;
    if (!p.grounded) m *= 2.2;
    if (p.crouching) m *= w.bipod ? 0.4 : 0.62;
    if (this.game.stats.stamina < 25) m *= 1.35;
    if (this.game.stats.health < 30) m *= 1.2;
    return base * m + this.spreadBloom;
  }

  canFire() {
    if (!this.current) return false;
    if (this.cooldown > 0) return false;
    if (this.state === 'equipping') return false;
    return true;
  }

  tryFire() {
    const w = this.current;
    if (!w) { this.punch(); return; }
    if (w.kind === 'melee') { this.doMelee(); return; }
    if (!this.canFire()) return;

    if (this.state === 'reloading') {
      if (w.shellReload && this.magazine > 0) this.state = 'idle';   // pump interrupt
      else return;
    }
    if (this.magazine <= 0) {
      Audio.dryFire();
      this.cooldown = 0.35;
      if (this.reserve > 0) this.startReload();
      else this.game.ui.toast('Empty — no reserve for this weapon', 'bad');
      return;
    }

    this.magazine -= 1;
    this.cooldown = 1 / w.rate;
    this.state = 'firing';
    this.game.stats.shotsFired++;

    const rMul = (1 - this.ads * 0.35) * (this.game.player.crouching ? 0.85 : 1);
    this.game.player.addRecoil(w.recoil * 0.0085 * rMul, (Math.random() - 0.5) * w.recoil * 0.0055 * rMul);
    this.kickVel -= w.recoil * 0.9;
    this.spreadBloom = Math.min(w.spread * 3.2, this.spreadBloom + w.spread * (w.auto ? 0.55 : 0.9));

    const muzzleWorld = this.muzzleWorldPosition();
    Audio.gunshot(w.profile, muzzleWorld);
    // The rest of the squad hears and sees this shot from where it was fired,
    // which is most of what tells you where your friends are in the dark.
    if (this.game.net?.online) this.game.net.reportShot(muzzleWorld, this.game.player.forward, w.profile);
    const flashScale = (w.profile === 'shotgun' || w.profile === 'rifle' ? 1.5 : 1.0) * (w.flashMul !== undefined ? w.flashMul : 1);
    if (flashScale > 0.05) {
      this.game.fx.muzzleFlash(this.muzzleLocalPosition().clone(), flashScale);
      this.game.fx.setFlashWorldPos(muzzleWorld);
    }
    const noise = w.noiseMul !== undefined ? w.noiseMul : 1;
    this.game.player.emitNoise(noise);
    this.game.world.onGunshot(this.game.player.position, w.range * noise);

    Input.rumble(Math.min(1, 0.16 + w.recoil * 0.16), Math.min(1, 0.10 + w.recoil * 0.09),
      w.profile === 'shotgun' || w.profile === 'rifle' ? 150 : 85);

    const pellets = w.pellets || 1;
    const origin = this.game.camera.getWorldPosition(_o);
    const baseDir = this.game.camera.getWorldDirection(_d).clone();
    let anyHit = false, anyKill = false;
    for (let i = 0; i < pellets; i++) {
      const dir = _dir.copy(baseDir);
      const s = this.spread;
      dir.x += (Math.random() + Math.random() - 1) * s;
      dir.y += (Math.random() + Math.random() - 1) * s;
      dir.z += (Math.random() + Math.random() - 1) * s * 0.4;
      dir.normalize();
      const res = this.game.world.raycast(origin, dir, w.range, this.game.entities);
      const end = res ? res.point : _end.copy(origin).addScaledVector(dir, w.range);
      if (i === 0 || pellets <= 3 || Math.random() < 0.4) {
        this.game.fx.tracer(muzzleWorld, end, w.profile === 'rifle' ? 0xfff0c0 : 0xffd9a0, pellets > 1 ? 0.7 : 1);
      }
      if (res) {
        if (res.entity) {
          const head = res.part === 'head';
          const dmg = w.damage * (head ? w.headMul : 1) * this.game.difficulty.dmgDealt;
          const killed = this.game.damage.applyToEntity(res.entity, dmg, dir, res.point, head ? 'head' : 'body', 'gun');
          anyHit = true; anyKill = anyKill || killed;
          this.game.fx.blood(res.point, _n.copy(dir).negate(), head ? 22 : 12);
          Audio.impact('flesh', res.point);
        } else {
          this.game.fx.impact(res.point, res.normal, res.material);
          Audio.impact(res.material, res.point);
          this.game.world.onImpactNoise(res.point);
        }
        if (this.game.sandbox && this.game.sandbox.explosive) this._explode(res ? res.point : end);
      }
    }
    if (anyHit) {
      this.game.stats.shotsHit++;
      this.game.ui.hitmarker(anyKill);
      Input.rumble(anyKill ? 0.42 : 0.14, anyKill ? 0.30 : 0.22, anyKill ? 170 : 60);
    }

    if (w.boltAction && this.magazine > 0) {
      this.boltPending = true;
      this.cooldown = Math.max(this.cooldown, 1 / w.rate);
      setTimeout(() => { if (this.currentId) Audio.reloadStep('bolt'); }, 260);
    }
    if (this.magazine === 0) setTimeout(() => this.reloadIfEmpty(), 220);
  }

  /** Sandbox explosive rounds: a blast at the point of impact. */
  _explode(point, radius = 6.5, damage = 90) {
    this.game.fx.muzzleFlash(new THREE.Vector3(0, 0, 0), 0);
    this.game.fx.impact(point, _n.set(0, 1, 0), 'rock');
    this.game.fx.debris(point, _n.set(0, 1, 0), 22, [0.5, 0.3, 0.12], 9);
    Audio.impact('metal', point);
    for (const e of this.game.entities.active) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(point);
      if (d > radius) continue;
      const dir = _dir.copy(e.position).sub(point).normalize();
      this.game.damage.applyToEntity(e, damage * (1 - d / radius), dir, point, 'body', 'explosion', 1.4);
    }
  }

  punch() {
    if (this.cooldown > 0) return;
    this.cooldown = 0.7;
    this.meleeSwing = 1;
    Audio.meleeSwing(this.game.player.position);
    this._meleeHit({ damage: 9, range: 1.9, arc: 0.6, headMul: 1.2, staminaCost: 4 });
  }

  doMelee() {
    if (this.cooldown > 0 || this.state === 'reloading') return;
    const w = this.current;
    if (this.game.stats.stamina < w.staminaCost) { Audio.denied(); return; }
    this.game.stats.useStamina(w.staminaCost);
    this.cooldown = 1 / w.rate;
    this.meleeSwing = 1;
    this.state = 'melee';
    Audio.meleeSwing(this.game.player.position);
    this.game.player.emitNoise(0.22);
    setTimeout(() => this._meleeHit(w), Math.min(220, 900 / w.rate * 0.35));
  }

  _meleeHit(w) {
    const origin = this.game.camera.getWorldPosition(_o);
    const dir = this.game.camera.getWorldDirection(_d);
    let hit = false, killed = false;
    for (const e of this.game.entities.active) {
      if (!e.alive) continue;
      const dx = e.position.x - origin.x, dy = (e.position.y + e.height * 0.5) - origin.y, dz = e.position.z - origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > w.range + e.radius) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(0.001, dist);
      if (dot < 1 - w.arc) continue;
      const dmg = w.damage * this.game.difficulty.dmgDealt;
      _n.set(dx / dist, dy / dist, dz / dist);
      _p.copy(origin).addScaledVector(_n, dist * 0.85);
      killed = this.game.damage.applyToEntity(e, dmg, _n, _p, 'body', 'melee', w.stagger || 0.4) || killed;
      this.game.fx.blood(_p, _n, 14);
      Audio.meleeHit(_p);
      hit = true;
      break;
    }
    if (hit) { this.game.ui.hitmarker(killed); Input.rumble(0.5, 0.35, 180); }
    else {
      const res = this.game.world.raycast(origin, dir, w.range, null);
      if (res) {
        this.game.fx.impact(res.point, res.normal, res.material);
        Audio.impact(res.material, res.point);
      }
    }
  }

  muzzleLocalPosition() {
    if (!this.model) return _m.set(0, 0, -0.3);
    const mz = this.model.userData.mounts && this.model.userData.mounts.muzzle;
    const extra = this.attachmentObjects.muzzle ? -0.10 : 0;
    if (mz) return _m.copy(mz.position).add(this.model.position).add(_v2.set(0, 0, extra));
    return _m.copy(this.model.userData.muzzle).add(this.model.position);
  }

  muzzleWorldPosition() {
    if (!this.model) return this.game.camera.getWorldPosition(_o).clone();
    _m.copy(this.muzzleLocalPosition());
    _m.multiplyScalar(this.root.scale.x);
    _m.applyMatrix4(this.game.camera.matrixWorld);
    return _m;
  }

  /* ================= per-frame ================= */

  update(dt, allowInput) {
    const w = this.current;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.stateTime > 0) {
      this.stateTime -= dt;
      if (this.stateTime <= 0 && this.state === 'equipping') this.state = 'idle';
    }
    this.spreadBloom *= Math.pow(0.02, dt);

    /* ---- ADS ---- */
    if (allowInput && w && w.kind === 'gun') {
      this.adsTarget = Input.mouse.right && this.state !== 'reloading' && !this.game.player.sprinting ? 1 : 0;
      if (this.game.player.sprinting) this.adsTarget = 0;
    } else this.adsTarget = 0;
    const adsSpeed = w && w.adsTime ? dt / w.adsTime : dt * 6;
    this.ads += Math.sign(this.adsTarget - this.ads) * Math.min(Math.abs(this.adsTarget - this.ads), adsSpeed);
    this.game.player.adsFactor = 1 - this.ads * (1 - Settings.get('adsSensitivity'));
    this.game.player.aiming = this.ads > 0.5;
    this.game.player.reloading = this.state === 'reloading';

    // Non-magnified optics pull the main FOV in slightly, the way a 1x optic
    // draws your eye. Magnified optics do NOT touch the main FOV — that is what
    // keeps the world outside the tube at normal scale while the tube itself
    // shows the magnified image.
    if (this.game.baseFov) {
      const targetFov = w && !w.magnified && w.zoom > 1
        ? this.game.baseFov / (1 + (w.zoom - 1) * this.ads)
        : this.game.baseFov;
      if (Math.abs(this.game.camera.fov - targetFov) > 0.01) {
        this.game.camera.fov += (targetFov - this.game.camera.fov) * Math.min(1, dt * 12);
        this.game.camera.updateProjectionMatrix();
      }
    }

    /* ---- firing input ---- */
    if (allowInput && w) {
      const held = Input.mouse.left;
      if (w.kind === 'gun') {
        if (w.auto ? held : (held && !this._triggerHeld)) this.tryFire();
      } else if (held && !this._triggerHeld) this.tryFire();
      this._triggerHeld = held;
    } else this._triggerHeld = false;

    /* ---- reload progress ---- */
    if (this.state === 'reloading') {
      this.reloadProgress += dt;
      const step = w.shellReload ? w.reload : this.reloadTotal;
      if (this.reloadProgress >= step) this._finishReloadStep();
    }

    /* ---- sway ---- */
    const lookDX = (this.game.player.yaw - this._lastLookX);
    const lookDY = (this.game.player.pitch - this._lastLookY);
    this._lastLookX = this.game.player.yaw;
    this._lastLookY = this.game.player.pitch;
    const swayMul = (w ? w.sway || 1 : 1) * (1 - this.ads * 0.75);
    this.swayVel.x += -lookDX * 2.4 * swayMul;
    this.swayVel.y += lookDY * 1.8 * swayMul;
    this.swayVel.multiplyScalar(Math.pow(0.0009, dt));
    this.swayPos.x += (this.swayVel.x - this.swayPos.x * 9) * dt;
    this.swayPos.y += (this.swayVel.y - this.swayPos.y * 9) * dt;
    this.swayPos.x = THREE.MathUtils.clamp(this.swayPos.x, -0.05, 0.05);
    this.swayPos.y = THREE.MathUtils.clamp(this.swayPos.y, -0.05, 0.05);

    this.kickVel += (-this.kick * 220 - this.kickVel * 22) * dt;
    this.kick += this.kickVel * dt * 0.01;
    this.meleeSwing = Math.max(0, this.meleeSwing - dt * (w && w.kind === 'melee' ? w.rate * 1.4 : 2.4));

    this.updateLaser();
    this.poseModel(dt);
  }

  /** Project the laser dot onto whatever it is pointing at. */
  updateLaser() {
    const laser = this.attachmentObjects.laser;
    if (!laser || !laser.parts.visibleBeam) {
      if (this._laserDot) this._laserDot.visible = false;
      return;
    }
    if (!this._laserDot) {
      this._laserDot = new THREE.Sprite(new THREE.SpriteMaterial({
        color: laser.parts.color, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      this._laserDot.scale.set(0.05, 0.05, 1);
      this.game.scene.add(this._laserDot);
    }
    const origin = this.game.camera.getWorldPosition(_o);
    const dir = this.game.camera.getWorldDirection(_d);
    const res = this.game.world.raycast(origin, dir, 80, this.game.entities);
    if (res) {
      this._laserDot.visible = true;
      this._laserDot.position.copy(res.point).addScaledVector(dir, -0.02);
      this._laserDot.scale.setScalar(0.02 + res.dist * 0.0016);
    } else this._laserDot.visible = false;
  }

  poseModel(dt) {
    if (!this.model) return;
    const w = this.current;
    const key = w ? w.viewModel : 'none';
    const hip = HIP_POSE[key] || HIP_POSE.none;
    const p = this.game.player;

    // hip -> ADS: bring the optic's eye point onto the camera axis at a
    // distance that suits the sight being used.
    const eye = this.opticEye;
    const scale = this.root.scale.x || 1;
    const dist = w && w.magnified ? ADS_EYE_DIST.magnified
      : (w && w.optic && w.optic.id !== 'iron') ? ADS_EYE_DIST.reflex : ADS_EYE_DIST.iron;
    const adsX = -eye.x, adsY = -eye.y - 0.004, adsZ = -(dist / scale) - eye.z;
    const t = this.ads;
    let px = hip.pos[0] * (1 - t) + adsX * t;
    let py = hip.pos[1] * (1 - t) + adsY * t;
    let pz = hip.pos[2] * (1 - t) + adsZ * t;

    const bob = p.bobAmount * (1 - t * 0.8) * Settings.get('headBob');
    px += Math.cos(p.bobPhase) * 0.012 * bob + this.swayPos.x;
    py += Math.sin(p.bobPhase * 2) * 0.010 * bob + this.swayPos.y - p.landDip * 0.5;
    const breathe = Math.sin(p.breathPhase) * (this.game.stats.exhausted ? 0.010 : 0.003) * (1 - t * 0.5);
    py += breathe;

    const sprintT = p.sprinting ? 1 : 0;
    this._sprintBlend = (this._sprintBlend || 0) + (sprintT - (this._sprintBlend || 0)) * Math.min(1, dt * 8);
    px += this._sprintBlend * 0.06;
    py -= this._sprintBlend * 0.05;
    pz += this._sprintBlend * 0.03;

    pz += this.kick * 0.0016;
    py += -this.kick * 0.0004;

    let rollExtra = 0, pitchExtra = 0;
    if (this.state === 'reloading') {
      const f = Math.min(1, this.reloadProgress / Math.max(0.001, this.reloadTotal));
      const s = Math.sin(f * Math.PI);
      py -= s * 0.09;
      rollExtra = -s * 0.5;
      pitchExtra = s * 0.35;
    }
    if (this.state === 'equipping') {
      const f = 1 - Math.max(0, this.stateTime) / 0.32;
      py -= (1 - f) * 0.22;
      pitchExtra += (1 - f) * 0.6;
    }
    if (this.meleeSwing > 0) {
      const s = Math.sin(this.meleeSwing * Math.PI);
      pitchExtra -= s * 0.9;
      px -= s * 0.10;
      rollExtra += s * 0.5;
    }

    this.model.position.set(px, py, pz);
    this.model.rotation.set(
      hip.rot[0] * (1 - t) + pitchExtra - this.kick * 0.0009,
      hip.rot[1] * (1 - t) - this.swayPos.x * 3.0 + this._sprintBlend * 0.5,
      hip.rot[2] * (1 - t) + rollExtra + this.swayPos.x * 2.0 - this._sprintBlend * 0.25
    );
  }

  serialize() {
    // Builds live in the armoury and serialise there; only the ammunition
    // actually sitting in each weapon belongs to this system.
    return { mags: Array.from(this.mags.entries()), equipped: this.currentId };
  }

  deserialize(d) {
    if (!d) return;
    this.mags = new Map(d.mags || []);
    // saves written before the armoury existed carried builds here
    if (this.armoury) {
      for (const [k, v] of d.fits || []) if (!this.armoury.fits.has(k)) this.armoury.fits.set(k, v);
      for (const [k, v] of d.camos || []) if (!this.armoury.camos.has(k)) this.armoury.camos.set(k, v);
    } else {
      this.fits = new Map(d.fits || []);
      this.camos = new Map(d.camos || []);
    }
    if (d.equipped) this.equip(d.equipped);
  }

  dispose() {
    this.scopeRT && this.scopeRT.dispose();
    if (this.scopeOverlay) {
      for (const o of this.scopeOverlay.children) { o.geometry.dispose(); o.material.dispose(); }
      this.scopeOverlay.parent && this.scopeOverlay.parent.remove(this.scopeOverlay);
    }
    if (this._laserDot) { this._laserDot.material.dispose(); this._laserDot = null; }
  }
}

/* ------------------------------------------------------------------ */

/**
 * Scope image: the second render, lifted slightly and vignetted at the edge.
 * Real glass gathers light, and without the gain a night scope is a black disc.
 */
function makeScopeImageMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: map }, opacity: { value: 0 }, gain: { value: 1.55 } },
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float opacity; uniform float gain; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb * gain;
        float r = distance(vUv, vec2(0.5)) * 2.0;
        c *= smoothstep(1.02, 0.72, r);                 // edge falloff inside the tube
        c += vec3(0.012, 0.016, 0.020) * (1.0 - r);     // faint coating bloom
        gl_FragColor = vec4(c, opacity);
      }`,
  });
}

/** Thermal optic: luminance through a heat ramp, with living things blown out. */
function makeThermalLensMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: map }, opacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float opacity; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        l = pow(clamp(l * 3.2, 0.0, 1.0), 0.75);
        vec3 cold = vec3(0.02, 0.05, 0.12);
        vec3 mid  = vec3(0.15, 0.55, 0.45);
        vec3 hot  = vec3(1.0, 0.92, 0.55);
        vec3 outc = l < 0.5 ? mix(cold, mid, l * 2.0) : mix(mid, hot, (l - 0.5) * 2.0);
        gl_FragColor = vec4(outc, opacity);
      }`,
  });
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Vector3();
const _v2 = new THREE.Vector3();
