--!strict
--[[
	BossService — one per biome, from scripts/entities/Bosses.js.

	A boss is not a bigger creature; it is a different system. It has phases
	that swap its movepool, weak points that only open at certain phases, a
	telegraph on every attack, an arena it will not leave, and a summon that
	pulls the local roster in on top of you.

	Killing it opens the rift. That is the only way out of a biome, which is
	why this file and ProgressionService are the two halves of the run.

	The telegraph is the whole fight. Every attack has a `windup` — from 0.45
	on the Chorister's lash to 1.4 on the Pyre-King's nova — during which the
	boss is committed and you can still move. A player who learns the windups
	beats a boss on any difficulty; a player who does not, does not.
]]

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local Bosses = require(Shared:WaitForChild("Bosses"))
local Net = require(Shared:WaitForChild("Net"))
local Rng = require(Shared:WaitForChild("Rng"))

local Blackroot = script.Parent
local StatsService = require(Blackroot:WaitForChild("StatsService"))
local WorldBuilder = require(Blackroot:WaitForChild("WorldBuilder"))
local WeaponService = require(Blackroot:WaitForChild("WeaponService"))
local EnemyService = require(Blackroot:WaitForChild("EnemyService"))

local BossService = {}

local C = Bosses.CONST

type Active = {
	def: any,
	model: Model,
	root: BasePart,
	health: number,
	maxHealth: number,
	origin: Vector3,
	awake: boolean,
	phaseIndex: number,
	attackTimer: number,
	summonCooldown: number,
	windup: number,
	move: string?,
	chargeTimer: number,
	target: Player?,
	dead: boolean,
	revealed: { [string]: boolean },
}

local current: Active? = nil
local folder: Folder? = nil
local seed = 0
local biome: any = nil
local depth = 0
local BossEvent: RemoteEvent
local ToastEvent: RemoteEvent
local onDefeated: ((Vector3) -> ())? = nil

-- ── Model ──────────────────────────────────────────────────────────────────

local function limb(model: Model, name: string, size: Vector3, cf: CFrame, colour: Color3, mat: Enum.Material): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cf
	p.Color = colour
	p.Material = mat
	p.CanCollide = false
	p.Massless = true
	p.Anchored = true
	p.Parent = model
	return p
end

--- Palette per boss. Original silhouettes assembled from primitives.
local LOOK = {
	warden = { body = Color3.fromRGB(52, 46, 36), accent = Color3.fromRGB(78, 68, 50), glow = Color3.fromRGB(226, 176, 90) },
	chorister = { body = Color3.fromRGB(26, 22, 42), accent = Color3.fromRGB(96, 72, 190), glow = Color3.fromRGB(178, 140, 255) },
	gillfather = { body = Color3.fromRGB(32, 48, 54), accent = Color3.fromRGB(48, 74, 82), glow = Color3.fromRGB(120, 240, 230) },
	pyreking = { body = Color3.fromRGB(44, 24, 18), accent = Color3.fromRGB(96, 40, 20), glow = Color3.fromRGB(255, 132, 44) },
	hoarmother = { body = Color3.fromRGB(168, 182, 194), accent = Color3.fromRGB(206, 220, 232), glow = Color3.fromRGB(190, 226, 244) },
	motherstalk = { body = Color3.fromRGB(86, 72, 54), accent = Color3.fromRGB(126, 74, 99), glow = Color3.fromRGB(186, 214, 110) },
}

local STUDS = 2.6   -- studs per game metre, matching EnemyService

