--!strict
--[[
	WeaponService — server-authoritative ballistics, from
	scripts/systems/WeaponSystem.js.

	Guns and melee both live here because both answer the same question: what
	did that swing or that round actually hit, and how much did it hurt?

	Everything the client sends is a request. The client says where it was
	aiming; the server decides whether the magazine had a round in it, whether
	enough time has passed, whether the claimed muzzle is plausible, where the
	ray goes after spread, and what it hits. A client that lies about its
	origin gets the shot re-rooted to the server's position rather than
	rejected — the same clamp-don't-discard reasoning as the movement check in
	the WebGL netcode, because rejecting outright punishes lag and the clamp
	punishes only the lie.

	Spread is the interesting part. `spread` is the hip figure and `adsSpread`
	the aimed one, and the WebGL build blends between them by how far into the
	aim the player is, then adds a bloom term that grows with every shot and
	decays when you stop. Both are here, so a Vector-9 held down still walks
	off target at exactly the rate it does in the browser.
]]

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Items = require(Shared:WaitForChild("Items"))
local Net = require(Shared:WaitForChild("Net"))

local Blackroot = script.Parent
local StatsService = require(Blackroot:WaitForChild("StatsService"))
local InventoryService = require(Blackroot:WaitForChild("InventoryService"))

local WeaponService = {}

local ORIGIN_TOLERANCE = 14
local BLOOM_PER_SHOT = 0.55      -- fraction of base spread added per shot
local BLOOM_DECAY = 3.2          -- per second
local BLOOM_MAX = 4.0

type Shooter = {
	lastShot: number,
	bloom: number,
	ads: number,        -- 0 = hip, 1 = fully aimed
	adsHeld: boolean,
	crouched: boolean,
}

local shooters: { [Player]: Shooter } = {}
local HitEvent: RemoteEvent
local damageHooks: { (Player, Instance, number, boolean, Vector3) -> boolean } = {}

--- Enemy and boss services register here so WeaponService does not have to
--- know what kinds of things can be shot. First hook to claim the hit wins.
function WeaponService.registerDamageHook(fn: (Player, Instance, number, boolean, Vector3) -> boolean)
	table.insert(damageHooks, fn)
end

local function shooterFor(player: Player): Shooter
	local s = shooters[player]
	if not s then
		s = { lastShot = 0, bloom = 0, ads = 0, adsHeld = false, crouched = false }
		shooters[player] = s
	end
	return s
end

-- ── Effects ────────────────────────────────────────────────────────────────

local function tracer(from: Vector3, to: Vector3, colour: Color3?)
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Material = Enum.Material.Neon
	p.Color = colour or Color3.fromRGB(255, 226, 170)
	p.Transparency = 0.35
	local d = to - from
	p.Size = Vector3.new(0.12, 0.12, math.max(d.Magnitude, 0.1))
	p.CFrame = CFrame.lookAt(from + d * 0.5, to)
	p.Parent = Workspace
	task.delay(0.06, function() p:Destroy() end)
end

local function impact(at: Vector3, normal: Vector3)
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.Size = Vector3.new(0.35, 0.35, 0.05)
	p.CFrame = CFrame.lookAt(at + normal * 0.03, at + normal)
	p.Color = Color3.fromRGB(28, 26, 24)
	p.Material = Enum.Material.Slate
	p.Transparency = 0.25
	p.Parent = Workspace
	task.delay(9, function() p:Destroy() end)
end

-- ── Aim maths ──────────────────────────────────────────────────────────────

--[[
	The cone half-angle for the next shot, in radians.

	Blended hip-to-aimed by `ads`, then multiplied by the bloom that every shot
	adds and time takes away. A bipod under a crouched player tightens it
	further, which is the only reason the Folding Bipod exists.
]]
function WeaponService.spreadFor(stats: any, s: Shooter): number
	local base = stats.spread + (stats.adsSpread - stats.spread) * s.ads
	local cone = base * (1 + s.bloom)
	if stats.crouchBonus and s.crouched then
		cone *= 0.7
	end
	return math.max(cone, 0)
