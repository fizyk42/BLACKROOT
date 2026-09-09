--!strict
--[[
	ModMenu — the sandbox, on the backtick key.

	Renders whatever is in Mods.ALL rather than a hand-written list, so the
	menu and the server never disagree about what exists. Four control kinds:

	  toggle  a switch that takes effect immediately
	  slider  a live number — drag it while you are moving and it changes
	          under your feet
	  pick    a chooser; a paired action does the work
	  action  a button, run once

	It does not pause the game. That is the point of a sandbox: you break
	things while they are running and watch what happens.

	The tutorial is the seven-step walkthrough from the WebGL build, shown once
	and dismissable, with each step able to point at a specific control.
]]

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))

local player = Players.LocalPlayer

local gui = Instance.new("ScreenGui")
gui.Name = "BlackrootMods"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.DisplayOrder = 6
gui.Enabled = false
gui.Parent = player:WaitForChild("PlayerGui")

local INK = Color3.fromRGB(228, 230, 234)
local DIM = Color3.fromRGB(132, 138, 146)
local GOLD = Color3.fromRGB(244, 206, 128)
local GOOD = Color3.fromRGB(150, 220, 160)
local PANEL = Color3.fromRGB(14, 15, 18)

local SetMod = Net.event("SetMod")
local RunMod = Net.event("RunMod")

-- ── Shell ──────────────────────────────────────────────────────────────────
-- No dimmer: the sandbox stays visible behind the menu, because watching the
-- world change while you drag a slider is the whole feature.

local panel = Instance.new("Frame")
panel.AnchorPoint = Vector2.new(0, 0.5)
panel.Position = UDim2.new(0, 24, 0.5, 0)
panel.Size = UDim2.fromOffset(430, 620)
panel.BackgroundColor3 = PANEL
panel.BackgroundTransparency = 0.12
panel.BorderSizePixel = 0
panel.Parent = gui
Instance.new("UICorner", panel).CornerRadius = UDim.new(0, 8)
local edge = Instance.new("UIStroke")
edge.Color = Color3.fromRGB(58, 60, 66)
edge.Parent = panel

local title = Instance.new("TextLabel")
title.BackgroundTransparency = 1
title.Position = UDim2.fromOffset(20, 14)
title.Size = UDim2.fromOffset(300, 26)
title.Font = Enum.Font.Code
title.TextSize = 20
title.TextXAlignment = Enum.TextXAlignment.Left
title.TextColor3 = GOLD
title.Text = "MOD MENU"
title.Parent = panel

local hint = Instance.new("TextLabel")
hint.BackgroundTransparency = 1
hint.Position = UDim2.fromOffset(20, 38)
hint.Size = UDim2.fromOffset(390, 18)
hint.Font = Enum.Font.Code
hint.TextSize = 12
hint.TextXAlignment = Enum.TextXAlignment.Left
hint.TextColor3 = DIM
hint.Text = "` closes it. Nothing here is saved, nothing here is scored."
hint.Parent = panel

local groupRow = Instance.new("ScrollingFrame")
groupRow.Position = UDim2.fromOffset(16, 62)
groupRow.Size = UDim2.new(1, -32, 0, 30)
groupRow.BackgroundTransparency = 1
groupRow.BorderSizePixel = 0
groupRow.ScrollBarThickness = 2
groupRow.ScrollingDirection = Enum.ScrollingDirection.X
groupRow.CanvasSize = UDim2.new()
groupRow.AutomaticCanvasSize = Enum.AutomaticSize.X
groupRow.Parent = panel
local groupLayout = Instance.new("UIListLayout")
groupLayout.FillDirection = Enum.FillDirection.Horizontal
groupLayout.Padding = UDim.new(0, 6)
groupLayout.Parent = groupRow

