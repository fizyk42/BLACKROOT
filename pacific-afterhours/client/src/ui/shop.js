// Every "walk up to a door and do business" interface lives here.

import { VEHICLES, PAINTS, UPGRADES } from '../entities/vehicle.js';
import { OUTFITS, SKIN_TONES } from '../entities/character.js';
import { WEAPONS } from '../entities/player.js';
import { BUSINESSES, PROPERTIES } from '../game/economy.js';
import { fmtMoney } from '../core/util.js';
import { escapeHtml } from './hud.js';

const $ = (id) => document.getElementById(id);

export class ShopUI {
  constructor(game) {
    this.game = game;
    this.el = $('shop');
    this.title = $('shop-title');
    this.cash = $('shop-cash');
    this.body = $('shop-body');
    this.open = false;
    this.current = null;
    $('shop-close').addEventListener('click', () => this.close());
  }

  close() {
    this.el.classList.add('hidden');
    this.open = false;
    this.current = null;
    this.game.onShopClosed();
  }

  show(poi) {
    this.current = poi;
    this.open = true;
    this.el.classList.remove('hidden');
    this.title.textContent = poi.name;
    this.refresh();
    this.game.onShopOpened();
  }

  refresh() {
    if (!this.open) return;
    this.cash.textContent = fmtMoney(this.game.economy.money);
    const kind = this.current.kind;
    const fn = {
      dealer: () => this.renderDealer(),
      garage: () => this.renderGarage(),
      tuning: () => this.renderGarage(true),
      clothing: () => this.renderWardrobe(),
      food: () => this.renderFood(),
      safehouse: () => this.renderSafehouse(),
      jobboard: () => this.renderJobBoard(),
      racehub: () => this.renderRaces(),
      hospital: () => this.renderHospital(),
      police: () => this.renderPolice(),
      story: () => this.renderStory(),
      landmark: () => this.renderStory(),
    }[kind];
    this.body.innerHTML = '';
    if (fn) fn(); else this.renderStory();
  }

  card({ title, desc, stats = [], price, action, label = 'Buy', owned = false, disabled = false, extra = '' }) {
    const d = document.createElement('div');
    d.className = 'item' + (owned ? ' owned' : '');
    d.innerHTML = `
      <h4>${escapeHtml(title)}</h4>
      <div class="desc">${escapeHtml(desc || '')}</div>
      ${stats.map((s) => `<div class="stat">${escapeHtml(s)}</div>`).join('')}
      ${price !== undefined ? `<div class="price">${price === 0 ? 'Free' : fmtMoney(price)}</div>` : ''}
      ${extra}
      ${action ? `<button ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>` : ''}
    `;
    if (action) {
      const b = d.querySelector('button');
      if (b && !disabled) b.addEventListener('click', () => { action(); this.refresh(); });
    }
    this.body.appendChild(d);
    return d;
  }

  note(text) {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML = `<div class="desc">${escapeHtml(text)}</div>`;
    this.body.appendChild(d);
  }

  // ---------------------------------------------------------------- dealer
  renderDealer() {
    const g = this.game;
    for (const spec of Object.values(VEHICLES)) {
      if (spec.noSell) continue;
      const owned = g.economy.vehicleList.some((v) => v.spec === spec.id);
      this.card({
        title: spec.name,
        desc: spec.blurb,
        stats: [
          `${spec.class} · ${spec.seats} seats`,
          `Top speed ${Math.round(spec.topSpeed * 3.6)} km/h`,
          `Grip ${spec.grip.toFixed(1)} · Mass ${spec.mass} kg`,
        ],
        price: spec.price,
        owned,
        label: 'Purchase',
        disabled: !g.economy.canAfford(spec.price) || g.economy.vehicleList.length >= g.economy.garageCapacity(),
        action: () => {
          const r = g.buyVehicle(spec.id);
          if (!r.ok) g.hud.toast(r.message || 'Cannot buy that.', 'bad');
        },
      });
    }
    const cap = g.economy.garageCapacity();
    this.note(`Garage space: ${g.economy.vehicleList.length} of ${cap}. Buy property for more space.`);
  }

