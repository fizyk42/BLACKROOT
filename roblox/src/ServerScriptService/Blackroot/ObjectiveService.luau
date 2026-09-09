--!strict
--[[
	ObjectiveService — the guide, from scripts/systems/Waypoints.js.

	The single loudest complaint about the original WebGL build was not knowing
	where to go, and the fix was a wisp: a light that leads, always visible,
	always pointing at the thing you should be doing next. This is that.

	The objective is decided, not configured:
	  1. a rift is open        → the rift, because that is the way out
	  2. the boss is awake     → the boss, because you are already in it
	  3. otherwise             → the nearest landmark you have not found

	Marks are the co-op half: press M and everyone sees where you pointed.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))

local Blackroot = script.Parent
local LootService = require(Blackroot:WaitForChild("LootService"))
local BossService = require(Blackroot:WaitForChild("BossService"))
local ProgressionService = require(Blackroot:WaitForChild("ProgressionService"))

local ObjectiveService = {}

type Mark = { position: Vector3, by: string, at: number }

local marks: { Mark } = {}
local ObjectiveEvent: RemoteEvent
local MarksEvent: RemoteEvent
local acc = 0

--- What this player should be walking toward, and what to call it.
function ObjectiveService.objectiveFor(player: Player): (Vector3?, string)
	local riftAt = ProgressionService.riftPosition()
	if riftAt then
		return riftAt, "THE RIFT"
	end

	local boss = BossService.active()
	if boss then
		local biomeBoss = BossService.position()
		if biomeBoss then
			return biomeBoss, boss.def.name
		end
	end

	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return nil, "" end

	local best, bestD = nil, math.huge
	for _, lm in LootService.landmarks() do
		if lm.found then continue end
		local d = (lm.position - hrp.Position).Magnitude
		if d < bestD then best, bestD = lm, d end
	end
	if best then
		return best.position, string.upper(best.kind.label)
	end

	-- Everything found and nothing awake: go and wake the boss.
	local bossAt = BossService.position()
	if bossAt then return bossAt, "SOMETHING IS OUT THERE" end
	return nil, ""
end

function ObjectiveService.broadcast()
	if not ObjectiveEvent then return end
	for _, player in Players:GetPlayers() do
		local at, label = ObjectiveService.objectiveFor(player)
		local char = player.Character
		local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
		local distance = 0
		if at and hrp then
			distance = math.floor((at - hrp.Position).Magnitude / 2.6)   -- studs → metres
		end
		ObjectiveEvent:FireClient(player, at, label, distance)
	end
end

function ObjectiveService.step(dt: number)
	acc += dt
	if acc < 0.25 then return end
	acc = 0
	ObjectiveService.broadcast()

	-- Marks expire after two minutes so the HUD does not silt up.
	local now = os.clock()
	local changed = false
	for i = #marks, 1, -1 do
		if now - marks[i].at > 120 then
			table.remove(marks, i)
			changed = true
		end
	end
	if changed then ObjectiveService.pushMarks() end
end

-- ── Marks ──────────────────────────────────────────────────────────────────

function ObjectiveService.addMark(player: Player, at: Vector3)
	if typeof(at) ~= "Vector3" then return end
	table.insert(marks, { position = at, by = player.DisplayName, at = os.clock() })
	if #marks > 12 then table.remove(marks, 1) end
	ObjectiveService.pushMarks()
end

function ObjectiveService.pushMarks()
	if not MarksEvent then return end
	local payload = {}
	for _, m in marks do
		table.insert(payload, { position = m.position, by = m.by })
	end
	MarksEvent:FireAllClients(payload)
end

function ObjectiveService.clearMarks()
	table.clear(marks)
	ObjectiveService.pushMarks()
end

function ObjectiveService.stop()
	ObjectiveService.clearMarks()
end

function ObjectiveService.init()
	ObjectiveEvent = Net.event("Objective")
	MarksEvent = Net.event("Marks")

	Net.event("Mark").OnServerEvent:Connect(function(player, at)
		ObjectiveService.addMark(player, at)
	end)
end

return ObjectiveService
