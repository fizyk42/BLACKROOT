--!strict
--[[
	Inventory — the bag, the armoury and the upgrade tracks, on Tab.

	Three panes behind one key, because in the WebGL build they were three
	screens the player moved between constantly and the movement was the
	annoying part.

	  BAG        what you are carrying, what it weighs, what it does
	  ARMOURY    the held weapon, its seven attachment slots
	  UPGRADES   six tracks, the points you have, what the next level costs

	Everything here sends a request and redraws when the server answers. The
	panel never assumes a click worked, because the server is allowed to say no
	— not enough points, an attachment that does not exist, a weapon you are
	not actually holding.
]]

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))

local player = Players.LocalPlayer

local gui = Instance.new("ScreenGui")
gui.Name = "BlackrootInventory"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.DisplayOrder = 4
gui.Enabled = false
gui.Parent = player:WaitForChild("PlayerGui")

local INK = Color3.fromRGB(228, 230, 234)
local DIM = Color3.fromRGB(132, 138, 146)
local GOLD = Color3.fromRGB(244, 206, 128)
local GOOD = Color3.fromRGB(150, 220, 160)
local PANEL = Color3.fromRGB(16, 17, 20)

local UseEvent = Net.event("UseItem")
local EquipEvent = Net.event("Equip")
local FitEvent = Net.event("Fit")
local UpgradeEvent = Net.event("Upgrade")
local AssignEvent = Net.event("AssignQuick")
local DropEvent = Net.event("DropItem")

-- ── Shell ──────────────────────────────────────────────────────────────────

local dim = Instance.new("Frame")
dim.Size = UDim2.fromScale(1, 1)
dim.BackgroundColor3 = Color3.new(0, 0, 0)
dim.BackgroundTransparency = 0.45
dim.BorderSizePixel = 0
dim.Parent = gui

local panel = Instance.new("Frame")
panel.AnchorPoint = Vector2.new(0.5, 0.5)
panel.Position = UDim2.fromScale(0.5, 0.5)
panel.Size = UDim2.fromOffset(880, 600)
panel.BackgroundColor3 = PANEL
panel.BackgroundTransparency = 0.04
panel.BorderSizePixel = 0
panel.Parent = gui
Instance.new("UICorner", panel).CornerRadius = UDim.new(0, 8)
local edge = Instance.new("UIStroke")
edge.Color = Color3.fromRGB(58, 60, 66)
edge.Parent = panel

local title = Instance.new("TextLabel")
title.BackgroundTransparency = 1
title.Position = UDim2.fromOffset(24, 18)
title.Size = UDim2.fromOffset(400, 28)
title.Font = Enum.Font.Code
title.TextSize = 22
title.TextXAlignment = Enum.TextXAlignment.Left
title.TextColor3 = INK
title.Text = "BAG"
title.Parent = panel

local summary = Instance.new("TextLabel")
summary.BackgroundTransparency = 1
summary.AnchorPoint = Vector2.new(1, 0)
summary.Position = UDim2.new(1, -24, 0, 22)
summary.Size = UDim2.fromOffset(400, 22)
summary.Font = Enum.Font.Code
summary.TextSize = 15
summary.TextXAlignment = Enum.TextXAlignment.Right
summary.TextColor3 = DIM
summary.Text = ""
summary.Parent = panel

local tabsRow = Instance.new("Frame")
tabsRow.Position = UDim2.fromOffset(24, 52)
tabsRow.Size = UDim2.new(1, -48, 0, 32)
tabsRow.BackgroundTransparency = 1
tabsRow.Parent = panel
local tabsLayout = Instance.new("UIListLayout")
tabsLayout.FillDirection = Enum.FillDirection.Horizontal
tabsLayout.Padding = UDim.new(0, 8)
tabsLayout.Parent = tabsRow

local scroll = Instance.new("ScrollingFrame")
scroll.Position = UDim2.fromOffset(24, 94)
scroll.Size = UDim2.new(1, -48, 1, -118)
scroll.BackgroundTransparency = 1
scroll.BorderSizePixel = 0
scroll.ScrollBarThickness = 4
scroll.CanvasSize = UDim2.new()
scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
scroll.Parent = panel
local listLayout = Instance.new("UIListLayout")
listLayout.Padding = UDim.new(0, 6)
listLayout.SortOrder = Enum.SortOrder.LayoutOrder
listLayout.Parent = scroll

-- ── State ──────────────────────────────────────────────────────────────────

local pane = "BAG"
local bag: any = { stacks = {}, quick = {}, levels = {}, fit = {} }
local catalogue: any = nil
local order = 0

