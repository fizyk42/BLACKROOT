--!strict
--[[
	Creatures — transcribed from scripts/entities/MutantAI.js and AnimalAI.js.

	Two rosters. Mutants are what the Hollow made; animals are what was already
	there and is now behaving badly. They share a stat block so one AI stepper
	can drive both, and differ in the `behaviour` / `temperament` field that
	selects which state machine runs.

	The behaviour constants at the bottom are the ones that make a stalker feel
	like a stalker: it holds fourteen to twenty-three metres, closes when you
	look away, and only commits when you are inside seven metres and not
	looking at it.
]]

local Creatures = {}

-- ── Mutants ────────────────────────────────────────────────────────────────
-- All faction "mutant", lootTable "nest", scale 1.

Creatures.MUTANTS = {
	stalker = {
		id = "stalker", label = "a Stalker", model = "stalker", behaviour = "stalk", biome = "hollow",
		health = 105, radius = 0.45, height = 2.4, headHeight = 2.10,
		speed = 1.5, runSpeed = 6.6, damage = 17, attackRange = 2.35, attackCooldown = 1.25,
		viewRange = 46, fov = 1.15, hearRange = 58, armor = 0.0, mass = 1.0, noise = 0.35, lightShy = 0.55,
	},
	brute = {
		id = "brute", label = "a Brute", model = "brute", behaviour = "charge", biome = "hollow",
		health = 340, radius = 0.85, height = 2.7, headHeight = 2.25,
		speed = 1.5, runSpeed = 4.6, damage = 41, attackRange = 2.9, attackCooldown = 2.1,
		viewRange = 38, fov = 1.0, hearRange = 62, armor = 0.30, mass = 3.2, noise = 1.0, lightShy = 0.0,
	},
	crawler = {
		id = "crawler", label = "a Crawler", model = "crawler", behaviour = "swarm", biome = "hollow",
		health = 58, radius = 0.42, height = 0.9, headHeight = 0.62,
		speed = 2.2, runSpeed = 8.2, damage = 13, attackRange = 1.8, attackCooldown = 0.85,
		viewRange = 26, fov = 1.5, hearRange = 40, armor = 0, mass = 0.7, noise = 0.25, lightShy = 0.25,
	},
	screamer = {
		id = "screamer", label = "a Screamer", model = "screamer", behaviour = "call", biome = "hollow",
		health = 72, radius = 0.42, height = 1.9, headHeight = 1.68,
		speed = 1.9, runSpeed = 5.4, damage = 9, attackRange = 1.9, attackCooldown = 1.6,
		viewRange = 52, fov = 1.35, hearRange = 70, armor = 0, mass = 0.8, noise = 0.6, lightShy = 0.75,
	},
	choir = {
		id = "choir", label = "a Choir", model = "choir", behaviour = "call", biome = "void",
		health = 96, radius = 0.5, height = 2.2, headHeight = 1.95,
		speed = 2.4, runSpeed = 6.0, damage = 14, attackRange = 2.6, attackCooldown = 1.5,
		viewRange = 64, fov = 3.14, hearRange = 80, armor = 0.1, mass = 0.6, noise = 0.5, lightShy = 0.0,
		floats = true,
	},
	drowned = {
		id = "drowned", label = "a Drowned", model = "drowned", behaviour = "charge", biome = "abyss",
		health = 250, radius = 0.72, height = 2.2, headHeight = 1.86,
		speed = 1.3, runSpeed = 4.2, damage = 33, attackRange = 2.6, attackCooldown = 1.8,
		viewRange = 30, fov = 1.2, hearRange = 90, armor = 0.18, mass = 2.4, noise = 0.7, lightShy = 0.0,
	},
	ashwalker = {
		id = "ashwalker", label = "an Ashwalker", model = "ashwalker", behaviour = "swarm", biome = "cinder",
		health = 120, radius = 0.5, height = 2.2, headHeight = 1.92,
		speed = 2.4, runSpeed = 7.4, damage = 21, attackRange = 2.2, attackCooldown = 1.0,
		viewRange = 42, fov = 1.3, hearRange = 55, armor = 0.05, mass = 1.1, noise = 0.55, lightShy = 0.0,
		burns = true,
	},
	rimewretch = {
		id = "rimewretch", label = "a Rimewretch", model = "rimewretch", behaviour = "charge", biome = "permafrost",
		health = 290, radius = 0.62, height = 2.3, headHeight = 1.98,
		speed = 1.1, runSpeed = 4.0, damage = 36, attackRange = 2.5, attackCooldown = 1.9,
		viewRange = 40, fov = 1.1, hearRange = 66, armor = 0.42, mass = 2.8, noise = 0.5, lightShy = 0.0,
		chills = true,
	},
	sporebearer = {
		id = "sporebearer", label = "a Sporebearer", model = "sporebearer", behaviour = "stalk", biome = "bloom",
		health = 140, radius = 0.52, height = 2.0, headHeight = 1.72,
		speed = 1.6, runSpeed = 5.2, damage = 15, attackRange = 2.2, attackCooldown = 1.3,
		viewRange = 34, fov = 1.25, hearRange = 62, armor = 0.08, mass = 1.3, noise = 0.4, lightShy = 0.2,
		sporeBurst = true,
	},
}

