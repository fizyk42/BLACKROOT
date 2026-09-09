--!strict
--[[
	EnemyService — the things in the fog, from scripts/entities/MutantAI.js
	and AnimalAI.js.

	Nine mutants and five animals, driven by one stepper and separated by the
	`behaviour` (mutant) or `temperament` (animal) field on their stat block.
	Every constant comes from Creatures.AI, which is a transcription rather
	than a re-tuning, so a Stalker holds the same fourteen to twenty-three
	metres it holds in the browser and only commits when you are inside seven
	and looking the other way.

	Alert is the spine of the whole thing. Nothing charges you because it
	spawned nearby; it charges you because it saw you, heard you, was hit by
	you, or was screamed at by something that did. Alert decays when none of
	that is happening, which is what makes crouching in the dark work.

	The quiet ring is enforced here: nothing hostile spawns within
	Config.QUIET_RING of a living player, because dying eleven seconds into a
	run to something that materialised behind you is not difficulty.
]]

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local Creatures = require(Shared:WaitForChild("Creatures"))
local Rng = require(Shared:WaitForChild("Rng"))

local Blackroot = script.Parent
local StatsService = require(Blackroot:WaitForChild("StatsService"))
local WorldBuilder = require(Blackroot:WaitForChild("WorldBuilder"))
local WeaponService = require(Blackroot:WaitForChild("WeaponService"))

local EnemyService = {}

local AI = Creatures.AI

type Entity = {
	id: string,
	def: any,
	faction: string,
	model: Model,
	root: BasePart,
	health: number,
	maxHealth: number,
	state: string,
	stateTime: number,
	alert: number,
	target: Player?,
	home: Vector3,
	wander: Vector3,
	attackTimer: number,
	windup: number,
	windupMove: string?,
	chargeTimer: number,
	callCooldown: number,
	growlIn: number,
	stalkDistance: number,
	commitIn: number,
	dead: boolean,
	scale: number,
}

local live: { Entity } = {}
local folder: Folder? = nil
local seed = 0
local biome: any = nil
local density = 1
local depth = 0
local frozen = false
local peaceful = false
local scaleOverride = 1
local onKilled: ((Player?, Entity) -> ())? = nil

-- ── Models ─────────────────────────────────────────────────────────────────

local function limb(model: Model, name: string, size: Vector3, cf: CFrame, colour: Color3, mat: Enum.Material): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cf
	p.Color = colour
	p.Material = mat
	p.CanCollide = false
	p.Massless = true
	p.Parent = model
	return p
end

local function weld(a: BasePart, b: BasePart)
	local w = Instance.new("WeldConstraint")
	w.Part0 = a
	w.Part1 = b
	w.Parent = b
end

--- Palette per archetype. Original silhouettes built from primitives; nothing
--- here is modelled on any existing game's creature.
local LOOK: { [string]: { body: Color3, accent: Color3, eye: Color3, glow: boolean } } = {
	stalker = { body = Color3.fromRGB(48, 46, 42), accent = Color3.fromRGB(66, 62, 54), eye = Color3.fromRGB(210, 190, 120), glow = true },
	brute = { body = Color3.fromRGB(58, 50, 44), accent = Color3.fromRGB(80, 68, 56), eye = Color3.fromRGB(200, 120, 80), glow = true },
	crawler = { body = Color3.fromRGB(52, 44, 40), accent = Color3.fromRGB(70, 58, 50), eye = Color3.fromRGB(190, 200, 140), glow = true },
	screamer = { body = Color3.fromRGB(64, 60, 58), accent = Color3.fromRGB(88, 80, 76), eye = Color3.fromRGB(240, 230, 200), glow = true },
	choir = { body = Color3.fromRGB(30, 26, 46), accent = Color3.fromRGB(120, 90, 210), eye = Color3.fromRGB(180, 140, 255), glow = true },
	drowned = { body = Color3.fromRGB(38, 54, 60), accent = Color3.fromRGB(52, 74, 80), eye = Color3.fromRGB(70, 200, 190), glow = true },
	ashwalker = { body = Color3.fromRGB(52, 30, 24), accent = Color3.fromRGB(96, 44, 26), eye = Color3.fromRGB(255, 120, 40), glow = true },
	rimewretch = { body = Color3.fromRGB(150, 162, 172), accent = Color3.fromRGB(190, 206, 218), eye = Color3.fromRGB(180, 220, 240), glow = true },
	sporebearer = { body = Color3.fromRGB(84, 92, 52), accent = Color3.fromRGB(140, 110, 130), eye = Color3.fromRGB(180, 210, 90), glow = true },

	rabbit = { body = Color3.fromRGB(120, 108, 92), accent = Color3.fromRGB(150, 138, 120), eye = Color3.fromRGB(40, 30, 30), glow = false },
	deer = { body = Color3.fromRGB(128, 100, 70), accent = Color3.fromRGB(160, 132, 96), eye = Color3.fromRGB(30, 24, 20), glow = false },
	boar = { body = Color3.fromRGB(74, 62, 52), accent = Color3.fromRGB(96, 82, 68), eye = Color3.fromRGB(40, 28, 22), glow = false },
	wolf = { body = Color3.fromRGB(88, 88, 90), accent = Color3.fromRGB(116, 116, 118), eye = Color3.fromRGB(210, 200, 130), glow = true },
	bear = { body = Color3.fromRGB(62, 50, 42), accent = Color3.fromRGB(84, 70, 58), eye = Color3.fromRGB(40, 30, 24), glow = false },
}