local function nextOrder(): number
	order += 1
	return order
end

local function clear()
	order = 0
	for _, child in scroll:GetChildren() do
		if not child:IsA("UIListLayout") then child:Destroy() end
	end
end

local function heading(text: string)
	local h = Instance.new("TextLabel")
	h.BackgroundTransparency = 1
	h.Size = UDim2.new(1, 0, 0, 26)
	h.LayoutOrder = nextOrder()
	h.Font = Enum.Font.Code
	h.TextSize = 14
	h.TextXAlignment = Enum.TextXAlignment.Left
	h.TextColor3 = GOLD
	h.Text = text
	h.Parent = scroll
end

local function card(height: number): Frame
	local c = Instance.new("Frame")
	c.Size = UDim2.new(1, -6, 0, height)
	c.LayoutOrder = nextOrder()
	c.BackgroundColor3 = Color3.fromRGB(24, 25, 29)
	c.BackgroundTransparency = 0.1
	c.BorderSizePixel = 0
	c.Parent = scroll
	Instance.new("UICorner", c).CornerRadius = UDim.new(0, 6)
	return c
end

local function button(parent: Instance, text: string, width: number, x: number, colour: Color3): TextButton
	local b = Instance.new("TextButton")
	b.AnchorPoint = Vector2.new(1, 0.5)
	b.Position = UDim2.new(1, -x, 0.5, 0)
	b.Size = UDim2.fromOffset(width, 32)
	b.BackgroundColor3 = Color3.fromRGB(42, 46, 52)
	b.BorderSizePixel = 0
	b.Font = Enum.Font.Code
	b.TextSize = 14
	b.TextColor3 = colour
	b.Text = text
	b.Parent = parent
	Instance.new("UICorner", b).CornerRadius = UDim.new(0, 5)
	return b
end

local function text(parent: Instance, str: string, size: number, pos: UDim2, width: number, colour: Color3): TextLabel
	local t = Instance.new("TextLabel")
	t.BackgroundTransparency = 1
	t.Position = pos
	t.Size = UDim2.fromOffset(width, size + 6)
	t.Font = Enum.Font.Code
	t.TextSize = size
	t.TextXAlignment = Enum.TextXAlignment.Left
	t.TextColor3 = colour
	t.Text = str
	t.Parent = parent
	return t
end

-- ── Panes ──────────────────────────────────────────────────────────────────

local function drawBag()
	if not catalogue then heading("Loading…") return end

	local byCat: { [string]: { any } } = {}
	for _, s in bag.stacks do
		local def = catalogue.items[s.id] or catalogue.weapons[s.id] or catalogue.ammo[s.id]
		local cat = if def then def.cat else "other"
		byCat[cat] = byCat[cat] or {}
		table.insert(byCat[cat], { stack = s, def = def })
	end

	for _, cat in { "weapon", "ammo", "medical", "food", "supply", "key", "other" } do
		local rows = byCat[cat]
		if not rows then continue end
		heading(string.upper(cat))

		for _, row in rows do
			local def = row.def
			local s = row.stack
			local c = card(56)

			text(c, `{def and def.icon or "·"}  {def and def.name or s.id}`, 16, UDim2.fromOffset(14, 8), 420, INK)
			local detail = if def and def.weight
				then `×{s.qty}    {string.format("%.2f", def.weight * s.qty)} kg`
				else `×{s.qty}`
			text(c, detail, 13, UDim2.fromOffset(14, 30), 420, DIM)

			if cat == "weapon" then
				local equipBtn = button(c, if bag.equipped == s.id then "HELD" else "EQUIP", 90, 14,
					if bag.equipped == s.id then GOOD else GOLD)
				equipBtn.Activated:Connect(function() EquipEvent:FireServer(s.id) end)
			elseif def and def.useTime then
				local useBtn = button(c, "USE", 74, 14, GOLD)
				useBtn.Activated:Connect(function() UseEvent:FireServer(s.id) end)

				local assignBtn = button(c, "→ SLOT", 84, 96, DIM)
				assignBtn.Activated:Connect(function()
					-- Fill the first empty quick slot, or overwrite slot 1.
					local target = 1
					for i = 1, 5 do
						if not bag.quick[i] then target = i; break end
					end
					AssignEvent:FireServer(target, s.id)
				end)
			end

			if cat ~= "weapon" then
				local dropBtn = button(c, "DROP", 70, if def and def.useTime then 190 else 14, Color3.fromRGB(200, 120, 110))
				dropBtn.Activated:Connect(function() DropEvent:FireServer(s.id, 1) end)
			end
		end
	end

	if #bag.stacks == 0 then heading("Empty.") end
