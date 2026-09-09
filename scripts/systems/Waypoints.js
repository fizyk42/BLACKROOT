/**
 * Waypoints — where to go, and how far.
 *
 * Two halves that have to agree with each other:
 *
 *  - a **world beacon**: a column of light and a slowly turning diamond at the
 *    objective, drawn without depth testing so it shows through terrain. You
 *    can see where you are going from anywhere on the map, which is the whole
 *    point of a waypoint.
 *  - a **HUD marker**: the same objective projected to the screen with its
 *    label and distance, and — this is the part that actually stops people
 *    getting lost — an arrow pinned to the screen edge pointing at it when it
 *    is behind you or off to one side.
 *
 * The objective is chosen automatically and in priority order, so the player
 * is never asked to manage a quest log: the open rift first (that is the way
 * out), then the biome's boss once it is awake, then the nearest place you
 * have not found yet. Anything the player pins themselves outranks all of it.
 */
import * as THREE from 'three';
import { Settings } from '../core/Settings.js';

const _col = new THREE.Color();

const KIND_STYLE = {
  rift:      { color: 0xc0a15a, label: 'THE RIFT', icon: '◈' },
  boss:      { color: 0xb8382a, label: 'THE BOSS', icon: '✖' },
  landmark:  { color: 0x8fb0c0, label: 'UNEXPLORED', icon: '◆' },
  custom:    { color: 0x6f9a72, label: 'MARKED', icon: '⬤' },
  squad:     { color: 0x63a8d6, label: 'SQUAD', icon: '◉' },
  mate:      { color: 0x8fd694, label: 'SQUAD', icon: '▲' },
  camp:      { color: 0xd8a45a, label: 'CAMP', icon: '⌂' },
};

export class Waypoints {
  constructor(game) {
    this.game = game;
    this.list = [];             // player-pinned markers
    this.active = null;         // the objective being shown
    this._nextId = 1;

    this.group = new THREE.Group();
    this.group.renderOrder = 90;
    this._buildBeacon();
    this._buildWisp();
  }

  attach(scene) { scene.add(this.group); scene.add(this.wisp); }

  /* ================= the world beacon ================= */

