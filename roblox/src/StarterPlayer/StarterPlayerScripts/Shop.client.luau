--!strict
--[[
	Shop — the Robux storefront, opened with B or the top-right button.

	The client never grants anything and never sees a product id it can act on.
	Pressing BUY sends a key; the server looks the key up and asks Roblox to
	show its own purchase dialog. Everything the player sees here — price
	included — is display text read from the shared catalogue, and the
	dashboard remains the only place a price is really set.

	Entries the owner has not configured yet render greyed out and say so,
	rather than silently doing nothing when pressed.
]]

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))

local player = Players.LocalPlayer
local BuyEvent = Net.event("RequestBuy")
local Catalogue = Net.func("GetCatalogue")

local gui = Instance.new("ScreenGui")
gui.Name = "BlackrootShop"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.DisplayOrder = 5
gui.Parent = player:WaitForChild("PlayerGui")

local INK = Color3.fromRGB(228, 230, 234)
local DIM = Color3.fromRGB(132, 138, 146)
local GOLD = Color3.fromRGB(244, 206, 128)
local PANEL = Color3.fromRGB(16, 17, 20)

-- ── Open button ────────────────────────────────────────────────────────────
local openBtn = Instance.new("TextButton")
openBtn.Name = "Open"
openBtn.AnchorPoint = Vector2.new(1, 0)
openBtn.Position = UDim2.new(1, -22, 0, 22)
openBtn.Size = UDim2.fromOffset(132, 34)
openBtn.BackgroundColor3 = PANEL
openBtn.BackgroundTransparency = 0.25
openBtn.BorderSizePixel = 0
openBtn.Font = Enum.Font.Code
openBtn.TextSize = 16
openBtn.TextColor3 = GOLD
openBtn.Text = "SUPPLY  [B]"
openBtn.Parent = gui
Instance.new("UICorner", openBtn).CornerRadius = UDim.new(0, 4)

-- ── Panel ──────────────────────────────────────────────────────────────────
local panel = Instance.new("Frame")
panel.Name = "Panel"
panel.AnchorPoint = Vector2.new(0.5, 0.5)
panel.Position = UDim2.fromScale(0.5, 0.5)
panel.Size = UDim2.fromOffset(720, 560)
panel.BackgroundColor3 = PANEL
panel.BackgroundTransparency = 0.06
panel.BorderSizePixel = 0
panel.Visible = false
panel.Parent = gui
Instance.new("UICorner", panel).CornerRadius = UDim.new(0, 8)
local edge = Instance.new("UIStroke")
edge.Color = Color3.fromRGB(58, 60, 66)
edge.Thickness = 1
edge.Parent = panel

local title = Instance.new("TextLabel")
title.BackgroundTransparency = 1
title.Position = UDim2.fromOffset(24, 18)
title.Size = UDim2.fromOffset(400, 30)
title.Font = Enum.Font.Code
title.TextSize = 22
title.TextXAlignment = Enum.TextXAlignment.Left
title.TextColor3 = INK
title.Text = "SUPPLY DROP"
title.Parent = panel

local subtitle = Instance.new("TextLabel")
subtitle.BackgroundTransparency = 1
subtitle.Position = UDim2.fromOffset(24, 46)
subtitle.Size = UDim2.fromOffset(660, 20)
subtitle.Font = Enum.Font.Code
subtitle.TextSize = 14
subtitle.TextXAlignment = Enum.TextXAlignment.Left
subtitle.TextColor3 = DIM
subtitle.Text = "Everything here also drops in the world. This is the shortcut, not the only road."
subtitle.Parent = panel

local closeBtn = Instance.new("TextButton")
closeBtn.AnchorPoint = Vector2.new(1, 0)
closeBtn.Position = UDim2.new(1, -18, 0, 18)
closeBtn.Size = UDim2.fromOffset(30, 30)
closeBtn.BackgroundTransparency = 1
closeBtn.Font = Enum.Font.Code
closeBtn.TextSize = 22
closeBtn.TextColor3 = DIM
closeBtn.Text = "✕"
closeBtn.Parent = panel

local scroll = Instance.new("ScrollingFrame")
scroll.Position = UDim2.fromOffset(20, 82)
scroll.Size = UDim2.new(1, -40, 1, -102)
scroll.BackgroundTransparency = 1
scroll.BorderSizePixel = 0
scroll.ScrollBarThickness = 4
scroll.CanvasSize = UDim2.new()
scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
scroll.Parent = panel

local list = Instance.new("UIListLayout")
list.Padding = UDim.new(0, 8)
list.SortOrder = Enum.SortOrder.LayoutOrder
list.Parent = scroll

-- ── Rows ───────────────────────────────────────────────────────────────────

local function heading(text: string, order: number)
	local h = Instance.new("TextLabel")
	h.BackgroundTransparency = 1
	h.Size = UDim2.new(1, 0, 0, 28)
	h.LayoutOrder = order
	h.Font = Enum.Font.Code
	h.TextSize = 15
	h.TextXAlignment = Enum.TextXAlignment.Left
	h.TextColor3 = GOLD
	h.Text = text
	h.Parent = scroll