local function buildBiped(def: any, look: any, at: Vector3, scale: number): (Model, BasePart)
	local model = Instance.new("Model")
	model.Name = def.id
	model:SetAttribute("BlackrootEntity", true)

	local h = def.height * scale * 2.6      -- studs per game metre, roughly
	local root = Instance.new("Part")
	root.Name = "HumanoidRootPart"
	root.Size = Vector3.new(def.radius * 5 * scale, h * 0.42, def.radius * 3.4 * scale)
	root.CFrame = CFrame.new(at + Vector3.new(0, h * 0.55, 0))
	root.Color = look.body
	root.Material = Enum.Material.Slate
	root.CanCollide = true
	root.Parent = model
	model.PrimaryPart = root

	local head = limb(model, "Head", Vector3.new(1.6, 1.9, 1.5) * scale,
		root.CFrame * CFrame.new(0, h * 0.32, 0), look.accent, Enum.Material.Slate)
	weld(root, head)

	for _, side in { -1, 1 } do
		local eye = limb(model, "Eye", Vector3.new(0.34, 0.34, 0.2) * scale,
			head.CFrame * CFrame.new(side * 0.4 * scale, 0.2 * scale, -0.78 * scale),
			look.eye, Enum.Material.Neon)
		weld(head, eye)
		if look.glow then
			local l = Instance.new("PointLight")
			l.Color = look.eye
			l.Range = 14
			l.Brightness = 1.1
			l.Parent = eye
		end

		local arm = limb(model, "Arm", Vector3.new(0.7, h * 0.55, 0.7) * scale,
			root.CFrame * CFrame.new(side * 1.5 * scale, -h * 0.1, 0), look.body, Enum.Material.Slate)
		weld(root, arm)

		local leg = limb(model, "Leg", Vector3.new(0.8, h * 0.5, 0.8) * scale,
			root.CFrame * CFrame.new(side * 0.7 * scale, -h * 0.45, 0), look.body, Enum.Material.Slate)
		weld(root, leg)
	end

	return model, root
end

local function buildQuadruped(def: any, look: any, at: Vector3, scale: number): (Model, BasePart)
	local model = Instance.new("Model")
	model.Name = def.id
	model:SetAttribute("BlackrootEntity", true)

	local length = def.radius * 8 * scale
	local h = def.height * scale * 2.6
	local root = Instance.new("Part")
	root.Name = "HumanoidRootPart"
	root.Size = Vector3.new(def.radius * 4 * scale, h * 0.6, length)
	root.CFrame = CFrame.new(at + Vector3.new(0, h * 0.6, 0))
	root.Color = look.body
	root.Material = Enum.Material.Fabric
	root.CanCollide = true
	root.Parent = model
	model.PrimaryPart = root

	local head = limb(model, "Head", Vector3.new(def.radius * 3 * scale, h * 0.4, def.radius * 3.6 * scale),
		root.CFrame * CFrame.new(0, h * 0.2, -length * 0.62), look.accent, Enum.Material.Fabric)
	weld(root, head)

	for _, side in { -1, 1 } do
		for _, front in { -1, 1 } do
			local leg = limb(model, "Leg", Vector3.new(0.5, h * 0.55, 0.5) * scale,
				root.CFrame * CFrame.new(side * def.radius * 1.6 * scale, -h * 0.5, front * length * 0.32),
				look.body, Enum.Material.Fabric)
			weld(root, leg)
		end
	end

	if look.glow then
		for _, side in { -1, 1 } do
			local eye = limb(model, "Eye", Vector3.new(0.22, 0.22, 0.15) * scale,
				head.CFrame * CFrame.new(side * 0.3 * scale, 0.14 * scale, -def.radius * 1.7 * scale),
				look.eye, Enum.Material.Neon)
			weld(head, eye)
		end
	end

	return model, root