end

local function drawArmoury()
	if not catalogue then heading("Loading…") return end
	if not bag.equipped then heading("Nothing held.") return end

	heading(string.upper(bag.weaponName or bag.equipped))

	for _, slot in catalogue.slots do
		local options = catalogue.attachments[slot]
		if not options then continue end

		local c = card(72)
		text(c, catalogue.slotLabels[slot] or slot, 15, UDim2.fromOffset(14, 8), 200, GOLD)

		local fitted = bag.fit[slot]
		local fittedName = ""
		for _, opt in options do
			if opt.id == fitted then fittedName = opt.name; break end
		end
		text(c, fittedName, 13, UDim2.fromOffset(14, 28), 300, DIM)

		-- One button per option, laid out right to left.
		local x = 14
		for i = #options, 1, -1 do
			local opt = options[i]
			local width = math.max(64, #opt.id * 9 + 18)
			local b = button(c, string.upper(opt.id), width, x,
				if opt.id == fitted then GOOD else INK)
			b.Activated:Connect(function() FitEvent:FireServer(slot, opt.id) end)
			x += width + 6
		end
	end
end

local function drawUpgrades()
	if not catalogue then heading("Loading…") return end
	heading(`{bag.points or 0} POINTS — earned by killing, finding places and staying alive`)

	for _, track in catalogue.upgrades do
		local level = (bag.levels or {})[track.id] or 0
		local c = card(64)

		text(c, track.label, 16, UDim2.fromOffset(14, 8), 320, INK)

		local pips = {}
		for i = 1, track.max do
			table.insert(pips, if i <= level then "■" else "□")
		end
		text(c, table.concat(pips, " "), 15, UDim2.fromOffset(14, 32), 200, if level > 0 then GOOD else DIM)

		if level >= track.max then
			local b = button(c, "MAXED", 110, 14, GOOD)
			b.AutoButtonColor = false
		else
			local cost = track.baseCost + level * track.baseCost
			local affordable = (bag.points or 0) >= cost
			local b = button(c, `+1  ·  {cost}`, 110, 14, if affordable then GOLD else DIM)
			if affordable then
				b.Activated:Connect(function() UpgradeEvent:FireServer(track.id) end)
			else
				b.AutoButtonColor = false
			end
		end
	end
end

local function redraw()
	clear()
	title.Text = pane
	summary.Text = if bag.weight
		then `{string.format("%.1f", bag.weight)} / {bag.carryLimit} kg     {bag.points or 0} pts`
		else ""

	if pane == "BAG" then drawBag()
	elseif pane == "ARMOURY" then drawArmoury()
	else drawUpgrades() end
end

-- ── Tabs ───────────────────────────────────────────────────────────────────

local tabButtons: { [string]: TextButton } = {}
for i, name in { "BAG", "ARMOURY", "UPGRADES" } do
	local b = Instance.new("TextButton")
	b.Size = UDim2.fromOffset(130, 30)
	b.LayoutOrder = i
	b.BackgroundColor3 = Color3.fromRGB(30, 32, 36)
	b.BorderSizePixel = 0
	b.Font = Enum.Font.Code
	b.TextSize = 15
	b.TextColor3 = DIM
	b.Text = name
	b.Parent = tabsRow
	Instance.new("UICorner", b).CornerRadius = UDim.new(0, 5)
	tabButtons[name] = b

	b.Activated:Connect(function()
		pane = name
		for other, btn in tabButtons do
			btn.TextColor3 = if other == name then GOLD else DIM
		end
		redraw()
	end)
end
tabButtons.BAG.TextColor3 = GOLD

-- ── Wiring ─────────────────────────────────────────────────────────────────

Net.event("Inventory").OnClientEvent:Connect(function(b)
	bag = b
	if gui.Enabled then redraw() end
end)

local function open(on: boolean)
	gui.Enabled = on
	UserInputService.MouseIconEnabled = on
	if on then
		if not catalogue then
			task.spawn(function()
				local ok, data = pcall(function()
					return Net.func("GetCatalogueData"):InvokeServer()
				end)
				if ok then catalogue = data end
				redraw()
			end)
		end
		redraw()
	end
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	if input.KeyCode == Enum.KeyCode.Tab then
		open(not gui.Enabled)
	elseif input.KeyCode == Enum.KeyCode.Escape and gui.Enabled then
		open(false)
	end
end)
