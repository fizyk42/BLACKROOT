--!strict
--[[
	WorldBuilder — the procedural world, one biome at a time.

	Same generator as the WebGL build: seeded value noise, fBm'd over four
	octaves, shaped by the biome's `relief`, `ridge` and `detail`, carved into
	Roblox terrain, then scattered with flora whose *builder* differs per biome
	rather than only its colour.

	Everything is deterministic from (seed, biome), so two servers given the
	same pair build the same world — the property the WebGL co-op relies on,
	kept here for the same reason.

	The biome's physics block is applied to Workspace.Gravity here too, which
	is why the Long Dark feels like the Long Dark: 0.42 g and a 1.55× jump are
	the same numbers in both engines, and they are the reason that biome plays
	differently rather than just looking different.
]]

local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local Rng = require(Shared:WaitForChild("Rng"))

local WorldBuilder = {}

local CELL = 32
local HALF = Config.ARENA_SIZE / 2

-- ── Deterministic noise ────────────────────────────────────────────────────

local function hash2(seed: number, x: number, y: number): number
	local h = seed * 374761393 + x * 668265263 + y * 2147483647
	h = bit32.bxor(h % 4294967296, bit32.rshift(h % 4294967296, 13))
	h = (h * 1274126177) % 4294967296
	return bit32.bxor(h, bit32.rshift(h, 16)) % 4294967296 / 4294967296
end

local function smooth(t: number): number
	return t * t * (3 - 2 * t)
end

local function valueNoise(seed: number, x: number, y: number): number
	local xi, yi = math.floor(x), math.floor(y)
	local xf, yf = x - xi, y - yi
	local u, v = smooth(xf), smooth(yf)
	local a = hash2(seed, xi, yi)
	local b = hash2(seed, xi + 1, yi)
	local c = hash2(seed, xi, yi + 1)
	local d = hash2(seed, xi + 1, yi + 1)
	return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
end

local function fbm(seed: number, x: number, y: number, octaves: number?): number
	local total, amp, freq, norm = 0, 1, 1, 0
	for _ = 1, octaves or 4 do
		total += valueNoise(seed, x * freq, y * freq) * amp
		norm += amp
		amp *= 0.5
		freq *= 2.07
	end
	return total / norm
end

--- Ground height at a world position, for this seed and biome.
function WorldBuilder.heightAt(seed: number, biome: any, x: number, z: number): number
	local T = biome.terrain
	local n = fbm(seed, x / 260, z / 260)
	local ridge = math.abs(fbm(seed + 91, x / 90, z / 90) - 0.5) * 2
	local detail = (fbm(seed + 313, x / 34, z / 34) - 0.5) * 6 * T.detail

	local h = (n - 0.42) * 130 * T.relief + (1 - ridge) * 22 * T.ridge + detail

	-- The Drowned Shelf sits under a flood: everything below its floor is water.
	if T.floor and T.floor > 0 then
		h -= T.floor
	end

	-- A rim so nobody walks off the edge of the world.
	local d = math.max(math.abs(x), math.abs(z)) / HALF
	if d > 0.82 then
		h += (d - 0.82) * 420
	end
	return h
end

--- Surface wetness, 0..1. Drives which wildlife lives where, as in the JS.
function WorldBuilder.moistureAt(seed: number, x: number, z: number): number
	return math.clamp(fbm(seed + 7717, x / 180, z / 180), 0, 1)
end

--- Slope magnitude at a point, used for spawn rejection.
function WorldBuilder.slopeAt(seed: number, biome: any, x: number, z: number): number
	local h = WorldBuilder.heightAt(seed, biome, x, z)
	local hx = WorldBuilder.heightAt(seed, biome, x + 4, z)
	local hz = WorldBuilder.heightAt(seed, biome, x, z + 4)
	return (math.abs(hx - h) + math.abs(hz - h)) / 4
end

-- ── Terrain ────────────────────────────────────────────────────────────────

