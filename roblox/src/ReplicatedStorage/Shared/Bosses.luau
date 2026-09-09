--!strict
--[[
	Bosses — transcribed from scripts/entities/Bosses.js.

	One per biome, each with three phases, two weak points, and a movepool that
	changes as it loses health. Killing one opens the rift that takes you to
	the next biome, which is the only way forward — so these are the shape of
	the whole run, not an optional encounter.

	Weak points are the reason a boss fight is not a health bar. A body shot is
	×0.65, a head shot is ×1.5, and the right spot at the right phase is up to
	×7. The Hoar Mother is the clearest case: her shell is ×1.6 and almost
	worthless, and the woman inside it is ×7 but only exposed in the last
	quarter of the fight.
]]

local Bosses = {}

export type Phase = { at: number, name: string, speed: number, moves: { string } }
export type WeakPoint = { name: string, y: number, z: number, r: number, mul: number, phase: number, hiddenUntilPhase: number? }

Bosses.ALL = {
	warden = {
		id = "warden", name = "THE WARDEN OF THE HOLLOW", biome = "hollow",
		title = "what the rangers became, all of them at once",
		health = 2600, radius = 1.5, height = 5.2, headHeight = 4.2,
		speed = 1.9, runSpeed = 5.4, armor = 0.28, mass = 8,
		damage = 44, attackRange = 4.4, attackCooldown = 2.4, viewRange = 70, arena = 46,
		phases = {
			{ at = 1.00, name = "It stands up", speed = 1.0, moves = { "sweep", "slam" } },
			{ at = 0.62, name = "The bark splits", speed = 1.22, moves = { "sweep", "slam", "summon" } },
			{ at = 0.28, name = "It stops pretending to be a tree", speed = 1.5, moves = { "slam", "charge", "summon" } },
		},
		weakPoints = {
			{ name = "heart", y = 2.5, z = 0.55, r = 0.55, mul = 4.5, phase = 0 },
			{ name = "crown", y = 4.6, z = 0.0, r = 0.7, mul = 2.4, phase = 1 },
		},
	},

	chorister = {
		id = "chorister", name = "THE FIRST CHORISTER", biome = "void",
		title = "it was singing before there was anything to hear it",
		health = 2100, radius = 1.3, height = 4.6, headHeight = 3.4,
		speed = 3.4, runSpeed = 7.0, armor = 0.15, mass = 3, floats = true,
		damage = 30, attackRange = 3.6, attackCooldown = 1.7, viewRange = 90, arena = 52,
		phases = {
			{ at = 1.00, name = "The ring opens", speed = 1.0, moves = { "shardvolley", "lash" } },
			{ at = 0.66, name = "It divides", speed = 1.25, moves = { "shardvolley", "lash", "summon" } },
			{ at = 0.30, name = "The song resolves", speed = 1.55, moves = { "shardvolley", "collapse", "summon" } },
		},
		weakPoints = {
			{ name = "core", y = 2.2, z = 0.0, r = 0.5, mul = 6.0, phase = 0, hiddenUntilPhase = 1 },
			{ name = "eye", y = 3.5, z = 0.35, r = 0.42, mul = 3.2, phase = 0 },
		},
	},

	gillfather = {
		id = "gillfather", name = "THE GILL-FATHER", biome = "abyss",
		title = "the light on the end of it is the only kindness down here",
		health = 3000, radius = 1.7, height = 4.4, headHeight = 3.2,
		speed = 2.0, runSpeed = 5.0, armor = 0.34, mass = 9,
		damage = 48, attackRange = 4.8, attackCooldown = 2.6, viewRange = 40, arena = 50,
		phases = {
			{ at = 1.00, name = "The lure comes on", speed = 1.0, moves = { "bite", "sweep" } },
			{ at = 0.60, name = "It stops waiting", speed = 1.3, moves = { "bite", "charge", "summon" } },
			{ at = 0.25, name = "Everything down here answers it", speed = 1.45, moves = { "charge", "bite", "summon" } },
		},
		weakPoints = {
			{ name = "lure", y = 4.1, z = 1.2, r = 0.45, mul = 5.0, phase = 0 },
			{ name = "gills", y = 2.6, z = 0.9, r = 0.55, mul = 3.0, phase = 1 },
		},
	},

	pyreking = {
		id = "pyreking", name = "THE PYRE-KING", biome = "cinder",
		title = "it has been on fire for nine years and it is not finished",
		health = 2400, radius = 1.4, height = 4.8, headHeight = 3.9,
		speed = 2.6, runSpeed = 6.6, armor = 0.20, mass = 5,
		damage = 38, attackRange = 4.0, attackCooldown = 1.9, viewRange = 65, arena = 44,
		phases = {
			{ at = 1.00, name = "It turns to face you", speed = 1.0, moves = { "slam", "firelash" } },
			{ at = 0.64, name = "The crust cracks open", speed = 1.3, moves = { "firelash", "charge", "summon" } },
			{ at = 0.26, name = "It burns everything left", speed = 1.6, moves = { "charge", "firelash", "nova" } },
		},
		weakPoints = {
			{ name = "furnace", y = 2.4, z = 0.6, r = 0.6, mul = 4.0, phase = 0 },
			{ name = "crown", y = 4.2, z = 0.2, r = 0.5, mul = 3.0, phase = 1 },
		},
	},

	hoarmother = {
		id = "hoarmother", name = "THE HOAR MOTHER", biome = "permafrost",
		title = "she has been standing here since before the road",
		health = 3400, radius = 1.6, height = 5.0, headHeight = 4.0,
		speed = 1.4, runSpeed = 4.2, armor = 0.48, mass = 11,
		damage = 52, attackRange = 4.6, attackCooldown = 2.8, viewRange = 55, arena = 48,
		phases = {
			{ at = 1.00, name = "The ice moves first", speed = 1.0, moves = { "slam", "spikes" } },
			{ at = 0.58, name = "Her shell breaks", speed = 1.25, moves = { "slam", "spikes", "summon" } },
			{ at = 0.24, name = "There is a person inside it", speed = 1.5, moves = { "charge", "spikes", "summon" } },
		},
		weakPoints = {
			{ name = "shell", y = 2.8, z = 0.7, r = 0.75, mul = 1.6, phase = 0 },
			{ name = "woman", y = 2.8, z = 0.55, r = 0.45, mul = 7.0, phase = 2 },
		},
	},

	motherstalk = {
		id = "motherstalk", name = "THE MOTHER STALK", biome = "bloom",
		title = "every fungus in this valley is one organism and this is its head",
		health = 2800, radius = 2.0, height = 5.6, headHeight = 4.6,
		speed = 0.9, runSpeed = 2.6, armor = 0.30, mass = 14, rooted = true,
		damage = 34, attackRange = 5.4, attackCooldown = 2.2, viewRange = 60, arena = 42,
		phases = {
			{ at = 1.00, name = "The cap opens", speed = 1.0, moves = { "tendril", "sporecloud" } },
			{ at = 0.66, name = "It puts up children", speed = 1.15, moves = { "tendril", "sporecloud", "summon" } },
			{ at = 0.30, name = "It pulls itself out of the ground", speed = 1.4, moves = { "tendril", "sporecloud", "summon", "slam" } },
		},
		weakPoints = {
			{ name = "gills", y = 4.3, z = 0.0, r = 0.9, mul = 3.5, phase = 0 },
			{ name = "bulb", y = 1.2, z = 0.7, r = 0.7, mul = 5.0, phase = 1 },
		},
	},
}

