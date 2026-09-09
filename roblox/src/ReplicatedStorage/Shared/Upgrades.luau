--!strict
--[[
	Upgrades — transcribed from scripts/systems/Upgrades.js.

	Six tracks, points earned by playing. Cost rises linearly with level, so a
	five-level track at base cost 2 costs 2+4+6+8+10 = 30 points end to end,
	and the four-level capacity track at base 3 costs exactly the same. That
	symmetry is deliberate: no track is the efficient one.
]]

local Upgrades = {}

export type Track = {
	id: string,
	label: string,
	max: number,
	baseCost: number,
	effect: { [string]: number },
	line: string,
}

Upgrades.TRACKS = {
	{ id = "ballistics", label = "Terminal Ballistics", max = 5, baseCost = 2,
		effect = { damage = 0.055 }, line = "+%d%% damage" },
	{ id = "control", label = "Recoil Control", max = 5, baseCost = 2,
		effect = { recoil = -0.075 }, line = "−%d%% recoil" },
	{ id = "handling", label = "Handling", max = 5, baseCost = 2,
		effect = { adsTime = -0.045, sway = -0.055 }, line = "−%d%% aim time · −%d%% sway" },
	{ id = "capacity", label = "Feed Capacity", max = 4, baseCost = 3,
		effect = { magAdd = 0.10 }, line = "+%d%% magazine" },
	{ id = "barrel", label = "Barrel Tuning", max = 5, baseCost = 2,
		effect = { range = 0.075, adsSpread = -0.06 }, line = "+%d%% range · −%d%% aimed spread" },
	{ id = "drills", label = "Reload Drills", max = 5, baseCost = 2,
		effect = { reload = -0.06 }, line = "−%d%% reload time" },
} :: { Track }

function Upgrades.track(id: string): Track?
	for _, t in Upgrades.TRACKS do
		if t.id == id then return t end
	end
	return nil
end

--- What the next level of a track costs, given the level you already hold.
function Upgrades.cost(trackId: string, level: number): number
	local t = Upgrades.track(trackId)
	if not t then return math.huge end
	return t.baseCost + level * t.baseCost
end

--- Points a run has earned. Same formula as the WebGL build.
function Upgrades.earnedPoints(stats: { kills: number?, landmarksFound: number?, timeAlive: number?, itemsLooted: number? }): number
	local kills = stats.kills or 0
	local found = stats.landmarksFound or 0
	local alive = stats.timeAlive or 0
	local looted = stats.itemsLooted or 0
	return math.floor(kills * 2 + found * 4 + math.floor(alive / 120) + math.floor(looted / 6))
end

Upgrades.GRANTED_POINTS = 12

--- Apply a level map to a weapon's stats. `base` supplies the magazine that
--- magAdd is measured against, for the same reason as in Attachments.
function Upgrades.apply(base: any, stats: any, levels: { [string]: number }): any
	local out = table.clone(stats)
	local magAdd = 0

	for _, t in Upgrades.TRACKS do
		local n = levels[t.id] or 0
		if n <= 0 then continue end
		for key, per in t.effect do
			if key == "magAdd" then
				magAdd += per * n
			elseif out[key] ~= nil then
				out[key] = out[key] * (1 + per * n)
			end
		end
	end

	if magAdd ~= 0 then
		out.mag = math.max(1, math.round((out.mag or base.mag) + base.mag * magAdd))
	end
	if out.adsTime then
		out.adsTime = math.max(0.06, out.adsTime)
	end

	return out
end

return Upgrades