local function carve(seed: number, biome: any)
	local terrain = Workspace.Terrain
	terrain:Clear()

	local steps = math.floor(Config.ARENA_SIZE / CELL)
	for ix = 0, steps - 1 do
		for iz = 0, steps - 1 do
			local x = -HALF + (ix + 0.5) * CELL
			local z = -HALF + (iz + 0.5) * CELL
			local h = WorldBuilder.heightAt(seed, biome, x, z)

			local mat = biome.rbx.ground
			if WorldBuilder.slopeAt(seed, biome, x, z) > 0.55 then
				mat = biome.rbx.rock
			end

			terrain:FillBlock(
				CFrame.new(x, h - 30, z),
				Vector3.new(CELL, 60, CELL),
				mat
			)
		end
		if ix % 4 == 3 then task.wait() end
	end

	-- The flood on the Drowned Shelf, and the creeks elsewhere.
	if biome.terrain.water == "flood" then
		terrain:FillBlock(
			CFrame.new(0, -6, 0),
			Vector3.new(Config.ARENA_SIZE, 60, Config.ARENA_SIZE),
			Enum.Material.Water
		)
	end
end

-- ── Flora ──────────────────────────────────────────────────────────────────

local function hexColor(n: number): Color3
	return Color3.fromRGB(bit32.rshift(n, 16) % 256, bit32.rshift(n, 8) % 256, n % 256)
end

WorldBuilder.hexColor = hexColor