-- ── Shared attack table ────────────────────────────────────────────────────
-- `damage` is a multiplier on the boss's own damage figure.

Bosses.ATTACKS = {
	sweep = { windup = 0.65, damage = 0.8, rangeAdd = 1.4, bleed = 0.5, kind = "melee" },
	slam = { windup = 0.9, damage = 1.25, rangeAdd = 0.8, bleed = 0.7, kind = "melee",
		knockRadius = 3, knockY = 4.5, knockXZ = 6 },
	bite = { windup = 0.55, damage = 1.4, rangeAdd = 0.0, bleed = 1.0, kind = "melee" },
	lash = { windup = 0.45, damage = 0.55, rangeAdd = 0.6, bleed = 0.3, kind = "melee",
		hits = 2, secondHitDelay = 0.26 },

	charge = { windup = 0.8, kind = "charge", minDistance = 8, maxDistance = 34,
		duration = 1.8, speedMul = 1.7 },

	shardvolley = { windup = 1.0, damage = 0.7, bleed = 0.3, kind = "line", maxDistance = 30, facing = 0.72 },
	firelash = { windup = 0.85, damage = 0.7, bleed = 0.3, kind = "line", maxDistance = 30, facing = 0.72 },
	spikes = { windup = 1.0, damage = 0.7, bleed = 0.8, kind = "line", maxDistance = 30, facing = 0.72 },
	tendril = { windup = 0.9, damage = 0.7, bleed = 0.3, kind = "line", maxDistance = 30, facing = 0.72 },

	sporecloud = { windup = 1.2, kind = "aoe", radius = 9, bleed = 0.4, flash = 0.5 },
	collapse = { windup = 1.3, kind = "aoe", radius = 11, bleed = 0.4 },
	nova = { windup = 1.4, kind = "aoe", radius = 14, bleed = 0.4 },

	summon = { windup = 1.1, kind = "summon", cooldown = 22, firstAt = 12,
		countBase = 2, minRange = 9, maxRange = 21 },
}

