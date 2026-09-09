--!strict
--[[
	SandboxService — the mod menu, from scripts/systems/Sandbox.js.

	Forty-three mods across seven groups. The table in Mods.luau *is* the menu:
	the client renders whatever is in it and this file applies whatever is in
	it, so adding a mod is one table entry plus one handler here.

	Toggles and sliders are re-applied every frame rather than set once,
	because almost everything they touch is also being written by the normal
	simulation. God mode has to beat the damage that would kill you this frame,
	not the frame you ticked it.

	Sandbox mods are gated on the run being in sandbox mode. There is no
	"cheats in the real run" switch, because the run has a leaderboard-shaped
	shadow (your salvage, your depth) and a god-mode depth is not a depth.
]]

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local Mods = require(Shared:WaitForChild("Mods"))
local Items = require(Shared:WaitForChild("Items"))
local Creatures = require(Shared:WaitForChild("Creatures"))
local Bosses = require(Shared:WaitForChild("Bosses"))
local Forge = require(Shared:WaitForChild("Forge"))
local Upgrades = require(Shared:WaitForChild("Upgrades"))
local Net = require(Shared:WaitForChild("Net"))

local Blackroot = script.Parent
local StatsService = require(Blackroot:WaitForChild("StatsService"))
local InventoryService = require(Blackroot:WaitForChild("InventoryService"))
local EnemyService = require(Blackroot:WaitForChild("EnemyService"))
local BossService = require(Blackroot:WaitForChild("BossService"))
local WorldBuilder = require(Blackroot:WaitForChild("WorldBuilder"))
local LootService = require(Blackroot:WaitForChild("LootService"))

local SandboxService = {}

local values: { [string]: any } = Mods.defaults()
local active = false
local SandboxEvent: RemoteEvent
local ToastEvent: RemoteEvent
local onRebuild: ((string?) -> ())? = nil

local STUDS = 2.6

function SandboxService.isActive(): boolean
	return active
end

function SandboxService.setActive(on: boolean)
	active = on
	if not on then
		-- Leaving the sandbox puts the world back the way it was.
		values = Mods.defaults()
		EnemyService.setFrozen(false)
		EnemyService.setPeaceful(false)
		EnemyService.setScale(1)
	end
	SandboxService.push()
end

function SandboxService.get(id: string): any
	return values[id]
end

function SandboxService.values(): { [string]: any }
	return values
end

-- ── Setting ────────────────────────────────────────────────────────────────

function SandboxService.set(player: Player, id: string, value: any)
	if not active then return end
	local mod = Mods.get(id)
	if not mod then return end

	if mod.kind == "toggle" then
		if type(value) ~= "boolean" then return end
	elseif mod.kind == "slider" then
		if type(value) ~= "number" then return end
		value = math.clamp(value, mod.min or 0, mod.max or 1)
	elseif mod.kind == "pick" then
		if type(value) ~= "string" then return end
	else
		return   -- actions go through RunMod
	end

	values[id] = value

	-- The ones that only make sense as a one-time push.
	if id == "freezeAi" then EnemyService.setFrozen(value) end
	if id == "peaceful" then EnemyService.setPeaceful(value) end
	if id == "creatureScale" then EnemyService.setScale(value) end
	if id == "gravity" then
		local biome = Biomes.get(SandboxService.get("worldPick") or "sandbox")
		local g = (biome and biome.physics.gravity or 1) * value
		Workspace.Gravity = Config.BASE_GRAVITY * g
	end

	SandboxService.push()
end

-- ── Actions ────────────────────────────────────────────────────────────────

local function facingPoint(player: Player, distance: number): Vector3?
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return nil end
	return hrp.Position + hrp.CFrame.LookVector * distance
end

local actions: { [string]: (Player) -> () } = {}

actions.heal = function(player)
	local s = StatsService.get(player)
	if not s then return end
	s.health = s.maxHealth
	s.stamina = s.maxStamina
	s.hunger = 100
	s.thirst = 100
	s.bleeding = 0
	s.poison = 0
	StatsService.push(player)
end