local function build(def: any, at: Vector3): (Model, BasePart)
	local look = LOOK[def.id] or LOOK.warden
	local model = Instance.new("Model")
	model.Name = def.id
	model:SetAttribute("BlackrootEntity", true)
	model:SetAttribute("BlackrootBoss", true)

	local h = def.height * STUDS
	local r = def.radius * STUDS

	local root = Instance.new("Part")
	root.Name = "HumanoidRootPart"
	root.Size = Vector3.new(r * 2, h * 0.5, r * 1.6)
	root.CFrame = CFrame.new(at + Vector3.new(0, h * 0.5, 0))
	root.Color = look.body
	root.Material = Enum.Material.Slate
	root.Anchored = true
	root.CanCollide = true
	root.Parent = model
	model.PrimaryPart = root

	limb(model, "Head", Vector3.new(r * 1.2, h * 0.16, r * 1.1),
		CFrame.new(at + Vector3.new(0, def.headHeight * STUDS, 0)), look.accent, Enum.Material.Slate)

	-- Each weak point is a real part, so shooting one is shooting a thing you
	-- can see rather than a hitbox you have to guess at.
	for _, wp in def.weakPoints do
		local part = limb(model, `WeakPoint_{wp.name}`,
			Vector3.new(wp.r * 2 * STUDS, wp.r * 2 * STUDS, wp.r * 2 * STUDS),
			CFrame.new(at + Vector3.new(0, wp.y * STUDS, wp.z * STUDS)),
			look.glow, Enum.Material.Neon)
		part.Transparency = 0.72     -- opens up when its phase arrives
		part:SetAttribute("WeakPoint", wp.name)

		local light = Instance.new("PointLight")
		light.Color = look.glow
		light.Range = 26
		light.Brightness = 0.4
		light.Enabled = false
		light.Parent = part
	end

	for _, side in { -1, 1 } do
		limb(model, "Limb", Vector3.new(r * 0.5, h * 0.62, r * 0.5),
			CFrame.new(at + Vector3.new(side * r * 1.3, h * 0.42, 0)), look.body, Enum.Material.Slate)
	end

	-- The arena ring, so it is obvious where the fight is.
	local ring = limb(model, "Arena", Vector3.new(def.arena * 2, 0.4, def.arena * 2),
		CFrame.new(at - Vector3.new(0, h * 0.5, 0)), look.glow, Enum.Material.Neon)
	ring.Transparency = 0.93
	ring.CanQuery = false

	return model, root
end

local function setWeakPointsVisible(a: Active)
	for _, child in a.model:GetChildren() do
		local name = child:GetAttribute("WeakPoint")
		if not name then continue end
		local part = child :: BasePart

		local wp
		for _, candidate in a.def.weakPoints do
			if candidate.name == name then wp = candidate; break end
		end
		if not wp then continue end

		local revealed = a.phaseIndex - 1 >= wp.phase
		if wp.hiddenUntilPhase and a.phaseIndex - 1 < wp.hiddenUntilPhase then
			revealed = false
		end

		part.Transparency = if revealed then 0.15 else 0.72
		local light = part:FindFirstChildOfClass("PointLight")
		if light then
			light.Enabled = revealed
			light.Brightness = if revealed then 2.4 else 0.4
		end
		if revealed and not a.revealed[name] then
			a.revealed[name] = true
			if ToastEvent then
				ToastEvent:FireAllClients(`THE {string.upper(name)} IS OPEN`, "warn")
			end
		end
	end
end

-- ── Attacks ────────────────────────────────────────────────────────────────

local function playersInArena(a: Active): { { player: Player, hrp: BasePart, dist: number } }
	local out = {}
	for _, p in Players:GetPlayers() do
		local s = StatsService.get(p)
		if not s or s.dead then continue end
		local char = p.Character
		local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
		if not hrp then continue end
		table.insert(out, { player = p, hrp = hrp, dist = (hrp.Position - a.root.Position).Magnitude })
	end
	table.sort(out, function(x, y) return x.dist < y.dist end)
	return out
end

local function telegraph(a: Active, move: string, seconds: number)
	local flash = Instance.new("Part")
	flash.Anchored = true
	flash.CanCollide = false
	flash.CanQuery = false
	flash.Size = Vector3.new(a.def.radius * STUDS * 3, 0.3, a.def.radius * STUDS * 3)
	flash.CFrame = CFrame.new(a.root.Position - Vector3.new(0, a.def.height * STUDS * 0.5, 0))
	flash.Color = Color3.fromRGB(240, 90, 70)
	flash.Material = Enum.Material.Neon
	flash.Transparency = 0.55
	flash.Name = "Telegraph"
	flash.Parent = Workspace
	task.delay(seconds, function() flash:Destroy() end)

	if BossEvent then
		for _, p in Players:GetPlayers() do
			BossEvent:FireClient(p, {
				name = a.def.name,
				title = a.def.title,
				health = a.health,
				maxHealth = a.maxHealth,
				phase = a.phaseIndex,
				phaseName = a.def.phases[a.phaseIndex].name,
				telegraph = move,
				windup = seconds,
			})
		end
	end
