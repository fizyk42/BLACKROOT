--!strict
--[[
	Attachments — transcribed from scripts/systems/Attachments.js.

	Mods are multiplicative except keys ending in "Add", which are additive
	fractions of the *base* magazine. That one exception is why `apply` takes
	the base stats separately: applying magAdd to an already-modified magazine
	compounds, and an extended drum on a forge-rolled Ravenous receiver would
	end up with eighty rounds instead of sixty.
]]

local Attachments = {}

Attachments.SLOTS = { "optic", "muzzle", "barrel", "mag", "stock", "grip", "laser" }

Attachments.SLOT_LABEL = {
	optic = "Optic", muzzle = "Muzzle", barrel = "Barrel", mag = "Magazine",
	stock = "Stock", grip = "Underbarrel", laser = "Laser",
}

Attachments.OPTIC = {
	{ id = "iron", name = "Iron Sights", mods = {}, zoom = 1, magnified = false },
	{ id = "reflex", name = "Reflex Sight", mods = { adsTime = 0.94, adsSpread = 0.82 },
		zoom = 1.12, magnified = false, reticleColor = "#ff3b30" },
	{ id = "holo", name = "Holographic Sight", mods = { adsTime = 1.04, adsSpread = 0.74 },
		zoom = 1.2, magnified = false, reticleColor = "#39ff88" },
	{ id = "acog", name = "3× Combat Scope", mods = { adsTime = 1.22, adsSpread = 0.5, sway = 1.15 },
		zoom = 3, magnified = true, tubeLength = 0.17, tubeRadius = 0.020,
		reticle = "chevron", reticleColor = "#ffb02e" },
	{ id = "sniper", name = "6× Precision Scope",
		mods = { adsTime = 1.5, adsSpread = 0.28, sway = 1.45, range = 1.2 },
		zoom = 6, magnified = true, tubeLength = 0.24, tubeRadius = 0.023,
		reticle = "crosshair", reticleColor = "#e8e2d2", vignette = 0.82 },
	{ id = "thermal", name = "4× Thermal Optic",
		mods = { adsTime = 1.42, adsSpread = 0.42, sway = 1.3 },
		zoom = 4, magnified = true, thermal = true, tubeLength = 0.20, tubeRadius = 0.022,
		reticle = "crosshair", reticleColor = "#ffffff" },
}

Attachments.MUZZLE = {
	{ id = "none", name = "No Muzzle Device", mods = {} },
	{ id = "suppressor", name = "Suppressor", mods = { damage = 0.94, range = 0.88, recoil = 0.9 },
		noise = 0.35, flash = 0.25 },
	{ id = "compensator", name = "Compensator", mods = { recoil = 0.72, spread = 1.06 },
		noise = 1.15, flash = 1.3 },
	{ id = "brake", name = "Muzzle Brake", mods = { recoil = 0.58, adsTime = 1.06 },
		noise = 1.3, flash = 1.5 },
}

Attachments.BARREL = {
	{ id = "standard", name = "Standard Barrel", mods = {} },
	{ id = "long", name = "Long Barrel", mods = { range = 1.35, damage = 1.08, adsTime = 1.14, sway = 1.15 } },
	{ id = "short", name = "Short Barrel", mods = { range = 0.7, adsTime = 0.84, spread = 1.18, sway = 0.85 } },
	{ id = "heavy", name = "Heavy Barrel", mods = { recoil = 0.78, spread = 0.86, adsTime = 1.18 } },
}

Attachments.MAG = {
	{ id = "standard", name = "Standard Magazine", mods = {} },
	{ id = "extended", name = "Extended Magazine", mods = { magAdd = 0.5, reload = 1.15 } },
	{ id = "drum", name = "Drum Magazine", mods = { magAdd = 1.0, reload = 1.45, adsTime = 1.12 } },
	{ id = "quick", name = "Quickdraw Mags", mods = { reload = 0.7, magAdd = -0.15 } },
}

Attachments.STOCK = {
	{ id = "standard", name = "Standard Stock", mods = {} },
	{ id = "heavy", name = "Heavy Stock", mods = { sway = 0.6, recoil = 0.85, adsTime = 1.1 } },
	{ id = "light", name = "Skeleton Stock", mods = { adsTime = 0.86, sway = 1.3 } },
	{ id = "none", name = "No Stock", mods = { adsTime = 0.72, sway = 1.7, recoil = 1.35 } },
}

Attachments.GRIP = {
	{ id = "none", name = "No Grip", mods = {} },
	{ id = "vertical", name = "Vertical Grip", mods = { recoil = 0.8 } },
	{ id = "angled", name = "Angled Grip", mods = { adsTime = 0.88, spread = 1.05 } },
	{ id = "bipod", name = "Folding Bipod", mods = { sway = 0.5, adsTime = 1.2 }, crouchBonus = true },
}

Attachments.LASER = {
	{ id = "none", name = "No Laser", mods = {} },
	{ id = "red", name = "Target Laser", mods = { spread = 0.62 }, laserColor = 0xff2a1a, visible = true },
	{ id = "ir", name = "Infrared Laser", mods = { spread = 0.72 }, laserColor = 0x30203a, visible = false },
}

Attachments.BY_SLOT = {
	optic = Attachments.OPTIC,
	muzzle = Attachments.MUZZLE,
	barrel = Attachments.BARREL,
	mag = Attachments.MAG,
	stock = Attachments.STOCK,
	grip = Attachments.GRIP,
	laser = Attachments.LASER,
}

function Attachments.find(slot: string, id: string): any
	local list = Attachments.BY_SLOT[slot]
	if not list then return nil end
	for _, entry in list do
		if entry.id == id then return entry end
	end
	return nil
end

function Attachments.defaultLoadout(): { [string]: string }
	return {
		optic = "iron", muzzle = "none", barrel = "standard",
		mag = "standard", stock = "standard", grip = "none", laser = "none",
	}
end

--[[
	Apply a loadout to a weapon's base stats and return the modified copy.

	`base` is the untouched weapon definition; `stats` may already carry forge
	and upgrade changes. Multiplicative mods stack onto `stats`; magAdd is
	always measured against `base.mag`.
]]
function Attachments.apply(base: any, stats: any, loadout: { [string]: string }): any
	local out = table.clone(stats)
	local magAdd = 0

	for _, slot in Attachments.SLOTS do
		local chosen = loadout[slot]
		if not chosen then continue end
		local entry = Attachments.find(slot, chosen)
		if not entry then continue end

		for key, value in entry.mods do
			if key == "magAdd" then
				magAdd += value
			elseif out[key] ~= nil then
				out[key] = out[key] * value
			end
		end

		if slot == "optic" then
			out.zoom = entry.zoom
			out.magnified = entry.magnified
			out.opticId = entry.id
			out.reticle = entry.reticle
			out.reticleColor = entry.reticleColor
			out.thermal = entry.thermal
		elseif slot == "muzzle" then
			if entry.noise then out.noise = (out.noise or 1) * entry.noise end
			if entry.flash then out.flash = (out.flash or 1) * entry.flash end
		elseif slot == "laser" then
			out.laserColor = entry.laserColor
			out.laserVisible = entry.visible
		elseif slot == "grip" then
			out.crouchBonus = entry.crouchBonus
		end
	end

	if magAdd ~= 0 then
		out.mag = math.max(1, math.round((out.mag or base.mag) + base.mag * magAdd))
	end
	if out.adsTime then
		out.adsTime = math.max(0.06, out.adsTime)
	end

	return out
end

return Attachments
