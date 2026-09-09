--!strict
--[[
	Rng — mulberry32, the same generator the WebGL build uses.

	Roblox's own Random is fine for anything that only has to look random, but
	a seed has to produce the same weapon, the same camo and the same world on
	every machine that reads it, and Roblox does not promise that across
	versions. mulberry32 is forty lines and promises exactly that.

	Ported from scripts/core/RNG.js. Luau has no uint32 arithmetic, so every
	step goes through bit32, which is defined to operate on 32-bit values.
]]

local Rng = {}
Rng.__index = Rng

export type Generator = typeof(setmetatable({} :: { state: number }, Rng))

local TWO32 = 4294967296

local function u32(n: number): number
	n = n % TWO32
	if n < 0 then n += TWO32 end
	return n
end

--- Multiply two 32-bit values without losing the low bits to float precision.
local function mul32(a: number, b: number): number
	a = u32(a)
	b = u32(b)
	local aLo = a % 65536
	local aHi = (a - aLo) / 65536
	return u32(((aHi * b) % 65536) * 65536 + aLo * b)
end

function Rng.new(seed: number): Generator
	return setmetatable({ state = u32(math.floor(seed)) }, Rng)
end

--- The next float in [0, 1).
function Rng.next(self: Generator): number
	self.state = u32(self.state + 0x6D2B79F5)
	local t = self.state
	t = mul32(bit32.bxor(t, bit32.rshift(t, 15)), bit32.bor(t, 1))
	t = bit32.bxor(t, u32(t + mul32(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(t, 61))))
	return bit32.bxor(t, bit32.rshift(t, 14)) / TWO32
end

function Rng.range(self: Generator, lo: number, hi: number): number
	return lo + (hi - lo) * Rng.next(self)
end

function Rng.int(self: Generator, lo: number, hi: number): number
	return math.floor(Rng.range(self, lo, hi + 1))
end

function Rng.pick(self: Generator, list: { any }): any
	if #list == 0 then return nil end
	return list[Rng.int(self, 1, #list)]
end

function Rng.chance(self: Generator, p: number): boolean
	return Rng.next(self) < p
end

--- Weighted pick over a list of { weight = n } entries (or a parallel weight
--- accessor). Returns the entry.
function Rng.weighted(self: Generator, list: { any }, weightOf: ((any) -> number)?): any
	local total = 0
	for _, entry in list do
		total += if weightOf then weightOf(entry) else (entry.weight or 1)
	end
	if total <= 0 then return list[1] end
	local roll = Rng.next(self) * total
	for _, entry in list do
		roll -= if weightOf then weightOf(entry) else (entry.weight or 1)
		if roll <= 0 then return entry end
	end
	return list[#list]
end

function Rng.lerp(a: number, b: number, t: number): number
	return a + (b - a) * t
end

Rng.TWO32 = TWO32

return Rng
