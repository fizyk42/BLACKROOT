--!strict
--[[
	Mods — the sandbox mod menu, transcribed from scripts/systems/Sandbox.js.

	Forty-three entries across seven groups. The table is the menu: SandboxUI
	renders whatever is in here, and SandboxService applies whatever is in
	here, so adding a mod is one entry plus one handler and nothing else.

	Types:
	  toggle  boolean, re-applied every frame while on
	  slider  number, re-applied every frame
	  action  a button, run once when pressed
	  pick    a chooser; on its own it only stores a value, and a paired
	          action does the work (creature + spawn, worldPick + goWorld)
]]

local Mods = {}

Mods.GROUPS = { "Player", "Weapons", "Spawn", "World", "Worlds", "Camera", "Fun" }

export type Mod = {
	id: string,
	label: string,
	group: string,
	kind: string,
	default: any?,
	min: number?,
	max: number?,
	step: number?,
	unit: string?,
	options: { string }?,
	optionsFrom: string?,
	desc: string,
}

Mods.ALL = {
	-- ── Player ───────────────────────────────────────────────────────────
	{ id = "god", label = "God mode", group = "Player", kind = "toggle", default = false,
		desc = "Health pinned to maximum; bleeding and poison cleared every frame." },
	{ id = "infStamina", label = "Infinite stamina", group = "Player", kind = "toggle", default = false,
		desc = "Stamina pinned to maximum." },
	{ id = "noNeeds", label = "No hunger or thirst", group = "Player", kind = "toggle", default = true,
		desc = "Hunger and thirst pinned to full." },
	{ id = "noclip", label = "Noclip", group = "Player", kind = "toggle", default = false,
		desc = "Fly through everything. Space climbs, C drops." },
	{ id = "speed", label = "Move speed", group = "Player", kind = "slider", default = 1,
		min = 0.1, max = 8, step = 0.1, unit = "×", desc = "Multiplies your movement speed." },
	{ id = "jump", label = "Jump height", group = "Player", kind = "slider", default = 1,
		min = 0.2, max = 6, step = 0.1, unit = "×", desc = "Multiplies your jump." },
	{ id = "gravity", label = "Gravity", group = "Player", kind = "slider", default = 1,
		min = 0, max = 3, step = 0.05, unit = "×", desc = "Multiplies gravity. Zero is genuinely zero." },
	{ id = "heal", label = "Full heal", group = "Player", kind = "action",
		desc = "Health and stamina to maximum, hunger and thirst full, bleed and poison cleared." },

	-- ── Weapons ──────────────────────────────────────────────────────────
	{ id = "infAmmo", label = "Infinite ammo", group = "Weapons", kind = "toggle", default = true,
		desc = "Refills the magazine, cancels reloads, tops reserve up to 200." },
	{ id = "noRecoil", label = "No recoil", group = "Weapons", kind = "toggle", default = false,
		desc = "Kick, kick velocity and recoil pitch all held at zero." },
	{ id = "noSpread", label = "Perfect accuracy", group = "Weapons", kind = "toggle", default = false,
		desc = "Spread bloom held at zero. Every round goes exactly where you point." },
	{ id = "oneShot", label = "One-shot kills", group = "Weapons", kind = "toggle", default = false,
		desc = "Damage multiplier of one thousand." },
	{ id = "explosive", label = "Explosive rounds", group = "Weapons", kind = "toggle", default = false,
		desc = "Every impact throws a blast." },
	{ id = "giveAll", label = "Give every weapon", group = "Weapons", kind = "action",
		desc = "Adds every weapon in the game and 240 rounds for each of them." },
	{ id = "forge", label = "Forge a random weapon", group = "Weapons", kind = "action",
		desc = "Rolls a new seed, adds the weapon with 240 rounds, and equips it." },
	{ id = "maxOut", label = "Max out this weapon", group = "Weapons", kind = "action",
		desc = "Sets every upgrade track on the held weapon to its ceiling and refits." },

	-- ── Spawn ────────────────────────────────────────────────────────────
	{ id = "creature", label = "Creature", group = "Spawn", kind = "pick", default = "stalker",
		optionsFrom = "creatures", desc = "Which creature the spawn button uses." },
	{ id = "count", label = "How many", group = "Spawn", kind = "slider", default = 1,
		min = 1, max = 25, step = 1, desc = "How many to spawn at once." },
	{ id = "spawn", label = "Spawn them (ahead of you)", group = "Spawn", kind = "action",
		desc = "Places them in an arc in front of you, radius 9 + count × 0.5." },
	{ id = "bossPick", label = "Boss", group = "Spawn", kind = "pick", default = "warden",
		optionsFrom = "bosses", desc = "Which boss the spawn button uses." },
	{ id = "spawnBoss", label = "Spawn that boss", group = "Spawn", kind = "action",
		desc = "Drops it twenty-six metres ahead of you, already awake." },
	{ id = "freezeAi", label = "Freeze all AI", group = "Spawn", kind = "toggle", default = false,
		desc = "Everything stops where it stands." },
	{ id = "peaceful", label = "Peaceful", group = "Spawn", kind = "toggle", default = false,
		desc = "Mutants forget about you and will not attack." },
	{ id = "killAll", label = "Kill everything", group = "Spawn", kind = "action",
		desc = "Kills every active entity, with the deaths and the loot." },
	{ id = "clearAll", label = "Remove everything", group = "Spawn", kind = "action",
		desc = "Deletes every entity and the boss outright. No deaths, no loot." },

	-- ── World ────────────────────────────────────────────────────────────
	{ id = "timeScale", label = "Time scale", group = "World", kind = "slider", default = 1,
		min = 0.05, max = 3, step = 0.05, unit = "×", desc = "Slows or speeds the whole simulation." },
	{ id = "brightness", label = "Brightness", group = "World", kind = "slider", default = 1.8,
		min = 0.4, max = 3, step = 0.05, unit = "×", desc = "How much light there is to see by." },
	{ id = "fog", label = "Fog", group = "World", kind = "slider", default = 1,
		min = 0, max = 4, step = 0.05, unit = "×", desc = "Thickens or clears the fog." },
	{ id = "weather", label = "Weather", group = "World", kind = "pick", default = "none",
		options = { "none", "snow", "embers", "spores", "bubbles" }, desc = "What falls out of the sky." },
	{ id = "wind", label = "Wind", group = "World", kind = "slider", default = 1,
		min = 0, max = 4, step = 0.05, unit = "×", desc = "How hard everything sways." },
	{ id = "skyPick", label = "Sky and palette", group = "World", kind = "pick", default = "sandbox",
		optionsFrom = "biomes", desc = "Which biome's sky to wear." },
	{ id = "applySky", label = "Wear that biome's sky", group = "World", kind = "action",
		desc = "Swaps the sky, fog and light without regenerating the terrain." },
	{ id = "rebuild", label = "Rebuild the plain", group = "World", kind = "action",
		desc = "Regenerates the sandbox from a new seed. Your mods survive it." },

	-- ── Worlds ───────────────────────────────────────────────────────────
	{ id = "worldPick", label = "World", group = "Worlds", kind = "pick", default = "sandbox",
		optionsFrom = "worlds", desc = "Which world to build, sandbox or any of the six." },
	{ id = "goWorld", label = "Go there", group = "Worlds", kind = "action",
		desc = "Builds that world for real — its terrain, flora, physics and creatures. Mods persist." },
	{ id = "rollWorld", label = "Somewhere at random", group = "Worlds", kind = "action",
		desc = "Picks one of the six at random and takes you there." },
	{ id = "tourWorld", label = "Take me to a landmark", group = "Worlds", kind = "action",
		desc = "Teleports you beside a random landmark in the world you are in." },
	{ id = "listWorld", label = "What is out here?", group = "Worlds", kind = "action",
		desc = "Names the six nearest landmarks and how far away each one is." },

	-- ── Camera ───────────────────────────────────────────────────────────
	{ id = "fov", label = "Field of view", group = "Camera", kind = "slider", default = 74,
		min = 55, max = 130, step = 1, unit = "°", desc = "How wide the camera sees." },
	{ id = "thirdPerson", label = "Third person", group = "Camera", kind = "slider", default = 0,
		min = 0, max = 9, step = 0.25, unit = "m", desc = "Pulls the camera back. Off below 0.1; the weapon hides past two metres." },

	-- ── Fun ──────────────────────────────────────────────────────────────
	{ id = "bigHeads", label = "Big heads", group = "Fun", kind = "toggle", default = false,
		desc = "Every head scaled to 2.6." },
	{ id = "creatureScale", label = "Creature size", group = "Fun", kind = "slider", default = 1,
		min = 0.25, max = 4, step = 0.05, unit = "×", desc = "Scales every creature model." },
	{ id = "lowGravityCreatures", label = "Launch on death", group = "Fun", kind = "toggle", default = false,
		desc = "Corpses leave at speed." },
	{ id = "discoLamp", label = "Colour-cycle the lamp", group = "Fun", kind = "toggle", default = false,
		desc = "The flashlight cycles hue at 0.35 turns a second." },
	{ id = "rain", label = "Rain creatures", group = "Fun", kind = "action",
		desc = "Drops the chosen count from twenty-two to forty metres up, within a four to twenty-two metre radius." },
} :: { Mod }

