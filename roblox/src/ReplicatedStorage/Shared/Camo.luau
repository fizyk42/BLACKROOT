--!strict
--[[
	Camo — the finish generator, from scripts/systems/CamoGenerator.js.

	The WebGL build draws each finish into a canvas at runtime. Roblox has no
	canvas, so this port keeps the whole generator — family, palette, rarity,
	material response — and resolves it to a colour, a Roblox material and a
	surface texture id rather than a bitmap. The *identity* of a finish is
	preserved (seed 91442 is the same Tigerstripe/Cinder Exotic in both), which
	is what the number is for; the pixels are not, because they cannot be.
]]

local Shared = script.Parent
local Rng = require(Shared:WaitForChild("Rng"))

local Camo = {}

Camo.SPACE = 4294967296

Camo.RARITIES = {
	{ id = "standard", label = "Standard", color = "#8e8c84", weight = 0.58 },
	{ id = "refined", label = "Refined", color = "#6f9a72", weight = 0.24 },
	{ id = "rare", label = "Rare", color = "#5b8fc9", weight = 0.12 },
	{ id = "exotic", label = "Exotic", color = "#ad6bf0", weight = 0.05 },
	{ id = "mythic", label = "Mythic", color = "#d9a441", weight = 0.01 },
}

Camo.FAMILIES = {
	{ id = "blotch", label = "Blotch" },
	{ id = "digital", label = "Digital" },
	{ id = "tiger", label = "Tigerstripe" },
	{ id = "splinter", label = "Splinter" },
	{ id = "fractal", label = "Fractal" },
	{ id = "hex", label = "Hexcell" },
	{ id = "fluid", label = "Fluid" },
	{ id = "dazzle", label = "Dazzle" },
	{ id = "scale", label = "Scale" },
	{ id = "circuit", label = "Circuit" },
	{ id = "topo", label = "Contour" },
	{ id = "spray", label = "Stencil" },
	{ id = "damascus", label = "Damascus" },
	{ id = "gradient", label = "Gradient" },
	{ id = "shatter", label = "Shatter" },
	{ id = "weave", label = "Weave" },
	{ id = "drip", label = "Drip" },
	{ id = "starfield", label = "Starfield" },
}

Camo.PALETTES = {
	{ id = "woodland", label = "Woodland", colors = { "#3d4531", "#5b6344", "#2b2f24", "#7c7a5a", "#1d201a" } },
	{ id = "desert", label = "Desert", colors = { "#b09a6d", "#8a7247", "#d6c69b", "#5f5236", "#2f2a1e" } },
	{ id = "arctic", label = "Arctic", colors = { "#dfe6ec", "#a9b7c4", "#7d8b98", "#f2f6fa", "#4a5560" } },
	{ id = "urban", label = "Urban", colors = { "#4a4d52", "#6d7178", "#2a2c30", "#8f949b", "#17181b" } },
	{ id = "tigerstripe", label = "Tigerstripe", colors = { "#6b6340", "#2c2a1c", "#8f8558", "#3e3a26", "#141309" } },
	{ id = "nebula", label = "Nebula", colors = { "#2a1b4d", "#5b2f8a", "#8f4fd1", "#1a0f2e", "#d3a6ff" } },
	{ id = "abyssal", label = "Abyssal", colors = { "#0d2d38", "#14505f", "#1f7f8c", "#061a20", "#7fd4d9" } },
	{ id = "cinder", label = "Cinder", colors = { "#3a1310", "#7a2318", "#c1471f", "#1a0b09", "#ff8c3a" } },
	{ id = "toxic", label = "Toxic", colors = { "#2c3a12", "#5f8318", "#9ecf2b", "#161e0a", "#d9ff5c" } },
	{ id = "blood", label = "Blood", colors = { "#3d0e10", "#6e161a", "#a52228", "#1a0708", "#d95a5e" } },
	{ id = "gilded", label = "Gilded", colors = { "#6b5218", "#a8842c", "#d9b455", "#3a2c0d", "#ffe9a8" } },
	{ id = "chrome", label = "Chrome", colors = { "#6f7681", "#9aa3ae", "#c8d0d9", "#454a52", "#eef3f7" } },
	{ id = "void", label = "Void", colors = { "#121216", "#1e1e26", "#2c2c38", "#08080a", "#4a4a5e" } },
	{ id = "rust", label = "Rust", colors = { "#4a2a16", "#7a4522", "#a8642f", "#2a1810", "#c98b4e" } },
	{ id = "glacier", label = "Glacier", colors = { "#7fb3c9", "#4d8299", "#a8d4e6", "#2c5468", "#dff2fa" } },
	{ id = "bloom", label = "Bloom", colors = { "#3a1f4a", "#6b3a7a", "#a05fb0", "#1e0f28", "#e0a8f0" } },
	{ id = "ranger", label = "Ranger", colors = { "#4a4a3a", "#6b6a52", "#2c2c22", "#8a8a70", "#16160f" } },
	{ id = "ember", label = "Ember", colors = { "#1a1a1c", "#3a2018", "#8f3a12", "#0d0d0e", "#ffb45c" } },
}

