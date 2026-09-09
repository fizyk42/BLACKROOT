--!strict
--[[
	HorrorDirector — the thing that decides when it gets bad, from
	scripts/systems/HorrorDirector.js.

	A horror game where the pressure is constant is not tense, it is loud. The
	director tracks how the run is actually going — health, how long since a
	real fight, how much noise the player is making — and moves a single
	`dread` value up and down. Dread drives what happens next: quiet stretches
	get quieter until they are uncomfortable, and then something is put behind
	you.

	Each biome contributes a `dreadBase` floor, which is why the Bloom is
	never calm and the Hollow sometimes is.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))

local Blackroot = script.Parent
local StatsService = require(Blackroot:WaitForChild("StatsService"))
local EnemyService = require(Blackroot:WaitForChild("EnemyService"))

local HorrorDirector = {}

local dread = 0
local base = 0
local calmFor = 0
local sinceEvent = 0
local enabled = true
local ToastEvent: RemoteEvent

-- How long a quiet stretch runs before the director puts something in it.
local CALM_BEFORE_EVENT = 42
local EVENT_COOLDOWN = 55

--- Quiet lines. They are the only place the game speaks to the player in the
--- second person, and they are rare on purpose.
local WHISPERS = {
	"Something moved where you already looked.",
	"The birds stopped a while ago.",
	"You are being followed at a polite distance.",
	"It has been walking parallel to you for some time.",
	"Whatever it is, it is patient.",
	"You can hear your own breathing. That is not usually true.",
	"It knows the shape of a person. It is not one.",
	"The trees here have been marked. Recently.",
}

function HorrorDirector.begin(biome: any)
	base = (biome and biome.audio and biome.audio.dreadBase) or 0
	dread = base
	calmFor = 0
	sinceEvent = 0
end

function HorrorDirector.setEnabled(on: boolean)
	enabled = on
end

function HorrorDirector.dread(): number
	return dread
end

function HorrorDirector.step(dt: number)
	if not enabled then return end

	local worstFraction = 1
	local anyAlive = false
	local anyLoud = false

	for _, player in Players:GetPlayers() do
		local s = StatsService.get(player)
		if not s or s.dead then continue end
		anyAlive = true
		worstFraction = math.min(worstFraction, s.health / s.maxHealth)
		if s.sprinting or s.flashlight then anyLoud = true end
		if s.timeAlive - s.lastHitAt < 6 then calmFor = 0 end
	end
	if not anyAlive then return end

	calmFor += dt
	sinceEvent += dt

	-- Dread climbs in quiet and falls when something is actually happening.
	local target = base
		+ math.clamp(calmFor / 90, 0, 0.45)        -- boredom is pressure
		+ (1 - worstFraction) * 0.3                 -- being hurt is pressure
		+ (if anyLoud then 0.12 else 0)             -- being loud is pressure
	dread += (target - dread) * math.min(1, dt * 0.35)

	-- The event. Something is put behind the player, at a distance that gives
	-- them time to hear it rather than time to die to it.
	if calmFor > CALM_BEFORE_EVENT and sinceEvent > EVENT_COOLDOWN and dread > 0.45 then
		sinceEvent = 0
		calmFor = CALM_BEFORE_EVENT * 0.4

		local chosen: Player? = nil
		for _, p in Players:GetPlayers() do
			local s = StatsService.get(p)
			if s and not s.dead then chosen = p; break end
		end
		if not chosen then return end

		local char = chosen.Character
		local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
		if not hrp then return end

		if math.random() < 0.55 then
			-- Put one behind them, outside the quiet ring but inside earshot.
			local behind = -hrp.CFrame.LookVector
			local at = hrp.Position + behind * 90 + Vector3.new(math.random(-30, 30), 8, math.random(-30, 30))
			local e = EnemyService.spawnAt("stalker", at)
			if e then e.alert = 0.8 end
			if ToastEvent then
				ToastEvent:FireClient(chosen, WHISPERS[math.random(1, #WHISPERS)], "info")
			end
		else
			-- Or just wake what is already out there.
			EnemyService.alertAround(hrp.Position, 160, 0.55)
			if ToastEvent then
				ToastEvent:FireClient(chosen, WHISPERS[math.random(1, #WHISPERS)], "info")
			end
		end
	end
end

function HorrorDirector.init()
	ToastEvent = Net.event("Toast")
end

HorrorDirector.WHISPERS = WHISPERS
HorrorDirector.CALM_BEFORE_EVENT = CALM_BEFORE_EVENT

return HorrorDirector