Creatures.CORE_MUTANTS = { "stalker", "brute", "crawler", "screamer" }

--- The roster for a biome: its own creatures first, then the core four. The
--- Hollow is the exception — the core four *are* its roster.
function Creatures.mutantsForBiome(biomeId: string): { string }
	if biomeId == "hollow" then
		return table.clone(Creatures.CORE_MUTANTS)
	end

	local own = {}
	for id, def in Creatures.MUTANTS do
		if def.biome == biomeId then table.insert(own, id) end
	end
	table.sort(own)

	local out = {}
	for _, id in own do table.insert(out, id) end
	for _, id in Creatures.CORE_MUTANTS do
		local seen = false
		for _, have in out do
			if have == id then seen = true; break end
		end
		if not seen then table.insert(out, id) end
	end
	return out
end

-- ── Animals ────────────────────────────────────────────────────────────────
-- All faction "animal", no loot table, scale 1.

Creatures.ANIMALS = {
	rabbit = {
		id = "rabbit", model = "rabbit", health = 8, radius = 0.18, height = 0.34, headHeight = 0.3,
		speed = 1.2, runSpeed = 8.5, damage = 0, attackRange = 0, attackCooldown = 0,
		viewRange = 26, fov = 2.4, hearRange = 34, mass = 0.2,
		temperament = "skittish", fleeRange = 18,
	},
	deer = {
		id = "deer", model = "deer", health = 55, radius = 0.5, height = 1.6, headHeight = 1.5,
		speed = 1.5, runSpeed = 9.5, damage = 0, attackRange = 0, attackCooldown = 0,
		viewRange = 42, fov = 2.2, hearRange = 55, mass = 1.4,
		temperament = "skittish", fleeRange = 26,
	},
	boar = {
		id = "boar", model = "boar", health = 95, radius = 0.55, height = 1.0, headHeight = 0.9,
		speed = 1.4, runSpeed = 8.0, damage = 22, attackRange = 1.9, attackCooldown = 1.9,
		viewRange = 22, fov = 1.8, hearRange = 32, mass = 1.8,
		temperament = "defensive", fleeRange = 0, aggroRange = 11,
	},
	wolf = {
		id = "wolf", model = "wolf", health = 62, radius = 0.42, height = 1.05, headHeight = 0.95,
		speed = 2.2, runSpeed = 9.2, damage = 15, attackRange = 1.9, attackCooldown = 1.15,
		viewRange = 46, fov = 1.7, hearRange = 60, mass = 0.9,
		temperament = "predator", aggroRange = 34,
	},
	bear = {
		id = "bear", model = "bear", health = 300, radius = 0.85, height = 1.7, headHeight = 1.45,
		speed = 1.5, runSpeed = 8.4, damage = 48, attackRange = 2.5, attackCooldown = 1.9,
		viewRange = 30, fov = 1.5, hearRange = 44, mass = 3.4, armor = 0.15,
		temperament = "territorial", aggroRange = 16,
	},
}

function Creatures.get(id: string): any
	return Creatures.MUTANTS[id] or Creatures.ANIMALS[id]
end

function Creatures.allIds(): { string }
	local out = {}
	for id in Creatures.MUTANTS do table.insert(out, id) end
	for id in Creatures.ANIMALS do table.insert(out, id) end
	table.sort(out)
	return out
end

-- ── Behaviour constants ────────────────────────────────────────────────────

