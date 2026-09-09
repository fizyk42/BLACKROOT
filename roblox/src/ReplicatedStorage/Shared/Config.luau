--!strict
--[[
	Config — the run's shape and the difficulty ladder.

	The biome table used to live here; it now lives in Biomes.luau, which
	carries the full WebGL definitions rather than a Roblox-shaped subset.
	Config re-exports it so older call sites keep working, but new code should
	require Biomes directly.

	The difficulty ladder is a straight transcription of
	scripts/core/Settings.js and `robloxtest` fails if the two drift.
]]

local Shared = script.Parent
local Biomes = require(Shared:WaitForChild("Biomes"))

local Config = {}

Config.VERSION = "1.0.0-roblox"

-- ── Difficulty ─────────────────────────────────────────────────────────────
export type Difficulty = {
	dmgTaken: number, dmgDealt: number, hungerRate: number, thirstRate: number,
	enemyDensity: number, lootMul: number,
	regen: number, regenDelay: number, regenCap: number, iFrames: number, bleedMul: number,
}

Config.DIFFICULTY = {
	story = {
		dmgTaken = 0.28, dmgDealt = 1.7, hungerRate = 0.3, thirstRate = 0.3,
		enemyDensity = 0.45, lootMul = 1.8,
		regen = 7.0, regenDelay = 2.5, regenCap = 1.0, iFrames = 0.9, bleedMul = 0.3,
	},
	normal = {
		dmgTaken = 0.58, dmgDealt = 1.32, hungerRate = 0.55, thirstRate = 0.55,
		enemyDensity = 0.72, lootMul = 1.4,
		regen = 4.2, regenDelay = 4.5, regenCap = 0.85, iFrames = 0.6, bleedMul = 0.55,
	},
	harsh = {
		dmgTaken = 1.0, dmgDealt = 1.0, hungerRate = 1.0, thirstRate = 1.0,
		enemyDensity = 1.0, lootMul = 1.0,
		regen = 1.6, regenDelay = 9, regenCap = 0.5, iFrames = 0.35, bleedMul = 1.0,
	},
	brutal = {
		dmgTaken = 1.6, dmgDealt = 0.85, hungerRate = 1.45, thirstRate = 1.45,
		enemyDensity = 1.45, lootMul = 0.72,
		regen = 0, regenDelay = 999, regenCap = 0, iFrames = 0.2, bleedMul = 1.25,
	},
} :: { [string]: Difficulty }

Config.DIFFICULTY_ORDER = { "story", "normal", "harsh", "brutal" }
Config.DEFAULT_DIFFICULTY = "normal"

-- ── Biomes (re-exported) ───────────────────────────────────────────────────
Config.BIOMES = Biomes.ALL
Config.BIOME_IDS = Biomes.IDS

function Config.biomeById(id: string): any
	return Biomes.get(id)
end

-- ── World ──────────────────────────────────────────────────────────────────
Config.ARENA_SIZE = 900          -- studs across
Config.QUIET_RING = 140          -- nothing hostile spawns this close to a player
Config.LANDMARK_COUNT = 14
Config.LOOT_CONTAINERS = 26
Config.FORAGE_NODES = 40

-- ── Player ─────────────────────────────────────────────────────────────────
Config.MAX_HEALTH = 100
Config.WALK_SPEED = 16
Config.SPRINT_SPEED = 26
Config.CROUCH_SPEED = 8
Config.JUMP_POWER = 50
Config.BASE_GRAVITY = 196.2       -- Roblox default, the 1.0 of every biome's gravity
Config.CARRY_LIMIT = 34           -- kilograms before you start slowing down
Config.STAMINA_MAX = 100
Config.STAMINA_SPRINT = 11        -- per second
Config.STAMINA_REGEN = 16         -- per second, once you stop
Config.STAMINA_REGEN_DELAY = 1.1
Config.FLASHLIGHT_DRAIN = 0.55    -- battery percent per second
Config.QUICK_SLOTS = 5

-- ── Run ────────────────────────────────────────────────────────────────────
Config.RIFT_HOLD = 3              -- seconds standing in a rift before it takes you
Config.DEATH_RESPAWN = 4

return Config
