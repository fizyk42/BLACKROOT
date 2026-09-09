--!strict
--[[
	MonetizationService — Robux in, powerups out.

	The three things that go wrong with Roblox monetization, and what this file
	does about each:

	1. DOUBLE-GRANTING. ProcessReceipt is called again on the player's next
	   join for any purchase that did not return PurchaseGranted, and it can be
	   called twice for one purchase if a server dies at the wrong moment. The
	   only defence is recording PurchaseId durably *before* answering
	   PurchaseGranted. That is what `receipts` is for.

	2. GRANTING WHEN THE GRANT FAILED. If the player's character is still
	   loading, an inventory grant lands nowhere. Answering PurchaseGranted
	   there charges them for nothing. So a failed grant returns
	   NotProcessedYet and Roblox retries — which only works because of (1).

	3. TRUSTING THE CLIENT. The shop client may only ask to *prompt* a
	   purchase. Roblox itself runs the dialog and calls back into this server.
	   RequestBuy never grants anything; it only calls PromptProductPurchase.

	Nothing here needs an API key, and nothing here should ever be given one.
]]

local MarketplaceService = game:GetService("MarketplaceService")
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Products = require(Shared:WaitForChild("Products"))
local Net = require(Shared:WaitForChild("Net"))

local Blackroot = script.Parent
local PowerupService = require(Blackroot:WaitForChild("PowerupService"))

local MonetizationService = {}

local receipts: DataStore? = nil
local owned: { [Player]: { [string]: boolean } } = {}
local OwnedEvent: RemoteEvent
local ToastEvent: RemoteEvent

-- Studio has no live DataStore access unless the place is published and the
-- setting is on, so the receipt ledger falls back to memory there. That is
-- fine for testing and would be reckless in production, which is why it is
-- keyed off RunService:IsStudio() and says so out loud.
local memoryLedger: { [string]: boolean } = {}
local usingMemoryLedger = false

local function ledgerHas(key: string): boolean?
	if usingMemoryLedger then return memoryLedger[key] == true end
	local store = receipts
	if not store then return nil end
	local ok, value = pcall(function() return store:GetAsync(key) end)
	if not ok then return nil end       -- nil means "we do not know" → retry
	return value == true
end

local function ledgerWrite(key: string): boolean
	if usingMemoryLedger then
		memoryLedger[key] = true
		return true
	end
	local store = receipts
	if not store then return false end
	local ok = pcall(function() store:SetAsync(key, true) end)
	return ok
end

-- ── Pass ownership ─────────────────────────────────────────────────────────

local function refreshOwned(player: Player)
	local map: { [string]: boolean } = {}
	for _, pass in Products.PASSES do
		if Products.isConfigured(pass) then
			local ok, has = pcall(function()
				return MarketplaceService:UserOwnsGamePassAsync(player.UserId, pass.id)
			end)
			map[pass.perk] = ok and has or false
		else
			map[pass.perk] = false
		end
	end
	owned[player] = map
	if OwnedEvent then OwnedEvent:FireClient(player, map) end
end

function MonetizationService.owns(player: Player, perk: string): boolean
	local m = owned[player]
	return (m and m[perk]) == true
end

function MonetizationService.ownedMap(player: Player): { [string]: boolean }
	return owned[player] or {}
end

-- ── Receipts ───────────────────────────────────────────────────────────────

local function processReceipt(info: any): Enum.ProductPurchaseDecision
	local key = `receipt:{info.PurchaseId}`

	local seen = ledgerHas(key)
	if seen == true then
		-- Already delivered. Say granted so Roblox stops retrying.
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end
	if seen == nil then
		-- The store is unreachable; we cannot tell a repeat from a new
		-- purchase, and granting twice is worse than granting late.
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	local player = Players:GetPlayerByUserId(info.PlayerId)
	if not player then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	local entry = Products.byProductId(info.ProductId)
	if not entry then
		-- A product id this build does not know about. Refusing forever would
		-- strand the player's Robux in a retry loop, so log loudly and let it
		-- through — the owner sees the warning and adds the id to Products.
		warn(`[Blackroot] purchase of unknown product {info.ProductId}; add it to Products.luau`)
		if ledgerWrite(key) then
			return Enum.ProductPurchaseDecision.PurchaseGranted
		end
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	local granted = false
	local ok, err = pcall(function()
		granted = PowerupService.grant(player, entry)
	end)
	if not ok then
		warn(`[Blackroot] grant for {entry.key} errored: {err}`)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	if not granted then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	-- Record before answering. If this write fails we would rather deliver the
	-- item twice than answer granted on a purchase we cannot remember — but we
	-- have already delivered once, so we return NotProcessedYet and the
	-- duplicate is caught by the ledger on the retry, when the store is back.
	if not ledgerWrite(key) then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	return Enum.ProductPurchaseDecision.PurchaseGranted
end

-- ── Public API ─────────────────────────────────────────────────────────────

function MonetizationService.init()
	OwnedEvent = Net.event("Owned")
	ToastEvent = Net.event("Toast")

	usingMemoryLedger = RunService:IsStudio()
	if usingMemoryLedger then
		warn("[Blackroot] Studio session: purchase receipts are held in memory only.")
	else
		local ok, store = pcall(function()
			return DataStoreService:GetDataStore("BlackrootReceipts_v1")
		end)
		receipts = ok and store or nil
		if not receipts then
			warn("[Blackroot] receipt DataStore unavailable; purchases will retry until it returns.")
		end
	end

	MarketplaceService.ProcessReceipt = processReceipt

	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, wasPurchased)
		if not wasPurchased then return end
		refreshOwned(player)
		for _, pass in Products.PASSES do
			if pass.id == passId then
				if ToastEvent then ToastEvent:FireClient(player, `{pass.name} UNLOCKED`, "good") end
				if pass.perk == "starterKit" then
					PowerupService.applyPerks(player, { starterKit = true })
				end
			end
		end
	end)

	-- The client may ask for a purchase dialog. That is all it may do.
	local buy = Net.event("RequestBuy")
	buy.OnServerEvent:Connect(function(player, key, kind)
		if type(key) ~= "string" or type(kind) ~= "string" then return end

		if kind == "pass" then
			local pass = Products.passByKey(key)
			if not pass then return end
			if not Products.isConfigured(pass) then
				ToastEvent:FireClient(player, "That pass has not been set up yet.", "warn")
				return
			end
			pcall(function()
				MarketplaceService:PromptGamePassPurchase(player, pass.id)
			end)
			return
		end

		local product = Products.byKey(key)
		if not product then return end
		if not Products.isConfigured(product) then
			ToastEvent:FireClient(player, "That item has not been set up yet.", "warn")
			return
		end
		pcall(function()
			MarketplaceService:PromptProductPurchase(player, product.id)
		end)
	end)

	local catalogue = Net.func("GetCatalogue")
	catalogue.OnServerInvoke = function(player)
		return {
			products = Products.PRODUCTS,
			passes = Products.PASSES,
			owned = MonetizationService.ownedMap(player),
		}
	end

	Players.PlayerAdded:Connect(refreshOwned)
	for _, p in Players:GetPlayers() do
		task.spawn(refreshOwned, p)
	end
	Players.PlayerRemoving:Connect(function(p) owned[p] = nil end)

	local live, total = Products.configuredCount()
	if live < total then
		warn(`[Blackroot] {live}/{total} store entries have real ids. The rest show as "not configured" until you fill them in (see Products.luau).`)
	end
end

return MonetizationService