end

local function landAttack(a: Active, move: string)
	local spec = Bosses.ATTACKS[move]
	if not spec then return end

	local scaling = Biomes.depthScaling(depth)
	local damage = a.def.damage * (spec.damage or 0) * scaling.damage
	local targets = playersInArena(a)

	if spec.kind == "melee" then
		local reach = a.def.attackRange * STUDS + (spec.rangeAdd or 0) * STUDS
		for _, t in targets do
			if t.dist > reach then continue end
			StatsService.damage(t.player, damage, { bleed = spec.bleed })

			if spec.knockRadius and t.dist < reach + spec.knockRadius * STUDS then
				local away = (t.hrp.Position - a.root.Position).Unit
				t.hrp.AssemblyLinearVelocity += Vector3.new(
					away.X * (spec.knockXZ or 0) * STUDS,
					(spec.knockY or 0) * STUDS,
					away.Z * (spec.knockXZ or 0) * STUDS
				)
			end
		end

		-- The lash hits twice, a quarter-second apart.
		if spec.hits and spec.hits > 1 then
			task.delay(spec.secondHitDelay or 0.26, function()
				if not current or current ~= a or a.dead then return end
				for _, t in playersInArena(a) do
					if t.dist <= reach then
						StatsService.damage(t.player, damage, { bleed = spec.bleed, ignoreGrace = true })
					end
				end
			end)
		end

	elseif spec.kind == "line" then
		local facing = a.root.CFrame.LookVector
		for _, t in targets do
			if t.dist > (spec.maxDistance or 30) * STUDS then continue end
			local to = (t.hrp.Position - a.root.Position).Unit
			if facing:Dot(to) < (spec.facing or 0.72) then continue end
			StatsService.damage(t.player, damage, { bleed = spec.bleed })
		end

	elseif spec.kind == "aoe" then
		local radius = (spec.radius or 9) * STUDS
		for _, t in targets do
			if t.dist > radius then continue end
			-- Falloff exactly as in the JS: 1.1 minus distance over radius.
			local falloff = 1.1 - (t.dist / STUDS) / (spec.radius or 9)
			if falloff <= 0 then continue end
			StatsService.damage(t.player, a.def.damage * falloff * scaling.damage,
				{ bleed = spec.bleed, ignoreGrace = true })
		end

	elseif spec.kind == "summon" then
		local roster = biome and biome.creatures.mutants or { "stalker" }
		local count = (spec.countBase or 2) + (a.phaseIndex - 1)
		local rng = Rng.new(math.floor(os.clock() * 1e6) % 2147483647)
		for _ = 1, count do
			local angle = Rng.next(rng) * math.pi * 2
			local dist = Rng.range(rng, spec.minRange or 9, spec.maxRange or 21) * STUDS
			local at = a.root.Position + Vector3.new(math.cos(angle) * dist, 6, math.sin(angle) * dist)
			local id = Rng.pick(rng, roster)
			local spawned = EnemyService.spawnAt(id, at)
			if spawned then
				-- They arrive already looking for you.
				spawned.alert = 1
				spawned.state = "CHASE"
			end
		end
		a.summonCooldown = spec.cooldown or 22
		if ToastEvent then ToastEvent:FireAllClients("IT IS CALLING THEM", "bad") end
	end
end

