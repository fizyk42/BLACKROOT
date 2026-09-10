// One rigged mannequin (CC0, Quaternius Universal Animation Library) is loaded once
// and cloned for the player, pedestrians, story NPCs and remote players.
// Verified from the rig's inverse bind matrices: the toes point along +Z, which
// matches our forward convention, so no yaw offset is needed.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { damp } from '../core/util.js';

export const MODEL_YAW_OFFSET = 0;

export const CLIPS = {
  idle: 'Idle_Loop',
  talk: 'Idle_Talking_Loop',
  walk: 'Walk_Loop',
  walkFormal: 'Walk_Formal_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  crouchIdle: 'Crouch_Idle_Loop',
  crouchWalk: 'Crouch_Fwd_Loop',
  jumpStart: 'Jump_Start',
  jumpLoop: 'Jump_Loop',
  jumpLand: 'Jump_Land',
  drive: 'Driving_Loop',
  sitIdle: 'Sitting_Idle_Loop',
  sitEnter: 'Sitting_Enter',
  aimIdle: 'Pistol_Idle_Loop',
  aim: 'Pistol_Aim_Neutral',
  aimUp: 'Pistol_Aim_Up',
  shoot: 'Pistol_Shoot',
  reload: 'Pistol_Reload',
  punchA: 'Punch_Jab',
  punchB: 'Punch_Cross',
  punchEnter: 'Punch_Enter',
  hit: 'Hit_Chest',
  die: 'Death01',
  interact: 'Interact',
  fixing: 'Fixing_Kneeling',
  push: 'Push_Loop',
  dance: 'Dance_Loop',
  roll: 'Roll',
  swim: 'Swim_Fwd_Loop',
};

let _asset = null;

export async function loadCharacterAsset(url = 'assets/characters/citizen.gltf', onProgress) {
  if (_asset) return _asset;
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) => {
    loader.load(url, res, (e) => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
    }, rej);
  });
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  _asset = { scene: gltf.scene, clips };
  return _asset;
}

export function availableClips() { return _asset ? Object.keys(_asset.clips) : []; }

// Wardrobe: the mannequin has a body material and a joint material, so an outfit is
// two colours plus a name. Deliberately simple, and swapping in a textured character
// model later only means replacing the material assignment below.
export const OUTFITS = [
  { id: 'homecoming', name: 'Travel Clothes', body: 0x3d4a58, joints: 0xc9a483, price: 0 },
  { id: 'mechanic', name: 'Shop Coveralls', body: 0x2f4a3c, joints: 0xc9a483, price: 260 },
  { id: 'street', name: 'Street Casual', body: 0x8d3a2e, joints: 0xc9a483, price: 340 },
  { id: 'racer', name: 'Race Suit', body: 0x1b1e24, joints: 0xd8d2c6, price: 900 },
  { id: 'linen', name: 'Coast Linen', body: 0xe0d6c2, joints: 0xc9a483, price: 620 },
  { id: 'night', name: 'Afterhours Black', body: 0x14161a, joints: 0xc9a483, price: 1450 },
  { id: 'hivis', name: 'Courier Hi-Vis', body: 0xd8b02a, joints: 0xc9a483, price: 180 },
  { id: 'formal', name: 'Sloane Function Suit', body: 0x22262e, joints: 0xe6d8c6, price: 3200 },
];

export const SKIN_TONES = [0xf0d0b4, 0xdcb493, 0xc9a483, 0xa97d5c, 0x7d5539, 0x54382a];

export class Character {
  constructor(opts = {}) {
    if (!_asset) throw new Error('Character asset not loaded — call loadCharacterAsset() first.');
    this.root = new THREE.Group();
    this.model = cloneSkinned(_asset.scene);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
        // Give every instance its own materials so outfits are independent.
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      }
    });
    this.materials = { body: null, joints: null };
    this.model.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (/joint/i.test(m.name)) this.materials.joints = m;
        else this.materials.body = m;
        m.roughness = 0.72;
        m.metalness = 0.0;
      }
    });

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();
    this.current = null;
    this.currentName = '';
    this.timeScale = 1;

    this.setOutfit(opts.outfit || OUTFITS[0], opts.skin ?? SKIN_TONES[2]);
    this.play('idle', 0);
  }

  action(key) {
    const clipName = CLIPS[key] || key;
    if (this.actions.has(clipName)) return this.actions.get(clipName);
    const clip = _asset.clips[clipName];
    if (!clip) return null;
    const a = this.mixer.clipAction(clip);
    a.clampWhenFinished = true;
    this.actions.set(clipName, a);
    return a;
  }

  play(key, fade = 0.18, { loop = true, speed = 1, force = false } = {}) {
    const clipName = CLIPS[key] || key;
    if (!force && this.currentName === clipName) {
      if (this.current) this.current.timeScale = speed;
      return this.current;
    }
    const next = this.action(key);
    if (!next) return this.current;
    next.reset();
    next.timeScale = speed;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current && this.current !== next && fade > 0) next.crossFadeFrom(this.current, fade, true);
    next.play();
    this.current = next;
    this.currentName = clipName;
    return next;
  }

  /** Fire a one-shot on an additive-ish upper layer by simply playing it non-looping. */
  playOnce(key, speed = 1) {
    return this.play(key, 0.08, { loop: false, speed, force: true });
  }

  setOutfit(outfit, skin) {
    this.outfit = outfit;
    if (this.materials.body) this.materials.body.color.setHex(outfit.body);
    if (this.materials.joints) this.materials.joints.color.setHex(skin ?? outfit.joints);
    this.skin = skin ?? outfit.joints;
  }

  setPosition(x, y, z) { this.root.position.set(x, y, z); }
  setYaw(y) { this.root.rotation.y = y + MODEL_YAW_OFFSET; }

  update(dt) { this.mixer.update(dt * this.timeScale); }

  dispose(scene) {
    if (scene) scene.remove(this.root);
    this.mixer.stopAllAction();
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}

/**
 * Picks a locomotion clip from a planar speed. Used by the player, pedestrians
 * and remote players so everybody moves the same way.
 */
export function locomotionFor(speed, crouched) {
  if (crouched) return speed > 0.35 ? { key: 'crouchWalk', speed: Math.max(0.6, speed / 1.4) } : { key: 'crouchIdle', speed: 1 };
  if (speed < 0.25) return { key: 'idle', speed: 1 };
  if (speed < 2.4) return { key: 'walk', speed: Math.max(0.55, speed / 1.5) };
  if (speed < 5.2) return { key: 'jog', speed: Math.max(0.7, speed / 4.0) };
  return { key: 'sprint', speed: Math.max(0.8, speed / 7.2) };
}