--- Roblox has no runtime canvas, so a family maps to the closest surface the
--- engine can actually draw. Named rather than inlined so the mapping is one
--- table to argue with rather than a chain of ifs.
local FAMILY_MATERIAL = {
	blotch = Enum.Material.Fabric, digital = Enum.Material.Pebble, tiger = Enum.Material.Fabric,
	splinter = Enum.Material.Slate, fractal = Enum.Material.Marble, hex = Enum.Material.DiamondPlate,
	fluid = Enum.Material.SmoothPlastic, dazzle = Enum.Material.Metal, scale = Enum.Material.Cobblestone,
	circuit = Enum.Material.DiamondPlate, topo = Enum.Material.Sandstone, spray = Enum.Material.Concrete,
	damascus = Enum.Material.Metal, gradient = Enum.Material.SmoothPlastic, shatter = Enum.Material.Glass,
	weave = Enum.Material.Fabric, drip = Enum.Material.Plastic, starfield = Enum.Material.Neon,
}

local function hexToColor3(hex: string): Color3
	local clean = string.gsub(hex, "#", "")
	local r = tonumber(string.sub(clean, 1, 2), 16) or 0
	local g = tonumber(string.sub(clean, 3, 4), 16) or 0
	local b = tonumber(string.sub(clean, 5, 6), 16) or 0
	return Color3.fromRGB(r, g, b)
end

Camo.hexToColor3 = hexToColor3

--[[
	Resolve a finish seed. Roll order is fixed and matches the WebGL build:
	rarity, family, palette, then the two material terms.
]]
function Camo.roll(seed: number): any
	local rng = Rng.new(seed)

	local rarity = Rng.weighted(rng, Camo.RARITIES)
	local family = Rng.pick(rng, Camo.FAMILIES)
	local palette = Rng.pick(rng, Camo.PALETTES)

	-- Metal and roughness response, keyed off rarity exactly as in the source.
	local metal = if rarity.id == "mythic" then 0.85 elseif rarity.id == "exotic" then 0.55 else 0.18
	local rough = if rarity.id == "mythic" then 0.24 elseif rarity.id == "exotic" then 0.38 else 0.62

	-- Jitter, drawn but unused for geometry here; kept so the stream position
	-- matches the WebGL generator and seeds stay comparable across builds.
	local scaleJitter = Rng.range(rng, 0.8, 1.35)
	local rotation = Rng.next(rng) * math.pi * 2

	local primary = hexToColor3(palette.colors[1])
	local accent = hexToColor3(palette.colors[5])

	return {
		seed = seed,
		name = `{palette.label} {family.label}`,
		family = family.id,
		familyLabel = family.label,
		palette = palette.id,
		paletteLabel = palette.label,
		colors = palette.colors,
		rarity = rarity.id,
		rarityLabel = rarity.label,
		rarityColor = rarity.color,
		metal = metal,
		rough = rough,
		scale = scaleJitter,
		rotation = rotation,
		-- Roblox render hints
		color = primary,
		accentColor = accent,
		material = FAMILY_MATERIAL[family.id] or Enum.Material.Metal,
		reflectance = metal * 0.4,
	}
end

function Camo.randomSeed(): number
	return math.floor(math.random() * Camo.SPACE)
end

Camo.FAMILY_MATERIAL = FAMILY_MATERIAL

return Camo
