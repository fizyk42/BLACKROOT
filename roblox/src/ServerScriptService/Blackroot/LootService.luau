--!strict
--[[
	LootService — landmarks, containers and forage, from
	scripts/systems/LootSystem.js and InteractionSystem.js.

	Loot is not scattered pickups; it is *places*. A ranger station, a wreck, a
	cave, a nest — each one is a landmark with its own loot table, its own
	threat level, and its own reason to walk across the map to it. Finding one
	is worth four upgrade points, which is why exploring beats grinding.

	Containers are searched, not touched: hold E for the search time, and the
	roll happens on the server when the timer completes. That is deliberate —
	standing still for two seconds in a forest that is hunting you is the cost
	of the loot.
]]

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Items = require(Shared:WaitForChild("Items"))
local Net = require(Shared:WaitForChild("Net"))
local Rng = require(Shared:WaitForChild("Rng"))

local Blackroot = script.Parent
local StatsService = require(Blackroot:WaitForChild("StatsService"))
local InventoryService = require(Blackroot:WaitForChild("InventoryService"))
local WorldBuilder = require(Blackroot:WaitForChild("WorldBuilder"))

local LootService = {}

-- ── Landmarks ──────────────────────────────────────────────────────────────
--[[
	Each kind names its loot table, how dangerous it is (`threat` drives how
	many mutants nest there), how many containers it holds, and how it is
	built. `tier` raises both the number of rolls and the quantity per roll.
]]
export type LandmarkKind = {
	id: string, label: string, loot: string, threat: number,
	containers: number, tier: number, build: string,
}

LootService.LANDMARKS = {
	{ id = "camp", label = "Abandoned Camp", loot = "camp", threat = 0.2, containers = 3, tier = 0, build = "camp" },
	{ id = "cabin", label = "Hunter's Cabin", loot = "cabin", threat = 0.5, containers = 4, tier = 1, build = "cabin" },
	{ id = "ranger", label = "Ranger Station", loot = "ranger", threat = 0.7, containers = 5, tier = 2, build = "cabin" },
	{ id = "medical", label = "Field Aid Post", loot = "medical", threat = 0.6, containers = 3, tier = 2, build = "camp" },
	{ id = "wreck", label = "Crashed Transport", loot = "wreck", threat = 0.6, containers = 4, tier = 1, build = "wreck" },
	{ id = "military", label = "Cordon Checkpoint", loot = "military", threat = 1.0, containers = 6, tier = 3, build = "bunker" },
	{ id = "cave", label = "Flooded Cave Mouth", loot = "cave", threat = 0.9, containers = 4, tier = 2, build = "cave" },
	{ id = "tower", label = "Fire Watch Tower", loot = "tower", threat = 0.4, containers = 3, tier = 1, build = "tower" },
	{ id = "ruin", label = "Collapsed Farmstead", loot = "ruin", threat = 0.3, containers = 3, tier = 0, build = "ruin" },
	{ id = "graves", label = "Family Plot", loot = "graves", threat = 0.4, containers = 2, tier = 1, build = "graves" },
	{ id = "nest", label = "A Nest", loot = "nest", threat = 1.2, containers = 3, tier = 3, build = "nest" },
	{ id = "dock", label = "Creek Landing", loot = "dock", threat = 0.3, containers = 3, tier = 0, build = "dock" },
} :: { LandmarkKind }

type Container = {
	part: BasePart,
	loot: string,
	tier: number,
	opened: boolean,
	searchTime: number,
	label: string,
}

type Landmark = {
	kind: LandmarkKind,
	position: Vector3,
	found: boolean,
	model: Model,
}

local landmarks: { Landmark } = {}
local containers: { Container } = {}
local forage: { Container } = {}
local folder: Folder? = nil
local seed = 0
local biome: any = nil
local lootMul = 1

local ToastEvent: RemoteEvent
local InteractEvent: RemoteEvent
local searching: { [Player]: { target: Container, elapsed: number } } = {}

-- ── Building ───────────────────────────────────────────────────────────────