function Mods.get(id: string): Mod?
	for _, m in Mods.ALL do
		if m.id == id then return m end
	end
	return nil
end

function Mods.inGroup(group: string): { Mod }
	local out = {}
	for _, m in Mods.ALL do
		if m.group == group then table.insert(out, m) end
	end
	return out
end

function Mods.defaults(): { [string]: any }
	local out = {}
	for _, m in Mods.ALL do
		if m.default ~= nil then out[m.id] = m.default end
	end
	return out
end

-- ── The tutorial ───────────────────────────────────────────────────────────
-- Seven steps, same copy and same focus targets as the WebGL build.

Mods.TUTORIAL = {
	{ title = "This is the sandbox", focus = nil,
		body = "Flat ground, good light, and nothing here wants anything from you. Everything you are about to do is reversible." },
	{ title = "The mod menu", focus = nil, key = "`",
		body = "Press the backtick key to open and close it. It stays open while you play — you do not have to pause." },
	{ title = "Switches take effect immediately", focus = "god",
		body = "Tick god mode. You will notice nothing until something tries to kill you, which is rather the point." },
	{ title = "Sliders are live", focus = "speed",
		body = "Drag move speed while you are walking. It changes under your feet." },
	{ title = "Spawn things", focus = "spawn",
		body = "Pick a creature, pick a number, and put them in front of you. Peaceful stops them fighting back." },
	{ title = "Wear another biome", focus = "applySky",
		body = "The sky swaps without rebuilding the ground. Worlds, further down, builds the real thing instead." },
	{ title = "You are done", focus = nil,
		body = "Nothing here is scored and nothing here is saved. Break it however you like." },
}

return Mods
