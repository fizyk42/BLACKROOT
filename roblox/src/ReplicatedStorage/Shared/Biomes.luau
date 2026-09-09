--!strict
--[[
	Biomes — transcribed from scripts/world/Biomes.js.

	Every field the WebGL build carries is here, including the ones Roblox
	cannot use directly (star counts, nebula weight, hemisphere light colours).
	They are kept for two reasons: the parity test compares them, and several
	of them do map onto something Roblox *can* do — `fogDensity` becomes a fog
	distance, `exposure` becomes ExposureCompensation, `hemiIntensity` becomes
	EnvironmentDiffuseScale.

	The physics block is the important one. The Long Dark really is 0.42 g with
	a 1.55× jump, and the Drowned Shelf really does drag you to 0.62 move speed
	under 0.30 g. Those are the two biomes that feel different to walk through,
	and they feel different here for the same reason.
]]

local Biomes = {}

export type Physics = { gravity: number, drag: number, moveMul: number, jumpMul: number, slip: number? }

Biomes.FIRST = "hollow"

-- ── The table ──────────────────────────────────────────────────────────────

Biomes.ALL = {
	hollow = {
		id = "hollow", name = "THE HOLLOW", sub = "NIGHTFALL IN THE HOLLOW", first = true,
		blurb = "Black pine, wet leaf litter, and something that has learnt the shape of a person.",
		terrain = { relief = 1.0, ridge = 1.0, detail = 1.0, water = "creek", floor = 0 },
		palette = { base = { 0.115, 0.108, 0.078 }, litter = { 0.075, 0.050, 0.016 },
			moss = { -0.030, 0.022, -0.012 }, rock = { 0.148, 0.146, 0.138 }, mud = { 0.085, 0.070, 0.052 } },
		sky = { top = 0x05080f, horizon = 0x141c22, bottom = 0x0b0f12, fog = 0x05070a, fogDensity = 0.0122,
			stars = 1400, starTint = { 1.0, 0.92, 1.0 }, nebula = 0, moon = 0xcfd8e8, moonLight = 0x9fb6d8,
			moonIntensity = 0.55, moonSize = 120, hemiSky = 0x2a3a4e, hemiGround = 0x0a0c08,
			hemiIntensity = 0.22, exposure = 1.15 },
		flora = { canopyA = "conifer", canopyB = "broadleaf", trunk = "bark", under = "bush",
			ground = "fern", carpet = "grass", debris = "log", stone = "boulder" },
		floraColors = { trunk = 0x8a7a68, canopyA = 0x2c3a26, canopyB = 0x37401f, under = 0x9aa48a,
			ground = 0x8fa07e, carpet = 0xa9b295, stone = 0x9a988f },
		counts = { tree = 1.0, bush = 1.0, fern = 1.0, grass = 1.0, rock = 1.0, log = 1.0 },
		leafHue = 102,
		physics = { gravity = 1.0, drag = 1.0, moveMul = 1.0, jumpMul = 1.0 },
		fx = { moteColor = 0xb9c4d0, moteRate = 1.0, fall = nil },
		audio = { ambience = "forest", dreadBase = 0.0 },
		creatures = { mutants = { "stalker", "crawler", "screamer", "brute" }, wildlife = true, density = 1.0 },
		boss = "warden",
		-- Roblox rendering
		rbx = { ground = Enum.Material.Grass, rock = Enum.Material.Slate, prop = "pine", propDensity = 1.0, clock = 7.2 },
	},

	void = {
		id = "void", name = "THE LONG DARK", sub = "WHERE THE SKY CAME APART",
		blurb = "The ground still holds you. Nothing else here agrees to.",
		terrain = { relief = 1.45, ridge = 1.7, detail = 0.7, water = "none", floor = 0 },
		palette = { base = { 0.055, 0.048, 0.086 }, litter = { 0.030, 0.010, 0.075 },
			moss = { 0.020, -0.005, 0.050 }, rock = { 0.088, 0.082, 0.120 }, mud = { 0.040, 0.030, 0.070 } },
		sky = { top = 0x05000e, horizon = 0x1a0a34, bottom = 0x0a0418, fog = 0x0a0618, fogDensity = 0.0068,
			stars = 5200, starTint = { 1.0, 0.95, 1.15 }, nebula = 1, moon = 0xb18cff, moonLight = 0x8f6cff,
			moonIntensity = 0.42, moonSize = 210, hemiSky = 0x2a1a52, hemiGround = 0x0a0616,
			hemiIntensity = 0.30, exposure = 1.22 },
		flora = { canopyA = "shard", canopyB = "shard", trunk = "obsidian", under = "crystal",
			ground = "crystal", carpet = "ashgrass", debris = "monolith", stone = "floatstone" },
		floraColors = { trunk = 0x161426, canopyA = 0x9d7bff, canopyB = 0x6f5bd6, under = 0x7b6ad8,
			ground = 0x5f57b0, carpet = 0x39355c, stone = 0x2a2740 },
		counts = { tree = 0.42, bush = 0.5, fern = 0.3, grass = 0.5, rock = 1.6, log = 0.5 },
		emissive = { canopyA = 0.9, under = 0.7, ground = 0.5 },
		leafHue = 268,
		physics = { gravity = 0.42, drag = 1.0, moveMul = 1.06, jumpMul = 1.55 },
		fx = { moteColor = 0xa88cff, moteRate = 2.2, fall = nil },
		audio = { ambience = "void", dreadBase = 0.18 },
		creatures = { mutants = { "choir", "stalker", "screamer" }, wildlife = false, density = 0.85 },
		boss = "chorister",
		rbx = { ground = Enum.Material.Concrete, rock = Enum.Material.CrackedLava, prop = "monolith", propDensity = 0.5, clock = 1.0 },
	},

	abyss = {
		id = "abyss", name = "THE DROWNED SHELF", sub = "BELOW THE LAST LIGHT",
		blurb = "Everything down here is patient, and everything down here is listening.",
		terrain = { relief = 0.75, ridge = 0.5, detail = 1.3, water = "flood", floor = 26 },
		palette = { base = { 0.055, 0.082, 0.086 }, litter = { 0.020, 0.055, 0.045 },
			moss = { -0.010, 0.030, 0.020 }, rock = { 0.078, 0.098, 0.108 }, mud = { 0.048, 0.062, 0.062 } },
		sky = { top = 0x04202c, horizon = 0x062a34, bottom = 0x010a10, fog = 0x04222c, fogDensity = 0.030,
			stars = 320, starTint = { 0.7, 1.0, 1.0 }, nebula = 0, moon = 0x8fe8ff, moonLight = 0x62c0d8,
			moonIntensity = 0.30, moonSize = 260, hemiSky = 0x14586a, hemiGround = 0x03161c,
			hemiIntensity = 0.34, exposure = 1.30 },
		flora = { canopyA = "kelp", canopyB = "coral", trunk = "kelpstalk", under = "coralfan",
			ground = "anemone", carpet = "seagrass", debris = "driftwood", stone = "boulder" },
		floraColors = { trunk = 0x3f4a3a, canopyA = 0x40624a, canopyB = 0xa8586a, under = 0xc06a7a,
			ground = 0x8f6ab0, carpet = 0x3e6a58, stone = 0x5c6a6e },
		counts = { tree = 0.75, bush = 1.3, fern = 1.4, grass = 1.5, rock = 1.2, log = 0.4 },
		emissive = { under = 0.55, ground = 0.8 },
		leafHue = 158,
		physics = { gravity = 0.30, drag = 2.6, moveMul = 0.62, jumpMul = 1.25 },
		fx = { moteColor = 0xbfe8ff, moteRate = 3.0, fall = "bubbles" },
		audio = { ambience = "abyss", dreadBase = 0.22 },
		creatures = { mutants = { "drowned", "crawler", "screamer" }, wildlife = false, density = 0.8 },
		boss = "gillfather",
		rbx = { ground = Enum.Material.Sand, rock = Enum.Material.Rock, prop = "hulk", propDensity = 0.7, clock = 6.0 },
	},

	cinder = {
		id = "cinder", name = "THE CINDER REACH", sub = "IT IS STILL BURNING",
		blurb = "The fire went through here a long time ago. It has not finished.",
		terrain = { relief = 1.1, ridge = 1.25, detail = 1.1, water = "none", floor = 0 },
		palette = { base = { 0.062, 0.052, 0.046 }, litter = { 0.055, 0.026, 0.008 },
			moss = { 0.030, 0.006, -0.010 }, rock = { 0.098, 0.086, 0.078 }, mud = { 0.038, 0.028, 0.024 } },
		sky = { top = 0x160806, horizon = 0x4a1408, bottom = 0x0e0604, fog = 0x1c0a06, fogDensity = 0.0165,
			stars = 260, starTint = { 1.0, 0.7, 0.5 }, nebula = 0, moon = 0xff7a3a, moonLight = 0xff8a4a,
			moonIntensity = 0.48, moonSize = 150, hemiSky = 0x4e2010, hemiGround = 0x160a06,
			hemiIntensity = 0.30, exposure = 1.10 },
		flora = { canopyA = "burnt", canopyB = "burnt", trunk = "charwood", under = "emberbush",
			ground = "ashfern", carpet = "ashgrass", debris = "log", stone = "boulder" },
		floraColors = { trunk = 0x2e2723, canopyA = 0x3a2a20, canopyB = 0x33251c, under = 0x5c3020,
			ground = 0x4a3a2c, carpet = 0x5a5148, stone = 0x6a5f56 },
		counts = { tree = 0.85, bush = 0.5, fern = 0.4, grass = 0.7, rock = 1.3, log = 2.2 },
		emissive = { under = 0.6 },
		leafHue = 22,
		physics = { gravity = 1.0, drag = 1.0, moveMul = 1.0, jumpMul = 1.0 },
		fx = { moteColor = 0xff8848, moteRate = 3.4, fall = "embers" },
		audio = { ambience = "cinder", dreadBase = 0.20 },
		creatures = { mutants = { "ashwalker", "brute", "crawler" }, wildlife = false, density = 1.1 },
		boss = "pyreking",
		rbx = { ground = Enum.Material.Ground, rock = Enum.Material.Basalt, prop = "burnt", propDensity = 0.8, clock = 6.4 },
	},

	permafrost = {
		id = "permafrost", name = "THE STILL WHITE", sub = "NOTHING HERE HAS MOVED IN YEARS",
		blurb = "Cold enough that the things in it stopped rotting and started waiting.",
		terrain = { relief = 1.25, ridge = 1.4, detail = 0.85, water = "none", floor = 0 },
		palette = { base = { 0.190, 0.205, 0.225 }, litter = { -0.020, -0.010, 0.010 },
			moss = { -0.030, -0.015, 0.010 }, rock = { 0.140, 0.148, 0.166 }, mud = { 0.120, 0.135, 0.155 } },
		sky = { top = 0x0a1420, horizon = 0x24435c, bottom = 0x0c1620, fog = 0x152836, fogDensity = 0.0210,
			stars = 2200, starTint = { 0.85, 0.95, 1.15 }, nebula = 0, moon = 0xdfeeff, moonLight = 0xbcd8f0,
			moonIntensity = 0.72, moonSize = 165, hemiSky = 0x39607e, hemiGround = 0x1a2630,
			hemiIntensity = 0.34, exposure = 1.05 },
		flora = { canopyA = "frozenconifer", canopyB = "icecrown", trunk = "frostbark", under = "icebush",
			ground = "frostfern", carpet = "snowgrass", debris = "log", stone = "icerock" },
		floraColors = { trunk = 0x6a6e74, canopyA = 0x33484a, canopyB = 0x7fa8bc, under = 0x8fb0c0,
			ground = 0x9cb8c6, carpet = 0xc8d8e2, stone = 0xa8bccc },
		counts = { tree = 0.9, bush = 0.6, fern = 0.5, grass = 0.9, rock = 1.4, log = 0.8 },
		leafHue = 190,
		physics = { gravity = 1.0, drag = 1.0, moveMul = 0.88, jumpMul = 0.95, slip = 0.55 },
		fx = { moteColor = 0xdff0ff, moteRate = 2.6, fall = "snow" },
		audio = { ambience = "permafrost", dreadBase = 0.16 },
		creatures = { mutants = { "rimewretch", "stalker", "brute" }, wildlife = false, density = 0.9 },
		boss = "hoarmother",
		rbx = { ground = Enum.Material.Snow, rock = Enum.Material.Ice, prop = "spire", propDensity = 0.55, clock = 8.6 },
	},

	bloom = {
		id = "bloom", name = "THE BLOOM", sub = "IT GOT INTO EVERYTHING",
		blurb = "The forest is still here. It is simply not the one in charge any more.",
		terrain = { relief = 0.9, ridge = 0.8, detail = 1.2, water = "creek", floor = 0 },
		palette = { base = { 0.085, 0.072, 0.098 }, litter = { 0.045, 0.070, 0.020 },
			moss = { -0.020, 0.045, 0.010 }, rock = { 0.110, 0.100, 0.120 }, mud = { 0.060, 0.055, 0.070 } },
		sky = { top = 0x0c0616, horizon = 0x2a1440, bottom = 0x0a0812, fog = 0x130a1e, fogDensity = 0.0250,
			stars = 700, starTint = { 1.0, 0.9, 1.1 }, nebula = 0, moon = 0xc8ff9a, moonLight = 0x9fd07a,
			moonIntensity = 0.50, moonSize = 135, hemiSky = 0x3a2a5a, hemiGround = 0x141018,
			hemiIntensity = 0.30, exposure = 1.18 },
		flora = { canopyA = "sporecap", canopyB = "sporecap", trunk = "myceliumstalk", under = "puffball",
			ground = "gillfern", carpet = "mossgrass", debris = "log", stone = "boulder" },
		floraColors = { trunk = 0x7d7259, canopyA = 0x7d4a63, canopyB = 0x5c6a3a, under = 0x9a6a80,
			ground = 0x6f8a4a, carpet = 0x6d8452, stone = 0x77707e },
		counts = { tree = 1.1, bush = 1.5, fern = 1.6, grass = 1.3, rock = 0.8, log = 1.4 },
		emissive = { canopyA = 0.45, under = 0.8, ground = 0.35 },
		leafHue = 84,
		physics = { gravity = 1.0, drag = 1.0, moveMul = 0.94, jumpMul = 1.0 },
		fx = { moteColor = 0xc9ff8a, moteRate = 4.0, fall = "spores" },
		audio = { ambience = "bloom", dreadBase = 0.24 },
		creatures = { mutants = { "sporebearer", "crawler", "screamer" }, wildlife = false, density = 1.05 },
		boss = "motherstalk",
		rbx = { ground = Enum.Material.LeafyGrass, rock = Enum.Material.Mud, prop = "cap", propDensity = 1.35, clock = 6.9 },
	},

	sandbox = {
		id = "sandbox", name = "THE PLAIN", sub = "SANDBOX", sandbox = true,
		blurb = "Flat, lit, and nothing here wants anything from you. Open the mod menu and break it.",
		terrain = { relief = 0.035, ridge = 0.0, detail = 0.05, water = "none", floor = 0 },
		palette = { base = { 0.150, 0.158, 0.140 }, litter = { 0.030, 0.034, 0.018 },
			moss = { -0.010, 0.020, -0.006 }, rock = { 0.180, 0.180, 0.176 }, mud = { 0.120, 0.120, 0.110 } },
		sky = { top = 0x14243a, horizon = 0x51617a, bottom = 0x1a2430, fog = 0x33404f, fogDensity = 0.0026,
			stars = 900, starTint = { 1.0, 1.0, 1.0 }, nebula = 0, moon = 0xffffff, moonLight = 0xdfe8f5,
			moonIntensity = 1.5, moonSize = 150, hemiSky = 0x8fa8c4, hemiGround = 0x50524a,
			hemiIntensity = 0.85, exposure = 1.25 },
		flora = { canopyA = "conifer", canopyB = "broadleaf", trunk = "bark", under = "bush",
			ground = "fern", carpet = "grass", debris = "log", stone = "boulder" },
		floraColors = { trunk = 0x8a7a68, canopyA = 0x3c5030, canopyB = 0x47552a, under = 0x9aa48a,
			ground = 0x8fa07e, carpet = 0xa9b295, stone = 0x9a988f },
		counts = { tree = 0.10, bush = 0.10, fern = 0.10, grass = 0.35, rock = 0.12, log = 0.05 },
		leafHue = 102,
		physics = { gravity = 1.0, drag = 1.0, moveMul = 1.0, jumpMul = 1.0 },
		fx = { moteColor = 0xcfe0f0, moteRate = 0.6, fall = nil },
		audio = { ambience = "forest", dreadBase = 0.0 },
		creatures = { mutants = { "stalker", "brute", "crawler", "screamer" }, wildlife = false, density = 0.0 },
		boss = nil,
		rbx = { ground = Enum.Material.Grass, rock = Enum.Material.Slate, prop = "pine", propDensity = 0.1, clock = 12.0 },
	},
}