end

-- ── Spawning ───────────────────────────────────────────────────────────────

local function nearestPlayer(from: Vector3): (Player?, number, BasePart?)
	local best, bestD, bestPart = nil, math.huge, nil
	for _, p in Players:GetPlayers() do
		local s = StatsService.get(p)
		if s and not s.dead and p.Character then
			local hrp = p.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if hrp then
				local d = (hrp.Position - from).Magnitude
				if d < bestD then best, bestD, bestPart = p, d, hrp end
			end
		end
	end
	return best, bestD, bestPart
end

local function tooClose(at: Vector3, radius: number): boolean
	local _, d = nearestPlayer(at)
	return d < radius
end

--- Spawn one creature by id at a position. Returns nil if the id is unknown.
function EnemyService.spawnAt(id: string, at: Vector3): Entity?
	if not folder then return nil end
	local def = Creatures.get(id)
	if not def then return nil end

	local look = LOOK[id] or LOOK.stalker
	local scale = scaleOverride
	local isAnimal = Creatures.ANIMALS[id] ~= nil

	local model, root
	if isAnimal and id ~= "bear" then
		model, root = buildQuadruped(def, look, at, scale)
	elseif isAnimal then
		model, root = buildQuadruped(def, look, at, scale)
	else
		model, root = buildBiped(def, look, at, scale)
	end
	model.Parent = folder

	local scaling = Biomes.depthScaling(depth)
	local maxHealth = def.health * scaling.health

	local rng = Rng.new(math.floor(os.clock() * 1e6) % 2147483647)
	local e: Entity = {
		id = id,
		def = def,
		faction = if isAnimal then "animal" else "mutant",
		model = model,
		root = root,
		health = maxHealth,
		maxHealth = maxHealth,
		state = "IDLE",
		stateTime = 0,
		alert = 0,
		target = nil,
		home = at,
		wander = at,
		attackTimer = 0,
		windup = 0,
		windupMove = nil,
		chargeTimer = 0,
		callCooldown = Rng.range(rng, AI.callCooldownMin, AI.callCooldownMin + AI.callCooldownSpread),
		growlIn = Rng.range(rng, AI.growlMin, AI.growlMin + AI.growlSpread),
		stalkDistance = AI.stalkDistanceMin + Rng.next(rng) * AI.stalkDistanceSpread,
		commitIn = AI.predatorCommitMin + Rng.next(rng) * AI.predatorCommitSpread,
		dead = false,
		scale = scale,
	}
	table.insert(live, e)
	return e
end

--- Find somewhere legal to put one and spawn it there.
function EnemyService.spawnOne(id: string?): Entity?
	if not folder or not biome then return nil end

	local roster = Creatures.mutantsForBiome(biome.id)
	local chosen = id
	if not chosen then
		local weights = {}
		for i, rid in roster do
			table.insert(weights, { id = rid, weight = Creatures.rosterWeight(i) })
		end
		local rng = Rng.new(math.floor(os.clock() * 1e6) % 2147483647)
		chosen = (Rng.weighted(rng, weights) :: any).id
	end

	local rng = Rng.new(math.floor(os.clock() * 1e6 + 7) % 2147483647)
	for _ = 1, 24 do
		local half = Config.ARENA_SIZE / 2 * 0.88
		local x = Rng.range(rng, -half, half)
		local z = Rng.range(rng, -half, half)
		if WorldBuilder.slopeAt(seed, biome, x, z) > Creatures.POPULATION.freeRoamMaxSlope then continue end
		local y = WorldBuilder.heightAt(seed, biome, x, z)
		local at = Vector3.new(x, y + 4, z)
		if tooClose(at, Config.QUIET_RING) then continue end
		return EnemyService.spawnAt(chosen :: string, at)
	end
	return nil
end

