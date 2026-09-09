--!strict
--[[
	Products — the Robux catalogue.

	═══════════════════════════════════════════════════════════════════════════
	READ THIS BEFORE YOU PUBLISH
	═══════════════════════════════════════════════════════════════════════════
	Roblox will not let anyone but you create products for your experience, and
	it should not. Nothing in this repository can invent a product id for you.

	So every `id` below is 0 — a deliberate placeholder. The shop shows these
	entries greyed out with "not configured" until you fill them in, and the
	server refuses to grant a powerup for an id it does not recognise. Nothing
	breaks while they are 0; you simply cannot sell anything.

	To turn them on:
	  1. create.roblox.com → your experience → Monetization → Developer Products
	  2. Create each product below with the name, description and price given
	     here (they were priced to be worth the money — see the note at the
	     bottom of this file).
	  3. Copy the product id from the dashboard URL (…/developer-products/<ID>)
	     into the matching `id` field, or run
	         npm run roblox:bot -- products --universe <UNIVERSE_ID>
	     which lists everything the API can see and prints the exact lines to
	     paste here.
	  4. Repeat for Monetization → Passes and the PASSES table.

	Prices are in Robux. They are set deliberately low: the whole point of a
	consumable here is to shorten a bad run, not to sell a win. Nothing in this
	catalogue is available *only* for Robux — every consumable also drops in
	the world, and every pass effect can be earned by playing. Keep it that way
	if you change it; Roblox's own policy on paid random items is strict, and
	players notice the difference immediately.
]]

local Products = {}

export type Product = {
	key: string,
	id: number,            -- ← your Developer Product id goes here
	name: string,
	blurb: string,
	price: number,         -- Robux, for display only; the dashboard is the truth
	icon: string,          -- rbxassetid://… or "" to draw the built-in glyph
	glyph: string,
	kind: string,          -- "consumable"
	grant: string,         -- which PowerupService handler runs
	amount: number,
	limitPerRun: number,   -- 0 = unlimited
}

export type Pass = {
	key: string,
	id: number,            -- ← your Game Pass id goes here
	name: string,
	blurb: string,
	price: number,
	glyph: string,
	kind: string,          -- "pass"
	perk: string,
}

-- ── Consumables (Developer Products — repeatable) ──────────────────────────
Products.PRODUCTS = {
	{
		key = "medkit",
		id = 0,
		name = "Field Trauma Kit ×3",
		blurb = "Three kits, straight into your bag. Each one stops a bleed and puts back 55 health.",
		price = 25,
		icon = "", glyph = "+",
		kind = "consumable", grant = "medkit", amount = 3, limitPerRun = 0,
	},
	{
		key = "ammo",
		id = 0,
		name = "Ammunition Drop",
		blurb = "A full magazine and 120 rounds in reserve. Enough to finish what you started.",
		price = 25,
		icon = "", glyph = "▮",
		kind = "consumable", grant = "ammo", amount = 120, limitPerRun = 0,
	},
	{
		key = "adrenaline",
		id = 0,
		name = "Adrenaline Shot",
		blurb = "Ninety seconds of +35% movement and +25% damage. Then you pay for it with a slow minute.",
		price = 20,
		icon = "", glyph = "⚡",
		kind = "consumable", grant = "adrenaline", amount = 90, limitPerRun = 0,
	},
	{
		key = "flare",
		id = 0,
		name = "Extraction Flare",
		blurb = "Calls extraction to you instead of making you walk to it. Once per run.",
		price = 35,
		icon = "", glyph = "▲",
		kind = "consumable", grant = "flare", amount = 1, limitPerRun = 1,
	},
	{
		key = "secondwind",
		id = 0,
		name = "Second Wind",
		blurb = "Get up once after you go down, at 40 health, with ten seconds of grace. Once per run.",
		price = 49,
		icon = "", glyph = "✚",
		kind = "consumable", grant = "revive", amount = 1, limitPerRun = 1,
	},
	{
		key = "resupply",
		id = 0,
		name = "Full Resupply",
		blurb = "Kits, ammunition, an adrenaline shot and a flare together — about a third off buying them apart.",
		price = 99,
		icon = "", glyph = "❖",
		kind = "consumable", grant = "bundle", amount = 1, limitPerRun = 0,
	},
} :: { Product }

-- ── Passes (permanent, one purchase) ───────────────────────────────────────
Products.PASSES = {
	{
		key = "scavenger",
		id = 0,
		name = "Scavenger's Eye",
		blurb = "Loot within 90 studs outlines through the fog. Quality-of-life, not firepower.",
		price = 99, glyph = "◉", kind = "pass", perk = "lootHighlight",
	},
	{
		key = "cartographer",
		id = 0,
		name = "Cartographer",
		blurb = "The guide wisp never goes out, and the objective distance is always on your HUD.",
		price = 79, glyph = "✦", kind = "pass", perk = "permanentBeacon",
	},
	{
		key = "veteran",
		id = 0,
		name = "Veteran's Cache",
		blurb = "Start every run with the rifle, a plate carrier and two kits instead of scavenging for them.",
		price = 199, glyph = "▣", kind = "pass", perk = "starterKit",
	},
	{
		key = "salvage",
		id = 0,
		name = "Double Salvage",
		blurb = "Double the salvage you carry out of a run, forever. Salvage buys nothing that shoots.",
		price = 149, glyph = "✕2", kind = "pass", perk = "doubleSalvage",
	},
} :: { Pass }

-- ── Lookups ────────────────────────────────────────────────────────────────

function Products.byProductId(id: number): Product?
	if id == 0 then return nil end
	for _, p in Products.PRODUCTS do
		if p.id == id then return p end
	end
	return nil
end

function Products.byKey(key: string): Product?
	for _, p in Products.PRODUCTS do
		if p.key == key then return p end
	end
	return nil
end

function Products.passByKey(key: string): Pass?
	for _, p in Products.PASSES do
		if p.key == key then return p end
	end
	return nil
end

function Products.passByPerk(perk: string): Pass?
	for _, p in Products.PASSES do
		if p.perk == perk then return p end
	end
	return nil
end

--- True when the catalogue entry has a real id behind it.
function Products.isConfigured(entry: { id: number }): boolean
	return entry.id ~= nil and entry.id > 0
end

--- How many of the catalogue is live — the shop header uses this to tell the
--- owner, in Studio, that they still have ids to fill in.
function Products.configuredCount(): (number, number)
	local live, total = 0, 0
	for _, p in Products.PRODUCTS do
		total += 1
		if p.id > 0 then live += 1 end
	end
	for _, p in Products.PASSES do
		total += 1
		if p.id > 0 then live += 1 end
	end
	return live, total
end

return Products