actions.giveAll = function(player)
	for id in Items.WEAPONS do
		InventoryService.add(player, id, 1)
	end
	for id in Items.AMMO do
		InventoryService.add(player, id, 240)
	end
	if ToastEvent then ToastEvent:FireClient(player, "EVERY WEAPON", "good") end
end

actions.forge = function(player)
	local seed = Forge.randomSeed()
	local weapon = Forge.roll(seed)
	local bag = InventoryService.get(player)
	if not bag then return end

	-- A forged weapon is its own entry: the seed *is* its identity.
	local id = weapon.id
	bag.weapons[id] = {
		id = id,
		mag = weapon.mag,
		fit = weapon.fit,
		levels = {},
		forgeSeed = seed,
	}
	table.insert(bag.stacks, { id = id, qty = 1 })
	InventoryService.add(player, weapon.ammo, 240)
	bag.equipped = id
	InventoryService.push(player)

	if ToastEvent then
		ToastEvent:FireClient(player, `{weapon.name} — {weapon.forge.tierLabel}, rating {weapon.forge.rating}`, "good")
	end
end

actions.maxOut = function(player)
	local state = InventoryService.equipped(player)
	if not state then return end
	for _, track in Upgrades.TRACKS do
		state.levels[track.id] = track.max
	end
	InventoryService.push(player)
	if ToastEvent then ToastEvent:FireClient(player, "EVERY TRACK MAXED", "good") end
end

actions.spawn = function(player)
	local id = values.creature or "stalker"
	local n = math.floor(values.count or 1)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return end

	-- An arc in front, radius 9 + n × 0.5, exactly as in the JS.
	local radius = (9 + n * 0.5) * STUDS
	for i = 1, n do
		local t = if n == 1 then 0.5 else (i - 1) / (n - 1)
		local angle = (t - 0.5) * 2.2
		local dir = (hrp.CFrame * CFrame.Angles(0, angle, 0)).LookVector
		EnemyService.spawnAt(id, hrp.Position + dir * radius + Vector3.new(0, 4, 0))
	end
end

actions.spawnBoss = function(player)
	local at = facingPoint(player, 26 * STUDS)
	if not at then return end
	BossService.spawn(values.bossPick or "warden", at + Vector3.new(0, 6, 0), true)
end

actions.killAll = function(player)
	EnemyService.killAll(player)
end

actions.clearAll = function(player)
	EnemyService.clearAll()
	BossService.clear()
end

actions.applySky = function(player)
	local biome = Biomes.get(values.skyPick or "sandbox")
	if not biome then return end
	WorldBuilder.applyLighting(biome, "morning")
	if ToastEvent then ToastEvent:FireClient(player, `WEARING {biome.name}`, "info") end
end

actions.rebuild = function(player)
	if onRebuild then onRebuild("sandbox") end
end

actions.goWorld = function(player)
	if onRebuild then onRebuild(values.worldPick or "sandbox") end
end

