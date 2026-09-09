/**
 * DamageSystem — the single place damage is applied, so resistances, hit
 * reactions, aggro propagation and death handling never drift apart between
 * bullets, blades, claws and falls.
 */
import { Audio } from '../core/AudioManager.js';
import { Input } from '../core/Input.js';

export class DamageSystem {
  constructor(game) { this.game = game; }

  /**
   * @returns true if the hit killed the target.
   */
  applyToEntity(entity, amount, dir, point, part = 'body', source = 'gun', stagger = 0) {
    if (!entity || !entity.alive) return false;
    let dmg = amount * (this.game.sandbox ? this.game.sandbox.damageMultiplier : 1);
    if (entity.armor) dmg *= (1 - entity.armor);
    // The head multiplier for ordinary creatures is already folded in by the
    // weapon. Bosses are the exception: they publish their own per-part
    // multipliers, because knowing where to shoot one is the whole fight.
    if (entity.partMultiplier) dmg *= entity.partMultiplier(part);
    entity.health -= dmg;
    // The boss is the one thing the whole squad is shooting at once, so its
    // health is the server's to keep: everyone reports what they did and takes
    // the total back, instead of each client killing it privately.
    if (entity.isBoss && this.game.net?.online) this.game.net.reportBossHit(dmg);
    entity.lastHitAt = this.game.time;
    entity.flinch = Math.min(1, (entity.flinch || 0) + dmg / Math.max(20, entity.maxHealth * 0.5));

    // knockback / stagger
    const push = (stagger + dmg / Math.max(30, entity.maxHealth)) * (entity.mass ? 1 / entity.mass : 1);
    entity.knockback.x += dir.x * push * 2.4;
    entity.knockback.z += dir.z * push * 2.4;

    entity.onDamaged?.(dmg, dir, point, part, source);

    // being shot is the loudest possible aggro trigger
    this.game.entities.alertNear(entity.position, 34, entity, 0.9);

    if (entity.health <= 0) {
      entity.die(dir, point, part);
      if (this.game.sandbox && this.game.sandbox.launchOnDeath) {
        entity.knockback.x += dir.x * 60;
        entity.knockback.z += dir.z * 60;
        entity.velocity.y += 22;
      }
      this.game.stats.kills++;
      this.game.director?.onKill(entity);
      return true;
    }
    return false;
  }

  applyToPlayer(amount, source, opts = {}) {
    if (this.game.sandbox && this.game.sandbox.godMode) return 0;
    const before = this.game.stats.health;
    const dealt = this.game.stats.damage(amount, source, opts);
    if (dealt > 0) {
      this.game.ui.damageFlash(Math.min(1, dealt / 30), opts.dir);
      Input.rumble(Math.min(1, 0.25 + dealt / 45), Math.min(1, 0.18 + dealt / 60), 220);
      this.game.player.addRecoil(-0.004 * Math.min(dealt, 30), (Math.random() - 0.5) * 0.006 * Math.min(dealt, 30));
    }
    if (before > 0 && this.game.stats.dead) this.game.onPlayerDeath(source);
    return dealt;
  }
}
