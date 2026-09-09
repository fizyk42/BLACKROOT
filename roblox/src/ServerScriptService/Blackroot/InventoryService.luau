--!strict
--[[
	InventoryService — a real bag, from scripts/systems/InventorySystem.js.

	Stacks, weight, quick slots, an equipped weapon with its own magazine, and
	per-weapon attachment and upgrade state. Weight matters: past the carry
	limit you slow down, which is the whole reason a Trauma Kit at 0.9 kg is a
	decision and a Field Bandage at 0.08 kg is not.

	Ammunition is not tracked per weapon. It is an item in the bag like
	anything else, so the reserve for the M-9 and the Vector-9 is the same pile
	of 9mm — same as the WebGL build, and the reason picking up an SMG with a
	full pistol reserve feels like a windfall.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Items = require(Shared:WaitForChild("Items"))
local Attachments = require(Shared:WaitForChild("Attachments"))
local Upgrades = require(Shared:WaitForChild("Upgrades"))
local Forge = require(Shared:WaitForChild("Forge"))
local Net = require(Shared:WaitForChild("Net"))

local InventoryService = {}

export type Stack = { id: string, qty: number }
export type WeaponState = {
	id: string,
	mag: number,
	fit: { [string]: string },
	levels: { [string]: number },
	camoSeed: number?,
	forgeSeed: number?,
}

export type Bag = {
	stacks: { Stack },
	weapons: { [string]: WeaponState },   -- per weapon id
	equipped: string?,
	quick: { string? },                    -- five slots of item ids
	reloading: boolean,
	reloadEnds: number,
	points: number,
	spent: { [string]: number },
	salvage: number,
	battery: number,
}

local bags: { [Player]: Bag } = {}
local InvEvent: RemoteEvent

function InventoryService.init()
	InvEvent = Net.event("Inventory")
end

-- ── Bag maths ──────────────────────────────────────────────────────────────

local function defFor(id: string): any
	return Items.get(id)
end

function InventoryService.weight(player: Player): number
	local bag = bags[player]
	if not bag then return 0 end
	local total = 0
	for _, s in bag.stacks do
		local def = defFor(s.id)
		if def then total += (def.weight or 0) * s.qty end
	end
	return total
end

--- 1.0 at or under the limit, falling to 0.55 when badly overloaded.
function InventoryService.encumbrance(player: Player): number
	local w = InventoryService.weight(player)
	if w <= Config.CARRY_LIMIT then return 1 end
	local over = (w - Config.CARRY_LIMIT) / Config.CARRY_LIMIT
	return math.max(0.55, 1 - over * 0.5)
end

function InventoryService.count(player: Player, id: string): number
	local bag = bags[player]
	if not bag then return 0 end
	local n = 0
	for _, s in bag.stacks do
		if s.id == id then n += s.qty end
	end
	return n
end

--- Add items, splitting across stacks at the item's stack size.
function InventoryService.add(player: Player, id: string, qty: number): number
	local bag = bags[player]
	local def = defFor(id)
	if not bag or not def or qty <= 0 then return 0 end

	local stackSize = def.stack or 1
	local left = qty

	for _, s in bag.stacks do
		if s.id == id and s.qty < stackSize then
			local room = stackSize - s.qty
			local take = math.min(room, left)
			s.qty += take
			left -= take
			if left <= 0 then break end
		end
	end
	while left > 0 do
		local take = math.min(stackSize, left)
		table.insert(bag.stacks, { id = id, qty = take })
		left -= take
	end

	-- A weapon carries its own state the first time it is picked up.
	if Items.isWeapon(id) and not bag.weapons[id] then
		local w = Items.WEAPONS[id]
		bag.weapons[id] = {
			id = id,
			mag = if w.kind == "gun" then w.mag else 0,
			fit = Attachments.defaultLoadout(),
			levels = {},
		}
	end

	InventoryService.push(player)
	return qty - left
end

--- Remove items. Returns false and changes nothing if there are not enough.
function InventoryService.take(player: Player, id: string, qty: number): boolean
	local bag = bags[player]
	if not bag or qty <= 0 then return false end
	if InventoryService.count(player, id) < qty then return false end

	local left = qty
	for i = #bag.stacks, 1, -1 do
		local s = bag.stacks[i]
		if s.id ~= id then continue end
		local take = math.min(s.qty, left)
		s.qty -= take
		left -= take
		if s.qty <= 0 then table.remove(bag.stacks, i) end
		if left <= 0 then break end
	end

	InventoryService.push(player)
	return true
end

-- ── Weapons ────────────────────────────────────────────────────────────────

function InventoryService.equipped(player: Player): (WeaponState?, any)
	local bag = bags[player]
	if not bag or not bag.equipped then return nil, nil end
	local state = bag.weapons[bag.equipped]
	if not state then return nil, nil end
	return state, InventoryService.statsFor(player, state)
end

--- The full stat line for a weapon: base, forge roll, upgrades, attachments.
--- Order matters and matches the WebGL build; attachments come last so an
--- extended magazine is measured against the base, not the upgraded, capacity.
function InventoryService.statsFor(player: Player, state: WeaponState): any
	local base: any
	if state.forgeSeed then
		base = Forge.roll(state.forgeSeed)
	else
		base = Items.WEAPONS[state.id]
	end
	if not base then return nil end

	local stats = table.clone(base)
	stats = Upgrades.apply(base, stats, state.levels)
	stats = Attachments.apply(base, stats, state.fit)
	return stats
end

function InventoryService.equip(player: Player, id: string): boolean
	local bag = bags[player]
	if not bag then return false end
	if not bag.weapons[id] then return false end
	if InventoryService.count(player, id) <= 0 then return false end
	bag.equipped = id
	bag.reloading = false
	InventoryService.push(player)
	return true
end

--- Cycle to the next weapon in the bag, the mouse-wheel behaviour.
function InventoryService.cycle(player: Player, direction: number): boolean
	local bag = bags[player]
	if not bag then return false end

	local owned = {}
	for _, s in bag.stacks do
		if Items.isWeapon(s.id) then
			local seen = false
			for _, have in owned do
				if have == s.id then seen = true; break end
			end
			if not seen then table.insert(owned, s.id) end
		end
	end
	if #owned == 0 then return false end
	table.sort(owned)

	local at = 1
	for i, id in owned do
		if id == bag.equipped then at = i; break end
	end
	local next = ((at - 1 + direction) % #owned) + 1
	return InventoryService.equip(player, owned[next])
end

function InventoryService.reserve(player: Player): number
	local state = InventoryService.equipped(player)
	if not state then return 0 end
	local base = if state.forgeSeed then Forge.roll(state.forgeSeed) else Items.WEAPONS[state.id]
	if not base or base.kind ~= "gun" then return 0 end
	return InventoryService.count(player, base.ammo)
end

function InventoryService.spendRound(player: Player): boolean
	local bag = bags[player]
	local state = InventoryService.equipped(player)
	if not bag or not state or state.mag <= 0 then return false end
	state.mag -= 1
	InventoryService.push(player)
	return true
end

--[[
	Reload. Two shapes, both from the WebGL build:
	  * a magazine weapon swaps the whole thing in `reload` seconds
	  * a shell weapon (`shellReload`) feeds one at a time, so it can be
	    interrupted by firing and a partial reload is still worth doing
]]
function InventoryService.reload(player: Player): boolean
	local bag = bags[player]
	local state, stats = InventoryService.equipped(player)
	if not bag or not state or not stats or stats.kind ~= "gun" then return false end
	if bag.reloading then return false end

	local need = stats.mag - state.mag
	if need <= 0 then return false end
	local have = InventoryService.count(player, stats.ammo)
	if have <= 0 then return false end

	bag.reloading = true
	bag.reloadEnds = os.clock() + stats.reload
	InventoryService.push(player)

	task.delay(stats.reload, function()
		local b = bags[player]
		local s = b and b.weapons[b.equipped or ""]
		if not b or not s or s ~= state then return end
		if not b.reloading then return end

		if stats.shellReload then
			-- One shell, then the caller may reload again.
			if InventoryService.take(player, stats.ammo, 1) then
				s.mag += 1
			end
			b.reloading = false
			InventoryService.push(player)
			if s.mag < stats.mag and InventoryService.count(player, stats.ammo) > 0 then
				InventoryService.reload(player)
			end
			return
		end

		local take = math.min(stats.mag - s.mag, InventoryService.count(player, stats.ammo))
		if take > 0 and InventoryService.take(player, stats.ammo, take) then
			s.mag += take
		end
		b.reloading = false
		InventoryService.push(player)
	end)

	return true
end

function InventoryService.cancelReload(player: Player)
	local bag = bags[player]
	if bag then bag.reloading = false end
end

-- ── Attachments and upgrades ───────────────────────────────────────────────

function InventoryService.fit(player: Player, slot: string, attachmentId: string): boolean
	local bag = bags[player]
	local state = InventoryService.equipped(player)
	if not bag or not state then return false end
	if not Attachments.find(slot, attachmentId) then return false end
	state.fit[slot] = attachmentId
	InventoryService.push(player)
	return true
end

function InventoryService.upgrade(player: Player, trackId: string): boolean
	local bag = bags[player]
	local state = InventoryService.equipped(player)
	if not bag or not state then return false end

	local track = Upgrades.track(trackId)
	if not track then return false end

	local level = state.levels[trackId] or 0
	if level >= track.max then return false end

	local cost = Upgrades.cost(trackId, level)
	if bag.points < cost then return false end

	bag.points -= cost
	state.levels[trackId] = level + 1
	bag.spent[trackId] = (bag.spent[trackId] or 0) + cost
	InventoryService.push(player)
	return true
end

function InventoryService.grantPoints(player: Player, n: number)
	local bag = bags[player]
	if not bag then return end
	bag.points += n
	InventoryService.push(player)
end

-- ── Quick slots ────────────────────────────────────────────────────────────

function InventoryService.assignQuick(player: Player, slot: number, id: string?)
	local bag = bags[player]
	if not bag or slot < 1 or slot > Config.QUICK_SLOTS then return end
	bag.quick[slot] = id
	InventoryService.push(player)
end

function InventoryService.quickItem(player: Player, slot: number): string?
	local bag = bags[player]
	if not bag then return nil end
	return bag.quick[slot]
end

-- ── Lifecycle ──────────────────────────────────────────────────────────────

function InventoryService.reset(player: Player, kitted: boolean?): Bag
	local bag: Bag = {
		stacks = {},
		weapons = {},
		equipped = nil,
		quick = { nil, nil, nil, nil, nil },
		reloading = false,
		reloadEnds = 0,
		points = Upgrades.GRANTED_POINTS,
		spent = {},
		salvage = 0,
		battery = 100,
	}
	bags[player] = bag

	for _, entry in Items.startingLoadout() do
		InventoryService.add(player, entry.id, entry.qty)
	end

	if kitted then
		-- Veteran's Cache: the rifle, spare plates, and two more kits.
		InventoryService.add(player, "carbine", 1)
		InventoryService.add(player, "ammo556", 90)
		InventoryService.add(player, "medkit", 2)
	end

	InventoryService.equip(player, "pistol9")
	bag.quick[1] = "bandage"
	bag.quick[2] = "medkit"
	bag.quick[3] = "berries"
	bag.quick[4] = "water"
	bag.quick[5] = "battery"

	InventoryService.push(player)
	return bag
end

function InventoryService.get(player: Player): Bag?
	return bags[player]
end

function InventoryService.clear(player: Player)
	bags[player] = nil
end

--- Add ammunition for whatever is held, plus a full magazine. Used by loot,
--- by the ammunition drop, and by the sandbox's infinite-ammo mod.
function InventoryService.topUp(player: Player, rounds: number)
	local state, stats = InventoryService.equipped(player)
	if not state or not stats or stats.kind ~= "gun" then return end
	InventoryService.add(player, stats.ammo, rounds)
	state.mag = stats.mag
	InventoryService.push(player)
end

function InventoryService.push(player: Player)
	local bag = bags[player]
	if not bag or not InvEvent then return end

	local state, stats = InventoryService.equipped(player)
	InvEvent:FireClient(player, {
		stacks = bag.stacks,
		equipped = bag.equipped,
		weaponName = stats and stats.name or "",
		kind = stats and stats.kind or "",
		mag = state and state.mag or 0,
		magSize = stats and stats.mag or 0,
		reserve = InventoryService.reserve(player),
		reloading = bag.reloading,
		quick = bag.quick,
		weight = InventoryService.weight(player),
		carryLimit = Config.CARRY_LIMIT,
		points = bag.points,
		levels = state and state.levels or {},
		fit = state and state.fit or {},
		salvage = bag.salvage,
		battery = bag.battery,
	})
end

Players.PlayerRemoving:Connect(function(p) InventoryService.clear(p) end)

return InventoryService