  _buildBeacon() {
    const mat = (color, opacity) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthTest: false, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide, fog: false,
    });

    // A tall, soft column. Tapered and faded at the top so it reads as light
    // rather than as a solid post someone left in the woods.
    const colGeo = new THREE.CylinderGeometry(0.55, 1.5, 70, 10, 1, true);
    colGeo.translate(0, 35, 0);
    this.column = new THREE.Mesh(colGeo, mat(0xffffff, 0.10));
    this.group.add(this.column);

    const coreGeo = new THREE.CylinderGeometry(0.14, 0.4, 70, 8, 1, true);
    coreGeo.translate(0, 35, 0);
    this.core = new THREE.Mesh(coreGeo, mat(0xffffff, 0.32));
    this.group.add(this.core);

    // The diamond sits at head height where the thing actually is.
    this.diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), mat(0xffffff, 0.9));
    this.diamond.position.y = 2.6;
    this.group.add(this.diamond);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.9, 32), mat(0xffffff, 0.55));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.14;
    this.group.add(this.ring);

    for (const o of this.group.children) o.frustumCulled = false;
    this.group.visible = false;
  }

  /* ================= the guide ================= */

  /**
   * A lantern that goes on ahead of you.
   *
   * A column of light on the horizon tells you *where* the objective is; it
   * does not tell you how to get there, and in a forest those are different
   * questions — the straight line runs into a cliff, a lake, or a wall of
   * trunks. So the objective marker is joined by something to physically
   * follow: a small light that hangs a few metres ahead at head height, moves
   * off when you close on it, waits when you fall behind, and lights the
   * ground it is standing over so you can see what you are walking onto.
   *
   * It is drawn with depth testing on, unlike the beacon, precisely so that it
   * disappears behind a rock the moment the straight line stops working — that
   * is the cue to go around, and it is information the beacon cannot give you.
   */
  _buildWisp() {
    this.wisp = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff0cf, toneMapped: false, fog: false })
    );
    this.wispCore = core;
    this.wisp.add(core);

    // Two nested shells rather than a sprite: a sprite always faces you and
    // reads as a UI decal, and this has to read as a thing in the world.
    for (const [r, o, c] of [[0.22, 0.34, 0xffd89a], [0.42, 0.13, 0xffc477]]) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(r, 12, 10),
        new THREE.MeshBasicMaterial({
          color: c, transparent: true, opacity: o, depthWrite: false,
          blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
        })
      );
      this.wisp.add(halo);
      (this.wispHalos = this.wispHalos || []).push(halo);
    }

    this.wispLight = new THREE.PointLight(0xffdca8, 9, 16, 1.2);
    this.wisp.add(this.wispLight);

    // A pool on the ground under it, so you can see the footing it is over.
    this.wispPool = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd28a, transparent: true, opacity: 0.14, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      })
    );
    this.wispPool.rotation.x = -Math.PI / 2;
    this.wisp.add(this.wispPool);

    this.wisp.visible = false;
    this._wispPos = new THREE.Vector3();
    this._wispHave = false;
    this._wispTrail = 0;
  }

  /**
   * Move the guide. It leads by a distance that shortens as you arrive, sits
   * on the ground rather than inside it, and never gets so far ahead that it
   * stops being a thing you are following.
   */
  _updateWisp(dt, obj, dist) {
    const G = this.game;
    if (!obj || !Settings.get('guide') || !Settings.get('waypoints')) { this.wisp.visible = false; this._wispHave = false; return; }
    const p = G.player.position;
    const T = G.world.terrain;

    let tx = obj.x, tz = obj.z;
    let dx = tx - p.x, dz = tz - p.z;
    const flat = Math.hypot(dx, dz) || 1;
    // Lead by up to twelve metres, but never past the objective itself. Once
    // you are within a few metres it stops leading and settles onto the thing
    // you came for — a guide hovering two metres in front of your face is a
    // nuisance, not a help.
    let gx, gz;
    if (flat < 4) { gx = tx; gz = tz; }
    else { const lead = Math.min(flat - 0.5, 12); gx = p.x + (dx / flat) * lead; gz = p.z + (dz / flat) * lead; }

    const gy = T.heightAt(gx, gz) + 1.65 + Math.sin(G.time * 1.7) * 0.16;
    if (!this._wispHave) { this._wispPos.set(gx, gy, gz); this._wispHave = true; }
    else {
      // Chase the ideal spot rather than snapping to it: a light that jumps
      // every time you turn your head is a UI element, not a companion.
      const k = Math.min(1, dt * 3.4);
      this._wispPos.x += (gx - this._wispPos.x) * k;
      this._wispPos.y += (gy - this._wispPos.y) * k;
      this._wispPos.z += (gz - this._wispPos.z) * k;
    }
    this.wisp.position.copy(this._wispPos);
    this.wisp.visible = true;

    const style = KIND_STYLE[obj.kind] || KIND_STYLE.custom;
    const pulse = 0.82 + Math.sin(G.time * 3.1) * 0.18;
    this.wispCore.material.color.setHex(0xffffff).lerp(_col.setHex(style.color), 0.35);
    for (const h of this.wispHalos) h.material.color.setHex(style.color);
    // Brighter the further you have to go; it settles as you arrive so it does
    // not blow out the thing you came to look at.
    const near = Math.min(1, Math.max(0, (dist - 3) / 12));
    this.wispLight.intensity = 9 * pulse * near * Settings.get('brightness');
    this.wispPool.position.y = -(this._wispPos.y - T.heightAt(this._wispPos.x, this._wispPos.z)) + 0.06;
    this.wispPool.material.opacity = 0.14 * near;

    // A thin trail of embers behind it, so you can see the line it took even
    // when it is briefly out of sight behind a trunk.
    this._wispTrail -= dt;
    if (this._wispTrail <= 0 && G.fx && dist > 6) {
      this._wispTrail = 0.09;
      G.fx.emit(this._wispPos, (Math.random() - 0.5) * 0.2, -0.25 - Math.random() * 0.3, (Math.random() - 0.5) * 0.2,
        [1.0, 0.82, 0.52], 0.05, 1.1, 1.4, 0.02);
    }
  }

  /* ================= pins ================= */

  /** Drop a marker the player asked for. Returns it. */
  pin(x, z, label = 'Marked position') {
    const y = this.game.world.terrain.heightAt(x, z);
    const wp = { id: this._nextId++, x, y, z, label, kind: 'custom', pinned: true };
    this.list.push(wp);
    return wp;
  }

  /** Pin whatever the player is looking at, out to 300 m. */
  pinAhead() {
    const cam = this.game.camera;
    const o = cam.getWorldPosition(_o);
    const d = cam.getWorldDirection(_d);
    const hit = this.game.world.raycast(o, d, 300, null);
    const p = hit ? hit.point : _p.copy(o).addScaledVector(d, 90);
    return this.pin(p.x, p.z, 'Marked position');
  }

  /**
   * A mark somebody else in the squad dropped. It expires on its own, because
   * eight people pinning things over the course of an hour would otherwise
   * turn the screen into a christmas tree.
   */
  addNetPing(x, y, z, label = 'Squad mark', ttl = 120) {
    const wp = {
      id: this._nextId++, x,
      y: Number.isFinite(y) ? y : this.game.world.terrain.heightAt(x, z),
      z, label, kind: 'squad', pinned: false, ttl,
    };
    this.list.push(wp);
    // Never more than four foreign marks at once; the oldest goes first.
    let squad = this.list.filter((w) => w.kind === 'squad');
    while (squad.length > 4) { this.list.splice(this.list.indexOf(squad[0]), 1); squad = squad.slice(1); }
    return wp;
  }

  clearPins() { this.list = this.list.filter((w) => w.kind === 'squad'); }

  togglePinAhead() {
    if (this.list.length) { this.clearPins(); return null; }
    return this.pinAhead();
  }

  /* ================= objective selection ================= */

  /**
   * Decide what the player should be heading towards. Player pins win; then
   * the way out; then the thing standing between them and it.
   */
  chooseObjective() {
    const G = this.game;
    if (this.list.length) {
      const p = G.player.position;
      let best = null, bd = Infinity;
      for (const w of this.list) {
        const d = Math.hypot(w.x - p.x, w.z - p.z);
        if (d < bd) { bd = d; best = w; }
      }
      return best;
    }
    if (G.riftOpen && G.riftObject) {
      return { x: G.riftObject.x, y: G.riftObject.y, z: G.riftObject.z, kind: 'rift', label: 'Step through the rift' };
    }
    if (G.bossAlive && G.boss) {
      const b = G.boss;
      // Before it is awake it is a rumour: point at the arena, not the model.
      const known = b.awake || G.bossLandmark?.discovered;
      const t = known ? b.position : (G.bossLandmark || b.position);
      return {
        x: t.x, y: (t.y ?? G.world.terrain.heightAt(t.x, t.z)), z: t.z, kind: 'boss',
        label: b.awake ? b.def.name : 'Something enormous',
      };
    }
    const n = G.world.nearestUndiscovered(G.player.position);
    if (n) {
      return { x: n.lm.x, y: n.lm.y, z: n.lm.z, kind: 'landmark', label: 'Somewhere you have not been' };
    }
    return null;
  }

  /* ================= per-frame ================= */

  update(dt) {
    // Marks dropped by other players time out on their own.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i];
      if (w.ttl === undefined) continue;
      w.ttl -= dt;
      if (w.ttl <= 0) this.list.splice(i, 1);
    }
    if (!Settings.get('waypoints')) {
      this.group.visible = false;
      this.active = null;
      return;
    }
    const obj = this.chooseObjective();
    this.active = obj;
    if (!obj) { this.group.visible = false; this.wisp.visible = false; this._wispHave = false; return; }

    const style = KIND_STYLE[obj.kind] || KIND_STYLE.custom;
    const p = this.game.player.position;
    const dist = Math.hypot(obj.x - p.x, obj.z - p.z);

    this.group.visible = true;
    this.group.position.set(obj.x, obj.y ?? this.game.world.terrain.heightAt(obj.x, obj.z), obj.z);

    const t = this.game.time;
    this.diamond.rotation.y = t * 1.1;
    this.diamond.rotation.x = Math.sin(t * 0.8) * 0.35;
    this.diamond.position.y = 2.6 + Math.sin(t * 1.6) * 0.22;
    this.ring.scale.setScalar(1 + Math.sin(t * 1.6) * 0.06);

    // Close up the column is in the way; far away it is the only thing you
    // can see. So it fades out as you arrive.
    const near = Math.max(0, Math.min(1, (dist - 6) / 18));
    for (const [mesh, base] of [[this.column, 0.10], [this.core, 0.32], [this.ring, 0.55], [this.diamond, 0.9]]) {
      mesh.material.color.setHex(style.color);
      mesh.material.opacity = base * (mesh === this.diamond || mesh === this.ring ? 1 : near);
    }

    this.objectiveInfo = { ...obj, dist, style };
    this._updateWisp(dt, obj, dist);
  }

  /** Everything the HUD needs to draw markers this frame. */
  markers() {
    const out = [];
    if (!Settings.get('waypoints')) return out;
    const p = this.game.player.position;
    if (this.objectiveInfo) {
      out.push({ ...this.objectiveInfo, primary: true });
    }
    // Discovered landmarks are worth showing as secondary markers so the
    // player can find their way back to a place they have already looted.
    for (const lm of this.game.world.landmarks) {
      if (!lm.discovered) continue;
      const dist = Math.hypot(lm.x - p.x, lm.z - p.z);
      if (dist > 260) continue;
      const kind = lm.type === 'camp' ? 'camp' : 'landmark';
      out.push({
        x: lm.x, y: lm.y, z: lm.z, dist, kind,
        label: lm.label, style: KIND_STYLE[kind], primary: false, faded: true,
      });
    }

    // Everyone else in the squad. In a black forest this is the difference
    // between co-op and four people playing single-player in the same room.
    const net = this.game.net;
    if (net && net.online) {
      for (const mate of net.players.values()) {
        const g = mate.group.position;
        // Close enough to see them? Then a marker over their head is clutter,
        // unless they are on the ground and you are looking for them.
        if (!mate.down && Math.hypot(g.x - p.x, g.z - p.z) < 9) continue;
        out.push({
          x: g.x, y: g.y + 2.0, z: g.z,
          dist: Math.hypot(g.x - p.x, g.z - p.z),
          kind: 'mate',
          label: mate.down ? `${mate.name} — DOWN` : mate.name,
          style: mate.down ? KIND_STYLE.boss : KIND_STYLE.mate,
          primary: false, faded: !mate.down,
        });
      }
    }
    return out;
  }

  dispose() {
    for (const o of this.group.children) { o.geometry.dispose(); o.material.dispose(); }
    this.group.parent?.remove(this.group);
    for (const o of this.wisp.children) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
    this.wisp.parent?.remove(this.wisp);
  }
}

export { KIND_STYLE };

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