end

local function coneDirection(direction: Vector3, cone: number): Vector3
	if cone <= 0 then return direction.Unit end
	local up = math.abs(direction.Y) > 0.99 and Vector3.new(1, 0, 0) or Vector3.new(0, 1, 0)
	local right = direction:Cross(up).Unit
	local trueUp = right:Cross(direction).Unit
	local angle = math.random() * math.pi * 2
	local radius = math.sqrt(math.random()) * cone
	return (direction.Unit + right * (math.cos(angle) * radius) + trueUp * (math.sin(angle) * radius)).Unit
end

-- ── Firing ─────────────────────────────────────────────────────────────────

local function resolveHit(player: Player, result: RaycastResult, stats: any, damage: number)
	local model: Model? = nil
	local node: Instance? = result.Instance
	while node and node ~= Workspace do
		if node:IsA("Model") then
			model = node :: Model
			if node:GetAttribute("BlackrootEntity") or node:FindFirstChildOfClass("Humanoid") then
				break
			end
		end
		node = node.Parent
	end
	if not model then return end

	local headshot = result.Instance.Name == "Head" or result.Instance.Name == "Eye"
	local dealt = damage * (headshot and (stats.headMul or 1) or 1)

	for _, hook in damageHooks do
		if hook(player, model, dealt, headshot, result.Position) then return end
	end
end

function WeaponService.fireGun(player: Player, origin: Vector3, direction: Vector3)
	local pstats = StatsService.get(player)
	if not pstats or pstats.dead then return end

	local state, stats = InventoryService.equipped(player)
	if not state or not stats or stats.kind ~= "gun" then return end

	local s = shooterFor(player)
	local now = os.clock()
	local interval = 1 / math.max(stats.rate, 0.05)
	if now - s.lastShot < interval * 0.92 then return end

	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return end
	if typeof(origin) ~= "Vector3" or typeof(direction) ~= "Vector3" then return end
	if direction.Magnitude < 0.01 then return end

	local muzzle = origin
	local drift = (origin - hrp.Position).Magnitude
	if drift > ORIGIN_TOLERANCE then
		muzzle = hrp.Position + (origin - hrp.Position) * (ORIGIN_TOLERANCE / drift)
	end

	if not InventoryService.spendRound(player) then
		return
	end
	InventoryService.cancelReload(player)
	s.lastShot = now

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { char :: Instance }
	params.IgnoreWater = true

	local damage = stats.damage * StatsService.damageMultiplier(player)
	local cone = WeaponService.spreadFor(stats, s)
	local pellets = stats.pellets or 1
	local range = stats.range

	for _ = 1, pellets do
		local dir = coneDirection(direction, cone) * range
		local result = Workspace:Raycast(muzzle, dir, params)
		local endPoint = result and result.Position or (muzzle + dir)
		tracer(muzzle, endPoint)
		if result then
			impact(result.Position, result.Normal)
			resolveHit(player, result, stats, damage)
		end
	end

	s.bloom = math.min(BLOOM_MAX, s.bloom + BLOOM_PER_SHOT * (stats.recoil or 1) * 0.5)

	-- A bolt-action chambers the next round before it will fire again.
	if stats.boltAction then
		s.lastShot = now + 0.55
	end
end

-- ── Melee ──────────────────────────────────────────────────────────────────