--- Wildlife, weighted by moisture and distance from spawn as in the JS.
local function spawnWildlife()
	if not biome or not biome.creatures.wildlife then return end
	local rng = Rng.new(math.floor(os.clock() * 1e6 + 31) % 2147483647)
	local half = Config.ARENA_SIZE / 2 * 0.85

	local x = Rng.range(rng, -half, half)
	local z = Rng.range(rng, -half, half)
	local distance = math.sqrt(x * x + z * z)
	if distance < Creatures.POPULATION.freeRoamSkipRadius then return end

	local moisture = WorldBuilder.moistureAt(seed, x, z)
	local y = WorldBuilder.heightAt(seed, biome, x, z)
	local at = Vector3.new(x, y + 3, z)
	if tooClose(at, Config.QUIET_RING * 0.5) then return end

	-- The bear is a flat roll rather than part of the weight table.
	if distance > Creatures.POPULATION.bearMinDistance and Rng.chance(rng, Creatures.POPULATION.bearChance) then
		EnemyService.spawnAt("bear", at)
		return
	end

	local weights = Creatures.wildlifeWeights(moisture, distance)
	local pick = Rng.weighted(rng, weights)
	if not pick or pick.weight <= 0 then return end

	if pick.id == "wolf" then
		local pack = Creatures.POPULATION.wolfPackMin + math.floor(Rng.next(rng) * Creatures.POPULATION.wolfPackSpread)
		for i = 1, pack do
			local off = Vector3.new(Rng.range(rng, -8, 8), 0, Rng.range(rng, -8, 8))
			EnemyService.spawnAt("wolf", at + off)
		end
	else
		EnemyService.spawnAt(pick.id, at)
	end
end

-- ── Alert ──────────────────────────────────────────────────────────────────

--- Something screamed. Everything within `radius` learns where you are.
function EnemyService.alertAround(at: Vector3, radius: number, amount: number)
	for _, e in live do
		if e.dead then continue end
		if (e.root.Position - at).Magnitude <= radius then
			e.alert = math.min(1, e.alert + amount)
		end
	end
end

-- ── Damage ─────────────────────────────────────────────────────────────────

--- WeaponService calls this for every hit. Returns true if it claimed the hit.
function EnemyService.onDamage(player: Player, model: Instance, amount: number, headshot: boolean, at: Vector3): boolean
	for i, e in live do
		if e.model ~= model then continue end
		if e.dead then return true end

		local armor = e.def.armor or 0
		local dealt = amount * (1 - armor)
		e.health -= dealt
		e.alert = 1
		e.target = player
		if e.state == "IDLE" or e.state == "PATROL" or e.state == "GRAZE" then
			e.state = if e.faction == "animal" then "FLEE" else "CHASE"
			e.stateTime = 0
		end

		-- Something being shot is the loudest thing in the forest.
		EnemyService.alertAround(at, 45, 0.5)

		if e.health <= 0 then
			EnemyService.kill(e, player, headshot)
		else
			WeaponService.reportHit(player, headshot)
		end
		return true
	end
	return false
end

function EnemyService.kill(e: Entity, by: Player?, headshot: boolean?)
	if e.dead then return end
	e.dead = true

	-- The Sporebearer takes someone with it.
	if e.def.sporeBurst then
		for _, p in Players:GetPlayers() do
			local char = p.Character
			local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
			if not hrp then continue end
			local d = (hrp.Position - e.root.Position).Magnitude
			if d < AI.sporeBurstRadius then
				StatsService.damage(p, AI.sporeBurstDamage * (1 - d / AI.sporeBurstRadius),
					{ ignoreGrace = true, poison = 0.8 })
			end
		end
		EnemyService.alertAround(e.root.Position, AI.sporeBurstAlert, 0.6)
	end

	if by then
		StatsService.countKill(by)
		WeaponService.reportKill(by, headshot == true)
	end
	if onKilled then onKilled(by, e) end

	e.root.Anchored = false
	e.root.CanCollide = false
	for _, part in e.model:GetDescendants() do
		if part:IsA("BasePart") then
			part.CanCollide = false
			part.Anchored = false
		end
	end

	task.delay(6, function()
		if e.model.Parent then e.model:Destroy() end
	end)

	for i, other in live do
		if other == e then
			table.remove(live, i)
			break
		end
	end
end

-- ── Perception ─────────────────────────────────────────────────────────────

