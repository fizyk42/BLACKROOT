// The San Aurelio campaign.
//
// Missions are data. A small step runner interprets them, so adding a mission means
// adding a list of steps rather than writing new systems. Missions 1-3 are fully
// playable; 4-20 exist as designed outlines and are shown in the journal as planned,
// not pretended to be finished.

import { poi, CITY } from '../world/citymap.js';
import { fmtMoney } from '../core/util.js';

export const CHARACTERS = {
  alex: { name: 'Alex Vega', colour: '#ffb347' },
  maya: { name: 'Maya Vega', colour: '#7fe3cd' },
  dante: { name: 'Dante Cruz', colour: '#ff9d6b' },
  lena: { name: 'Lena Park', colour: '#9fd4ff' },
  marcus: { name: 'Marcus Reed', colour: '#c9d2d6' },
  sloane: { name: 'Victor Sloane', colour: '#e0d6c2' },
  nico: { name: 'Nico Bell', colour: '#ffd27f' },
  dispatch: { name: 'Depot Dispatch', colour: '#c9d2d6' },
};

const P = CITY.PITCH;
const at = (id) => {
  const p = poi(id);
  return { x: p.doorX ?? p.x, z: p.doorZ ?? p.z };
};

// ------------------------------------------------------------------ missions

export const MISSIONS = [
  // ---------------------------------------------------------------- 1
  {
    id: 'homecoming',
    number: 1,
    title: 'Homecoming',
    blurb: 'Alex is back in San Aurelio after four years away. Maya is at the shop, and the shop is not doing well.',
    reward: 500,
    implemented: true,
    requires: [],
    steps: [
      {
        type: 'dialogue', speaker: 'maya',
        lines: [
          'You actually came. I owe Dante ten dollars.',
          'Dad left the place to both of us, Alex. Both of us.',
          'Come down to the shop. I will explain the rest in person.',
        ],
      },
      {
        type: 'goto', label: 'Get to Vega & Daughter Auto', pos: at('vega_shop'), radius: 5,
        hint: 'The shop is on Palm Hollow Road. Follow the marker.',
      },
      {
        type: 'dialogue', speaker: 'maya',
        lines: [
          'Four years. You could have called.',
          'Here it is. Two ramps, a leaking roof, and eleven thousand in arrears.',
          'Sloane Development has offered to buy us out twice this month.',
          'I said no twice. I would like to keep saying no.',
        ],
      },
      {
        type: 'goto', label: 'Take the car keys from the bench', pos: { x: at('vega_shop').x + 4, z: at('vega_shop').z + 3 }, radius: 3.5,
        hint: 'Maya left a car out front for you.',
      },
      {
        type: 'grantVehicle', spec: 'sedan', colour: 0x3d4a58, near: 'vega_shop',
        label: 'Your car', note: 'Maya has signed the old Corvella over to you.',
      },
      {
        type: 'enterVehicle', label: 'Get in the car',
      },
      {
        type: 'driveTo', label: 'Drive to your apartment on Linnet Street', pos: at('apartment_1'), radius: 7,
        hint: 'It is not much, but the rent is paid until Friday.',
      },
      {
        type: 'dialogue', speaker: 'maya',
        lines: [
          'Get some sleep. Tomorrow you are working.',
          'And Alex — do not let Dante talk you into anything before noon.',
        ],
      },
    ],
    onComplete: { unlockJobs: ['delivery'], text: 'Courier work is now available at the Kestrel Freight Depot.' },
  },

  // ---------------------------------------------------------------- 2
  {
    id: 'late_delivery',
    number: 2,
    title: 'Late Delivery',
    blurb: 'Dante has a run that pays too well for what it is. Alex takes it anyway.',
    reward: 1400,
    implemented: true,
    requires: ['homecoming'],
    steps: [
      {
        type: 'dialogue', speaker: 'dante',
        lines: [
          'Alex Vega. The prodigal mechanic.',
          'One pickup, one drop, forty minutes. Fourteen hundred.',
          'Do not open the box and do not be late. In that order.',
        ],
      },
      { type: 'goto', label: 'Meet Dante at the depot', pos: at('depot'), radius: 6 },
      {
        type: 'dialogue', speaker: 'dante',
        lines: [
          'Box is in the van. Van is yours for the night.',
          'Kestrel Docks to the pier lot. Clock starts now.',
        ],
      },
      {
        type: 'grantVehicle', spec: 'van', colour: 0xe8e6df, near: 'depot',
        label: 'Dante\'s van', temporary: true,
      },
      { type: 'enterVehicle', label: 'Get in the van' },
      {
        type: 'timedDriveTo', label: 'Deliver the box to the pier lot',
        pos: at('racehub'), radius: 8, seconds: 150,
        failText: 'Dante does not pay for late.',
        hint: 'The pier lot is on the coast, south end.',
      },
      {
        type: 'dialogue', speaker: 'nico',
        lines: [
          'You are Dante\'s new driver? You look like a mechanic.',
          'I am both, apparently.',
          'Then you will do fine here. Nico Bell. Ask for me if you want the races.',
        ],
      },
    ],
    onComplete: { unlockJobs: ['taxi', 'race'], text: 'Nico has put you on the list for street races.' },
  },

  // ---------------------------------------------------------------- 3
  {
    id: 'under_the_lights',
    number: 3,
    title: 'Under the Lights',
    blurb: 'Nico runs a race out of the pier lot. Winning it is how you get noticed.',
    reward: 3200,
    implemented: true,
    requires: ['late_delivery'],
    steps: [
      {
        type: 'dialogue', speaker: 'nico',
        lines: [
          'Pier lot, after dark. Bring something that corners.',
          'Two laps. First one home takes the pot.',
        ],
      },
      { type: 'goto', label: 'Get to the pier lot with a car', pos: at('racehub'), radius: 8 },
      { type: 'enterVehicle', label: 'Get behind the wheel' },
      {
        type: 'race', raceId: 'race_pier', label: 'Win the Pier Lot Sprint',
        failText: 'You did not finish. Nico is not impressed.',
      },
      {
        type: 'dialogue', speaker: 'lena',
        lines: [
          'You drive like somebody who fixes cars for a living.',
          'Lena Park. I own the shop on Sable that Sloane keeps trying to buy.',
          'Sounds familiar.',
          'Then we should talk properly. Soon.',
        ],
      },
    ],
    onComplete: { text: 'Lena Park will be in touch.' },
  },

  // ---------------------------------------------------------------- 4-20 (designed, not built)
  ...[
    ['paper_trail', 'Paper Trail', 'Lena has the Sloane purchase offers going back two years. Somebody has been forging signatures.', 2600, ['under_the_lights']],
    ['the_long_way', 'The Long Way Round', 'A courier run that has to avoid three police checkpoints.', 3000, ['paper_trail']],
    ['reeds_favour', "Reed's Favour", 'Detective Marcus Reed wants a look inside the depot and cannot get a warrant.', 3400, ['the_long_way']],
    ['repossession', 'Repossession', 'Take back four cars Sloane leased under a shell company.', 4200, ['reeds_favour']],
    ['static', 'Static', 'Someone is jamming the shop radio. Follow the signal up into the hills.', 3800, ['repossession']],
    ['house_rules', 'House Rules', 'Nico owes the wrong people. Drive him to five drops before dawn.', 4600, ['static']],
    ['the_offer', 'The Offer', 'Victor Sloane invites the Vegas to dinner and names a number.', 5000, ['house_rules']],
    ['maya_alone', 'Maya, Alone', 'Maya goes to the tower without telling Alex.', 5400, ['the_offer']],
    ['saltflat', 'Salt Flat Road', 'A night race with no rules, out past the docks.', 6000, ['maya_alone']],
    ['inventory', 'Inventory', 'What Dante has actually been moving in those boxes.', 6200, ['saltflat']],
    ['cut_loose', 'Cut Loose', 'Dante burns the depot and blames the shop.', 6800, ['inventory']],
    ['insurance', 'Insurance', 'Rebuild the shop with money that has to come from somewhere.', 7200, ['cut_loose']],
    ['reed_calls_in', 'Reed Calls It In', 'The detective asks for the one thing Alex cannot give.', 7600, ['insurance']],
    ['blackout', 'Blackout', 'The whole of Verdugo Row loses power for eleven minutes.', 8200, ['reed_calls_in']],
    ['the_pier', 'The Pier', 'Nico, a boat, and a very short window.', 8800, ['blackout']],
    ['groundwork', 'Groundwork', 'Sloane breaks ground on Palm Hollow. The shop is inside the red line.', 9400, ['the_pier']],
    ['afterhours', 'Afterhours', 'Everything ends where it started, at nine o\'clock, with the shutter half down.', 15000, ['groundwork']],
  ].map(([id, title, blurb, reward, requires], k) => ({
    id, title, blurb, reward, requires, number: k + 4, implemented: false, steps: [],
  })),
];