--[[
	A swing is a cone test, not a ray: `arc` is the half-angle in radians and
	`range` the reach, and everything inside both takes the hit. That is why
	the machete at 2.7 m and 0.65 rad clears a crawler pack and the knife at
	2.3 m and 0.55 rad does not.
]]
function WeaponService.swing(player: Player)
	local pstats = StatsService.get(player)
	if not pstats or pstats.dead then return end

	local state, stats = InventoryService.equipped(player)
	if not state or not stats or stats.kind ~= "melee" then return end

	local s = shooterFor(player)
	local now = os.clock()
	if now - s.lastShot < 1 / math.max(stats.rate, 0.05) then return end

	if not StatsService.spendStamina(player, stats.staminaCost or 0) then return end
	s.lastShot = now

	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return end

	local origin = hrp.Position + Vector3.new(0, 1.4, 0)
	local facing = hrp.CFrame.LookVector
	local damage = stats.damage * StatsService.damageMultiplier(player)
	local hitAny = false

	for _, model in Workspace:GetDescendants() do
		if not model:IsA("Model") then continue end
		if not model:GetAttribute("BlackrootEntity") then continue end
		local root = model.PrimaryPart
		if not root then continue end

		local to = root.Position - origin
		local dist = to.Magnitude
		if dist > stats.range then continue end
		if facing:Dot(to.Unit) < math.cos(stats.arc) then continue end

		hitAny = true
		for _, hook in damageHooks do
			if hook(player, model, damage, false, root.Position) then break end
		end
	end

	if HitEvent then HitEvent:FireClient(player, false, false, hitAny) end
end

-- ── Per-frame ──────────────────────────────────────────────────────────────

function WeaponService.step(dt: number)
	for player, s in shooters do
		s.bloom = math.max(0, s.bloom - BLOOM_DECAY * dt)

		local _, stats = InventoryService.equipped(player)
		local adsTime = stats and stats.adsTime or 0.2
		local target = s.adsHeld and 1 or 0
		local rate = dt / math.max(adsTime, 0.06)
		if s.ads < target then
			s.ads = math.min(target, s.ads + rate)
		elseif s.ads > target then
			s.ads = math.max(target, s.ads - rate)
		end
	end
end

function WeaponService.adsFraction(player: Player): number
	return shooterFor(player).ads
end

-- ── Wiring ─────────────────────────────────────────────────────────────────

function WeaponService.init()
	HitEvent = Net.event("Hitmark")

	Net.event("Fire").OnServerEvent:Connect(function(player, origin, direction)
		local _, stats = InventoryService.equipped(player)
		if not stats then return end
		local ok, err = pcall(function()
			if stats.kind == "melee" then
				WeaponService.swing(player)
			else
				WeaponService.fireGun(player, origin, direction)
			end
		end)
		if not ok then warn(`[Blackroot] fire failed: {err}`) end
	end)

	Net.event("Reload").OnServerEvent:Connect(function(player)
		InventoryService.reload(player)
	end)

	Net.event("Aim").OnServerEvent:Connect(function(player, held, crouched)
		local s = shooterFor(player)
		s.adsHeld = held == true
		s.crouched = crouched == true
	end)

	Net.event("Equip").OnServerEvent:Connect(function(player, id)
		if type(id) == "number" then
			InventoryService.cycle(player, if id < 0 then -1 else 1)
		elseif type(id) == "string" then
			InventoryService.equip(player, id)
		end
	end)

	Net.event("Fit").OnServerEvent:Connect(function(player, slot, attachmentId)
		if type(slot) ~= "string" or type(attachmentId) ~= "string" then return end
		InventoryService.fit(player, slot, attachmentId)
	end)

	Net.event("Upgrade").OnServerEvent:Connect(function(player, trackId)
		if type(trackId) ~= "string" then return end
		InventoryService.upgrade(player, trackId)
	end)

	Players.PlayerRemoving:Connect(function(p) shooters[p] = nil end)
end

--- Report a kill so the hitmarker reads right. Called by whatever took the hit.
function WeaponService.reportKill(player: Player, headshot: boolean)
	if HitEvent then HitEvent:FireClient(player, true, headshot, true) end
end

function WeaponService.reportHit(player: Player, headshot: boolean)
	if HitEvent then HitEvent:FireClient(player, false, headshot, true) end
end

WeaponService.ORIGIN_TOLERANCE = ORIGIN_TOLERANCE
WeaponService.BLOOM_PER_SHOT = BLOOM_PER_SHOT
WeaponService.BLOOM_DECAY = BLOOM_DECAY

return WeaponService