local function canSee(e: Entity, hrp: BasePart, dist: number): boolean
	if dist > e.def.viewRange then return false end
	local to = (hrp.Position - e.root.Position).Unit
	local facing = e.root.CFrame.LookVector
	return facing:Dot(to) > math.cos(e.def.fov)
end

local function lookingAtMe(e: Entity, player: Player): boolean
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return false end
	local to = (e.root.Position - hrp.Position).Unit
	return hrp.CFrame.LookVector:Dot(to) > 0.7
end

local function updateAlert(e: Entity, dt: number, player: Player?, dist: number, hrp: BasePart?)
	e.alert = math.max(0, e.alert - AI.alertDecay * dt)
	if not player or not hrp then return end

	local s = StatsService.get(player)
	if not s then return end

	if canSee(e, hrp, dist) then
		e.alert = math.min(1, e.alert + AI.visibleGain * dt)
	end

	-- The flashlight is the loudest thing you carry.
	if s.flashlight and dist < AI.lightGainRange then
		e.alert = math.min(1, e.alert + dt * (0.8 + (e.def.lightShy or 0)))
	end

	-- Proximity. Crouching and standing still cuts it to a quarter.
	if dist < AI.proximityRange then
		local stealth = if s.crouched and not s.sprinting then AI.crouchStillStealth else 1
		e.alert = math.min(1, e.alert + dt * AI.proximityGain * stealth * (1 - dist / AI.proximityRange))
	end

	if s.sprinting and dist < e.def.hearRange then
		e.alert = math.min(1, e.alert + dt * 0.4)
	end
end

-- ── Movement ───────────────────────────────────────────────────────────────

local function groundY(x: number, z: number, e: Entity): number
	if not biome then return e.root.Position.Y end
	local h = WorldBuilder.heightAt(seed, biome, x, z)
	local lift = e.def.height * e.scale * 2.6 * 0.55
	if e.def.floats then
		lift += AI.floatBase + math.sin(os.clock() * AI.floatRate) * AI.floatAmp
	end
	return h + lift
end

local function moveToward(e: Entity, goal: Vector3, speed: number, dt: number, face: Vector3?)
	local here = e.root.Position
	local flat = Vector3.new(goal.X - here.X, 0, goal.Z - here.Z)
	if flat.Magnitude < 0.05 then return end
	local step = flat.Unit * speed * dt * 2.6
	local nextX, nextZ = here.X + step.X, here.Z + step.Z
	local y = groundY(nextX, nextZ, e)
	local smoothed = y + (here.Y - y) * math.exp(-8 * dt)
	local look = face or Vector3.new(goal.X, smoothed, goal.Z)
	e.root.CFrame = CFrame.lookAt(Vector3.new(nextX, smoothed, nextZ), Vector3.new(look.X, smoothed, look.Z))
end

-- ── Attacks ────────────────────────────────────────────────────────────────

local function tryAttack(e: Entity, player: Player, dist: number, dt: number)
	e.attackTimer -= dt

	if e.windup > 0 then
		e.windup -= dt
		if e.windup <= 0 then
			-- The blow lands only if you are still in reach when it does,
			-- which is why stepping back during a windup works.
			if dist <= e.def.attackRange + 0.8 then
				local scaling = Biomes.depthScaling(depth)
				local bleed = if e.faction == "animal"
					then (if e.id == "bear" then AI.bearBleed else AI.animalBleed)
					else (if e.state == "CHARGE" then AI.chargeBleed else AI.defaultBleed)
				StatsService.damage(player, e.def.damage * scaling.damage, { bleed = bleed })

				-- Heavy things throw you.
				if e.id == "bear" or e.id == "boar" or e.state == "CHARGE" then
					local char = player.Character
					local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
					if hrp then
						local away = (hrp.Position - e.root.Position).Unit
						local xz = if e.state == "CHARGE" then AI.chargeShoveXZ else AI.heavyShoveXZ
						local y = if e.state == "CHARGE" then AI.chargeShoveY else AI.heavyShoveY
						hrp.AssemblyLinearVelocity += Vector3.new(away.X * xz, y, away.Z * xz) * 3
					end
				end
			end
			e.windup = 0
			e.attackTimer = e.def.attackCooldown
		end
		return
	end

	if dist <= e.def.attackRange and e.attackTimer <= 0 then
		e.windup = if e.faction == "animal" then AI.animalWindup
			elseif e.state == "CHARGE" then AI.chargeWindup
			else AI.attackWindup
	end