local function part(name: string, size: Vector3, cf: CFrame, colour: Color3, material: Enum.Material, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cf
	p.Anchored = true
	p.Color = colour
	p.Material = material
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local function glow(p: BasePart, colour: Color3, range: number, brightness: number)
	local l = Instance.new("PointLight")
	l.Color = colour
	l.Range = range
	l.Brightness = brightness
	l.Parent = p
end

--[[
	One builder per biome silhouette. These are the six shapes that make the
	biomes read as different places from a distance: a conifer, a burnt snag,
	an ice spire, a fungal cap, a ship hulk and a monolith. Each takes the
	biome's own flora colours so the palette comes from the data, not the code.
]]
local builders: { [string]: (Model, Vector3, any, Rng.Generator) -> () } = {}

builders.pine = function(model, at, biome, rng)
	local C = biome.floraColors
	local h = Rng.range(rng, 22, 40)
	part("Trunk", Vector3.new(2.2, h, 2.2), CFrame.new(at + Vector3.new(0, h / 2, 0)),
		hexColor(C.trunk), Enum.Material.Wood, model)
	for i = 0, 3 do
		local t = i / 3
		local r = (1 - t) * 9 + 1.5
		part("Bough", Vector3.new(r * 2, 6, r * 2),
			CFrame.new(at + Vector3.new(0, h * 0.42 + t * h * 0.5, 0)),
			hexColor(if i % 2 == 0 then C.canopyA else C.canopyB), Enum.Material.Grass, model)
	end
end

builders.burnt = function(model, at, biome, rng)
	local C = biome.floraColors
	local h = Rng.range(rng, 14, 30)
	local lean = CFrame.Angles(Rng.range(rng, -0.22, 0.22), Rng.range(rng, 0, 6.28), Rng.range(rng, -0.22, 0.22))
	part("Char", Vector3.new(2.6, h, 2.6), CFrame.new(at + Vector3.new(0, h / 2, 0)) * lean,
		hexColor(C.trunk), Enum.Material.CrackedLava, model)
	for _ = 1, Rng.int(rng, 1, 3) do
		local a = Rng.range(rng, 0, 6.28)
		part("Limb", Vector3.new(0.9, 0.9, Rng.range(rng, 4, 9)),
			CFrame.new(at + Vector3.new(0, Rng.range(rng, h * 0.4, h * 0.9), 0))
				* CFrame.Angles(0, a, Rng.range(rng, -0.5, 0.2)) * CFrame.new(0, 0, -3),
			hexColor(C.canopyA), Enum.Material.Slate, model)
	end
	local ember = part("Ember", Vector3.new(3, 0.4, 3), CFrame.new(at + Vector3.new(0, 0.3, 0)),
		hexColor(C.under), Enum.Material.Neon, model)
	ember.Transparency = 0.35
	glow(ember, hexColor(biome.fx.moteColor), 18, 0.9)
end

builders.spire = function(model, at, biome, rng)
	local C = biome.floraColors
	local h = Rng.range(rng, 28, 64)
	local w = Rng.range(rng, 5, 12)
	local p = part("Spire", Vector3.new(w, h, w),
		CFrame.new(at + Vector3.new(0, h / 2 - 4, 0))
			* CFrame.Angles(Rng.range(rng, -0.1, 0.1), Rng.range(rng, 0, 6.28), Rng.range(rng, -0.1, 0.1)),
		hexColor(C.stone), Enum.Material.Ice, model)
	p.Transparency = 0.18
	p.Reflectance = 0.25
	part("Cap", Vector3.new(w * 0.5, h * 0.35, w * 0.5),
		CFrame.new(at + Vector3.new(0, h * 0.9, 0)),
		hexColor(C.carpet), Enum.Material.Glacier, model)
end

builders.cap = function(model, at, biome, rng)
	local C = biome.floraColors
	local stalk = Rng.range(rng, 6, 18)
	part("Stalk", Vector3.new(2.4, stalk, 2.4), CFrame.new(at + Vector3.new(0, stalk / 2, 0)),
		hexColor(C.trunk), Enum.Material.Sand, model)
	local capSize = Rng.range(rng, 8, 22)
	local top = part("Cap", Vector3.new(capSize, capSize * 0.55, capSize),
		CFrame.new(at + Vector3.new(0, stalk + capSize * 0.14, 0)),
		hexColor(C.canopyA), Enum.Material.Foil, model)
	top.Shape = Enum.PartType.Ball
	glow(top, hexColor(biome.fx.moteColor), 22, 0.7)
end

builders.hulk = function(model, at, biome, rng)
	local C = biome.floraColors
	local l = Rng.range(rng, 40, 90)
	local hull = part("Hull", Vector3.new(Rng.range(rng, 14, 24), Rng.range(rng, 10, 20), l),
		CFrame.new(at + Vector3.new(0, 6, 0))
			* CFrame.Angles(Rng.range(rng, -0.3, 0.3), Rng.range(rng, 0, 6.28), Rng.range(rng, -0.5, 0.5)),
		hexColor(C.stone), Enum.Material.CorrodedMetal, model)
	for _ = 1, 3 do
		part("Rib", Vector3.new(1.4, Rng.range(rng, 8, 18), 1.4),
			hull.CFrame * CFrame.new(Rng.range(rng, -8, 8), Rng.range(rng, 4, 12), Rng.range(rng, -l / 2, l / 2)),
			hexColor(C.trunk), Enum.Material.DiamondPlate, model)
	end
	local lure = part("Lure", Vector3.new(1.2, 1.2, 1.2),
		hull.CFrame * CFrame.new(0, Rng.range(rng, 12, 18), 0),
		hexColor(C.under), Enum.Material.Neon, model)
	glow(lure, hexColor(biome.fx.moteColor), 34, 1.2)
end

builders.monolith = function(model, at, biome, rng)
	local C = biome.floraColors
	local h = Rng.range(rng, 45, 110)
	local slab = part("Monolith", Vector3.new(Rng.range(rng, 6, 14), h, Rng.range(rng, 3, 7)),
		CFrame.new(at + Vector3.new(0, h / 2 - 6, 0))
			* CFrame.Angles(0, Rng.range(rng, 0, 6.28), Rng.range(rng, -0.06, 0.06)),
		hexColor(C.trunk), Enum.Material.Slate, model)
	slab.Reflectance = 0.08
	local seam = part("Seam", Vector3.new(0.6, h * 0.7, 0.4), slab.CFrame * CFrame.new(0, 0, slab.Size.Z / 2),
		hexColor(C.canopyA), Enum.Material.Neon, model)
	seam.Transparency = 0.25
	glow(seam, hexColor(C.canopyA), 40, 1.4)
end

WorldBuilder.builders = builders

-- ── Lighting ───────────────────────────────────────────────────────────────

--[[
	Apply a biome's sky. The WebGL build renders its own gradient dome, stars
	and moon; Roblox has Lighting and Atmosphere, so the palette is mapped onto
	those. `fogDensity` is an exponential term in three.js and a distance in
	Roblox, hence the reciprocal.
]]
function WorldBuilder.applyLighting(biome: any, timeOfDay: string?)
	local sky = Biomes.skyFor(biome.id, timeOfDay or "morning")

	Lighting.ClockTime = if sky.daylight then biome.rbx.clock else 0.4
	Lighting.FogColor = hexColor(sky.fog)
	Lighting.FogEnd = math.clamp(1 / math.max(sky.fogDensity, 0.0005) * 0.14, 120, 1400)
	Lighting.FogStart = Lighting.FogEnd * 0.10
	Lighting.OutdoorAmbient = hexColor(sky.hemiSky)
	Lighting.Ambient = hexColor(sky.hemiGround)
	Lighting.Brightness = math.clamp(sky.moonIntensity, 0.4, 4)
	Lighting.EnvironmentDiffuseScale = math.clamp(sky.hemiIntensity * 0.5, 0.1, 1)
	Lighting.EnvironmentSpecularScale = 0.4
	Lighting.ExposureCompensation = (sky.exposure - 1) * 0.8
	Lighting.GlobalShadows = true

	local atmos = Lighting:FindFirstChildOfClass("Atmosphere")
	if not atmos then
		atmos = Instance.new("Atmosphere")
		atmos.Parent = Lighting
	end
	atmos.Density = math.clamp(sky.fogDensity * 14, 0.05, 0.6)
	atmos.Haze = 2.2
	atmos.Color = hexColor(sky.fog)
	atmos.Decay = hexColor(sky.horizon)

	local skybox = Lighting:FindFirstChildOfClass("Sky")
	if sky.stars > 0 then
		if not skybox then
			skybox = Instance.new("Sky")
			skybox.Parent = Lighting
		end
		;(skybox :: Sky).StarCount = math.clamp(sky.stars, 0, 3000)
		;(skybox :: Sky).CelestialBodiesShown = true
	elseif skybox then
		skybox:Destroy()
	end
end

--- The biome's physics block, applied to the world and reported for players.
function WorldBuilder.applyPhysics(biome: any)
	Workspace.Gravity = Config.BASE_GRAVITY * biome.physics.gravity
end

-- ── Build ──────────────────────────────────────────────────────────────────

--- Build a whole world. Returns the folder holding everything it made and the
--- biome definition, so a teardown is one Destroy.
function WorldBuilder.build(seed: number, biomeId: string, timeOfDay: string?): (Folder, any)
	local biome = Biomes.get(biomeId) or Biomes.get("hollow")

	local old = Workspace:FindFirstChild("BlackrootWorld")
	if old then old:Destroy() end

	local root = Instance.new("Folder")
	root.Name = "BlackrootWorld"
	root.Parent = Workspace

	WorldBuilder.applyLighting(biome, timeOfDay)
	WorldBuilder.applyPhysics(biome)
	carve(seed, biome)

	local rng = Rng.new(seed + 1201)
	local props = Instance.new("Folder")
	props.Name = "Flora"
	props.Parent = root

	local builder = builders[biome.rbx.prop] or builders.pine
	local count = math.floor(220 * biome.rbx.propDensity * (biome.counts.tree + biome.counts.rock) * 0.5)
	for i = 1, count do
		local x = Rng.range(rng, -HALF * 0.9, HALF * 0.9)
		local z = Rng.range(rng, -HALF * 0.9, HALF * 0.9)
		local y = WorldBuilder.heightAt(seed, biome, x, z)
		local model = Instance.new("Model")
		model.Name = `{biome.rbx.prop}_{i}`
		local ok = pcall(builder, model, Vector3.new(x, y, z), biome, rng)
		if ok and #model:GetChildren() > 0 then
			model.Parent = props
		else
			model:Destroy()
		end
		if i % 24 == 0 then task.wait() end
	end

	local spawnY = WorldBuilder.heightAt(seed, biome, 0, 0)
	part("SpawnPad", Vector3.new(46, 2, 46), CFrame.new(0, spawnY + 1, 0),
		hexColor(biome.floraColors.stone), Enum.Material.Metal, root)

	local sp = Instance.new("SpawnLocation")
	sp.Size = Vector3.new(12, 1, 12)
	sp.CFrame = CFrame.new(0, spawnY + 2.5, 0)
	sp.Anchored = true
	sp.Transparency = 1
	sp.CanCollide = false
	sp.Neutral = true
	sp.Parent = root

	return root, biome
end

WorldBuilder.fbm = fbm

return WorldBuilder