local function chooseMove(a: Active): string?
	local phase = a.def.phases[a.phaseIndex]
	if not phase then return nil end

	local pool = {}
	for _, move in phase.moves do
		if move == "summon" and a.summonCooldown > 0 then continue end
		table.insert(pool, move)
	end
	if #pool == 0 then return nil end
	return pool[math.random(1, #pool)]
end

-- ── Damage ─────────────────────────────────────────────────────────────────

--- WeaponService calls this. Returns true if it claimed the hit.
function BossService.onDamage(player: Player, model: Instance, amount: number, headshot: boolean, at: Vector3): boolean
	local a = current
	if not a or a.dead then return false end
	if model ~= a.model then return false end

	-- Where on the boss, in its own local metres.
	local local_ = a.root.CFrame:PointToObjectSpace(at)
	local localY = (at.Y - (a.root.Position.Y - a.def.height * STUDS * 0.5)) / STUDS
	local localZ = -local_.Z / STUDS

	local mul, hitName = Bosses.hitMultiplier(a.def, localY, localZ, a.phaseIndex, headshot)
	local dealt = amount * mul * (1 - a.def.armor)

	a.health = math.max(0, a.health - dealt)
	a.awake = true

	if hitName and hitName ~= "head" then
		WeaponService.reportKill(player, false)   -- weak point reads as a crit
	else
		WeaponService.reportHit(player, headshot)
	end

	local fraction = a.health / a.maxHealth
	local newPhase = Bosses.phaseFor(a.def, fraction)
	if newPhase ~= a.phaseIndex then
		a.phaseIndex = newPhase
		setWeakPointsVisible(a)
		if ToastEvent then
			ToastEvent:FireAllClients(a.def.phases[newPhase].name, "bad")
		end
	end

	if a.health <= 0 then
		BossService.defeat(player)
	end
	return true
end

function BossService.defeat(by: Player?)
	local a = current
	if not a or a.dead then return end
	a.dead = true

	if ToastEvent then
		ToastEvent:FireAllClients(`{a.def.name} IS DOWN`, "title")
		ToastEvent:FireAllClients("A rift has opened where it fell", "good")
	end
	if BossEvent then BossEvent:FireAllClients(nil) end

	local where = a.root.Position
	task.delay(2.5, function()
		if a.model.Parent then a.model:Destroy() end
	end)

	current = nil
	if onDefeated then onDefeated(where) end
end

-- ── Step ───────────────────────────────────────────────────────────────────

function BossService.step(dt: number)
	local a = current
	if not a or a.dead then return end

	local targets = playersInArena(a)
	local nearest = targets[1]
	if not nearest then return end

	local arena = a.def.arena * STUDS

	if not a.awake then
		if nearest.dist < arena * C.wakeFraction then
			a.awake = true
			if ToastEvent then
				ToastEvent:FireAllClients(`{a.def.name}`, "title")
				ToastEvent:FireAllClients(a.def.title, "info")
			end
		else
			return
		end
	end

	local phase = a.def.phases[a.phaseIndex]
	a.summonCooldown = math.max(0, a.summonCooldown - dt)

	-- Windup: committed, and the player can still move out of it.
	if a.windup > 0 then
		a.windup -= dt
		if a.windup <= 0 then
			landAttack(a, a.move :: string)
			a.move = nil
			a.attackTimer = a.def.attackCooldown
		end
		return
	end

	-- Movement. Rooted bosses turn but do not walk.
	local speed = a.def.speed * phase.speed
	if a.chargeTimer > 0 then
		a.chargeTimer -= dt
		speed = a.def.runSpeed * (Bosses.ATTACKS.charge.speedMul or 1.7) * phase.speed
	elseif nearest.dist > a.def.attackRange * STUDS then
		speed = a.def.runSpeed * phase.speed
	end

	local toHome = (a.root.Position - a.origin).Magnitude
	local goal = if toHome > arena * C.leashMul then a.origin else nearest.hrp.Position

	if not a.def.rooted then
		local to = Vector3.new(goal.X - a.root.Position.X, 0, goal.Z - a.root.Position.Z)
		if to.Magnitude > 1 then
			local step = to.Unit * speed * dt * STUDS
			local nx, nz = a.root.Position.X + step.X, a.root.Position.Z + step.Z
			local y = WorldBuilder.heightAt(seed, biome, nx, nz) + a.def.height * STUDS * 0.5
			a.root.CFrame = CFrame.lookAt(Vector3.new(nx, y, nz), Vector3.new(goal.X, y, goal.Z))
		end
	else
		local y = a.root.Position.Y
		a.root.CFrame = CFrame.lookAt(a.root.Position, Vector3.new(goal.X, y, goal.Z))
	end

	-- Choosing the next move.
	a.attackTimer -= dt
	if a.attackTimer <= 0 then
		local move = chooseMove(a)
		if move then
			local spec = Bosses.ATTACKS[move]
			local usable = true
			if spec.kind == "charge" then
				usable = nearest.dist > (spec.minDistance or 8) * STUDS
					and nearest.dist < (spec.maxDistance or 34) * STUDS
			elseif spec.kind == "melee" then
				usable = nearest.dist <= (a.def.attackRange + (spec.rangeAdd or 0) + 2) * STUDS
			elseif spec.kind == "line" then
				usable = nearest.dist < (spec.maxDistance or 30) * STUDS
			end

			if usable then
				if spec.kind == "charge" then
					a.chargeTimer = spec.duration or 1.8
					a.attackTimer = a.def.attackCooldown
				else
					a.move = move
					a.windup = spec.windup
					telegraph(a, move, spec.windup)
				end
			else
				a.attackTimer = 0.4
			end
		else
			a.attackTimer = 0.6
		end
	end

	-- The bar, a few times a second.
	BossService._acc = (BossService._acc or 0) + dt
	if BossService._acc >= 0.2 and BossEvent then
		BossService._acc = 0
		BossEvent:FireAllClients({
			name = a.def.name,
			title = a.def.title,
			health = a.health,
			maxHealth = a.maxHealth,
			phase = a.phaseIndex,
			phaseName = phase.name,
		})
	end
end

-- ── Lifecycle ──────────────────────────────────────────────────────────────

function BossService.spawn(bossId: string, at: Vector3, awake: boolean?): boolean
	local def = Bosses.get(bossId)
	if not def then return false end
	BossService.clear()

	if not folder then
		folder = Instance.new("Folder")
		;(folder :: Folder).Name = "Boss"
		;(folder :: Folder).Parent = Workspace
	end

	local model, root = build(def, at)
	model.Parent = folder

	local scaling = Biomes.depthScaling(depth)
	local maxHealth = def.health * scaling.health

	current = {
		def = def,
		model = model,
		root = root,
		health = maxHealth,
		maxHealth = maxHealth,
		origin = at,
		awake = awake == true,
		phaseIndex = 1,
		attackTimer = C.attackTimerStart,
		summonCooldown = C.summonCooldownStart,
		windup = 0,
		move = nil,
		chargeTimer = 0,
		target = nil,
		dead = false,
		revealed = {},
	}
	setWeakPointsVisible(current :: Active)
	return true
end

--- Place the biome's boss somewhere far from spawn and leave it asleep.
function BossService.begin(worldSeed: number, worldBiome: any, runDepth: number)
	seed = worldSeed
	biome = worldBiome
	depth = runDepth or 0
	BossService.clear()

	if not worldBiome.boss then return end

	local rng = Rng.new(worldSeed + 55501)
	local angle = Rng.next(rng) * math.pi * 2
	local dist = Config.ARENA_SIZE * 0.32
	local x = math.cos(angle) * dist
	local z = math.sin(angle) * dist
	local y = WorldBuilder.heightAt(worldSeed, worldBiome, x, z)

	BossService.spawn(worldBiome.boss, Vector3.new(x, y + 4, z), false)
end

function BossService.clear()
	if current and current.model.Parent then
		current.model:Destroy()
	end
	current = nil
	if BossEvent then BossEvent:FireAllClients(nil) end
end

function BossService.stop()
	BossService.clear()
	if folder then folder:Destroy(); folder = nil end
end

function BossService.active(): Active?
	return current
end

function BossService.position(): Vector3?
	return current and current.root.Position or nil
end

function BossService.onDefeat(fn: (Vector3) -> ())
	onDefeated = fn
end

function BossService.init()
	BossEvent = Net.event("BossState")
	ToastEvent = Net.event("Toast")
	WeaponService.registerDamageHook(BossService.onDamage)
end

BossService.STUDS = STUDS

return BossService