  // ---------------------------------------------------------------- garage
  renderGarage(tuning = false) {
    const g = this.game;
    const v = g.player.vehicle;
    if (!v) {
      this.note('Drive a vehicle in here to work on it.');
      this.renderGarageList();
      return;
    }
    const owned = g.economy.ownsVehicle(v.id);

    this.card({
      title: `${v.displayName} · ${v.plate}`,
      desc: owned ? 'One of yours.' : 'Not registered to you. Repairs still cost money.',
      stats: [`Condition ${Math.round(v.health)}%`],
      price: v.health >= 99 ? undefined : Math.round((100 - v.health) * 6),
      label: 'Repair',
      disabled: v.health >= 99 || !g.economy.canAfford(Math.round((100 - v.health) * 6)),
      action: () => {
        const cost = Math.round((100 - v.health) * 6);
        if (g.economy.spend(cost, 'repair').ok) { v.repair(); g.hud.toast('Repaired.', 'good'); }
      },
    });

    if (!owned) {
      this.note('Upgrades and paint are only available on vehicles you own.');
      return;
    }

    for (const [key, up] of Object.entries(UPGRADES)) {
      const lvl = v.upgrades[key] || 0;
      const next = lvl + 1;
      const maxed = next >= up.cost.length;
      this.card({
        title: up.name,
        desc: `Level ${lvl} of ${up.cost.length - 1}`,
        stats: [maxed ? 'Fully upgraded' : `+${Math.round(up.per * 100)}% per level`],
        price: maxed ? undefined : up.cost[next],
        label: 'Install',
        disabled: maxed || !g.economy.canAfford(up.cost[next]),
        action: () => {
          if (g.economy.spend(up.cost[next], 'upgrade').ok) {
            v.upgrades[key] = next;
            g.economy.updateVehicle(v.serialise());
            g.hud.toast(`${up.name} upgraded to level ${next}.`, 'good');
          }
        },
      });
    }

    // Paint.
    const price = tuning ? 450 : 700;
    const swatches = PAINTS.map((p) =>
      `<div class="swatch" data-hex="${p.hex}" title="${p.name}" style="background:#${p.hex.toString(16).padStart(6, '0')}" ${v.colour === p.hex ? 'aria-current="true"' : ''}></div>`).join('');
    const card = this.card({
      title: 'Respray',
      desc: 'Pick a colour. Changing the paint also clears any police description of the car.',
      price,
      action: null,
      extra: `<div class="swatches">${swatches}</div>`,
    });
    card.querySelectorAll('.swatch').forEach((s) => {
      s.addEventListener('click', () => {
        const hex = parseInt(s.dataset.hex, 10);
        if (v.colour === hex) return;
        if (!g.economy.spend(price, 'respray').ok) { g.hud.toast('Not enough money.', 'bad'); return; }
        v.setColour(hex);
        g.economy.updateVehicle(v.serialise());
        g.police.heat = Math.max(0, g.police.heat - 0.5);
        g.hud.toast('Resprayed.', 'good');
        this.refresh();
      });
    });
  }

  renderGarageList() {
    const g = this.game;
    const list = g.economy.vehicleList;
    if (!list.length) { this.note('You do not own any vehicles yet.'); return; }
    for (const data of list) {
      const spec = VEHICLES[data.spec];
      const isOut = g.ownedVehicles.some((v) => v.id === data.id);
      this.card({
        title: spec ? spec.name : data.spec,
        desc: `Plate ${data.plate} · condition ${data.health}%`,
        stats: [isOut ? 'Currently out' : 'In storage'],
        label: isOut ? 'Already out' : 'Bring it out',
        disabled: isOut,
        action: () => {
          const r = g.retrieveVehicle(data.id);
          if (!r.ok) g.hud.toast(r.message, 'bad');
          else { g.hud.toast('Brought out front.', 'good'); this.close(); }
        },
      });
      this.card({
        title: 'Sell ' + (spec ? spec.name : data.spec),
        desc: 'Sells for roughly 55% of list, less for damage.',
        price: sellPrice(data),
        label: 'Sell',
        action: () => {
          g.sellVehicle(data.id);
          g.hud.toast('Sold.', 'good');
        },
      });
    }
  }

