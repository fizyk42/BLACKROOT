--!strict
--[[
	Forge — the procedural weapon generator, from scripts/systems/WeaponForge.js.

	A forge seed is a number in [0, 2^32). The same seed produces the same
	chassis, tier, traits, statline, name and finish on every machine, which is
	what lets a player read a number out to a friend and have them hold the
	same gun.

	Roll order matters and is fixed: chassis, tier, stat jitter, traits, name,
	nickname, finish. Change the order and every existing seed produces a
	different weapon.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = script.Parent
local Rng = require(Shared:WaitForChild("Rng"))
local Attachments = require(Shared:WaitForChild("Attachments"))

local Forge = {}

Forge.SPACE = 4294967296

-- ── Chassis ────────────────────────────────────────────────────────────────

Forge.CHASSIS = {
	{ id = "sidearm", label = "Sidearm", base = "pistol9", viewModel = "pistol", profile = "pistol",
		ammo = "ammo9", weight = 1.0, mag = 15, damage = 26, rate = 5.2, reload = 1.9,
		recoil = 1.0, spread = 0.010, adsSpread = 0.0022, range = 120, adsTime = 0.18,
		sway = 1.0, headMul = 2.2, auto = false },
	{ id = "magnum", label = "Magnum", base = "revolver", viewModel = "revolver", profile = "revolver",
		ammo = "ammo357", weight = 1.3, mag = 6, damage = 62, rate = 1.9, reload = 3.2,
		recoil = 2.6, spread = 0.013, adsSpread = 0.003, range = 140, adsTime = 0.24,
		sway = 1.15, headMul = 2.4, auto = false },
	{ id = "scattergun", label = "Scattergun", base = "shotgun", viewModel = "shotgun", profile = "shotgun",
		ammo = "ammo12", weight = 3.2, mag = 6, damage = 17, rate = 0.95, reload = 0.62,
		recoil = 4.0, spread = 0.052, adsSpread = 0.036, range = 34, adsTime = 0.30,
		sway = 1.4, headMul = 1.5, auto = false, pellets = 8, shellReload = true },
	{ id = "marksman", label = "Marksman Rifle", base = "rifle", viewModel = "rifle", profile = "rifle",
		ammo = "ammo308", weight = 3.9, mag = 5, damage = 96, rate = 0.85, reload = 3.6,
		recoil = 3.6, spread = 0.020, adsSpread = 0.0006, range = 300, adsTime = 0.36,
		sway = 1.5, headMul = 3.0, auto = false, boltAction = true, zoom = 2.4 },
	{ id = "machinePistol", label = "Machine Pistol", base = "smg", viewModel = "smg", profile = "smg",
		ammo = "ammo9", weight = 2.4, mag = 30, damage = 21, rate = 12.5, reload = 2.4,
		recoil = 1.15, spread = 0.020, adsSpread = 0.009, range = 90, adsTime = 0.20,
		sway = 1.1, headMul = 1.8, auto = true },
	{ id = "carbine", label = "Assault Carbine", base = "carbine", viewModel = "carbine", profile = "ar",
		ammo = "ammo556", weight = 3.4, mag = 30, damage = 38, rate = 10.0, reload = 2.6,
		recoil = 1.6, spread = 0.014, adsSpread = 0.0028, range = 220, adsTime = 0.26,
		sway = 1.2, headMul = 2.2, auto = true, zoom = 1.35 },
}

-- ── Tiers ──────────────────────────────────────────────────────────────────

Forge.TIERS = {
	{ id = "field", label = "Field", color = "#8e8c84", weight = 0.42, power = 0.00, traits = 0 },
	{ id = "marked", label = "Marked", color = "#6f9a72", weight = 0.28, power = 0.06, traits = 1 },
	{ id = "issued", label = "Issued", color = "#5b8fc9", weight = 0.18, power = 0.13, traits = 1 },
	{ id = "relic", label = "Relic", color = "#ad6bf0", weight = 0.09, power = 0.22, traits = 2 },
	{ id = "blackroot", label = "Blackroot", color = "#d9a441", weight = 0.03, power = 0.34, traits = 3 },
}

-- ── Traits ─────────────────────────────────────────────────────────────────

Forge.TRAITS = {
	{ id = "hollowpoint", label = "Hollowpoint", mods = { damage = 1.16, range = 0.82 } },
	{ id = "match", label = "Match Grade", mods = { spread = 0.72, adsSpread = 0.62, reload = 1.08 } },
	{ id = "overclock", label = "Overclocked", mods = { rate = 1.22, recoil = 1.18 } },
	{ id = "feather", label = "Featherweight", mods = { adsTime = 0.80, sway = 1.22 } },
	{ id = "anchored", label = "Anchored", mods = { recoil = 0.74, sway = 0.70, adsTime = 1.16 } },
	{ id = "longthrow", label = "Long Throw", mods = { range = 1.30, adsTime = 1.08 } },
	{ id = "ravenous", label = "Ravenous", mods = { magAdd = 0.34, reload = 1.14 } },
	{ id = "drilled", label = "Drilled", mods = { reload = 0.68 } },
	{ id = "quiet", label = "Quiet Running", mods = {}, noise = 0.55, flash = 0.6 },
	{ id = "headhunter", label = "Headhunter", mods = { headMul = 1.35, damage = 0.94 } },
	{ id = "brutal", label = "Brutal", mods = { damage = 1.28, recoil = 1.35, spread = 1.15 } },
	{ id = "surefooted", label = "Surefooted", mods = { spread = 0.80, sway = 0.84 } },
}

-- ── Naming ─────────────────────────────────────────────────────────────────

Forge.MAKERS = {
	"Halloway", "Bowman", "Verrick", "Ostend", "Kaltbrun", "Marrow & Sons",
	"Lantern Works", "Pell", "Ardath", "Ninefold", "Carrow", "Stannis",
	"Vosk", "Deering", "Merrow", "Ashgrove", "Thorne", "Quillan",
}

Forge.LETTERS = "ABCDEFGHKLMPRSTVXZ"

Forge.NICK_A = {
	"Ashen", "Hollow", "Silent", "Drowned", "Burnt", "Pale", "Iron", "Wretched",
	"Frozen", "Rotting", "Gilded", "Feral", "Broken", "Starless", "Bitter",
	"Second", "Long", "Low", "Quiet", "Black", "Hungry", "Split", "Grave", "Salt",
}

Forge.NICK_B = {
	"Widow", "Sermon", "Vigil", "Choir", "Tide", "Bloom", "Cinder", "Vein",
	"Wake", "Husk", "Lantern", "Thaw", "Harrow", "Grain", "Fathom", "Ledger",
	"Cradle", "Lure", "Spine", "Bell", "Root", "Frost", "Static", "Verse",
}

-- ── Default attachment fit ─────────────────────────────────────────────────

local function pickFit(chassisId: string, rng: Rng.Generator): { [string]: string }
	local fit = Attachments.defaultLoadout()

	local r = Rng.next(rng)
	if chassisId == "marksman" then
		fit.optic = if r < 0.5 then "sniper" elseif r < 0.8 then "acog" else "iron"
	elseif chassisId == "scattergun" then
		fit.optic = if r < 0.4 then "reflex" else "iron"
	elseif chassisId == "sidearm" or chassisId == "magnum" then
		fit.optic = if r < 0.35 then "reflex" else "iron"
	else
		fit.optic = if r < 0.32 then "reflex" elseif r < 0.55 then "holo" elseif r < 0.68 then "acog" else "iron"
	end

	r = Rng.next(rng)
	fit.muzzle = if r < 0.22 then "suppressor" elseif r < 0.42 then "compensator" elseif r < 0.55 then "brake" else "none"

	r = Rng.next(rng)
	fit.barrel = if r < 0.2 then "long" elseif r < 0.35 then "heavy" elseif r < 0.48 then "short" else "standard"

	local pistolish = chassisId == "sidearm" or chassisId == "magnum"
	if not pistolish then
		r = Rng.next(rng)
		fit.stock = if r < 0.22 then "heavy" elseif r < 0.44 then "light" else "standard"
		r = Rng.next(rng)
		fit.grip = if r < 0.24 then "vertical" elseif r < 0.4 then "angled" elseif r < 0.5 then "bipod" else "none"
	end

	r = Rng.next(rng)
	fit.laser = if r < 0.18 then "red" else "none"

	return fit
end

-- ── Power rating ───────────────────────────────────────────────────────────

local BASE_DPS = 26 * 5.2   -- the sidearm, which is the yardstick

function Forge.powerRating(stats: any): number
	local pellets = stats.pellets or 1
	local dps = stats.damage * pellets * stats.rate
	local acc = math.clamp(1 - stats.spread / 0.06, 0, 1)
	local handling = math.clamp(1 - (stats.adsTime - 0.14) / 0.3, 0, 1)
	local reach = math.clamp(stats.range / 300, 0, 1)
	local raw = (dps / BASE_DPS) * 0.45 + acc * 0.2 + handling * 0.2 + reach * 0.15
	return math.clamp(math.round(raw * 52), 1, 100)
end

-- ── The roll ───────────────────────────────────────────────────────────────

--[[
	Build the weapon for a seed. Returns a table shaped like an entry in
	Items.WEAPONS, plus `forge` metadata (tier, traits, seed, rating).
]]
function Forge.roll(seed: number): any
	local rng = Rng.new(seed)

	local chassis = Rng.pick(rng, Forge.CHASSIS)
	local tier = Rng.weighted(rng, Forge.TIERS)
	local P = tier.power

	local function rollUp(): number
		return Rng.lerp(0.90, 1.14, Rng.next(rng)) * (1 + P)
	end
	local function rollDown(): number
		return Rng.lerp(0.88, 1.12, Rng.next(rng)) * (1 - P * 0.55)
	end

	local stats = {
		kind = "gun",
		ammo = chassis.ammo,
		weight = chassis.weight,
		profile = chassis.profile,
		viewModel = chassis.viewModel,
		auto = chassis.auto,
		pellets = chassis.pellets,
		shellReload = chassis.shellReload,
		boltAction = chassis.boltAction,
		zoom = chassis.zoom,
		headMul = chassis.headMul,

		damage = chassis.damage * rollUp(),
		range = chassis.range * rollUp(),
		rate = chassis.rate * Rng.lerp(0.92, 1.10, Rng.next(rng)),
		recoil = chassis.recoil * rollDown(),
		spread = chassis.spread * rollDown(),
		adsSpread = chassis.adsSpread * rollDown(),
		adsTime = chassis.adsTime * rollDown(),
		reload = chassis.reload * rollDown(),
		sway = chassis.sway * rollDown(),
		mag = math.round(chassis.mag * Rng.lerp(0.85, 1.2, Rng.next(rng)) * (1 + P * 0.5)),
	}
	stats.mag = math.max(1, stats.mag)

	-- Traits
	local traits = {}
	local pool = table.clone(Forge.TRAITS)
	for _ = 1, tier.traits do
		if #pool == 0 then break end
		local index = Rng.int(rng, 1, #pool)
		local trait = table.remove(pool, index)
		table.insert(traits, trait)
	end

	local magAdd = 0
	for _, trait in traits do
		for key, value in trait.mods do
			if key == "magAdd" then
				magAdd += value
			elseif stats[key] ~= nil then
				stats[key] = stats[key] * value
			end
		end
		if trait.noise then stats.noise = (stats.noise or 1) * trait.noise end
		if trait.flash then stats.flash = (stats.flash or 1) * trait.flash end
	end
	if magAdd ~= 0 then
		stats.mag = math.max(1, math.round(stats.mag + chassis.mag * magAdd))
	end
	stats.adsTime = math.max(0.06, stats.adsTime)

	-- Name
	local maker = Rng.pick(rng, Forge.MAKERS)
	local letterIndex = Rng.int(rng, 1, #Forge.LETTERS)
	local letter = string.sub(Forge.LETTERS, letterIndex, letterIndex)
	local number = 1 + math.floor(Rng.next(rng) * 98)
	local name = `{maker} {letter}-{number}`

	local nickname = nil
	if tier.traits >= 2 then
		nickname = `The {Rng.pick(rng, Forge.NICK_A)} {Rng.pick(rng, Forge.NICK_B)}`
		name = `{name} "{nickname}"`
	end

	stats.id = `forge:{seed}`
	stats.name = name
	stats.cat = "weapon"
	stats.icon = "🔫"
	stats.stack = 1
	stats.rarity = tier.id
	stats.desc = `{tier.label} pattern. {#traits > 0 and "Marked: " or "No markings."}`
	if #traits > 0 then
		local labels = {}
		for _, t in traits do table.insert(labels, t.label) end
		stats.desc = `{tier.label} pattern. {table.concat(labels, ", ")}.`
	end

	stats.fit = pickFit(chassis.id, rng)
	stats.presetCamo = tier.power >= 0.22

	stats.forge = {
		seed = seed,
		chassis = chassis.id,
		tier = tier.id,
		tierLabel = tier.label,
		tierColor = tier.color,
		traits = traits,
		nickname = nickname,
		rating = Forge.powerRating(stats),
	}

	return stats
end

function Forge.randomSeed(): number
	return math.floor(math.random() * Forge.SPACE)
end

return Forge
