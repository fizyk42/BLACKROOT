--!strict
--[[
	ProgressionService — the road through the biomes.

	The shape of a run, from the WebGL build: you start in the Hollow, you find
	and kill its boss, a rift opens where it fell, you step through, and you
	are somewhere else — deeper, harder, with everything scaled by
	Biomes.depthScaling. The order after the Hollow is shuffled by your seed,
	so two players on the same seed walk the same road and two players on
	different seeds do not.

	Depth is the difficulty curve and it is not subtle: +30% creature health,
	+18% damage, +12% density and +10% loot per rift. The sixth biome is a
	different game from the first, which is the point.
]]

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local Net = require(Shared:WaitForChild("Net"))

local Blackroot = script.Parent
local StatsService = require(Blackroot:WaitForChild("StatsService"))

local ProgressionService = {}

local order: { string } = {}
local depth = 0
local seed = 0
local rift: BasePart? = nil
local riftHold: { [Player]: number } = {}
local onTravel: ((string, number) -> ())? = nil
local ToastEvent: RemoteEvent

-- ── The rift ───────────────────────────────────────────────────────────────

--- Open a rift at a position. It stays until somebody stands in it.
function ProgressionService.openRift(at: Vector3)
	ProgressionService.closeRift()

	local p = Instance.new("Part")
	p.Name = "Rift"
	p.Anchored = true
	p.CanCollide = false
	p.Size = Vector3.new(9, 16, 9)
	p.CFrame = CFrame.new(at + Vector3.new(0, 8, 0))
	p.Color = Color3.fromRGB(150, 110, 255)
	p.Material = Enum.Material.Neon
	p.Transparency = 0.3
	p.Shape = Enum.PartType.Ball
	p.Parent = Workspace

	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(150, 110, 255)
	light.Range = 70
	light.Brightness = 4
	light.Parent = p

	-- A column so it is visible from the far side of the map.
	local beam = Instance.new("Part")
	beam.Name = "Beam"
	beam.Anchored = true
	beam.CanCollide = false
	beam.CanQuery = false
	beam.Size = Vector3.new(3, 500, 3)
	beam.CFrame = CFrame.new(at + Vector3.new(0, 250, 0))
	beam.Color = Color3.fromRGB(150, 110, 255)
	beam.Material = Enum.Material.Neon
	beam.Transparency = 0.85
	beam.Parent = p

	rift = p
	table.clear(riftHold)
end

function ProgressionService.closeRift()
	if rift then rift:Destroy(); rift = nil end
	table.clear(riftHold)
end

function ProgressionService.riftPosition(): Vector3?
	return rift and rift.Position or nil
end

function ProgressionService.riftOpen(): boolean
	return rift ~= nil
end

-- ── Travel ─────────────────────────────────────────────────────────────────

function ProgressionService.currentBiome(): string
	return order[math.min(depth + 1, #order)] or Biomes.FIRST
end

function ProgressionService.nextBiome(): string?
	return order[depth + 2]
end

function ProgressionService.depth(): number
	return depth
end

function ProgressionService.order(): { string }
	return order
end

--- Step through. Advances depth and asks the run to rebuild.
function ProgressionService.travel()
	local next = ProgressionService.nextBiome()
	ProgressionService.closeRift()

	if not next then
		-- Past the last biome the road loops, deeper each time. There is no
		-- ending screen in the WebGL build either; the run ends when you do.
		depth += 1
		local wrapped = order[((depth) % #order) + 1]
		if ToastEvent then
			ToastEvent:FireAllClients("THE ROAD LOOPS. IT IS WORSE THIS TIME.", "bad")
		end
		if onTravel then onTravel(wrapped, depth) end
		return
	end

	depth += 1
	if onTravel then onTravel(next, depth) end
end

function ProgressionService.step(dt: number)
	if not rift then return end

	for _, player in Players:GetPlayers() do
		local s = StatsService.get(player)
		if not s or s.dead then continue end
		local char = player.Character
		local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
		if not hrp then continue end

		local d = (hrp.Position - (rift :: BasePart).Position).Magnitude
		if d < 12 then
			riftHold[player] = (riftHold[player] or 0) + dt
			if riftHold[player] >= Config.RIFT_HOLD then
				-- Whoever takes the rift brings the party. Same rule as the
				-- WebGL co-op: the host taking it moves everybody.
				ProgressionService.travel()
				return
			end
		else
			riftHold[player] = nil
		end
	end
end

function ProgressionService.holdFor(player: Player): number
	return riftHold[player] or 0
end

-- ── Lifecycle ──────────────────────────────────────────────────────────────

function ProgressionService.begin(runSeed: number)
	seed = runSeed
	depth = 0
	order = Biomes.order(runSeed)
	ProgressionService.closeRift()
end

function ProgressionService.setDepth(n: number)
	depth = math.max(0, n)
end

function ProgressionService.onTravel(fn: (string, number) -> ())
	onTravel = fn
end

function ProgressionService.init()
	ToastEvent = Net.event("Toast")
	Players.PlayerRemoving:Connect(function(p) riftHold[p] = nil end)
end

return ProgressionService