export function missionById(id) { return MISSIONS.find((m) => m.id === id); }

// ------------------------------------------------------------------ runner

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.completed = new Set();
    this.active = null;
    this.stepIndex = 0;
    this.stepState = null;
    this.marker = null;
    this.dialogueQueue = [];
    this.dialogueTimer = 0;
    this.onEvent = () => {};
    this.tempVehicles = [];
  }

  available() {
    return MISSIONS.filter((m) =>
      m.implemented && !this.completed.has(m.id) && m.requires.every((r) => this.completed.has(r)));
  }

  nextMission() { return this.available()[0] || null; }

  canStart(id) {
    const m = missionById(id);
    return !!m && m.implemented && !this.completed.has(id) && m.requires.every((r) => this.completed.has(r));
  }

  start(id) {
    if (!this.canStart(id)) return { ok: false, reason: 'unavailable' };
    const m = missionById(id);
    this.active = m;
    this.stepIndex = -1;
    this.onEvent({ type: 'mission-start', mission: m });
    this.advance();
    return { ok: true };
  }

  abandon(reason = 'Mission abandoned') {
    if (!this.active) return;
    const m = this.active;
    this.cleanupStep();
    this.clearTempVehicles();
    this.active = null;
    this.stepState = null;
    this.dialogueQueue.length = 0;
    this.onEvent({ type: 'mission-failed', mission: m, text: reason });
  }

  clearTempVehicles() {
    for (const v of this.tempVehicles) {
      if (this.game.player.vehicle === v) this.game.player.exitVehicle(true);
      v.detach(this.game.scene);
      const i = this.game.missionVehicles.indexOf(v);
      if (i >= 0) this.game.missionVehicles.splice(i, 1);
    }
    this.tempVehicles.length = 0;
  }

  cleanupStep() {
    if (this.marker) { this.marker.dispose(); this.marker = null; }
  }

  advance() {
    this.cleanupStep();
    this.stepIndex++;
    const m = this.active;
    if (!m) return;
    if (this.stepIndex >= m.steps.length) return this.complete();

    const step = m.steps[this.stepIndex];
    this.stepState = { t: 0 };
    this.beginStep(step);
  }

  beginStep(step) {
    const g = this.game;
    switch (step.type) {
      case 'dialogue':
        this.dialogueQueue = step.lines.map((l, i) => ({
          speaker: i % 2 === 0 || step.lines.length < 3 ? step.speaker : (i % 2 ? 'alex' : step.speaker),
          text: l,
        }));
        // Two-hander missions alternate speakers only where the script implies it.
        if (step.speakers) this.dialogueQueue = step.lines.map((l, i) => ({ speaker: step.speakers[i] || step.speaker, text: l }));
        this.dialogueTimer = 0;
        this.setObjective('', step.hint || '');
        break;

      case 'goto':
      case 'driveTo':
      case 'timedDriveTo':
        this.marker = g.makeMarker(step.pos.x, step.pos.z, 0xffb347, step.radius || 5);
        this.setObjective(step.label, step.hint || '');
        if (step.type === 'timedDriveTo') {
          this.stepState.timeLeft = step.seconds;
          this.stepState.timeLimit = step.seconds;
        }
        break;

      case 'grantVehicle': {
        const v = g.spawnMissionVehicle(step);
        this.stepState.vehicle = v;
        if (step.temporary) this.tempVehicles.push(v);
        else if (v) g.economy.addVehicle(v.serialise());
        if (step.note) this.onEvent({ type: 'toast', text: step.note, tone: 'good' });
        this.marker = g.makeMarker(v.pos.x, v.pos.z, 0x7fe3cd, 3.4);
        this.setObjective(step.label || 'Take the vehicle', '');
        break;
      }

      case 'enterVehicle':
        this.setObjective(step.label || 'Get in a vehicle', '');
        break;

      case 'race':
        this.setObjective(step.label, 'Beat the clock around the circuit.');
        g.jobs.startRace(step.raceId, g.player.pos);
        this.stepState.raceStarted = true;
        break;

      case 'wait':
        this.stepState.timeLeft = step.seconds || 2;
        this.setObjective(step.label || '', '');
        break;

      default:
        console.warn('Unknown mission step', step.type);
        this.advance();
    }
  }

  setObjective(text, hint) {
    this.onEvent({ type: 'objective', title: this.active ? this.active.title : '', text, hint });
  }

  update(dt) {
    if (!this.active) return;
    const step = this.active.steps[this.stepIndex];
    if (!step) return;
    const g = this.game;
    const st = this.stepState;
    st.t += dt;

    // Dialogue plays out on a timer, or the player can skip a line.
    if (step.type === 'dialogue') {
      if (this.dialogueQueue.length && this.dialogueTimer <= 0) {
        const line = this.dialogueQueue.shift();
        this.dialogueTimer = 2.2 + line.text.length * 0.035;
        this.onEvent({ type: 'dialogue', speaker: line.speaker, text: line.text, seconds: this.dialogueTimer });
      }
      this.dialogueTimer -= dt;
      if (this.dialogueTimer <= 0 && !this.dialogueQueue.length) this.advance();
      return;
    }

    if (step.type === 'goto') {
      if (this.marker && this.marker.contains(g.player.pos.x, g.player.pos.z, 1.2)) this.advance();
      return;
    }

    if (step.type === 'driveTo' || step.type === 'timedDriveTo') {
      if (step.type === 'timedDriveTo') {
        st.timeLeft -= dt;
        this.onEvent({ type: 'timer', seconds: st.timeLeft, limit: st.timeLimit });
        if (st.timeLeft <= 0) return this.fail(step.failText || 'Out of time.');
      }
      if (this.marker && this.marker.contains(g.player.pos.x, g.player.pos.z, 2.0)) {
        this.onEvent({ type: 'timer', seconds: 0, limit: 0 });
        this.advance();
      }
      return;
    }

    if (step.type === 'grantVehicle') {
      if (st.vehicle && this.marker) this.marker.move(st.vehicle.pos.x, st.vehicle.pos.z);
      if (g.player.vehicle && st.vehicle && g.player.vehicle === st.vehicle) this.advance();
      else if (st.t > 1.2 && g.player.vehicle) this.advance();
      return;
    }

    if (step.type === 'enterVehicle') {
      if (g.player.vehicle) this.advance();
      return;
    }

    if (step.type === 'race') {
      if (!g.jobs.active && st.raceStarted) {
        // The job system reports the outcome through game.lastJobResult.
        if (g.lastJobResult && g.lastJobResult.success) this.advance();
        else this.fail(step.failText || 'Race lost.');
      }
      return;
    }

    if (step.type === 'wait') {
      st.timeLeft -= dt;
      if (st.timeLeft <= 0) this.advance();
    }
  }

  fail(text) {
    const m = this.active;
    this.cleanupStep();
    this.clearTempVehicles();
    this.active = null;
    this.onEvent({ type: 'mission-failed', mission: m, text, retryable: true });
  }

  complete() {
    const m = this.active;
    this.cleanupStep();
    this.clearTempVehicles();
    this.active = null;
    this.completed.add(m.id);

    const res = this.game.economy.claim('mission_' + m.id, m.reward, { kind: 'mission' });
    this.onEvent({
      type: 'mission-complete', mission: m,
      reward: res.ok ? m.reward : 0,
      text: res.ok
        ? `${m.title} complete — ${fmtMoney(m.reward)}`
        : `${m.title} complete`,
      note: m.onComplete && m.onComplete.text,
    });
  }

  serialise() {
    return { completed: [...this.completed], active: this.active ? this.active.id : null };
  }

  restore(d) {
    if (!d) return;
    this.completed = new Set(d.completed || []);
  }

  /** Journal entries: done, available now, or designed but not yet built. */
  journal() {
    return MISSIONS.map((m) => ({
      id: m.id, number: m.number, title: m.title, blurb: m.blurb, reward: m.reward,
      state: this.completed.has(m.id) ? 'done'
        : !m.implemented ? 'planned'
          : m.requires.every((r) => this.completed.has(r)) ? 'available' : 'locked',
    }));
  }
}