local scroll = Instance.new("ScrollingFrame")
scroll.Position = UDim2.fromOffset(16, 100)
scroll.Size = UDim2.new(1, -32, 1, -118)
scroll.BackgroundTransparency = 1
scroll.BorderSizePixel = 0
scroll.ScrollBarThickness = 4
scroll.CanvasSize = UDim2.new()
scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
scroll.Parent = panel
local listLayout = Instance.new("UIListLayout")
listLayout.Padding = UDim.new(0, 5)
listLayout.SortOrder = Enum.SortOrder.LayoutOrder
listLayout.Parent = scroll

-- ── State ──────────────────────────────────────────────────────────────────

local catalogue: any = nil
local sandboxActive = false
local values: { [string]: any } = {}
local group = "Player"
local order = 0
local focusId: string? = nil
local rowsById: { [string]: Frame } = {}

-- ── Controls ───────────────────────────────────────────────────────────────

local function row(height: number, mod: any): Frame
	order += 1
	local c = Instance.new("Frame")
	c.Size = UDim2.new(1, -6, 0, height)
	c.LayoutOrder = order
	c.BackgroundColor3 = Color3.fromRGB(24, 25, 29)
	c.BackgroundTransparency = if focusId == mod.id then 0 else 0.2
	c.BorderSizePixel = 0
	c.Parent = scroll
	Instance.new("UICorner", c).CornerRadius = UDim.new(0, 5)

	if focusId == mod.id then
		local ring = Instance.new("UIStroke")
		ring.Color = GOLD
		ring.Thickness = 2
		ring.Parent = c
	end

	local name = Instance.new("TextLabel")
	name.BackgroundTransparency = 1
	name.Position = UDim2.fromOffset(12, 6)
	name.Size = UDim2.fromOffset(250, 20)
	name.Font = Enum.Font.Code
	name.TextSize = 15
	name.TextXAlignment = Enum.TextXAlignment.Left
	name.TextColor3 = INK
	name.Text = mod.label
	name.Parent = c

	local desc = Instance.new("TextLabel")
	desc.BackgroundTransparency = 1
	desc.Position = UDim2.fromOffset(12, 24)
	desc.Size = UDim2.new(1, -24, 0, 26)
	desc.Font = Enum.Font.Code
	desc.TextSize = 11
	desc.TextWrapped = true
	desc.TextXAlignment = Enum.TextXAlignment.Left
	desc.TextYAlignment = Enum.TextYAlignment.Top
	desc.TextColor3 = DIM
	desc.Text = mod.desc
	desc.Parent = c

	rowsById[mod.id] = c
	return c
end

local function makeToggle(mod: any)
	local c = row(56, mod)
	local on = values[mod.id] == true

	local sw = Instance.new("TextButton")
	sw.AnchorPoint = Vector2.new(1, 0)
	sw.Position = UDim2.new(1, -12, 0, 8)
	sw.Size = UDim2.fromOffset(52, 24)
	sw.BackgroundColor3 = if on then Color3.fromRGB(48, 78, 54) else Color3.fromRGB(34, 35, 40)
	sw.BorderSizePixel = 0
	sw.Font = Enum.Font.Code
	sw.TextSize = 13
	sw.TextColor3 = if on then GOOD else DIM
	sw.Text = if on then "ON" else "OFF"
	sw.Parent = c
	Instance.new("UICorner", sw).CornerRadius = UDim.new(0, 12)

	sw.Activated:Connect(function()
		SetMod:FireServer(mod.id, not on)
	end)
end