Creatures.AI = {
	-- shared
	alertDecay = 0.045,           -- per second
	visibleGain = 1.4,            -- per second while in view
	proximityRange = 6.5,
	proximityGain = 0.9,
	crouchStillStealth = 0.25,
	lightGainRange = 40,
	lightGainThreshold = 0.12,
	attackWindup = 0.25,
	chargeWindup = 0.55,
	defaultBleed = 0.3,
	patrolMin = 8,
	patrolMax = 26,
	worldClampMutant = 440,
	worldClampAnimal = 435,
	growlMin = 7, growlSpread = 16,

	-- stalk
	stalkDistanceMin = 14, stalkDistanceSpread = 9,
	stalkWatchedMul = 1.25, stalkUnwatchedMul = 0.55,
	stalkBreakDistance = 7,
	stalkPatienceSeconds = 26,
	stalkPatienceAlert = 0.75,
	coverQueryRadius = 14,
	coverTreeRadius = 0.4,

	-- charge
	chargeMinDistance = 8, chargeMaxDistance = 26,
	chargeChancePerSecond = 0.5,
	chargeDuration = 2.4,
	chargeSpeedMul = 1.6,
	chargeBleed = 0.55,
	chargeShoveXZ = 7.5, chargeShoveY = 2.2,

	-- swarm
	swarmWobbleRate = 5, swarmWobbleAmp = 4.5, swarmWobbleFalloff = 12,

	-- call
	callBackoffDistance = 9,
	callRange = 46,
	callRangeStalk = 42,
	callCooldownMin = 12, callCooldownSpread = 8,
	callAlertRadius = 95,
	callFleeHealthFraction = 0.5,

	-- sporebearer death
	sporeBurstDamage = 14, sporeBurstRadius = 4.5, sporeBurstAlert = 26,

	-- choir float
	floatBase = 0.42, floatRate = 0.8, floatAmp = 0.10,

	-- animals
	animalWindup = 0.22,
	animalAggroDecay = 0.05,
	skittishArc = 0.35,
	skittishReturnDistanceMul = 2.2, skittishReturnTime = 2.5, skittishGiveUp = 9,
	defensiveGain = 0.9, defensiveCharge = 0.6, boarDisengage = 3.5, boarFleeRange = 14,
	predatorGain = 0.5, predatorStalk = 0.45, predatorWant = 11, predatorLateral = 6,
	predatorCircleSpeedMul = 2.2, predatorCommitMin = 4, predatorCommitSpread = 5,
	predatorCommitAlert = 0.55, predatorChaseSeconds = 5, predatorDisengage = 55,
	territorialGain = 0.55, territorialCharge = 0.75,
	bearBleed = 0.6, animalBleed = 0.35,
	heavyShoveXZ = 6.5, heavyShoveY = 1.8,
	packAlertRadius = 40, howlAlertRadius = 60,
	ambientCallMin = 18, ambientCallSpread = 40, ambientCallRange = 140,
	wanderRadiusWolf = 34, wanderRadiusOther = 18, wanderMinOffset = 6,
	maxSlope = 0.55,
}

-- ── Population ─────────────────────────────────────────────────────────────

Creatures.POPULATION = {
	mutantCap = 42,
	animalCap = 46,
	animalDensityBonus = 0.2,
	animalDensityCeiling = 1.2,
	nestWeightBoostPrimary = 1.8,
	nestWeightBoostOther = 0.8,
	nestThreatScale = 4.2,
	nestSkipRadius = 95,
	nestZoneRadius = 40,
	freeRoamSkipRadius = 110,
	freeRoamMaxSlope = 0.5,
	wolfPackMin = 2, wolfPackSpread = 3,
	bearMinDistance = 220, bearChance = 0.10,
}

--- Roster weight by position: the biome's own creature is common, the rest
--- taper off. 6, 3, 2, 1.
function Creatures.rosterWeight(index: number): number
	return if index == 1 then 6 else math.max(1, 4 - (index - 1))
end

--- Wildlife weights at a point. `moisture` is 0..1, `distance` is metres from
--- the spawn. Bear is handled separately: a flat 10% roll past 220 m.
function Creatures.wildlifeWeights(moisture: number, distance: number): { { id: string, weight: number } }
	return {
		{ id = "rabbit", weight = 7 + (1 - moisture) * 4 },
		{ id = "deer", weight = 6 + moisture * 4 },
		{ id = "boar", weight = if distance > 75 then 3 + moisture * 3 else 0 },
		{ id = "wolf", weight = if distance > 110 then 5 else 0 },
	}
end

return Creatures
