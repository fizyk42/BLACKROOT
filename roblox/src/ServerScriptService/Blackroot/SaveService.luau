--!strict
--[[
	SaveService — persistence, from scripts/systems/SaveManager.js.

	The WebGL build saves one slot to localStorage and does not serialise the
	world: the world is regenerated from its seed, so a save is only the
	mutable state. Same principle here, which keeps a save small enough to sit
	comfortably inside a DataStore entry.

	What persists between sessions is deliberately narrow: your seed, your
	depth, your difficulty, your bag, your upgrade points, and the totals you
	have earned. Not creature positions, not which container you opened, not
	the boss's health — a run you walk away from is a run you restart, and
	pretending otherwise would mean saving several megabytes to spare somebody
	four minutes.
]]

local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local Blackroot = script.Parent
local StatsService = require(Blackroot:WaitForChild("StatsService"))
local InventoryService = require(Blackroot:WaitForChild("InventoryService"))

local SaveService = {}

local store: DataStore? = nil
local memory: { [number]: any } = {}
local useMemory = false
local lastSave: { [Player]: number } = {}

local SAVE_INTERVAL = 45

function SaveService.init()
	useMemory = RunService:IsStudio()
	if useMemory then
		warn("[Blackroot] Studio session: saves are held in memory only.")
		return
	end
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore("BlackrootSave_v1")
	end)
	store = if ok then result else nil
	if not store then
		warn("[Blackroot] save DataStore unavailable; progress will not persist this session.")
	end
end

local function key(player: Player): string
	return `player_{player.UserId}`
end

-- ── Shape ──────────────────────────────────────────────────────────────────

function SaveService.snapshot(player: Player, runSeed: number, depth: number): any?
	local s = StatsService.get(player)
	local bag = InventoryService.get(player)
	if not s or not bag then return nil end

	-- Weapon state is stored by id, not by object, so a save survives a
	-- rebalance that changes what a weapon's stats are.
	local weapons = {}
	for id, w in bag.weapons do
		weapons[id] = {
			mag = w.mag,
			fit = w.fit,
			levels = w.levels,
			forgeSeed = w.forgeSeed,
			camoSeed = w.camoSeed,
		}
	end

	return {
		version = 1,
		savedAt = os.time(),
		seed = runSeed,
		depth = depth,
		difficulty = s.difficulty,
		health = s.health,
		stamina = s.stamina,
		hunger = s.hunger,
		thirst = s.thirst,
		battery = s.battery,
		kills = s.kills,
		itemsLooted = s.itemsLooted,
		landmarksFound = s.landmarksFound,
		timeAlive = s.timeAlive,
		stacks = bag.stacks,
		weapons = weapons,
		equipped = bag.equipped,
		quick = bag.quick,
		points = bag.points,
		salvage = bag.salvage,
	}
end

function SaveService.save(player: Player, runSeed: number, depth: number): boolean
	local data = SaveService.snapshot(player, runSeed, depth)
	if not data then return false end

	if useMemory then
		memory[player.UserId] = data
		return true
	end
	if not store then return false end

	local ok = pcall(function()
		(store :: DataStore):SetAsync(key(player), data)
	end)
	return ok
end

function SaveService.load(player: Player): any?
	if useMemory then
		return memory[player.UserId]
	end
	if not store then return nil end
	local ok, data = pcall(function()
		return (store :: DataStore):GetAsync(key(player))
	end)
	if not ok then return nil end
	return data
end

--- Apply a loaded save onto a fresh player. Returns the seed and depth it
--- wants the run rebuilt at, or nil to start clean.
function SaveService.restore(player: Player): (number?, number?)
	local data = SaveService.load(player)
	if not data or data.version ~= 1 then return nil, nil end

	local s = StatsService.get(player)
	local bag = InventoryService.get(player)
	if not s or not bag then return nil, nil end

	s.difficulty = data.difficulty or Config.DEFAULT_DIFFICULTY
	s.health = math.clamp(data.health or s.maxHealth, 1, s.maxHealth)
	s.stamina = data.stamina or s.maxStamina
	s.hunger = data.hunger or 100
	s.thirst = data.thirst or 100
	s.battery = data.battery or 100
	s.kills = data.kills or 0
	s.itemsLooted = data.itemsLooted or 0
	s.landmarksFound = data.landmarksFound or 0
	s.timeAlive = data.timeAlive or 0

	bag.stacks = data.stacks or bag.stacks
	bag.quick = data.quick or bag.quick
	bag.points = data.points or bag.points
	bag.salvage = data.salvage or 0

	if data.weapons then
		for id, w in data.weapons do
			bag.weapons[id] = {
				id = id,
				mag = w.mag or 0,
				fit = w.fit or {},
				levels = w.levels or {},
				forgeSeed = w.forgeSeed,
				camoSeed = w.camoSeed,
			}
		end
	end
	if data.equipped and bag.weapons[data.equipped] then
		bag.equipped = data.equipped
	end

	StatsService.push(player)
	InventoryService.push(player)
	return data.seed, data.depth
end

function SaveService.clear(player: Player)
	if useMemory then
		memory[player.UserId] = nil
		return
	end
	if not store then return end
	pcall(function() (store :: DataStore):RemoveAsync(key(player)) end)
end

--- Autosave, on the same two-minute-ish cadence as the WebGL build's.
function SaveService.step(dt: number, runSeed: number, depth: number)
	local now = os.clock()
	for _, player in Players:GetPlayers() do
		if now - (lastSave[player] or 0) < SAVE_INTERVAL then continue end
		lastSave[player] = now
		task.spawn(SaveService.save, player, runSeed, depth)
	end
end

function SaveService.onLeave(player: Player, runSeed: number, depth: number)
	SaveService.save(player, runSeed, depth)
	lastSave[player] = nil
end

SaveService.SAVE_INTERVAL = SAVE_INTERVAL

return SaveService