  // ---------------------------------------------------------------- wardrobe
  renderWardrobe() {
    const g = this.game;
    for (const o of OUTFITS) {
      const owned = g.ownedOutfits.has(o.id);
      this.card({
        title: o.name,
        desc: owned ? 'In your wardrobe.' : 'Available in your size.',
        price: owned ? undefined : o.price,
        label: owned ? 'Wear' : 'Buy and wear',
        owned: g.player.character.outfit.id === o.id,
        disabled: !owned && !g.economy.canAfford(o.price),
        action: () => {
          if (!owned) {
            if (!g.economy.spend(o.price, 'clothes').ok) return;
            g.ownedOutfits.add(o.id);
          }
          g.player.setOutfit(o);
          g.hud.toast(`Wearing ${o.name}.`, 'good');
        },
      });
    }
    const swatches = SKIN_TONES.map((h, i) =>
      `<div class="swatch" data-hex="${h}" style="background:#${h.toString(16).padStart(6, '0')}"></div>`).join('');
    const card = this.card({
      title: 'Appearance',
      desc: 'Adjust skin tone.',
      extra: `<div class="swatches">${swatches}</div>`,
    });
    card.querySelectorAll('.swatch').forEach((s) => s.addEventListener('click', () => {
      g.player.setOutfit(g.player.character.outfit, parseInt(s.dataset.hex, 10));
    }));
  }

  // ---------------------------------------------------------------- misc
  renderFood() {
    const g = this.game;
    const items = [
      { name: 'Coffee', price: 4, heal: 8 },
      { name: 'Eggs and hash', price: 12, heal: 32 },
      { name: 'The full plate', price: 22, heal: 100 },
    ];
    for (const it of items) {
      this.card({
        title: it.name,
        desc: `Restores ${it.heal} health.`,
        price: it.price,
        label: 'Order',
        disabled: !g.economy.canAfford(it.price) || g.player.health >= g.player.maxHealth,
        action: () => {
          if (g.economy.spend(it.price, 'food').ok) {
            g.player.heal(it.heal);
            g.hud.toast('That helped.', 'good');
          }
        },
      });
    }
    const biz = BUSINESSES.find((b) => b.poi === this.current.id);
    if (biz) this.renderBusiness(biz);
  }

  renderBusiness(biz) {
    const g = this.game;
    const owned = g.economy.businesses.has(biz.id);
    if (owned) {
      const st = g.economy.businesses.get(biz.id);
      this.card({
        title: biz.name + ' — takings',
        desc: `Net ${fmtMoney(biz.incomePerHour - biz.upkeepPerHour)} per in-game hour.`,
        stats: [`Waiting: ${fmtMoney(Math.floor(st.accrued || 0))}`],
        label: 'Collect',
        disabled: Math.floor(st.accrued || 0) < 1,
        action: () => {
          const r = g.economy.collectBusiness(biz.id);
          if (r.ok) g.hud.toast(`Collected ${fmtMoney(r.amount)}.`, 'good');
        },
      });
    } else {
      this.card({
        title: 'Buy ' + biz.name,
        desc: `Income ${fmtMoney(biz.incomePerHour)}/hr, upkeep ${fmtMoney(biz.upkeepPerHour)}/hr.`,
        price: biz.price,
        label: 'Purchase',
        disabled: !g.economy.canAfford(biz.price),
        action: () => {
          const r = g.economy.buyBusiness(biz.id);
          if (r.ok) g.hud.toast(`You own ${biz.name}.`, 'good');
        },
      });
    }
  }

  renderSafehouse() {
    const g = this.game;
    const def = PROPERTIES.find((p) => p.id === this.current.id);
    const owned = def && g.economy.properties.has(def.id);
    if (def && !owned) {
      this.card({
        title: 'Buy ' + def.name,
        desc: `Includes ${def.garageSlots} garage spaces.`,
        price: def.price,
        label: 'Purchase',
        disabled: !g.economy.canAfford(def.price),
        action: () => {
          const r = g.economy.buyProperty(def.id);
          if (r.ok) g.hud.toast('Keys are yours.', 'good');
        },
      });
      return;
    }
    this.card({
      title: 'Sleep until morning',
      desc: 'Advances time to 07:00 and restores health.',
      label: 'Sleep',
      action: () => {
        g.sky.setTime(7);
        g.player.heal(100);
        g.saveGame('auto');
        g.hud.toast('Slept. Game saved.', 'good');
        this.close();
      },
    });
    this.card({
      title: 'Save game',
      desc: 'Writes to the autosave slot.',
      label: 'Save',
      action: () => {
        const r = g.saveGame('auto');
        g.hud.toast(r.ok ? 'Saved.' : 'Could not save: ' + r.error, r.ok ? 'good' : 'bad');
      },
    });
    if (g.world.interiors.has(this.current.id)) {
      this.card({
        title: 'Go inside',
        desc: 'Walk into the apartment.',
        label: 'Enter',
        action: () => { this.close(); g.enterInterior(this.current.id); },
      });
    }
    this.renderGarageList();
  }