--- Everything but the sandbox, in the order a run walks them before shuffling.
Biomes.IDS = { "hollow", "void", "abyss", "cinder", "permafrost", "bloom" }

function Biomes.get(id: string): any
	return Biomes.ALL[id]
end

--- The order a seed sends you through the rifts. The Hollow is always first;
--- the rest are Fisher-Yates shuffled against a derived seed so two players on
--- the same run seed walk the same road.
function Biomes.order(seed: number): { string }
	local Rng = require(script.Parent:WaitForChild("Rng"))
	local rng = Rng.new(bit32.bxor(seed, 0x51F0A7ED))

	local rest = {}
	for _, id in Biomes.IDS do
		if id ~= Biomes.FIRST then table.insert(rest, id) end
	end
	for i = #rest, 2, -1 do
		local j = Rng.int(rng, 1, i)
		rest[i], rest[j] = rest[j], rest[i]
	end

	local out = { Biomes.FIRST }
	for _, id in rest do table.insert(out, id) end
	return out
end

--- How much harder everything gets each time you step through a rift.
function Biomes.depthScaling(depth: number): { health: number, damage: number, density: number, loot: number }
	return {
		health = 1 + depth * 0.30,
		damage = 1 + depth * 0.18,
		density = 1 + depth * 0.12,
		loot = 1 + depth * 0.10,
	}