end

-- ── Behaviours ─────────────────────────────────────────────────────────────

local function stepStalk(e: Entity, dt: number, player: Player, dist: number, hrp: BasePart)
	local watched = lookingAtMe(e, player)
	local want = e.stalkDistance * (if watched then AI.stalkWatchedMul else AI.stalkUnwatchedMul)

	if dist < AI.stalkBreakDistance and not watched then
		e.state = "CHASE"; e.stateTime = 0; return
	end
	if e.stateTime > AI.stalkPatienceSeconds and e.alert > AI.stalkPatienceAlert then
		e.state = "CHASE"; e.stateTime = 0; return
	end

	local to = (e.root.Position - hrp.Position)
	local flat = Vector3.new(to.X, 0, to.Z)
	if flat.Magnitude < 0.1 then return end
	local goal = hrp.Position + flat.Unit * want
	moveToward(e, goal, e.def.speed, dt, hrp.Position)
end

local function stepCharge(e: Entity, dt: number, player: Player, dist: number, hrp: BasePart)
	if e.chargeTimer > 0 then
		e.chargeTimer -= dt
		moveToward(e, hrp.Position, e.def.runSpeed * AI.chargeSpeedMul, dt)
		tryAttack(e, player, dist, dt)
		if e.chargeTimer <= 0 then e.state = "CHASE" end
		return
	end

	if dist > AI.chargeMinDistance and dist < AI.chargeMaxDistance
		and math.random() < dt * AI.chargeChancePerSecond then
		e.state = "CHARGE"
		e.chargeTimer = AI.chargeDuration
		return
	end

	moveToward(e, hrp.Position, e.def.runSpeed, dt)
	tryAttack(e, player, dist, dt)
end

local function stepSwarm(e: Entity, dt: number, player: Player, dist: number, hrp: BasePart)
	-- The weave. Erratic enough that leading them is guesswork.
	local wobble = math.sin(os.clock() * AI.swarmWobbleRate + e.root.Position.X)
		* AI.swarmWobbleAmp * math.min(1, dist / AI.swarmWobbleFalloff)
	local to = hrp.Position - e.root.Position
	local flat = Vector3.new(to.X, 0, to.Z)
	if flat.Magnitude < 0.1 then return end
	local side = Vector3.new(-flat.Unit.Z, 0, flat.Unit.X) * wobble
	moveToward(e, hrp.Position + side, e.def.runSpeed, dt, hrp.Position)
	tryAttack(e, player, dist, dt)
end

local function stepCall(e: Entity, dt: number, player: Player, dist: number, hrp: BasePart)
	e.callCooldown -= dt

	-- Below half health it stops calling and runs.
	if e.health < e.maxHealth * AI.callFleeHealthFraction then
		local away = (e.root.Position - hrp.Position)
		local flat = Vector3.new(away.X, 0, away.Z)
		if flat.Magnitude > 0.1 then
			moveToward(e, e.root.Position + flat.Unit * 20, e.def.runSpeed, dt)
		end
		return
	end

	local range = if e.def.behaviour == "stalk" then AI.callRangeStalk else AI.callRange
	if dist < range and e.callCooldown <= 0 then
		e.callCooldown = AI.callCooldownMin + math.random() * AI.callCooldownSpread
		EnemyService.alertAround(e.root.Position, AI.callAlertRadius, 1)
	end

	-- It backs off rather than closing.
	if dist < AI.callBackoffDistance then
		local away = (e.root.Position - hrp.Position)
		local flat = Vector3.new(away.X, 0, away.Z)
		if flat.Magnitude > 0.1 then
			moveToward(e, e.root.Position + flat.Unit * 12, e.def.speed, dt, hrp.Position)
		end
	else
		moveToward(e, hrp.Position, e.def.speed, dt, hrp.Position)
		tryAttack(e, player, dist, dt)
	end
end