-- ── Constants ──────────────────────────────────────────────────────────────

Bosses.CONST = {
	fov = 3.14,
	hearRange = 200,
	lootTable = "nest",
	noise = 1.2,
	attackTimerStart = 2.0,
	summonCooldownStart = 12,
	wakeFraction = 0.55,     -- wakes at dist < arena * this
	leashMul = 1.5,          -- chase allowed to arena * this
	headMul = 1.5,
	bodyMul = 0.65,
}

function Bosses.get(id: string): any
	return Bosses.ALL[id]
end

function Bosses.ids(): { string }
	local out = {}
	for id in Bosses.ALL do table.insert(out, id) end
	table.sort(out)
	return out
end

--- Which phase a boss is in, given the fraction of health it has left.
--- Returns the index (1-based) and the phase itself.
function Bosses.phaseFor(boss: any, fraction: number): (number, Phase)
	local index = 1
	for i, phase in boss.phases do
		if fraction <= phase.at then index = i end
	end
	return index, boss.phases[index]
end

--[[
	Damage multiplier for a hit at a local offset from the boss's origin.

	`localY` and `localZ` are metres above the base and forward of the centre.
	A weak point counts only once its phase has been reached; before that, and
	for a body hit, the multiplier is the flat 0.65 that makes shooting the
	torso a waste of ammunition.
]]
function Bosses.hitMultiplier(boss: any, localY: number, localZ: number, phaseIndex: number, headshot: boolean): (number, string?)
	for _, wp in boss.weakPoints do
		local dy = localY - wp.y
		local dz = localZ - wp.z
		if math.sqrt(dy * dy + dz * dz) <= wp.r then
			local revealed = phaseIndex - 1 >= wp.phase
			if wp.hiddenUntilPhase and phaseIndex - 1 < wp.hiddenUntilPhase then
				revealed = false
			end
			if revealed then return wp.mul, wp.name end
			return Bosses.CONST.bodyMul, nil
		end
	end
	if headshot then return Bosses.CONST.headMul, "head" end
	return Bosses.CONST.bodyMul, nil
end

return Bosses
