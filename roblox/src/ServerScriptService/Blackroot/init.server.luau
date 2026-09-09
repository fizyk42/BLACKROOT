--!strict
--[[
	BLACKROOT — Roblox server entry point.

	Boot order matters. Net first, because every service asks for its remotes
	by name and the client is already waiting on them. Then the services that
	hold state, then the ones that build the world, and only then the loop.

	The run is: build a biome → find its landmarks → wake and kill its boss →
	take the rift it leaves behind → deeper. Depth scales everything. There is
	no ending; the run ends when you do.
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local Items = require(Shared:WaitForChild("Items"))
local Attachments = require(Shared:WaitForChild("Attachments"))
local Upgrades = require(Shared:WaitForChild("Upgrades"))
local Mods = require(Shared:WaitForChild("Mods"))
local Net = require(Shared:WaitForChild("Net"))

Net.build()

local StatsService = require(script:WaitForChild("StatsService"))
local InventoryService = require(script:WaitForChild("InventoryService"))
local PowerupService = require(script:WaitForChild("PowerupService"))
local MonetizationService = require(script:WaitForChild("MonetizationService"))
local WorldBuilder = require(script:WaitForChild("WorldBuilder"))
local WeaponService = require(script:WaitForChild("WeaponService"))
local EnemyService = require(script:WaitForChild("EnemyService"))
local BossService = require(script:WaitForChild("BossService"))
local LootService = require(script:WaitForChild("LootService"))
local ProgressionService = require(script:WaitForChild("ProgressionService"))
local ObjectiveService = require(script:WaitForChild("ObjectiveService"))
local HorrorDirector = require(script:WaitForChild("HorrorDirector"))
local SandboxService = require(script:WaitForChild("SandboxService"))
local SaveService = require(script:WaitForChild("SaveService"))

StatsService.init()
InventoryService.init()
PowerupService.init()
WeaponService.init()
EnemyService.init()
BossService.init()
LootService.init()
ProgressionService.init()
ObjectiveService.init()
HorrorDirector.init()
SandboxService.init()
SaveService.init()

local ToastEvent = Net.event("Toast")
local RunStateEvent = Net.event("RunState")
local SquadEvent = Net.event("Squad")

local run = {
	seed = 0,
	biomeId = Biomes.FIRST,
	biome = nil :: any,
	difficulty = Config.DEFAULT_DIFFICULTY,
	sandbox = false,
	building = false,
	timeOfDay = "morning",
}

-- ── Run state ──────────────────────────────────────────────────────────────

local function pushRunState(player: Player?)
	local payload = {
		seed = run.seed,
		biome = run.biomeId,
		biomeName = run.biome and run.biome.name or "",
		biomeSub = run.biome and run.biome.sub or "",
		blurb = run.biome and run.biome.blurb or "",
		difficulty = run.difficulty,
		depth = ProgressionService.depth(),
		sandbox = run.sandbox,
		building = run.building,
		riftOpen = ProgressionService.riftOpen(),
		physics = run.biome and run.biome.physics or nil,
	}
	if player then
		RunStateEvent:FireClient(player, payload)
	else
		RunStateEvent:FireAllClients(payload)
	end
end

local function equip(player: Player)
	StatsService.reset(player, run.difficulty)
	InventoryService.reset(player, MonetizationService.owns(player, "starterKit"))
	PowerupService.resetRun(player)
	PowerupService.applyPerks(player, MonetizationService.ownedMap(player))
	pushRunState(player)
	ObjectiveService.broadcast()
	SandboxService.push()
end

-- ── Building a world ───────────────────────────────────────────────────────

local function buildWorld(biomeId: string, seed: number?)
	if run.building then return end
	run.building = true
	pushRunState()

	run.seed = seed or run.seed
	if run.seed == 0 then run.seed = math.random(1, 2 ^ 30) end
	run.biomeId = biomeId
	run.sandbox = biomeId == "sandbox"

	EnemyService.stop()
	BossService.stop()
	LootService.stop()
	ObjectiveService.stop()
	ProgressionService.closeRift()

	local depth = ProgressionService.depth()
	local _, biome = WorldBuilder.build(run.seed, biomeId, run.timeOfDay)
	run.biome = biome

	LootService.begin(run.seed, biome, run.difficulty, depth)
	EnemyService.begin(run.seed, biome, run.difficulty, depth)
	if not run.sandbox then
		BossService.begin(run.seed, biome, depth)
	end
	HorrorDirector.begin(biome)
	HorrorDirector.setEnabled(not run.sandbox)
	SandboxService.setActive(run.sandbox)

	run.building = false
	pushRunState()
	ToastEvent:FireAllClients(`{biome.name}`, "title")
	ToastEvent:FireAllClients(biome.sub, "info")

	for _, p in Players:GetPlayers() do
		if p.Character then p:LoadCharacter() end
	end
end

--- Start a fresh run at the top of the road.
local function startRun(seed: number?, difficulty: string?, sandbox: boolean?)
	if difficulty and Config.DIFFICULTY[difficulty] then
		run.difficulty = difficulty
	end
	run.seed = seed or math.random(1, 2 ^ 30)
	ProgressionService.begin(run.seed)

	if sandbox then
		buildWorld("sandbox", run.seed)
	else
		buildWorld(ProgressionService.currentBiome(), run.seed)
	end
end

-- Killing a boss opens the rift where it fell.
BossService.onDefeat(function(where)
	ProgressionService.openRift(where)
	pushRunState()
end)

-- Stepping through the rift rebuilds the world one biome deeper.
ProgressionService.onTravel(function(biomeId, depth)
	ToastEvent:FireAllClients("THROUGH", "title")
	task.delay(1.5, function()
		buildWorld(biomeId, run.seed + depth * 7919)
	end)
end)

-- The sandbox's Worlds group asks for a rebuild.
SandboxService.onRebuild(function(biomeId)
	buildWorld(biomeId or "sandbox", math.random(1, 2 ^ 30))
end)

-- The Extraction Flare brings the rift to you.
PowerupService.registerHook("flare", function(player)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return false end
	local at = hrp.Position + hrp.CFrame.LookVector * 55
	local y = WorldBuilder.heightAt(run.seed, run.biome, at.X, at.Z)
	ProgressionService.openRift(Vector3.new(at.X, y, at.Z))
	pushRunState()
	return true
end)

MonetizationService.init()

-- ── Item use ───────────────────────────────────────────────────────────────

local function useItem(player: Player, id: string)
	local s = StatsService.get(player)
	if not s or s.dead then return end

	local def = Items.ITEMS[id]
	if not def then return end
	if InventoryService.count(player, id) <= 0 then return end
	if not InventoryService.take(player, id, 1) then return end

	if def.cat == "food" then
		StatsService.feed(player, def.hunger or 0, def.thirst or 0)
		if def.health and def.health > 0 then StatsService.heal(player, def.health) end
	elseif def.cat == "medical" then
		StatsService.heal(player, def.health or 0, {
			stopsBleed = def.stopsBleed,
			curePoison = def.curePoison,
			overTime = def.healOverTime,
			duration = def.healDuration,
		})
		if def.damageResist then
			StatsService.resist(player, def.damageResist, def.resistDuration or 40)
		end
		if def.staminaBoost then
			StatsService.staminaBoost(player, def.resistDuration or 40)
		end
	elseif def.cat == "supply" then
		if def.battery then
			StatsService.chargeBattery(player, def.battery)
		end
		if def.throwable then
			-- A flare is loud, bright, and everything within a hundred metres
			-- looks. That is the whole item.
			local char = player.Character
			local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
			if hrp then
				EnemyService.alertAround(hrp.Position + hrp.CFrame.LookVector * 30, 100 * 2.6, 1)
				ToastEvent:FireClient(player, "FLARE — everything just looked", "warn")
			end
		end
	end
end

-- ── Players ────────────────────────────────────────────────────────────────

Players.PlayerAdded:Connect(function(player)
	player.CharacterAdded:Connect(function(char)
		local hum = char:WaitForChild("Humanoid") :: Humanoid
		hum.WalkSpeed = Config.WALK_SPEED
		hum.UseJumpPower = true
		hum.JumpPower = Config.JUMP_POWER
		-- StatsService owns health; the Humanoid is a puppet with a big pool
		-- so Roblox never kills anyone behind the simulation's back.
		hum.MaxHealth = 1e6
		hum.Health = 1e6
		task.wait(0.25)
		equip(player)

		-- Pick up an interrupted run, if there is one.
		local savedSeed, savedDepth = SaveService.restore(player)
		if savedSeed and savedDepth and savedDepth > 0 and #Players:GetPlayers() == 1 then
			ProgressionService.setDepth(savedDepth)
			run.seed = savedSeed
			ToastEvent:FireClient(player, `RESUMING AT DEPTH {savedDepth}`, "info")
			buildWorld(ProgressionService.currentBiome(), savedSeed + savedDepth * 7919)
		end
	end)
	if player.Character then equip(player) end
end)

Players.PlayerRemoving:Connect(function(player)
	SaveService.onLeave(player, run.seed, ProgressionService.depth())
	PowerupService.clear(player)
end)

-- ── Remotes ────────────────────────────────────────────────────────────────

Net.event("SetDifficulty").OnServerEvent:Connect(function(player, id)
	if type(id) ~= "string" or not Config.DIFFICULTY[id] then return end
	run.difficulty = id
	for _, p in Players:GetPlayers() do
		StatsService.setDifficulty(p, id)
	end
	ToastEvent:FireAllClients(`DIFFICULTY: {string.upper(id)}`, "info")
	pushRunState()
end)

Net.event("StartRun").OnServerEvent:Connect(function(player, mode, options)
	if type(mode) ~= "string" then return end
	local opts = if type(options) == "table" then options else {}
	local seed = if type(opts.seed) == "number" then math.floor(opts.seed) else nil
	local difficulty = if type(opts.difficulty) == "string" then opts.difficulty else nil
	startRun(seed, difficulty, mode == "sandbox")
end)

Net.event("UseItem").OnServerEvent:Connect(function(player, which)
	if type(which) == "number" then
		local id = InventoryService.quickItem(player, which)
		if id then useItem(player, id) end
	elseif type(which) == "string" then
		useItem(player, which)
	end
end)

Net.event("AssignQuick").OnServerEvent:Connect(function(player, slot, id)
	if type(slot) ~= "number" then return end
	InventoryService.assignQuick(player, math.floor(slot), if type(id) == "string" then id else nil)
end)

Net.event("DropItem").OnServerEvent:Connect(function(player, id, qty)
	if type(id) ~= "string" or type(qty) ~= "number" then return end
	InventoryService.take(player, id, math.max(1, math.floor(qty)))
end)

Net.event("Flashlight").OnServerEvent:Connect(function(player, on)
	local s = StatsService.get(player)
	if not s then return end
	if on and s.battery <= 0 then return end
	s.flashlight = on == true
	StatsService.push(player)
end)

Net.event("Sprint").OnServerEvent:Connect(function(player, on)
	local s = StatsService.get(player)
	if s then s.sprinting = on == true end
end)

Net.event("Crouch").OnServerEvent:Connect(function(player, on)
	local s = StatsService.get(player)
	if s then s.crouched = on == true end
end)

Net.event("Revive").OnServerEvent:Connect(function(player, target)
	if typeof(target) ~= "Instance" or not target:IsA("Player") then return end
	local mine = player.Character and player.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local theirs = target.Character and target.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not mine or not theirs then return end
	if (mine.Position - theirs.Position).Magnitude > 12 then return end
	StatsService.revive(target, player)
end)

Net.event("Chat").OnServerEvent:Connect(function(player, text)
	if type(text) ~= "string" then return end
	local clean = string.sub(text, 1, 140)
	if #clean == 0 then return end
	-- Chat is relayed, not filtered here; Roblox filters it downstream.
	ToastEvent:FireAllClients(`{player.DisplayName}: {clean}`, "info")
end)

Net.func("GetRunState").OnServerInvoke = function()
	return {
		seed = run.seed,
		biome = run.biomeId,
		biomeName = run.biome and run.biome.name or "",
		difficulty = run.difficulty,
		depth = ProgressionService.depth(),
		order = ProgressionService.order(),
		difficulties = Config.DIFFICULTY_ORDER,
		sandbox = run.sandbox,
	}
end

--- Everything the client needs to render its menus without hard-coding data.
Net.func("GetCatalogueData").OnServerInvoke = function()
	return {
		items = Items.ITEMS,
		weapons = Items.WEAPONS,
		ammo = Items.AMMO,
		attachments = Attachments.BY_SLOT,
		slots = Attachments.SLOTS,
		slotLabels = Attachments.SLOT_LABEL,
		upgrades = Upgrades.TRACKS,
		mods = Mods.ALL,
		modGroups = Mods.GROUPS,
		modOptions = SandboxService.options(),
		tutorial = Mods.TUTORIAL,
		biomes = Biomes.ALL,
	}
end

-- ── The loop ───────────────────────────────────────────────────────────────

local squadAcc = 0

RunService.Heartbeat:Connect(function(dt)
	if run.building then return end

	for _, p in Players:GetPlayers() do
		StatsService.step(p, dt)

		local char = p.Character
		local hum = char and char:FindFirstChildOfClass("Humanoid")
		local s = StatsService.get(p)
		if hum and s then
			local base = Config.WALK_SPEED
			if s.crouched then
				base = Config.CROUCH_SPEED
			elseif s.sprinting and s.stamina > 0 then
				base = Config.SPRINT_SPEED
			end
			local biomeMove = run.biome and run.biome.physics.moveMul or 1
			hum.WalkSpeed = base
				* StatsService.speedMultiplier(p)
				* InventoryService.encumbrance(p)
				* biomeMove
			local biomeJump = run.biome and run.biome.physics.jumpMul or 1
			hum.JumpPower = Config.JUMP_POWER * biomeJump * (SandboxService.get("jump") or 1)
		end
	end

	WeaponService.step(dt)
	EnemyService.step(dt)
	BossService.step(dt)
	LootService.step(dt)
	ProgressionService.step(dt)
	ObjectiveService.step(dt)
	HorrorDirector.step(dt)
	SandboxService.step(dt)
	SaveService.step(dt, run.seed, ProgressionService.depth())

	for _, p in Players:GetPlayers() do
		LootService.checkDiscovery(p)
	end

	squadAcc += dt
	if squadAcc >= 0.4 then
		squadAcc = 0
		SquadEvent:FireAllClients(StatsService.squadSnapshot())
	end
end)

task.spawn(function()
	startRun(nil, Config.DEFAULT_DIFFICULTY, false)
end)

print(`[Blackroot] server {Config.VERSION} up`)