local function makeSlider(mod: any)
	local c = row(64, mod)
	local value = values[mod.id]
	if type(value) ~= "number" then value = mod.default or 0 end

	local readout = Instance.new("TextLabel")
	readout.AnchorPoint = Vector2.new(1, 0)
	readout.Position = UDim2.new(1, -12, 0, 6)
	readout.Size = UDim2.fromOffset(90, 20)
	readout.BackgroundTransparency = 1
	readout.Font = Enum.Font.Code
	readout.TextSize = 14
	readout.TextXAlignment = Enum.TextXAlignment.Right
	readout.TextColor3 = GOLD
	readout.Text = `{string.format("%.2f", value)}{mod.unit or ""}`
	readout.Parent = c

	local track = Instance.new("TextButton")
	track.Position = UDim2.fromOffset(12, 46)
	track.Size = UDim2.new(1, -24, 0, 10)
	track.BackgroundColor3 = Color3.fromRGB(34, 35, 40)
	track.BorderSizePixel = 0
	track.Text = ""
	track.AutoButtonColor = false
	track.Parent = c
	Instance.new("UICorner", track).CornerRadius = UDim.new(0, 5)

	local fill = Instance.new("Frame")
	local span = (mod.max or 1) - (mod.min or 0)
	fill.Size = UDim2.fromScale(if span > 0 then (value - (mod.min or 0)) / span else 0, 1)
	fill.BackgroundColor3 = GOLD
	fill.BorderSizePixel = 0
	fill.Parent = track
	Instance.new("UICorner", fill).CornerRadius = UDim.new(0, 5)

	local dragging = false

	local function apply(x: number)
		local rel = math.clamp((x - track.AbsolutePosition.X) / math.max(track.AbsoluteSize.X, 1), 0, 1)
		local raw = (mod.min or 0) + rel * span
		local step = mod.step or 0.01
		local snapped = math.round(raw / step) * step
		fill.Size = UDim2.fromScale(rel, 1)
		readout.Text = `{string.format("%.2f", snapped)}{mod.unit or ""}`
		SetMod:FireServer(mod.id, snapped)
	end

	track.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1
			or input.UserInputType == Enum.UserInputType.Touch then
			dragging = true
			apply(input.Position.X)
		end
	end)
	track.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1
			or input.UserInputType == Enum.UserInputType.Touch then
			dragging = false
		end
	end)
	UserInputService.InputChanged:Connect(function(input)
		if not dragging then return end
		if input.UserInputType == Enum.UserInputType.MouseMovement
			or input.UserInputType == Enum.UserInputType.Touch then
			apply(input.Position.X)
		end
	end)
end