local function stepSkittish(e: Entity, dt: number, player: Player, dist: number, hrp: BasePart)
	local flee = e.def.fleeRange or 18
	if dist > flee then
		-- Graze: drift slowly around home.
		if (e.root.Position - e.wander).Magnitude < 3 or e.stateTime > 8 then
			e.stateTime = 0
			local a = math.random() * math.pi * 2
			local r = AI.wanderMinOffset + math.random() * AI.wanderRadiusOther
			e.wander = e.home + Vector3.new(math.cos(a) * r, 0, math.sin(a) * r)
		end
		moveToward(e, e.wander, e.def.speed, dt)
		return
	end

	-- Flee in an arc rather than a straight line, so they are hard to lead.
	local away = e.root.Position - hrp.Position
	local flat = Vector3.new(away.X, 0, away.Z)
	if flat.Magnitude < 0.1 then return end
	local lateral = Vector3.new(-flat.Unit.Z, 0, flat.Unit.X) * AI.skittishArc
	moveToward(e, e.root.Position + (flat.Unit + lateral).Unit * 24, e.def.runSpeed, dt)
end

local function stepDefensive(e: Entity, dt: number, player: Player, dist: number, hrp: BasePart)
	local aggroRange = e.def.aggroRange or 11
	if dist < aggroRange then
		e.alert = math.min(1, e.alert + dt * AI.defensiveGain)
	end

	if e.alert > AI.defensiveCharge then
		moveToward(e, hrp.Position, e.def.runSpeed, dt)
		tryAttack(e, player, dist, dt)
		-- The boar gives up after a few seconds and bolts.
		if e.id == "boar" and e.stateTime > AI.boarDisengage then
			e.alert = 0.2
			e.state = "FLEE"
			e.stateTime = 0
		end
		return
	end

	stepSkittish(e, dt, player, dist + 1e6, hrp)   -- graze, never flee
end

local function stepPredator(e: Entity, dt: number, player: Player, dist: number, hrp: BasePart)
	local aggroRange = e.def.aggroRange or 34
	if dist < aggroRange then
		e.alert = math.min(1, e.alert + dt * AI.predatorGain)
	end

	if dist > AI.predatorDisengage then
		e.alert = math.max(0, e.alert - dt * 0.3)
		stepSkittish(e, dt, player, dist + 1e6, hrp)
		return
	end

	if e.state == "CHASE" then
		moveToward(e, hrp.Position, e.def.runSpeed, dt)
		tryAttack(e, player, dist, dt)
		if e.stateTime > AI.predatorChaseSeconds then
			e.state = "STALK"; e.stateTime = 0
		end
		return
	end

	if e.alert > AI.predatorStalk then
		-- Circle at eleven metres with a six-metre lateral offset until it
		-- decides to come in.
		e.commitIn -= dt
		if e.commitIn <= 0 and e.alert > AI.predatorCommitAlert then
			e.state = "CHASE"
			e.stateTime = 0
			e.commitIn = AI.predatorCommitMin + math.random() * AI.predatorCommitSpread
			EnemyService.alertAround(e.root.Position, AI.packAlertRadius, 0.5)
			return
		end
		local to = e.root.Position - hrp.Position
		local flat = Vector3.new(to.X, 0, to.Z)
		if flat.Magnitude < 0.1 then return end
		local side = Vector3.new(-flat.Unit.Z, 0, flat.Unit.X) * AI.predatorLateral
		local goal = hrp.Position + flat.Unit * AI.predatorWant + side
		moveToward(e, goal, e.def.speed * AI.predatorCircleSpeedMul, dt, hrp.Position)
		return
	end

	stepSkittish(e, dt, player, dist + 1e6, hrp)
end

local function stepTerritorial(e: Entity, dt: number, player: Player, dist: number, hrp: BasePart)
	local aggroRange = e.def.aggroRange or 16
	if dist < aggroRange then
		e.alert = math.min(1, e.alert + dt * AI.territorialGain)
	end
	if e.alert > AI.territorialCharge then
		moveToward(e, hrp.Position, e.def.runSpeed, dt)
		tryAttack(e, player, dist, dt)
		return
	end
	stepSkittish(e, dt, player, dist + 1e6, hrp)
end

local function stepPatrol(e: Entity, dt: number)
	if (e.root.Position - e.wander).Magnitude < 3 or e.stateTime > 12 then
		e.stateTime = 0
		local a = math.random() * math.pi * 2
		local r = AI.patrolMin + math.random() * (AI.patrolMax - AI.patrolMin)
		local goal = e.home + Vector3.new(math.cos(a) * r, 0, math.sin(a) * r)
		local clamp = if e.faction == "animal" then AI.worldClampAnimal else AI.worldClampMutant
		if goal.Magnitude > clamp then goal = goal.Unit * clamp end
		e.wander = goal
	end
	moveToward(e, e.wander, e.def.speed, dt)