  renderJobBoard() {
    const g = this.game;
    const unlocked = g.unlockedJobs;
    if (g.jobs.active) { this.note(`You already have work on: ${g.jobs.active.title}.`); return; }

    if (this.current.id === 'depot') {
      this.card({
        title: 'Courier run',
        desc: 'Take a parcel across town before the clock runs out. Pay scales with distance.',
        stats: ['Requires a vehicle'],
        label: unlocked.has('delivery') ? 'Take the job' : 'Locked',
        disabled: !unlocked.has('delivery'),
        action: () => { g.jobs.startDelivery(g.player.pos); this.close(); },
      });
      const biz = BUSINESSES.find((b) => b.poi === 'depot');
      if (biz) this.renderBusiness(biz);
    }
    if (this.current.id === 'taxi_office') {
      this.card({
        title: 'Take a fare',
        desc: 'Collect a passenger and get them where they are going.',
        stats: ['Requires a vehicle'],
        label: unlocked.has('taxi') ? 'Clock on' : 'Locked',
        disabled: !unlocked.has('taxi'),
        action: () => { g.jobs.startTaxi(g.player.pos); this.close(); },
      });
    }
  }

  renderRaces() {
    const g = this.game;
    if (!g.unlockedJobs.has('race')) { this.note('Nico has not put you on the list yet.'); return; }
    if (g.jobs.active) { this.note('Finish what you are doing first.'); return; }
    for (const r of g.jobs.races) {
      this.card({
        title: r.name,
        desc: `${r.laps} lap${r.laps > 1 ? 's' : ''}, ${r.checkpoints.length} checkpoints.`,
        stats: [`Par time ${Math.round(r.parTime)}s`],
        price: r.prize,
        label: 'Enter',
        action: () => { g.jobs.startRace(r.id, g.player.pos); this.close(); },
      });
    }
    const biz = BUSINESSES.find((b) => b.poi === 'racehub');
    if (biz) this.renderBusiness(biz);
  }

  renderHospital() {
    const g = this.game;
    this.card({
      title: 'Treatment',
      desc: 'Patch you up, no questions.',
      price: 180,
      label: 'Pay',
      disabled: !g.economy.canAfford(180) || g.player.health >= g.player.maxHealth,
      action: () => { if (g.economy.spend(180, 'hospital').ok) { g.player.heal(100); g.hud.toast('Good as new.', 'good'); } },
    });
  }

  renderPolice() {
    const g = this.game;
    if (g.police.level > 0) { this.note('Walking into a police station with a wanted level is a poor plan.'); return; }
    this.card({
      title: 'Pay outstanding fines',
      desc: 'Clears any pending charges. Does nothing if you have none.',
      price: 0,
      label: 'Talk to the desk',
      action: () => g.hud.toast('The desk sergeant looks through you.', 'info'),
    });
  }

  renderStory() {
    const g = this.game;
    const m = g.missions.nextMission();
    if (this.current.id === 'vega_shop') {
      if (g.world.interiors.has('vega_shop')) {
        this.card({
          title: 'Go into the shop',
          desc: 'Two ramps, a leaking roof, and your name on the sign.',
          label: 'Enter',
          action: () => { this.close(); g.enterInterior('vega_shop'); },
        });
      }
      this.renderGarage();
    }
    if (m && !g.missions.active) {
      this.card({
        title: `Mission ${m.number}: ${m.title}`,
        desc: m.blurb,
        price: m.reward,
        label: 'Start',
        action: () => { this.close(); g.missions.start(m.id); },
      });
    } else if (!m) {
      this.note('Nothing new right now. Try freelance work, or check the journal.');
    }
  }
}

export function sellPrice(data) {
  const spec = VEHICLES[data.spec];
  if (!spec) return 0;
  return Math.round(spec.price * 0.55 * (0.5 + 0.5 * (data.health / 100)));
}
