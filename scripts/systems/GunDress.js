/**
 * GunDress — mounting attachments and finishes onto a built weapon model.
 *
 * Both the first-person weapon system and the armoury preview need to take a
 * bare view model and put the player's actual build on it. That logic lives
 * here so the gun you inspect in the armoury is assembled by exactly the same
 * code as the gun in your hands — there is no second, drifting version of it.
 */
import { SLOTS, buildAttachment } from './Attachments.js';
import { applyCamo } from './ViewModels.js';
import { makeCamoTexture, camoInfo } from './CamoGenerator.js';

/**
 * Fit `model` with `fit` and paint it with `camoSeed`.
 * Returns a map of slot -> { group, parts } for whatever was mounted.
 */
export function dressModel(model, fit, camoSeed, texSize = 512) {
  if (!model) return {};

  // strip whatever was on it before
  const prev = model.userData._fitted || {};
  for (const slot of SLOTS) {
    const p = prev[slot];
    if (p && p.group.parent) p.group.parent.remove(p.group);
  }

  const mounts = model.userData.mounts || {};
  const objs = {};
  for (const slot of SLOTS) {
    const built = buildAttachment(slot, fit[slot]);
    if (!built) continue;
    const anchor = mounts[slot];
    if (!anchor) continue;
    anchor.add(built.group);
    objs[slot] = built;
  }
  model.userData._fitted = objs;

  // iron sights only when the rail is clear
  const iron = model.userData.ironSight;
  if (iron) iron.visible = fit.optic === 'iron';

  if (camoSeed !== null && camoSeed !== undefined) {
    applyCamo(model, makeCamoTexture(camoSeed, texSize), camoInfo(camoSeed));
  } else {
    applyCamo(model, null, null);
  }
  return objs;
}

/** Texture size that matches the player's texture quality setting. */
export function camoTextureSize(quality) {
  return quality === 'low' ? 256 : quality === 'medium' ? 384 : 512;
}
