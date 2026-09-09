--!strict
--[[
	StatsService — condition, from scripts/player/PlayerStats.js.

	Health, stamina, hunger, thirst, bleeding, poison, the flashlight battery,
	and the two mercies that made the WebGL build playable: a post-hit grace
	window and out-of-combat regeneration.

	Everything hostile in the game routes damage through StatsService.damage,
	so the difficulty multiplier, the grace window, painkiller resistance and
	Second Wind are all applied in exactly one place. When something takes an
	unexpected amount off a player, this is the only file to read.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Net = require(Shared:WaitForChild("Net"))

type Difficulty = typeof(Config.DIFFICULTY.normal)

export type Heal = { rate: number, remaining: number }

export type State = {
	health: number,
	maxHealth: number,
	stamina: number,
	maxStamina: number,
	hunger: number,           -- 0..100
	thirst: number,           -- 0..100
	bleeding: number,
	poison: number,
	battery: number,          -- 0..100
	flashlight: boolean,
	sprinting: boolean,
	crouched: boolean,
	dead: boolean,
	downed: boolean,
	downedFor: number,
	downs: number,
	kills: number,
	itemsLooted: number,
	landmarksFound: number,
	timeAlive: number,
	lastHitAt: number,
	lastSprintAt: number,
	graceUntil: number,
	resistUntil: number,
	resistAmount: number,
	staminaBoostUntil: number,
	adrenalineUntil: number,
	fatigueUntil: number,
	reviveCharges: number,
	difficulty: string,
	heals: { Heal },
	godMode: boolean,
	moveMul: number,
	_pushAcc: number,
}

local StatsService = {}

local states: { [Player]: State } = {}
local StatsEvent: RemoteEvent
local ToastEvent: RemoteEvent

function StatsService.init()
	StatsEvent = Net.event("Stats")
	ToastEvent = Net.event("Toast")
end

local function diffOf(s: State): Difficulty
	return (Config.DIFFICULTY[s.difficulty] or Config.DIFFICULTY[Config.DEFAULT_DIFFICULTY]) :: Difficulty
end

-- ── Lifecycle ──────────────────────────────────────────────────────────────

function StatsService.reset(player: Player, difficulty: string?): State
	local previous = states[player]
	local s: State = {
		health = Config.MAX_HEALTH,
		maxHealth = Config.MAX_HEALTH,
		stamina = Config.STAMINA_MAX,
		maxStamina = Config.STAMINA_MAX,
		hunger = 100,
		thirst = 100,
		bleeding = 0,
		poison = 0,
		battery = 100,
		flashlight = false,
		sprinting = false,
		crouched = false,
		dead = false,
		downed = false,
		downedFor = 0,
		downs = 0,
		kills = 0,
		itemsLooted = 0,
		landmarksFound = 0,
		timeAlive = 0,
		lastHitAt = -1e9,
		lastSprintAt = -1e9,
		graceUntil = -1e9,
		resistUntil = 0,
		resistAmount = 0,
		staminaBoostUntil = 0,
		adrenalineUntil = 0,
		fatigueUntil = 0,
		reviveCharges = 0,
		difficulty = difficulty or (previous and previous.difficulty) or Config.DEFAULT_DIFFICULTY,
		heals = {},
		godMode = false,
		moveMul = 1,
		_pushAcc = 0,
	}
	states[player] = s
	StatsService.push(player)
	return s
end

function StatsService.get(player: Player): State?
	return states[player]
end

function StatsService.clear(player: Player)
	states[player] = nil
end

function StatsService.setDifficulty(player: Player, id: string)
	if not Config.DIFFICULTY[id] then return end
	local s = states[player]
	if s then
		s.difficulty = id
		StatsService.push(player)
	end
end

-- ── Buffs ──────────────────────────────────────────────────────────────────

function StatsService.addRevive(player: Player, n: number)
	local s = states[player]
	if not s then return end
	s.reviveCharges += n
	StatsService.push(player)
end

function StatsService.adrenaline(player: Player, seconds: number)
	local s = states[player]
	if not s then return end
	s.adrenalineUntil = math.max(s.adrenalineUntil, s.timeAlive + seconds)
	-- The come-down. Stacking shots extends the high but never past the cost.
	s.fatigueUntil = s.adrenalineUntil + 55
	StatsService.push(player)
end

function StatsService.resist(player: Player, amount: number, seconds: number)
	local s = states[player]
	if not s then return end
	s.resistAmount = amount
	s.resistUntil = s.timeAlive + seconds
	StatsService.push(player)
end

function StatsService.staminaBoost(player: Player, seconds: number)
	local s = states[player]
	if not s then return end
	s.staminaBoostUntil = s.timeAlive + seconds
end

--- Move speed multiplier from condition alone. Encumbrance is applied by the
--- caller, because inventory weight belongs to InventoryService.
function StatsService.speedMultiplier(player: Player): number
	local s = states[player]
	if not s then return 1 end
	local m = s.moveMul
	if s.timeAlive < s.adrenalineUntil then
		m *= 1.35
	elseif s.timeAlive < s.fatigueUntil then
		m *= 0.88
	end
	if s.hunger <= 0 or s.thirst <= 0 then m *= 0.82 end
	if s.downed then m *= 0.3 end
	return m
end

function StatsService.damageMultiplier(player: Player): number
	local s = states[player]
	if not s then return 1 end
	local m = diffOf(s).dmgDealt
	if s.timeAlive < s.adrenalineUntil then m *= 1.25 end
	return m
end

-- ── Stamina ────────────────────────────────────────────────────────────────

function StatsService.spendStamina(player: Player, amount: number): boolean
	local s = states[player]
	if not s then return false end
	if s.godMode then return true end
	if s.stamina < amount then return false end
	s.stamina -= amount
	s.lastSprintAt = s.timeAlive
	return true
end

-- ── Damage ─────────────────────────────────────────────────────────────────

--[[
	Apply damage. Returns how much actually landed, which is 0 when the grace
	window ate it — callers use that to decide whether to play a hit sound.

	opts.ignoreGrace  hazards, hunger and poison bypass the window
	opts.bleed        bleed to apply on top, scaled by the difficulty
	opts.poison       poison to apply on top
]]
function StatsService.damage(player: Player, amount: number, opts: { ignoreGrace: boolean?, bleed: number?, poison: number? }?): number
	local s = states[player]
	if not s or s.dead then return 0 end
	if s.godMode then return 0 end

	local o = opts or {}
	local d = diffOf(s)

	local grace = d.iFrames or 0
	if grace > 0 and not o.ignoreGrace and s.graceUntil > s.timeAlive then
		return 0
	end

	local dealt = amount * d.dmgTaken
	if s.timeAlive < s.resistUntil then
		dealt *= (1 - s.resistAmount)
	end

	s.health = math.max(0, s.health - dealt)
	s.lastHitAt = s.timeAlive
	if grace > 0 and not o.ignoreGrace then
		s.graceUntil = s.timeAlive + grace
	end
	if o.bleed and o.bleed > 0 then
		s.bleeding = math.min(6, s.bleeding + o.bleed * (d.bleedMul or 1))
	end
	if o.poison and o.poison > 0 then
		s.poison = math.min(6, s.poison + o.poison)
	end

	if s.health <= 0 then
		StatsService.down(player)
	else
		StatsService.push(player)
	end
	return dealt
end

function StatsService.heal(player: Player, amount: number, opts: { stopsBleed: boolean?, curePoison: boolean?, overTime: number?, duration: number? }?)
	local s = states[player]
	if not s or s.dead then return end
	local o = opts or {}

	s.health = math.min(s.maxHealth, s.health + amount)
	if o.stopsBleed then s.bleeding = 0 end
	if o.curePoison then s.poison = 0 end
	if o.overTime and o.overTime > 0 and o.duration and o.duration > 0 then
		table.insert(s.heals, { rate = o.overTime / o.duration, remaining = o.duration })
	end
	StatsService.push(player)
end

function StatsService.feed(player: Player, hunger: number, thirst: number)
	local s = states[player]
	if not s then return end
	s.hunger = math.clamp(s.hunger + hunger, 0, 100)
	s.thirst = math.clamp(s.thirst + thirst, 0, 100)
	StatsService.push(player)
end

function StatsService.chargeBattery(player: Player, amount: number)
	local s = states[player]
	if not s then return end
	s.battery = math.clamp(s.battery + amount, 0, 100)
	StatsService.push(player)
end

--[[
	Going down.

	Second Wind, if the player has one, is spent here. Otherwise they are
	*downed* rather than dead — crawling, bleeding out over thirty seconds, and
	revivable by a teammate with E. Alone, that thirty seconds is simply how
	long you have to watch.
]]
function StatsService.down(player: Player)
	local s = states[player]
	if not s or s.dead or s.downed then return end

	if s.reviveCharges > 0 then
		s.reviveCharges -= 1
		s.health = 40
		s.bleeding = 0
		s.graceUntil = s.timeAlive + 10
		s.downs += 1
		if ToastEvent then ToastEvent:FireClient(player, "SECOND WIND — ten seconds of grace", "good") end
		StatsService.push(player)
		return
	end

	local others = 0
	for _, p in Players:GetPlayers() do
		local o = states[p]
		if p ~= player and o and not o.dead and not o.downed then others += 1 end
	end

	if others > 0 then
		s.downed = true
		s.downedFor = 0
		s.health = 1
		s.downs += 1
		if ToastEvent then ToastEvent:FireClient(player, "YOU ARE DOWN — someone has thirty seconds", "bad") end
		StatsService.push(player)
		return
	end

	StatsService.kill(player)
end

function StatsService.revive(player: Player, by: Player?)
	local s = states[player]
	if not s or not s.downed then return end
	s.downed = false
	s.downedFor = 0
	s.health = math.max(35, s.health)
	s.bleeding = 0
	s.graceUntil = s.timeAlive + 4
	if ToastEvent then
		ToastEvent:FireClient(player, "BACK ON YOUR FEET", "good")
		if by then ToastEvent:FireClient(by, "PICKED THEM UP", "good") end
	end
	StatsService.push(player)
end

function StatsService.kill(player: Player)
	local s = states[player]
	if not s or s.dead then return end
	s.dead = true
	s.downed = false
	s.health = 0
	StatsService.push(player)

	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	if hum then hum.Health = 0 end
end

function StatsService.countKill(player: Player)
	local s = states[player]
	if s then s.kills += 1 end
end

-- ── Per-frame ──────────────────────────────────────────────────────────────

function StatsService.step(player: Player, dt: number)
	local s = states[player]
	if not s or s.dead then return end
	local d = diffOf(s)
	s.timeAlive += dt

	-- Downed: thirty seconds, then gone.
	if s.downed then
		s.downedFor += dt
		if s.downedFor >= 30 then
			StatsService.kill(player)
			return
		end
		StatsService.push(player)
		return
	end

	-- Bleeding and poison. Both count as being under fire, so neither lets
	-- regeneration start.
	if s.bleeding > 0 then
		local tick = math.min(s.bleeding, dt * 2.4)
		s.bleeding = math.max(0, s.bleeding - dt * 0.35)
		s.health = math.max(0, s.health - tick * 1.6)
		s.lastHitAt = s.timeAlive
	end
	if s.poison > 0 then
		s.poison = math.max(0, s.poison - dt * 0.2)
		s.health = math.max(0, s.health - dt * 1.4)
		s.lastHitAt = s.timeAlive
	end

	-- Heal-over-time from bandages and herbs.
	for i = #s.heals, 1, -1 do
		local h = s.heals[i]
		local step = math.min(h.remaining, dt)
		s.health = math.min(s.maxHealth, s.health + h.rate * step)
		h.remaining -= step
		if h.remaining <= 0 then table.remove(s.heals, i) end
	end

	-- Needs.
	s.hunger = math.max(0, s.hunger - dt * 0.16 * d.hungerRate)
	s.thirst = math.max(0, s.thirst - dt * 0.22 * d.thirstRate)
	if s.hunger <= 0 or s.thirst <= 0 then
		s.health = math.max(0, s.health - dt * 1.1)
	end

	-- Stamina.
	if s.sprinting then
		local cost = Config.STAMINA_SPRINT * (if s.timeAlive < s.staminaBoostUntil then 0.6 else 1)
		s.stamina = math.max(0, s.stamina - cost * dt)
		s.lastSprintAt = s.timeAlive
		if s.stamina <= 0 then s.sprinting = false end
	elseif s.timeAlive - s.lastSprintAt > Config.STAMINA_REGEN_DELAY then
		s.stamina = math.min(s.maxStamina, s.stamina + Config.STAMINA_REGEN * dt)
	end

	-- Flashlight battery.
	if s.flashlight then
		s.battery = math.max(0, s.battery - Config.FLASHLIGHT_DRAIN * dt)
		if s.battery <= 0 then
			s.flashlight = false
			if ToastEvent then ToastEvent:FireClient(player, "THE LAMP IS DEAD", "warn") end
		end
	end

	-- Out-of-combat regeneration. The cap is the point: a bad fight still
	-- leaves you short of full until you spend a bandage on it.
	local regen = d.regen or 0
	local quiet = s.timeAlive - s.lastHitAt
	if regen > 0 and s.bleeding <= 0 and s.poison <= 0 and quiet > (d.regenDelay or 6) then
		local cap = s.maxHealth * (d.regenCap or 0.5)
		if s.health < cap then
			s.health = math.min(cap, s.health + regen * dt)
		end
	end

	if s.godMode then
		s.health = s.maxHealth
		s.stamina = s.maxStamina
		s.bleeding = 0
		s.poison = 0
	end

	if s.health <= 0 then
		StatsService.down(player)
		return
	end

	s._pushAcc += dt
	if s._pushAcc >= 0.15 then
		s._pushAcc = 0
		StatsService.push(player)
	end
end

function StatsService.push(player: Player)
	local s = states[player]
	if not s or not StatsEvent then return end
	StatsEvent:FireClient(player, {
		health = math.floor(s.health + 0.5),
		maxHealth = s.maxHealth,
		stamina = math.floor(s.stamina + 0.5),
		maxStamina = s.maxStamina,
		hunger = s.hunger,
		thirst = s.thirst,
		bleeding = s.bleeding > 0,
		poisoned = s.poison > 0,
		battery = s.battery,
		flashlight = s.flashlight,
		dead = s.dead,
		downed = s.downed,
		downedFor = s.downedFor,
		difficulty = s.difficulty,
		revives = s.reviveCharges,
		adrenaline = math.max(0, s.adrenalineUntil - s.timeAlive),
		fatigued = s.timeAlive < s.fatigueUntil and s.timeAlive >= s.adrenalineUntil,
		resisting = s.timeAlive < s.resistUntil,
		kills = s.kills,
		timeAlive = s.timeAlive,
		godMode = s.godMode,
	})
end

--- Everyone's condition, for the squad readout in co-op.
function StatsService.squadSnapshot(): { any }
	local out = {}
	for player, s in states do
		table.insert(out, {
			userId = player.UserId,
			name = player.DisplayName,
			health = math.floor(s.health + 0.5),
			maxHealth = s.maxHealth,
			downed = s.downed,
			dead = s.dead,
			bleeding = s.bleeding > 0,
		})
	end
	return out
end

Players.PlayerRemoving:Connect(function(p) StatsService.clear(p) end)

return StatsService