end

-- ── The stepper ────────────────────────────────────────────────────────────

function EnemyService.step(dt: number)
	if not biome or frozen then return end

	for i = #live, 1, -1 do
		local e = live[i]
		if not e.model.Parent or e.dead then
			table.remove(live, i)
			continue
		end

		e.stateTime += dt
		local player, dist, hrp = nearestPlayer(e.root.Position)
		updateAlert(e, dt, player, dist, hrp)

		if peaceful and e.faction == "mutant" then
			e.alert = 0
			e.attackTimer = math.max(e.attackTimer, 2)
			stepPatrol(e, dt)
			continue
		end

		if not player or not hrp then
			stepPatrol(e, dt)
			continue
		end

		e.target = player

		if e.faction == "mutant" then
			if e.alert < 0.35 and dist > e.def.viewRange then
				stepPatrol(e, dt)
				continue
			end
			local b = e.def.behaviour
			if b == "stalk" then stepStalk(e, dt, player, dist, hrp)
			elseif b == "charge" then stepCharge(e, dt, player, dist, hrp)
			elseif b == "swarm" then stepSwarm(e, dt, player, dist, hrp)
			elseif b == "call" then stepCall(e, dt, player, dist, hrp)
			else stepCharge(e, dt, player, dist, hrp) end
		else
			e.alert = math.max(0, e.alert - AI.animalAggroDecay * dt)
			local t = e.def.temperament
			if t == "skittish" then stepSkittish(e, dt, player, dist, hrp)
			elseif t == "defensive" then stepDefensive(e, dt, player, dist, hrp)
			elseif t == "predator" then stepPredator(e, dt, player, dist, hrp)
			elseif t == "territorial" then stepTerritorial(e, dt, player, dist, hrp)
			else stepSkittish(e, dt, player, dist, hrp) end
		end
	end

	-- Trickle replacements so the world never empties.
	local want = math.floor(Creatures.POPULATION.mutantCap * density * 0.34)
	local mutants = 0
	for _, e in live do
		if e.faction == "mutant" then mutants += 1 end
	end
	if mutants < want and math.random() < dt * 0.3 then
		EnemyService.spawnOne()
	end

	if biome.creatures.wildlife and math.random() < dt * 0.12 then
		spawnWildlife()
	end
end

-- ── Lifecycle ──────────────────────────────────────────────────────────────

function EnemyService.begin(worldSeed: number, worldBiome: any, difficultyId: string, runDepth: number)
	EnemyService.stop()
	seed = worldSeed
	biome = worldBiome
	depth = runDepth or 0

	local d = Config.DIFFICULTY[difficultyId] or Config.DIFFICULTY[Config.DEFAULT_DIFFICULTY]
	local scaling = Biomes.depthScaling(depth)
	density = d.enemyDensity * worldBiome.creatures.density * scaling.density

	folder = Instance.new("Folder")
	;(folder :: Folder).Name = "Creatures"
	;(folder :: Folder).Parent = Workspace

	local want = math.floor(Creatures.POPULATION.mutantCap * density * 0.34)
	task.spawn(function()
		for _ = 1, want do
			EnemyService.spawnOne()
			task.wait(0.3)
		end
		if worldBiome.creatures.wildlife then
			for _ = 1, 10 do
				spawnWildlife()
				task.wait(0.4)
			end
		end
	end)
end

function EnemyService.stop()
	for _, e in live do
		if e.model.Parent then e.model:Destroy() end
	end
	table.clear(live)
	if folder then folder:Destroy(); folder = nil end
end

function EnemyService.killAll(by: Player?)
	for i = #live, 1, -1 do
		EnemyService.kill(live[i], by, false)
	end
end

function EnemyService.clearAll()
	for _, e in live do
		if e.model.Parent then e.model:Destroy() end
	end
	table.clear(live)
end

function EnemyService.count(): number
	return #live
end

function EnemyService.setFrozen(on: boolean) frozen = on end
function EnemyService.setPeaceful(on: boolean) peaceful = on end
function EnemyService.setScale(n: number) scaleOverride = n end
function EnemyService.onKill(fn: (Player?, Entity) -> ()) onKilled = fn end

function EnemyService.init()
	WeaponService.registerDamageHook(EnemyService.onDamage)
end

EnemyService.LOOK = LOOK

return EnemyService