actions.rollWorld = function(player)
	local pick = Biomes.IDS[math.random(1, #Biomes.IDS)]
	values.worldPick = pick
	SandboxService.push()
	if onRebuild then onRebuild(pick) end
end

actions.tourWorld = function(player)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return end

	local list = LootService.landmarks()
	if #list == 0 then
		if ToastEvent then ToastEvent:FireClient(player, "Nothing built out here yet.", "warn") end
		return
	end
	local lm = list[math.random(1, #list)]
	hrp.CFrame = CFrame.new(lm.position + Vector3.new(0, 8, 22))
	if ToastEvent then ToastEvent:FireClient(player, string.upper(lm.kind.label), "good") end
end

actions.listWorld = function(player)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return end

	local near = LootService.nearestLandmarks(hrp.Position, 6)
	if #near == 0 then
		if ToastEvent then ToastEvent:FireClient(player, "Nothing out here.", "warn") end
		return
	end
	for _, entry in near do
		if ToastEvent then
			ToastEvent:FireClient(player, `{entry.label} — {math.floor(entry.distance / STUDS)} m`, "info")
		end
	end
end

actions.rain = function(player)
	local id = values.creature or "stalker"
	local n = math.floor(values.count or 1)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return end

	for _ = 1, n do
		local a = math.random() * math.pi * 2
		local r = math.random(4, 22) * STUDS
		local h = math.random(22, 40) * STUDS
		EnemyService.spawnAt(id, hrp.Position + Vector3.new(math.cos(a) * r, h, math.sin(a) * r))
	end
end

function SandboxService.run(player: Player, id: string)
	if not active then return end
	local mod = Mods.get(id)
	if not mod or mod.kind ~= "action" then return end
	local fn = actions[id]
	if not fn then return end
	local ok, err = pcall(fn, player)
	if not ok then warn(`[Blackroot] sandbox action {id} failed: {err}`) end
end

-- ── Per-frame ──────────────────────────────────────────────────────────────

--[[
	Toggles and sliders are pushed every frame because the simulation is
	writing the same fields. This is the loop that makes god mode actually mean
	god mode rather than "full health as of when you clicked it".
]]
function SandboxService.step(dt: number)
	if not active then return end

	for _, player in Players:GetPlayers() do
		local s = StatsService.get(player)
		if not s then continue end

		s.godMode = values.god == true

		if values.infStamina then s.stamina = s.maxStamina end
		if values.noNeeds then s.hunger = 100; s.thirst = 100 end
		s.moveMul = values.speed or 1

		local char = player.Character
		local hum = char and char:FindFirstChildOfClass("Humanoid")
		if hum then
			hum.JumpPower = Config.JUMP_POWER * (values.jump or 1)
			hum.UseJumpPower = true
		end

		if values.infAmmo then
			local state, stats = InventoryService.equipped(player)
			if state and stats and stats.kind == "gun" then
				state.mag = stats.mag
				InventoryService.cancelReload(player)
				if InventoryService.count(player, stats.ammo) < 200 then
					InventoryService.add(player, stats.ammo, 200 - InventoryService.count(player, stats.ammo))
				end
			end
		end
	end

	-- World-level sliders.
	Lighting.Brightness = math.clamp((values.brightness or 1.8), 0.4, 4)
	local fogMul = values.fog or 1
	if fogMul > 0 then
		Lighting.FogEnd = math.clamp(900 / fogMul, 60, 3000)
		Lighting.FogStart = Lighting.FogEnd * 0.10
	else
		Lighting.FogEnd = 100000
		Lighting.FogStart = 99000
	end
end

--- WeaponService asks whether the sandbox is changing a shot.
function SandboxService.weaponOverrides(): { oneShot: boolean, noSpread: boolean, noRecoil: boolean, explosive: boolean }
	if not active then
		return { oneShot = false, noSpread = false, noRecoil = false, explosive = false }
	end
	return {
		oneShot = values.oneShot == true,
		noSpread = values.noSpread == true,
		noRecoil = values.noRecoil == true,
		explosive = values.explosive == true,
	}
end

function SandboxService.push()
	if not SandboxEvent then return end
	SandboxEvent:FireAllClients({ active = active, values = values })
end

function SandboxService.onRebuild(fn: (string?) -> ())
	onRebuild = fn
end

function SandboxService.init()
	SandboxEvent = Net.event("Sandbox")
	ToastEvent = Net.event("Toast")

	Net.event("SetMod").OnServerEvent:Connect(function(player, id, value)
		if type(id) ~= "string" then return end
		SandboxService.set(player, id, value)
	end)

	Net.event("RunMod").OnServerEvent:Connect(function(player, id)
		if type(id) ~= "string" then return end
		SandboxService.run(player, id)
	end)

	Players.PlayerAdded:Connect(function()
		task.wait(1)
		SandboxService.push()
	end)
end

--- Option lists the client needs to render the pick controls.
function SandboxService.options(): { [string]: { string } }
	local worlds = { "sandbox" }
	for _, id in Biomes.IDS do table.insert(worlds, id) end

	local skies = {}
	for id in Biomes.ALL do table.insert(skies, id) end
	table.sort(skies)

	return {
		creatures = Creatures.allIds(),
		bosses = Bosses.ids(),
		biomes = skies,
		worlds = worlds,
	}
end

SandboxService.actions = actions

return SandboxService