end

-- ── The morning grade ──────────────────────────────────────────────────────
-- The night palettes above are the originals. `morning` is the default,
-- because the original was unplayably dark; both are kept and switchable.

Biomes.DAWN = {
	top = 0x9dc2e8, horizon = 0xf7d7ae, bottom = 0xb9c6d2, fog = 0xcfdae3,
	hemiSky = 0xbcd8f0, hemiGround = 0x8a7f68, sun = 0xfff6e2, sunLight = 0xfff0d6,
}

local function mixHex(a: number, b: number, t: number): number
	local ar, ag, ab = bit32.rshift(a, 16) % 256, bit32.rshift(a, 8) % 256, a % 256
	local br, bg, bb = bit32.rshift(b, 16) % 256, bit32.rshift(b, 8) % 256, b % 256
	local r = math.floor(ar + (br - ar) * t + 0.5)
	local g = math.floor(ag + (bg - ag) * t + 0.5)
	local bl = math.floor(ab + (bb - ab) * t + 0.5)
	return r * 65536 + g * 256 + bl
end

Biomes.mixHex = mixHex

function Biomes.morningSky(K: any): any
	local D = Biomes.DAWN
	return {
		top = mixHex(K.top, D.top, 0.92),
		horizon = mixHex(K.horizon, D.horizon, 0.86),
		bottom = mixHex(K.bottom, D.bottom, 0.84),
		fog = mixHex(K.fog, D.fog, 0.88),
		fogDensity = K.fogDensity * 0.38,
		stars = if K.nebula > 0 then math.round(K.stars * 0.55) else 0,
		starTint = K.starTint,
		nebula = K.nebula * 0.35,
		moon = mixHex(K.moon, D.sun, 0.85),
		moonLight = mixHex(K.moonLight, D.sunLight, 0.88),
		moonIntensity = 3.1,
		moonSize = math.max(38, K.moonSize * 0.34),
		hemiSky = mixHex(K.hemiSky, D.hemiSky, 0.92),
		hemiGround = mixHex(K.hemiGround, D.hemiGround, 0.82),
		hemiIntensity = 1.85,
		exposure = 1.06,
		fillMul = 3.6,
		sunDir = { 0.66, 0.30, -0.69 },
		daylight = true,
	}
end

function Biomes.skyFor(biomeId: string, timeOfDay: string): any
	local biome = Biomes.ALL[biomeId] or Biomes.ALL.hollow
	if timeOfDay == "night" then return biome.sky end
	return Biomes.morningSky(biome.sky)
end

return Biomes