local function makePick(mod: any)
	local options: { string } = mod.options or {}
	if mod.optionsFrom and catalogue and catalogue.modOptions then
		options = catalogue.modOptions[mod.optionsFrom] or {}
	end
	if #options == 0 then return end

	local c = row(56, mod)
	local current = values[mod.id] or mod.default or options[1]

	local index = 1
	for i, opt in options do
		if opt == current then index = i; break end
	end

	local readout = Instance.new("TextLabel")
	readout.AnchorPoint = Vector2.new(1, 0)
	readout.Position = UDim2.new(1, -74, 0, 8)
	readout.Size = UDim2.fromOffset(160, 22)
	readout.BackgroundTransparency = 1
	readout.Font = Enum.Font.Code
	readout.TextSize = 14
	readout.TextXAlignment = Enum.TextXAlignment.Right
	readout.TextColor3 = GOLD
	readout.Text = string.upper(tostring(current))
	readout.Parent = c

	local function step(by: number)
		index = ((index - 1 + by) % #options) + 1
		readout.Text = string.upper(options[index])
		SetMod:FireServer(mod.id, options[index])
	end

	for i, spec in { { "‹", 40 }, { "›", 12 } } do
		local b = Instance.new("TextButton")
		b.AnchorPoint = Vector2.new(1, 0)
		b.Position = UDim2.new(1, -(spec[2] :: number), 0, 8)
		b.Size = UDim2.fromOffset(24, 22)
		b.BackgroundColor3 = Color3.fromRGB(34, 35, 40)
		b.BorderSizePixel = 0
		b.Font = Enum.Font.Code
		b.TextSize = 15
		b.TextColor3 = INK
		b.Text = spec[1] :: string
		b.Parent = c
		Instance.new("UICorner", b).CornerRadius = UDim.new(0, 4)
		b.Activated:Connect(function() step(if i == 1 then -1 else 1) end)
	end
end

local function makeAction(mod: any)
	local c = row(56, mod)
	local b = Instance.new("TextButton")
	b.AnchorPoint = Vector2.new(1, 0)
	b.Position = UDim2.new(1, -12, 0, 8)
	b.Size = UDim2.fromOffset(84, 26)
	b.BackgroundColor3 = Color3.fromRGB(46, 42, 30)
	b.BorderSizePixel = 0
	b.Font = Enum.Font.Code
	b.TextSize = 13
	b.TextColor3 = GOLD
	b.Text = "RUN"
	b.Parent = c
	Instance.new("UICorner", b).CornerRadius = UDim.new(0, 5)
	b.Activated:Connect(function() RunMod:FireServer(mod.id) end)
end

-- ── Draw ───────────────────────────────────────────────────────────────────

local function redraw()
	order = 0
	table.clear(rowsById)
	for _, child in scroll:GetChildren() do
		if not child:IsA("UIListLayout") then child:Destroy() end
	end

	if not catalogue then return end
	if not sandboxActive then
		local warn = Instance.new("TextLabel")
		warn.Size = UDim2.new(1, 0, 0, 60)
		warn.BackgroundTransparency = 1
		warn.Font = Enum.Font.Code
		warn.TextSize = 14
		warn.TextWrapped = true
		warn.TextColor3 = DIM
		warn.Text = "The mod menu only works in the sandbox. Start a sandbox run to use it — a god-mode depth is not a depth."
		warn.Parent = scroll
		return
	end

	for _, mod in catalogue.mods do
		if mod.group ~= group then continue end
		if mod.kind == "toggle" then makeToggle(mod)
		elseif mod.kind == "slider" then makeSlider(mod)
		elseif mod.kind == "pick" then makePick(mod)
		elseif mod.kind == "action" then makeAction(mod) end
	end
end

local groupButtons: { [string]: TextButton } = {}

local function buildGroups()
	if not catalogue then return end
	for _, child in groupRow:GetChildren() do
		if not child:IsA("UIListLayout") then child:Destroy() end
	end
	for i, name in catalogue.modGroups do
		local b = Instance.new("TextButton")
		b.Size = UDim2.fromOffset(84, 26)
		b.LayoutOrder = i
		b.BackgroundColor3 = Color3.fromRGB(28, 30, 34)
		b.BorderSizePixel = 0
		b.Font = Enum.Font.Code
		b.TextSize = 13
		b.TextColor3 = if name == group then GOLD else DIM
		b.Text = string.upper(name)
		b.Parent = groupRow
		Instance.new("UICorner", b).CornerRadius = UDim.new(0, 4)
		groupButtons[name] = b

		b.Activated:Connect(function()
			group = name
			for other, btn in groupButtons do
				btn.TextColor3 = if other == name then GOLD else DIM
			end
			redraw()
		end)
	end
end

-- ── Tutorial ───────────────────────────────────────────────────────────────

local tutorial = Instance.new("Frame")
tutorial.AnchorPoint = Vector2.new(1, 1)
tutorial.Position = UDim2.new(1, -28, 1, -28)
tutorial.Size = UDim2.fromOffset(380, 170)
tutorial.BackgroundColor3 = PANEL
tutorial.BackgroundTransparency = 0.08
tutorial.BorderSizePixel = 0
tutorial.Visible = false
tutorial.Parent = gui
Instance.new("UICorner", tutorial).CornerRadius = UDim.new(0, 8)
local tEdge = Instance.new("UIStroke")
tEdge.Color = GOLD
tEdge.Transparency = 0.5
tEdge.Parent = tutorial

local tTitle = Instance.new("TextLabel")
tTitle.BackgroundTransparency = 1
tTitle.Position = UDim2.fromOffset(18, 14)
tTitle.Size = UDim2.fromOffset(340, 24)
tTitle.Font = Enum.Font.Code
tTitle.TextSize = 17
tTitle.TextXAlignment = Enum.TextXAlignment.Left
tTitle.TextColor3 = GOLD
tTitle.Parent = tutorial

local tBody = Instance.new("TextLabel")
tBody.BackgroundTransparency = 1
tBody.Position = UDim2.fromOffset(18, 42)
tBody.Size = UDim2.fromOffset(344, 72)
tBody.Font = Enum.Font.Code
tBody.TextSize = 13
tBody.TextWrapped = true
tBody.TextXAlignment = Enum.TextXAlignment.Left
tBody.TextYAlignment = Enum.TextYAlignment.Top
tBody.TextColor3 = INK
tBody.Parent = tutorial

local tStep = Instance.new("TextLabel")
tStep.BackgroundTransparency = 1
tStep.Position = UDim2.fromOffset(18, 128)
tStep.Size = UDim2.fromOffset(100, 22)
tStep.Font = Enum.Font.Code
tStep.TextSize = 12
tStep.TextXAlignment = Enum.TextXAlignment.Left
tStep.TextColor3 = DIM
tStep.Parent = tutorial

local step = 1
local tutorialDone = false

local function showStep()
	if not catalogue or not catalogue.tutorial then return end
	local s = catalogue.tutorial[step]
	if not s then
		tutorial.Visible = false
		tutorialDone = true
		focusId = nil
		redraw()
		return
	end
	tutorial.Visible = true
	tTitle.Text = s.title
	tBody.Text = s.body
	tStep.Text = `{step} / {#catalogue.tutorial}`
	focusId = s.focus

	-- Jump to the group holding the highlighted control.
	if s.focus then
		for _, mod in catalogue.mods do
			if mod.id == s.focus then
				group = mod.group
				for other, btn in groupButtons do
					btn.TextColor3 = if other == group then GOLD else DIM
				end
				break
			end
		end
	end
	redraw()
end

for i, spec in { { "SKIP", 96 }, { "NEXT", 18 } } do
	local b = Instance.new("TextButton")
	b.AnchorPoint = Vector2.new(1, 1)
	b.Position = UDim2.new(1, -(spec[2] :: number), 1, -14)
	b.Size = UDim2.fromOffset(72, 26)
	b.BackgroundColor3 = Color3.fromRGB(34, 35, 40)
	b.BorderSizePixel = 0
	b.Font = Enum.Font.Code
	b.TextSize = 13
	b.TextColor3 = if i == 2 then GOLD else DIM
	b.Text = spec[1] :: string
	b.Parent = tutorial
	Instance.new("UICorner", b).CornerRadius = UDim.new(0, 4)

	b.Activated:Connect(function()
		if i == 1 then
			tutorial.Visible = false
			tutorialDone = true
			focusId = nil
			redraw()
		else
			step += 1
			showStep()
		end
	end)
end

-- ── Wiring ─────────────────────────────────────────────────────────────────

Net.event("Sandbox").OnClientEvent:Connect(function(state)
	sandboxActive = state.active == true
	values = state.values or {}
	if gui.Enabled then redraw() end
end)

local function open(on: boolean)
	gui.Enabled = on
	UserInputService.MouseIconEnabled = on
	if not on then return end

	if not catalogue then
		task.spawn(function()
			local ok, data = pcall(function()
				return Net.func("GetCatalogueData"):InvokeServer()
			end)
			if ok then catalogue = data end
			buildGroups()
			redraw()
			if sandboxActive and not tutorialDone then showStep() end
		end)
	else
		redraw()
		if sandboxActive and not tutorialDone then showStep() end
	end
end

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	if input.KeyCode == Enum.KeyCode.Backquote then
		open(not gui.Enabled)
	elseif input.KeyCode == Enum.KeyCode.Escape and gui.Enabled then
		open(false)
	end
end)
