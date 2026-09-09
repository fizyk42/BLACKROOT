--!strict
--[[
	Hud — vitals, ammunition, the guide, the boss bar, the squad and toasts.

	Built in code rather than as a stored GuiObject tree so the whole interface
	lives in version control and a sync is all it takes to change it.

	The design rule from the WebGL build holds: nothing on screen unless it is
	telling you something you can act on. Hunger and thirst only appear when
	they are low; the boss bar only exists during a boss; the interact prompt
	only exists when there is something to search.
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local gui = Instance.new("ScreenGui")
gui.Name = "BlackrootHud"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = player:WaitForChild("PlayerGui")

local INK = Color3.fromRGB(226, 228, 232)
local DIM = Color3.fromRGB(140, 146, 154)
local WARN = Color3.fromRGB(226, 92, 74)
local GOOD = Color3.fromRGB(150, 220, 160)
local GOLD = Color3.fromRGB(244, 206, 128)

local function stroke(inst: Instance, thickness: number?)
	local s = Instance.new("UIStroke")
	s.Color = Color3.new(0, 0, 0)
	s.Thickness = thickness or 2
	s.Transparency = 0.45
	s.Parent = inst
	return s
end

local function label(name: string, parent: Instance, size: UDim2, pos: UDim2, textSize: number): TextLabel
	local t = Instance.new("TextLabel")
	t.Name = name
	t.BackgroundTransparency = 1
	t.Size = size
	t.Position = pos
	t.Font = Enum.Font.Code
	t.TextSize = textSize
	t.TextColor3 = INK
	t.TextXAlignment = Enum.TextXAlignment.Left
	t.Text = ""
	t.Parent = parent
	stroke(t)
	return t
end

local function bar(parent: Instance, size: UDim2, pos: UDim2, colour: Color3): (Frame, Frame)
	local back = Instance.new("Frame")
	back.Size = size
	back.Position = pos
	back.BackgroundColor3 = Color3.fromRGB(18, 18, 20)
	back.BackgroundTransparency = 0.35
	back.BorderSizePixel = 0
	back.Parent = parent

	local fill = Instance.new("Frame")
	fill.Size = UDim2.fromScale(1, 1)
	fill.BackgroundColor3 = colour
	fill.BorderSizePixel = 0
	fill.Parent = back

	return back, fill
end

-- ── Crosshair and hitmarker ────────────────────────────────────────────────

local cross = Instance.new("Frame")
cross.Name = "Crosshair"
cross.AnchorPoint = Vector2.new(0.5, 0.5)
cross.Position = UDim2.fromScale(0.5, 0.5)
cross.Size = UDim2.fromOffset(18, 18)
cross.BackgroundTransparency = 1
cross.Parent = gui

local ticks = {}
for _, spec in { { UDim2.fromOffset(2, 8), UDim2.new(0.5, -1, 0, -12) },
	{ UDim2.fromOffset(2, 8), UDim2.new(0.5, -1, 1, 4) },
	{ UDim2.fromOffset(8, 2), UDim2.new(0, -12, 0.5, -1) },
	{ UDim2.fromOffset(8, 2), UDim2.new(1, 4, 0.5, -1) } } do
	local tick = Instance.new("Frame")
	tick.Size = spec[1]
	tick.Position = spec[2]
	tick.BorderSizePixel = 0
	tick.BackgroundColor3 = INK
	tick.BackgroundTransparency = 0.15
	tick.Parent = cross
	table.insert(ticks, tick)
end

local hitmark = Instance.new("TextLabel")
hitmark.AnchorPoint = Vector2.new(0.5, 0.5)
hitmark.Position = UDim2.fromScale(0.5, 0.5)
hitmark.Size = UDim2.fromOffset(44, 44)
hitmark.BackgroundTransparency = 1
hitmark.Font = Enum.Font.Code
hitmark.TextSize = 30
hitmark.Text = "✕"
hitmark.TextColor3 = INK
hitmark.TextTransparency = 1
hitmark.Parent = gui

-- ── Vitals ─────────────────────────────────────────────────────────────────

local vitals = Instance.new("Frame")
vitals.Name = "Vitals"
vitals.AnchorPoint = Vector2.new(0, 1)
vitals.Position = UDim2.new(0, 28, 1, -28)
vitals.Size = UDim2.fromOffset(340, 140)
vitals.BackgroundTransparency = 1
vitals.Parent = gui

local hpText = label("Hp", vitals, UDim2.fromOffset(300, 26), UDim2.fromOffset(0, 0), 22)
local _, hpFill = bar(vitals, UDim2.fromOffset(300, 10), UDim2.fromOffset(0, 30), Color3.fromRGB(206, 214, 220))
local _, staminaFill = bar(vitals, UDim2.fromOffset(300, 4), UDim2.fromOffset(0, 44), Color3.fromRGB(150, 190, 220))
local statusText = label("Status", vitals, UDim2.fromOffset(340, 20), UDim2.fromOffset(0, 54), 15)
statusText.TextColor3 = DIM
local needsText = label("Needs", vitals, UDim2.fromOffset(340, 18), UDim2.fromOffset(0, 74), 14)
needsText.TextColor3 = DIM
local ammoText = label("Ammo", vitals, UDim2.fromOffset(340, 26), UDim2.fromOffset(0, 94), 20)
local quickText = label("Quick", vitals, UDim2.fromOffset(340, 18), UDim2.fromOffset(0, 120), 13)
quickText.TextColor3 = DIM

-- ── Objective and compass ──────────────────────────────────────────────────

local objective = Instance.new("Frame")
objective.AnchorPoint = Vector2.new(0.5, 0)
objective.Position = UDim2.new(0.5, 0, 0, 20)
objective.Size = UDim2.fromOffset(560, 56)
objective.BackgroundTransparency = 1
objective.Parent = gui

local objTitle = label("ObjTitle", objective, UDim2.fromScale(1, 0.55), UDim2.fromScale(0, 0), 20)
objTitle.TextXAlignment = Enum.TextXAlignment.Center
local objDist = label("ObjDist", objective, UDim2.fromScale(1, 0.45), UDim2.fromScale(0, 0.55), 15)
objDist.TextXAlignment = Enum.TextXAlignment.Center
objDist.TextColor3 = DIM

local compass = label("Compass", gui, UDim2.fromOffset(300, 20), UDim2.new(0.5, -150, 0, 78), 14)
compass.TextXAlignment = Enum.TextXAlignment.Center
compass.TextColor3 = DIM

-- The guide wisp: a marker in 3D that always points at the objective.
local beacon = Instance.new("BillboardGui")
beacon.Name = "Beacon"
beacon.Size = UDim2.fromOffset(46, 46)
beacon.AlwaysOnTop = true
beacon.Enabled = false
beacon.Parent = gui
local beaconIcon = Instance.new("TextLabel")
beaconIcon.Size = UDim2.fromScale(1, 1)
beaconIcon.BackgroundTransparency = 1
beaconIcon.Font = Enum.Font.Code
beaconIcon.TextSize = 34
beaconIcon.Text = "◈"
beaconIcon.TextColor3 = GOLD
beaconIcon.Parent = beacon

local beaconAnchor = Instance.new("Part")
beaconAnchor.Anchored = true
beaconAnchor.CanCollide = false
beaconAnchor.CanQuery = false
beaconAnchor.Transparency = 1
beaconAnchor.Size = Vector3.one
beaconAnchor.Name = "BlackrootBeaconAnchor"
beaconAnchor.Parent = workspace
beacon.Adornee = beaconAnchor

-- ── Boss bar ───────────────────────────────────────────────────────────────

local bossFrame = Instance.new("Frame")
bossFrame.AnchorPoint = Vector2.new(0.5, 0)
bossFrame.Position = UDim2.new(0.5, 0, 0, 110)
bossFrame.Size = UDim2.fromOffset(640, 62)
bossFrame.BackgroundTransparency = 1
bossFrame.Visible = false
bossFrame.Parent = gui

local bossName = label("BossName", bossFrame, UDim2.fromScale(1, 0.4), UDim2.fromScale(0, 0), 22)
bossName.TextXAlignment = Enum.TextXAlignment.Center
bossName.TextColor3 = WARN
local _, bossFill = bar(bossFrame, UDim2.new(1, 0, 0, 8), UDim2.fromOffset(0, 28), WARN)
local bossPhase = label("BossPhase", bossFrame, UDim2.fromScale(1, 0.3), UDim2.fromOffset(0, 40), 14)
bossPhase.TextXAlignment = Enum.TextXAlignment.Center
bossPhase.TextColor3 = DIM

-- ── Squad ──────────────────────────────────────────────────────────────────

local squadFrame = Instance.new("Frame")
squadFrame.AnchorPoint = Vector2.new(1, 1)
squadFrame.Position = UDim2.new(1, -22, 1, -28)
squadFrame.Size = UDim2.fromOffset(230, 140)
squadFrame.BackgroundTransparency = 1
squadFrame.Parent = gui
local squadLayout = Instance.new("UIListLayout")
squadLayout.VerticalAlignment = Enum.VerticalAlignment.Bottom
squadLayout.HorizontalAlignment = Enum.HorizontalAlignment.Right
squadLayout.Padding = UDim.new(0, 3)
squadLayout.Parent = squadFrame

-- ── Interact prompt ────────────────────────────────────────────────────────

local prompt = Instance.new("Frame")
prompt.AnchorPoint = Vector2.new(0.5, 0.5)
prompt.Position = UDim2.new(0.5, 0, 0.5, 90)
prompt.Size = UDim2.fromOffset(300, 44)
prompt.BackgroundTransparency = 1
prompt.Visible = false
prompt.Parent = gui

local promptText = label("PromptText", prompt, UDim2.fromScale(1, 0.55), UDim2.fromScale(0, 0), 16)
promptText.TextXAlignment = Enum.TextXAlignment.Center
local _, promptFill = bar(prompt, UDim2.new(1, 0, 0, 4), UDim2.fromOffset(0, 26), GOLD)

-- ── Toasts ─────────────────────────────────────────────────────────────────

local toastHolder = Instance.new("Frame")
toastHolder.AnchorPoint = Vector2.new(0.5, 0)
toastHolder.Position = UDim2.new(0.5, 0, 0, 190)
toastHolder.Size = UDim2.fromOffset(660, 220)
toastHolder.BackgroundTransparency = 1
toastHolder.Parent = gui
local toastLayout = Instance.new("UIListLayout")
toastLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
toastLayout.SortOrder = Enum.SortOrder.LayoutOrder
toastLayout.Padding = UDim.new(0, 4)
toastLayout.Parent = toastHolder

local TONE = {
	good = GOOD, warn = Color3.fromRGB(240, 190, 110), bad = WARN,
	info = DIM, title = Color3.fromRGB(255, 228, 176),
}

local function toast(text: string, tone: string?)
	local t = Instance.new("TextLabel")
	t.BackgroundTransparency = 1
	t.Size = UDim2.new(1, 0, 0, if tone == "title" then 34 else 24)
	t.Font = Enum.Font.Code
	t.TextSize = if tone == "title" then 26 else 18
	t.TextColor3 = TONE[tone or "info"] or INK
	t.Text = text
	t.Parent = toastHolder
	local s = stroke(t)

	task.delay(if tone == "title" then 4.5 else 2.8, function()
		TweenService:Create(t, TweenInfo.new(0.6), { TextTransparency = 1 }):Play()
		TweenService:Create(s, TweenInfo.new(0.6), { Transparency = 1 }):Play()
		task.delay(0.65, function() t:Destroy() end)
	end)
end

-- ── Damage vignette ────────────────────────────────────────────────────────

local vignette = Instance.new("Frame")
vignette.Size = UDim2.fromScale(1, 1)
vignette.BackgroundColor3 = WARN
vignette.BackgroundTransparency = 1
vignette.BorderSizePixel = 0
vignette.ZIndex = 0
vignette.Parent = gui

local downed = Instance.new("TextLabel")
downed.AnchorPoint = Vector2.new(0.5, 0.5)
downed.Position = UDim2.fromScale(0.5, 0.42)
downed.Size = UDim2.fromOffset(600, 60)
downed.BackgroundTransparency = 1
downed.Font = Enum.Font.Code
downed.TextSize = 28
downed.TextColor3 = WARN
downed.Text = ""
downed.Visible = false
downed.Parent = gui
stroke(downed)

-- ── State ──────────────────────────────────────────────────────────────────

local stats: any = { health = 100, maxHealth = 100, stamina = 100, maxStamina = 100 }
local bag: any = { mag = 0, magSize = 0, reserve = 0, quick = {} }
local perks: { [string]: boolean } = {}
local objPos: Vector3? = nil
local lastHealth = 100
local marks: { any } = {}
local markGuis: { BillboardGui } = {}
local highlights: { [BasePart]: Highlight } = {}

-- ── Wiring ─────────────────────────────────────────────────────────────────

Net.event("Stats").OnClientEvent:Connect(function(s)
	stats = s

	local frac = math.clamp(s.health / math.max(1, s.maxHealth), 0, 1)
	hpFill.Size = UDim2.fromScale(frac, 1)
	hpFill.BackgroundColor3 = if frac < 0.3 then WARN
		elseif frac < 0.6 then Color3.fromRGB(232, 196, 120)
		else Color3.fromRGB(206, 214, 220)
	hpText.Text = `{s.health} / {s.maxHealth}`

	staminaFill.Size = UDim2.fromScale(math.clamp(s.stamina / math.max(1, s.maxStamina), 0, 1), 1)

	local bits = {}
	if s.bleeding then table.insert(bits, "BLEEDING") end
	if s.poisoned then table.insert(bits, "POISONED") end
	if s.adrenaline and s.adrenaline > 0 then table.insert(bits, `ADRENALINE {math.ceil(s.adrenaline)}s`) end
	if s.fatigued then table.insert(bits, "SPENT") end
	if s.resisting then table.insert(bits, "NUMB") end
	if s.revives and s.revives > 0 then table.insert(bits, `SECOND WIND ×{s.revives}`) end
	if s.godMode then table.insert(bits, "GOD") end
	statusText.Text = table.concat(bits, "   ")
	statusText.TextColor3 = if s.bleeding or s.poisoned then WARN else DIM

	local needs = {}
	if s.hunger and s.hunger < 45 then table.insert(needs, `HUNGER {math.floor(s.hunger)}%`) end
	if s.thirst and s.thirst < 45 then table.insert(needs, `THIRST {math.floor(s.thirst)}%`) end
	if s.battery and s.battery < 40 then table.insert(needs, `LAMP {math.floor(s.battery)}%`) end
	if s.flashlight then table.insert(needs, "LAMP ON") end
	needsText.Text = table.concat(needs, "   ")

	-- The flash when you take a hit.
	if s.health < lastHealth - 0.5 then
		vignette.BackgroundTransparency = 0.72
		TweenService:Create(vignette, TweenInfo.new(0.5), { BackgroundTransparency = 1 }):Play()
	end
	lastHealth = s.health

	downed.Visible = s.downed == true
	if s.downed then
		downed.Text = `YOU ARE DOWN — {math.max(0, math.ceil(30 - (s.downedFor or 0)))}`
	end
end)

Net.event("Inventory").OnClientEvent:Connect(function(b)
	bag = b
	if b.kind == "melee" then
		ammoText.Text = `{b.weaponName}`
	elseif b.reloading then
		ammoText.Text = `{b.weaponName}   RELOADING…`
	else
		ammoText.Text = `{b.weaponName}   {b.mag} / {b.reserve}`
	end

	local slots = {}
	for i = 1, 5 do
		local id = b.quick and b.quick[i]
		table.insert(slots, `[{i}] {if id then string.upper(id) else "—"}`)
	end
	local carry = if b.weight and b.carryLimit
		then `   {string.format("%.1f", b.weight)}/{b.carryLimit} kg`
		else ""
	quickText.Text = table.concat(slots, "  ") .. carry
end)

Net.event("Objective").OnClientEvent:Connect(function(pos, labelText, distance)
	objPos = pos
	objTitle.Text = labelText or ""
	objDist.Text = if pos then `{distance} m` else ""
	beacon.Enabled = pos ~= nil
	if pos then beaconAnchor.Position = pos + Vector3.new(0, 12, 0) end
end)

Net.event("Toast").OnClientEvent:Connect(toast)

Net.event("Hitmark").OnClientEvent:Connect(function(killed, headshot, landed)
	if not landed then return end
	hitmark.TextColor3 = if killed then WARN else INK
	hitmark.Text = if headshot then "✖" else "✕"
	hitmark.TextTransparency = 0
	TweenService:Create(hitmark, TweenInfo.new(0.28), { TextTransparency = 1 }):Play()
end)

Net.event("BossState").OnClientEvent:Connect(function(state)
	if not state then
		bossFrame.Visible = false
		return
	end
	bossFrame.Visible = true
	bossName.Text = state.name
	bossFill.Size = UDim2.fromScale(math.clamp(state.health / math.max(1, state.maxHealth), 0, 1), 1)
	bossPhase.Text = if state.telegraph
		then string.upper(state.telegraph)
		else state.phaseName or ""
	bossPhase.TextColor3 = if state.telegraph then WARN else DIM
end)

Net.event("Squad").OnClientEvent:Connect(function(list)
	for _, child in squadFrame:GetChildren() do
		if not child:IsA("UIListLayout") then child:Destroy() end
	end
	if #list <= 1 then return end
	for _, entry in list do
		if entry.userId == player.UserId then continue end
		local row = Instance.new("TextLabel")
		row.Size = UDim2.new(1, 0, 0, 18)
		row.BackgroundTransparency = 1
		row.Font = Enum.Font.Code
		row.TextSize = 14
		row.TextXAlignment = Enum.TextXAlignment.Right
		row.TextColor3 = if entry.dead then DIM elseif entry.downed then WARN else INK
		local condition = if entry.dead then "DOWN FOR GOOD"
			elseif entry.downed then "DOWNED — GO"
			else `{entry.health}`
		row.Text = `{entry.name}  {condition}`
		row.Parent = squadFrame
		stroke(row)
	end
end)

Net.event("Marks").OnClientEvent:Connect(function(list)
	marks = list or {}
	for _, g in markGuis do g:Destroy() end
	table.clear(markGuis)

	for _, m in marks do
		local anchor = Instance.new("Part")
		anchor.Anchored = true
		anchor.CanCollide = false
		anchor.CanQuery = false
		anchor.Transparency = 1
		anchor.Size = Vector3.one
		anchor.Position = m.position + Vector3.new(0, 8, 0)
		anchor.Parent = workspace

		local g = Instance.new("BillboardGui")
		g.Size = UDim2.fromOffset(30, 30)
		g.AlwaysOnTop = true
		g.Adornee = anchor
		g.Parent = gui

		local icon = Instance.new("TextLabel")
		icon.Size = UDim2.fromScale(1, 1)
		icon.BackgroundTransparency = 1
		icon.Font = Enum.Font.Code
		icon.TextSize = 22
		icon.Text = "◆"
		icon.TextColor3 = Color3.fromRGB(130, 200, 255)
		icon.Parent = g

		g.Destroying:Connect(function() anchor:Destroy() end)
		table.insert(markGuis, g)
	end
end)

Net.event("Interactable").OnClientEvent:Connect(function(labelText, progress)
	if not labelText then
		prompt.Visible = false
		return
	end
	prompt.Visible = true
	promptText.Text = `[E] SEARCH — {labelText}`
	promptFill.Size = UDim2.fromScale(math.clamp(progress or 0, 0, 1), 1)
end)

Net.event("Owned").OnClientEvent:Connect(function(map)
	perks = map or {}
	if not perks.lootHighlight then
		for part, h in highlights do
			h:Destroy()
			highlights[part] = nil
		end
	end
end)

Net.event("RunState").OnClientEvent:Connect(function(state)
	if state.building then
		objTitle.Text = "BUILDING…"
		objDist.Text = ""
	end
end)

-- ── Per-frame ──────────────────────────────────────────────────────────────

local COMPASS = { [0] = "N", [45] = "NE", [90] = "E", [135] = "SE",
	[180] = "S", [225] = "SW", [270] = "W", [315] = "NW" }

local function bearingText(): string
	local look = camera.CFrame.LookVector
	local deg = math.deg(math.atan2(look.X, -look.Z)) % 360
	local nearest = math.round(deg / 45) * 45 % 360
	return `{math.floor(deg)}°  {COMPASS[nearest] or ""}`
end

--- Scavenger's Eye: outline nearby crates through the fog.
local function updateLootHighlights()
	if not perks.lootHighlight then return end
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not hrp then return end

	local near: { [BasePart]: boolean } = {}
	for _, inst in CollectionService:GetTagged("BlackrootLoot") do
		if not inst:IsA("BasePart") or not inst.Parent then continue end
		local part = inst :: BasePart
		if (part.Position - hrp.Position).Magnitude > 90 * 2.6 then continue end
		near[part] = true
		if not highlights[part] then
			local h = Instance.new("Highlight")
			h.FillTransparency = 0.78
			h.OutlineColor = GOLD
			h.FillColor = GOLD
			h.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop
			h.Adornee = part
			h.Parent = part
			highlights[part] = h
		end
	end

	for part, h in highlights do
		if not near[part] or not part.Parent then
			h:Destroy()
			highlights[part] = nil
		end
	end
end

local lootClock = 0

RunService.RenderStepped:Connect(function(dt)
	compass.Text = bearingText()

	if objPos then
		beaconAnchor.Position = objPos + Vector3.new(0, 12, 0)
		if perks.permanentBeacon then
			beacon.Enabled = true
			beaconIcon.TextTransparency = 0
			local char = player.Character
			local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
			if hrp then
				objDist.Text = `{math.floor((hrp.Position - objPos).Magnitude / 2.6)} m`
			end
		end
	end

	-- The crosshair opens with movement, so the spread is legible.
	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	local speed = if hum then hum.MoveDirection.Magnitude * hum.WalkSpeed else 0
	local spread = 10 + speed * 0.35
	ticks[1].Position = UDim2.new(0.5, -1, 0, -math.floor(spread + 2))
	ticks[2].Position = UDim2.new(0.5, -1, 1, math.floor(spread - 6))
	ticks[3].Position = UDim2.new(0, -math.floor(spread + 2), 0.5, -1)
	ticks[4].Position = UDim2.new(1, math.floor(spread - 6), 0.5, -1)

	lootClock += dt
	if lootClock >= 0.5 then
		lootClock = 0
		updateLootHighlights()
	end
end)
