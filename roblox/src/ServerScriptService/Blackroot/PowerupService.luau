--!strict
--[[
	PowerupService — what a purchase actually *does*.

	Kept separate from MonetizationService on purpose. Nothing in here knows
	about Robux, receipts or product ids; every effect can also be triggered by
	finding the same thing in the world, which is what keeps the shop from
	being the only way to get any of it.

	Every grant returns true only when it was fully applied. MonetizationService
	turns a false into Enum.ProductPurchaseDecision.NotProcessedYet, so Roblox
	retries the purchase on the player's next join instead of charging them for
	nothing.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))

local Blackroot = script.Parent
local StatsService = require(Blackroot:WaitForChild("StatsService"))
local InventoryService = require(Blackroot:WaitForChild("InventoryService"))

local PowerupService = {}

local ToastEvent: RemoteEvent
local perRun: { [Player]: { [string]: number } } = {}
local hooks: { [string]: (Player) -> boolean } = {}

function PowerupService.init()
	ToastEvent = Net.event("Toast")
end

--- ProgressionService registers "flare" here so the powerup layer does not
--- have to reach into the run system directly.
function PowerupService.registerHook(name: string, fn: (Player) -> boolean)
	hooks[name] = fn
end

function PowerupService.resetRun(player: Player)
	perRun[player] = {}
end

function PowerupService.clear(player: Player)
	perRun[player] = nil
end

local function usedThisRun(player: Player, key: string): number
	local t = perRun[player]
	if not t then t = {}; perRun[player] = t end
	return t[key] or 0
end

local function noteUse(player: Player, key: string)
	local t = perRun[player]
	if not t then t = {}; perRun[player] = t end
	t[key] = (t[key] or 0) + 1
end

local function toast(player: Player, text: string, tone: string?)
	if ToastEvent then ToastEvent:FireClient(player, text, tone or "good") end
end

-- ── The grants ─────────────────────────────────────────────────────────────

local grants: { [string]: (Player, number) -> boolean } = {}

grants.medkit = function(player, amount)
	if not InventoryService.get(player) then return false end
	InventoryService.add(player, "medkit", amount)
	toast(player, `TRAUMA KIT ×{amount}`)
	return true
end

grants.ammo = function(player, amount)
	if not InventoryService.get(player) then return false end
	InventoryService.topUp(player, amount)
	toast(player, `+{amount} ROUNDS`)
	return true
end

grants.adrenaline = function(player, seconds)
	if not StatsService.get(player) then return false end
	StatsService.adrenaline(player, seconds)
	toast(player, "ADRENALINE — ninety seconds")
	return true
end

grants.revive = function(player, amount)
	if not StatsService.get(player) then return false end
	StatsService.addRevive(player, amount)
	toast(player, "SECOND WIND READY")
	return true
end

grants.flare = function(player, _amount)
	local hook = hooks.flare
	if not hook then return false end
	if not hook(player) then return false end
	toast(player, "EXTRACTION FLARE — the rift is coming to you")
	return true
end

grants.bundle = function(player, _amount)
	-- Every part must land, or the whole purchase is retried. The two that can
	-- fail cheaply go first.
	if not (StatsService.get(player) and InventoryService.get(player)) then return false end
	InventoryService.add(player, "medkit", 3)
	InventoryService.topUp(player, 120)
	StatsService.adrenaline(player, 90)
	InventoryService.add(player, "flare", 1)
	toast(player, "FULL RESUPPLY")
	return true
end

grants.starterKit = function(player, _amount)
	local bag = InventoryService.get(player)
	if not bag then return false end
	InventoryService.add(player, "carbine", 1)
	InventoryService.add(player, "ammo556", 90)
	InventoryService.add(player, "medkit", 2)
	local s = StatsService.get(player)
	if s then
		s.maxHealth = 125
		StatsService.heal(player, 25)
	end
	return true
end

--[[
	Apply one catalogue entry.

	`limitPerRun` of 1 means Roblox has already taken the Robux, so refusing
	here would be theft. Instead the grant still lands and the *effect* is
	deferred: a second flare in one run is banked in the inventory and can be
	used on the next.
]]
function PowerupService.grant(player: Player, entry: { grant: string, amount: number, limitPerRun: number, key: string, name: string }): boolean
	local fn = grants[entry.grant]
	if not fn then
		warn(`[Blackroot] no grant handler named "{entry.grant}"`)
		return false
	end

	if entry.limitPerRun > 0 and usedThisRun(player, entry.key) >= entry.limitPerRun then
		if entry.grant == "flare" then
			InventoryService.add(player, "flare", 1)
			toast(player, "FLARE BANKED for your next run")
			return true
		elseif entry.grant == "revive" then
			StatsService.addRevive(player, 1)
			toast(player, "SECOND WIND BANKED")
			return true
		end
	end

	local ok = fn(player, entry.amount)
	if ok then noteUse(player, entry.key) end
	return ok
end

--- Perks are the pass side: applied once when a run starts.
function PowerupService.applyPerks(player: Player, owned: { [string]: boolean })
	if owned.starterKit then
		grants.starterKit(player, 1)
	end
	-- lootHighlight, permanentBeacon and doubleSalvage are read where they
	-- matter rather than applied here, so nothing has to be undone on death.
end

PowerupService.grants = grants

return PowerupService