end

local function row(entry: any, kind: string, order: number, ownedAlready: boolean)
	local configured = (entry.id or 0) > 0

	local card = Instance.new("Frame")
	card.Size = UDim2.new(1, -6, 0, 78)
	card.LayoutOrder = order
	card.BackgroundColor3 = Color3.fromRGB(24, 25, 29)
	card.BackgroundTransparency = configured and 0.1 or 0.5
	card.BorderSizePixel = 0
	card.Parent = scroll
	Instance.new("UICorner", card).CornerRadius = UDim.new(0, 6)

	local glyph = Instance.new("TextLabel")
	glyph.BackgroundTransparency = 1
	glyph.Position = UDim2.fromOffset(14, 14)
	glyph.Size = UDim2.fromOffset(50, 50)
	glyph.Font = Enum.Font.Code
	glyph.TextSize = 30
	glyph.TextColor3 = configured and GOLD or DIM
	glyph.Text = entry.glyph or "●"
	glyph.Parent = card

	local name = Instance.new("TextLabel")
	name.BackgroundTransparency = 1
	name.Position = UDim2.fromOffset(74, 12)
	name.Size = UDim2.new(1, -260, 0, 22)
	name.Font = Enum.Font.Code
	name.TextSize = 17
	name.TextXAlignment = Enum.TextXAlignment.Left
	name.TextColor3 = configured and INK or DIM
	name.Text = entry.name
	name.Parent = card

	local blurb = Instance.new("TextLabel")
	blurb.BackgroundTransparency = 1
	blurb.Position = UDim2.fromOffset(74, 34)
	blurb.Size = UDim2.new(1, -260, 0, 34)
	blurb.Font = Enum.Font.Code
	blurb.TextSize = 13
	blurb.TextWrapped = true
	blurb.TextXAlignment = Enum.TextXAlignment.Left
	blurb.TextYAlignment = Enum.TextYAlignment.Top
	blurb.TextColor3 = DIM
	blurb.Text = configured and entry.blurb or (entry.blurb .. "  (not configured — see Products.luau)")
	blurb.Parent = card

	local buy = Instance.new("TextButton")
	buy.AnchorPoint = Vector2.new(1, 0.5)
	buy.Position = UDim2.new(1, -14, 0.5, 0)
	buy.Size = UDim2.fromOffset(158, 40)
	buy.BorderSizePixel = 0
	buy.Font = Enum.Font.Code
	buy.TextSize = 16
	buy.Parent = card
	Instance.new("UICorner", buy).CornerRadius = UDim.new(0, 5)

	if ownedAlready then
		buy.Text = "OWNED"
		buy.BackgroundColor3 = Color3.fromRGB(34, 44, 36)
		buy.TextColor3 = Color3.fromRGB(150, 220, 160)
		buy.AutoButtonColor = false
	elseif not configured then
		buy.Text = "UNAVAILABLE"
		buy.BackgroundColor3 = Color3.fromRGB(30, 31, 35)
		buy.TextColor3 = DIM
		buy.AutoButtonColor = false
	else
		buy.Text = `R$ {entry.price}`
		buy.BackgroundColor3 = Color3.fromRGB(42, 46, 52)
		buy.TextColor3 = GOLD
		buy.Activated:Connect(function()
			BuyEvent:FireServer(entry.key, kind)
		end)
	end
end

local built = false

local function rebuild()
	for _, child in scroll:GetChildren() do
		if not child:IsA("UIListLayout") then child:Destroy() end
	end

	local ok, data = pcall(function() return Catalogue:InvokeServer() end)
	if not ok or type(data) ~= "table" then
		heading("The store is not answering. Try again in a moment.", 1)
		return
	end

	local order = 0
	order += 1; heading("CONSUMABLES — spend them on a run that is going badly", order)
	for _, p in data.products do
		order += 1
		row(p, "consumable", order, false)
	end

	order += 1; heading("PASSES — one purchase, every run after it", order)
	for _, p in data.passes do
		order += 1
		row(p, "pass", order, (data.owned or {})[p.perk] == true)
	end

	built = true
end

local function setOpen(open: boolean)
	if open and not built then rebuild() end
	panel.Visible = open
	panel.Size = open and UDim2.fromOffset(720, 560) or panel.Size
	if open then
		panel.BackgroundTransparency = 1
		TweenService:Create(panel, TweenInfo.new(0.18), { BackgroundTransparency = 0.06 }):Play()
	end
end

openBtn.Activated:Connect(function() setOpen(not panel.Visible) end)
closeBtn.Activated:Connect(function() setOpen(false) end)

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then return end
	if input.KeyCode == Enum.KeyCode.B then
		setOpen(not panel.Visible)
	elseif input.KeyCode == Enum.KeyCode.Escape and panel.Visible then
		setOpen(false)
	end
end)

-- Ownership can change mid-session; redraw so the OWNED badge is honest.
Net.event("Owned").OnClientEvent:Connect(function()
	if panel.Visible then rebuild() else built = false end
end)