local function part(name: string, size: Vector3, cf: CFrame, colour: Color3, material: Enum.Material, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cf
	p.Anchored = true
	p.Color = colour
	p.Material = material
	p.Parent = parent
	return p
end

local WOOD = Color3.fromRGB(88, 70, 52)
local METAL = Color3.fromRGB(78, 82, 86)
local STONE = Color3.fromRGB(96, 94, 88)

local builders: { [string]: (Model, Vector3, Rng.Generator) -> () } = {}

builders.camp = function(model, at, rng)
	part("Tent", Vector3.new(9, 5, 12), CFrame.new(at + Vector3.new(0, 2.5, 0)) * CFrame.Angles(0, Rng.range(rng, 0, 6.28), 0),
		Color3.fromRGB(66, 72, 58), Enum.Material.Fabric, model)
	part("Firepit", Vector3.new(4, 0.6, 4), CFrame.new(at + Vector3.new(7, 0.3, 3)),
		Color3.fromRGB(40, 36, 32), Enum.Material.Slate, model)
end

builders.cabin = function(model, at, rng)
	local w, d, h = 22, 18, 11
	part("Floor", Vector3.new(w, 1, d), CFrame.new(at + Vector3.new(0, 0.5, 0)), WOOD, Enum.Material.WoodPlanks, model)
	part("WallA", Vector3.new(w, h, 1), CFrame.new(at + Vector3.new(0, h / 2, -d / 2)), WOOD, Enum.Material.Wood, model)
	part("WallB", Vector3.new(1, h, d), CFrame.new(at + Vector3.new(-w / 2, h / 2, 0)), WOOD, Enum.Material.Wood, model)
	part("WallC", Vector3.new(1, h, d), CFrame.new(at + Vector3.new(w / 2, h / 2, 0)), WOOD, Enum.Material.Wood, model)
	part("Roof", Vector3.new(w + 3, 1, d + 3), CFrame.new(at + Vector3.new(0, h, 0)), WOOD, Enum.Material.WoodPlanks, model)
end

builders.wreck = function(model, at, rng)
	part("Fuselage", Vector3.new(10, 8, 34), CFrame.new(at + Vector3.new(0, 4, 0))
		* CFrame.Angles(Rng.range(rng, -0.2, 0.2), Rng.range(rng, 0, 6.28), Rng.range(rng, -0.4, 0.4)),
		METAL, Enum.Material.CorrodedMetal, model)
	part("Wing", Vector3.new(30, 0.8, 7), CFrame.new(at + Vector3.new(Rng.range(rng, -12, 12), 2, Rng.range(rng, -10, 10)))
		* CFrame.Angles(0, Rng.range(rng, 0, 6.28), 0), METAL, Enum.Material.DiamondPlate, model)
end

builders.bunker = function(model, at, rng)
	part("Slab", Vector3.new(30, 2, 30), CFrame.new(at + Vector3.new(0, 1, 0)), Color3.fromRGB(72, 74, 72), Enum.Material.Concrete, model)
	part("Block", Vector3.new(18, 12, 18), CFrame.new(at + Vector3.new(0, 7, 0)), Color3.fromRGB(64, 66, 64), Enum.Material.Concrete, model)
	for _, side in { -1, 1 } do
		part("Barrier", Vector3.new(3, 5, 16), CFrame.new(at + Vector3.new(side * 16, 2.5, 0)),
			Color3.fromRGB(88, 84, 70), Enum.Material.Concrete, model)
	end
end

builders.cave = function(model, at, rng)
	part("Mouth", Vector3.new(20, 16, 14), CFrame.new(at + Vector3.new(0, 6, 0)), STONE, Enum.Material.Rock, model)
	local dark = part("Dark", Vector3.new(11, 10, 3), CFrame.new(at + Vector3.new(0, 5, -6.5)),
		Color3.fromRGB(8, 8, 10), Enum.Material.SmoothPlastic, model)
	dark.CanCollide = false
end

builders.tower = function(model, at, rng)
	for _, corner in { Vector3.new(-5, 0, -5), Vector3.new(5, 0, -5), Vector3.new(-5, 0, 5), Vector3.new(5, 0, 5) } do
		part("Leg", Vector3.new(1.2, 30, 1.2), CFrame.new(at + corner + Vector3.new(0, 15, 0)), WOOD, Enum.Material.Wood, model)
	end
	part("Deck", Vector3.new(16, 1, 16), CFrame.new(at + Vector3.new(0, 30, 0)), WOOD, Enum.Material.WoodPlanks, model)
	part("Cab", Vector3.new(11, 8, 11), CFrame.new(at + Vector3.new(0, 34.5, 0)), WOOD, Enum.Material.Wood, model)
end

builders.ruin = function(model, at, rng)
	for i = 1, 4 do
		local a = Rng.range(rng, 0, 6.28)
		part("Wall", Vector3.new(Rng.range(rng, 6, 16), Rng.range(rng, 3, 9), 1),
			CFrame.new(at + Vector3.new(math.cos(a) * 8, 3, math.sin(a) * 8)) * CFrame.Angles(0, a, 0),
			STONE, Enum.Material.Brick, model)
	end
end

builders.graves = function(model, at, rng)
	for i = 1, 6 do
		local a = Rng.range(rng, 0, 6.28)
		local r = Rng.range(rng, 3, 11)
		part("Stone", Vector3.new(1.6, 3, 0.5),
			CFrame.new(at + Vector3.new(math.cos(a) * r, 1.5, math.sin(a) * r))
				* CFrame.Angles(Rng.range(rng, -0.12, 0.12), a, 0),
			STONE, Enum.Material.Slate, model)
	end
end

builders.nest = function(model, at, rng)
	local mound = part("Mound", Vector3.new(24, 10, 24), CFrame.new(at + Vector3.new(0, 3, 0)),
		Color3.fromRGB(56, 48, 44), Enum.Material.Mud, model)
	mound.Shape = Enum.PartType.Ball
	for i = 1, 8 do
		local a = Rng.range(rng, 0, 6.28)
		part("Rib", Vector3.new(0.7, Rng.range(rng, 6, 14), 0.7),
			CFrame.new(at + Vector3.new(math.cos(a) * 9, 5, math.sin(a) * 9))
				* CFrame.Angles(Rng.range(rng, -0.4, 0.4), a, Rng.range(rng, -0.3, 0.3)),
			Color3.fromRGB(180, 172, 158), Enum.Material.Sand, model)
	end
end

builders.dock = function(model, at, rng)
	part("Deck", Vector3.new(8, 1, 26), CFrame.new(at + Vector3.new(0, 1, 0)), WOOD, Enum.Material.WoodPlanks, model)
	for i = -1, 1 do
		part("Post", Vector3.new(1, 6, 1), CFrame.new(at + Vector3.new(3.5, 0, i * 10)), WOOD, Enum.Material.Wood, model)
	end
end

-- ── Containers ─────────────────────────────────────────────────────────────

local function makeContainer(at: Vector3, kind: LandmarkKind, parent: Instance, rng: Rng.Generator): Container
	local p = part("Container", Vector3.new(4, 3, 2.6),
		CFrame.new(at) * CFrame.Angles(0, Rng.range(rng, 0, 6.28), 0),
		Color3.fromRGB(112, 92, 66), Enum.Material.WoodPlanks, parent)
	p:SetAttribute("BlackrootContainer", true)
	CollectionService:AddTag(p, "BlackrootLoot")

	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(220, 190, 130)
	light.Range = 10
	light.Brightness = 0.35
	light.Parent = p

	local c: Container = {
		part = p,
		loot = kind.loot,
		tier = kind.tier,
		opened = false,
		searchTime = 2.0 + kind.tier * 0.4,
		label = kind.label,
	}
	table.insert(containers, c)
	return c
end

local function makeForage(at: Vector3, parent: Instance, rng: Rng.Generator)
	local p = part("Forage", Vector3.new(2.4, 1.4, 2.4), CFrame.new(at + Vector3.new(0, 0.7, 0)),
		Color3.fromRGB(96, 118, 68), Enum.Material.LeafyGrass, parent)
	p:SetAttribute("BlackrootForage", true)
	p.CanCollide = false
	CollectionService:AddTag(p, "BlackrootLoot")

	table.insert(forage, {
		part = p, loot = "forage", tier = 0, opened = false,
		searchTime = 1.2, label = "Forage",
	})
end

-- ── Interaction ────────────────────────────────────────────────────────────

local function nearestContainer(from: Vector3): (Container?, number)
	local best, bestD = nil, math.huge
	for _, list in { containers, forage } do
		for _, c in list do
			if c.opened or not c.part.Parent then continue end
			local d = (c.part.Position - from).Magnitude
			if d < bestD then best, bestD = c, d end
		end
	end
	return best, bestD
end

local function grant(player: Player, c: Container)
	c.opened = true
	local rng = Rng.new(math.floor(os.clock() * 1e6) % 2147483647)
	local rolled = Items.rollLoot(c.loot, c.tier, lootMul, rng)

	local s = StatsService.get(player)
	local lines = {}
	for _, entry in rolled do
		InventoryService.add(player, entry.id, entry.qty)
		local def = Items.get(entry.id)
		table.insert(lines, `{def and def.name or entry.id} ×{entry.qty}`)
		if s then s.itemsLooted += entry.qty end
	end

	if ToastEvent then
		if #lines == 0 then
			ToastEvent:FireClient(player, "EMPTY", "info")
		else
			ToastEvent:FireClient(player, table.concat(lines, "   "), "good")
		end
	end

	c.part.Transparency = 0.55
	c.part.Color = Color3.fromRGB(64, 58, 50)
	local light = c.part:FindFirstChildOfClass("PointLight")
	if light then light:Destroy() end
	CollectionService:RemoveTag(c.part, "BlackrootLoot")
end

--- Called every frame with who is holding E.
function LootService.step(dt: number)
	for _, player in Players:GetPlayers() do
		local char = player.Character
		local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
		if not hrp then
			searching[player] = nil
			continue
		end

		local c, dist = nearestContainer(hrp.Position)
		local inRange = c ~= nil and dist < 9

		-- Tell the client what it is looking at, so the prompt is honest.
		if InteractEvent then
			local s = searching[player]
			InteractEvent:FireClient(player,
				if inRange then (c :: Container).label else nil,
				if s then s.elapsed / s.target.searchTime else 0)
		end

		local held = searching[player]
		if not held then continue end

		if not inRange or held.target ~= c then
			searching[player] = nil
			continue
		end

		held.elapsed += dt
		if held.elapsed >= held.target.searchTime then
			searching[player] = nil
			grant(player, held.target)
		end
	end
end

function LootService.beginSearch(player: Player)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return end
	local c, dist = nearestContainer(hrp.Position)
	if not c or dist > 9 then return end
	searching[player] = { target = c, elapsed = 0 }
end

function LootService.cancelSearch(player: Player)
	searching[player] = nil
end

-- ── Landmark discovery ─────────────────────────────────────────────────────

function LootService.checkDiscovery(player: Player)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return end

	for _, lm in landmarks do
		if lm.found then continue end
		if (hrp.Position - lm.position).Magnitude > 55 then continue end
		lm.found = true
		local s = StatsService.get(player)
		if s then s.landmarksFound += 1 end
		InventoryService.grantPoints(player, 4)
		if ToastEvent then
			ToastEvent:FireClient(player, `FOUND — {lm.kind.label}`, "good")
		end
	end
end

function LootService.landmarks(): { Landmark }
	return landmarks
end

--- The six nearest landmarks and their distances, for the sandbox's
--- "What is out here?" and for the guide.
function LootService.nearestLandmarks(from: Vector3, n: number): { { label: string, distance: number, position: Vector3 } }
	local list = {}
	for _, lm in landmarks do
		table.insert(list, {
			label = lm.kind.label,
			distance = (lm.position - from).Magnitude,
			position = lm.position,
		})
	end
	table.sort(list, function(a, b) return a.distance < b.distance end)
	local out = {}
	for i = 1, math.min(n, #list) do table.insert(out, list[i]) end
	return out
end

-- ── Lifecycle ──────────────────────────────────────────────────────────────

function LootService.begin(worldSeed: number, worldBiome: any, difficultyId: string, depth: number)
	LootService.stop()
	seed = worldSeed
	biome = worldBiome

	local d = Config.DIFFICULTY[difficultyId] or Config.DIFFICULTY[Config.DEFAULT_DIFFICULTY]
	local Biomes = require(Shared:WaitForChild("Biomes"))
	lootMul = d.lootMul * Biomes.depthScaling(depth or 0).loot

	folder = Instance.new("Folder")
	;(folder :: Folder).Name = "Loot"
	;(folder :: Folder).Parent = Workspace

	local rng = Rng.new(worldSeed + 4242)
	local half = Config.ARENA_SIZE / 2 * 0.82

	-- Landmarks: the least-used kind wins each slot, so a run never gets four
	-- ranger stations and no cave.
	local used: { [string]: number } = {}
	for i = 1, Config.LANDMARK_COUNT do
		local best, bestUse = LootService.LANDMARKS[1], math.huge
		local order = table.clone(LootService.LANDMARKS)
		-- Shuffle so ties break differently each slot.
		for k = #order, 2, -1 do
			local j = Rng.int(rng, 1, k)
			order[k], order[j] = order[j], order[k]
		end
		for _, kind in order do
			local n = used[kind.id] or 0
			if n < bestUse then best, bestUse = kind, n end
		end
		used[best.id] = (used[best.id] or 0) + 1

		local x, z, y
		for _ = 1, 20 do
			x = Rng.range(rng, -half, half)
			z = Rng.range(rng, -half, half)
			if math.sqrt(x * x + z * z) < 90 then continue end   -- not on spawn
			if WorldBuilder.slopeAt(worldSeed, worldBiome, x, z) > 0.35 then continue end
			break
		end
		y = WorldBuilder.heightAt(worldSeed, worldBiome, x, z)
		local at = Vector3.new(x, y, z)

		local model = Instance.new("Model")
		model.Name = best.id
		local build = builders[best.build] or builders.camp
		local ok = pcall(build, model, at, rng)
		if not ok then
			model:Destroy()
			continue
		end
		model.Parent = folder

		for c = 1, best.containers do
			local a = Rng.range(rng, 0, 6.28)
			local r = Rng.range(rng, 5, 16)
			local cx, cz = x + math.cos(a) * r, z + math.sin(a) * r
			local cy = WorldBuilder.heightAt(worldSeed, worldBiome, cx, cz) + 1.6
			makeContainer(Vector3.new(cx, cy, cz), best, model, rng)
		end

		table.insert(landmarks, { kind = best, position = at, found = false, model = model })
		if i % 3 == 0 then task.wait() end
	end

	-- Forage nodes, out in the open.
	local forageFolder = Instance.new("Folder")
	forageFolder.Name = "Forage"
	forageFolder.Parent = folder
	for i = 1, Config.FORAGE_NODES do
		local x = Rng.range(rng, -half, half)
		local z = Rng.range(rng, -half, half)
		local y = WorldBuilder.heightAt(worldSeed, worldBiome, x, z)
		makeForage(Vector3.new(x, y, z), forageFolder, rng)
		if i % 10 == 0 then task.wait() end
	end
end

function LootService.stop()
	table.clear(landmarks)
	table.clear(containers)
	table.clear(forage)
	table.clear(searching)
	if folder then folder:Destroy(); folder = nil end
end

function LootService.remaining(): number
	local n = 0
	for _, c in containers do
		if not c.opened then n += 1 end
	end
	return n
end

function LootService.init()
	ToastEvent = Net.event("Toast")
	InteractEvent = Net.event("Interactable")

	Net.event("Interact").OnServerEvent:Connect(function(player, held)
		if held then
			LootService.beginSearch(player)
		else
			LootService.cancelSearch(player)
		end
	end)

	Players.PlayerRemoving:Connect(function(p) searching[p] = nil end)
end

LootService.builders = builders

return LootService
