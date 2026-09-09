--!strict
--[[
	Combat — input, from scripts/core/Input.js and PlayerController.js.

	Every action here is a *request*; the server decides. The bindings match
	the WebGL build key for key, because muscle memory is the one thing a port
	can actually carry across.

	  Mouse 1     fire / swing        R      reload
	  Mouse 2     aim down sights     E      interact (hold to search)
	  Shift       sprint              F      flashlight
	  Ctrl / C    crouch              1–5    quick slots
	  Wheel       cycle weapons       M      mark where you are looking
	  Tab         inventory           `      mod menu (sandbox only)

	Sprint, crouch and aim can each be switched from hold to toggle, the same
	three options the WebGL Settings screen offers, held in `prefs` below.

	Touch gets its own buttons. A Roblox experience that only works with a
	mouse is a Roblox experience most people cannot play.
]]

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local ContextActionService = game:GetService("ContextActionService")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Net = require(Shared:WaitForChild("Net"))

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local FireEvent = Net.event("Fire")
local ReloadEvent = Net.event("Reload")
local AimEvent = Net.event("Aim")
local EquipEvent = Net.event("Equip")
local UseEvent = Net.event("UseItem")
local InteractEvent = Net.event("Interact")
local FlashlightEvent = Net.event("Flashlight")
local SprintEvent = Net.event("Sprint")
local CrouchEvent = Net.event("Crouch")
local MarkEvent = Net.event("Mark")

-- ── Preferences ────────────────────────────────────────────────────────────
-- Hold by default, the same as the WebGL build's defaults.
local prefs = {
	toggleSprint = false,
	toggleCrouch = false,
	toggleAds = false,
	invertY = false,
	adsSensitivity = 0.65,
}

-- ── State ──────────────────────────────────────────────────────────────────

local firing = false
local aiming = false
local sprinting = false
local crouching = false
local flashlightOn = false
local interacting = false
local lastFire = 0
local rate = 0.1        -- replaced from the inventory packet
local isMelee = false
local baseFov = 70

Net.event("Inventory").OnClientEvent:Connect(function(b)
	isMelee = b.kind == "melee"
	if b.magSize and b.magSize > 0 then
		-- The client only needs a floor on its own send rate; the server does
		-- the real rate check. Anything faster than this is wasted packets.
		rate = 0.05
	end
end)

-- ── The lamp ───────────────────────────────────────────────────────────────
-- The flashlight is the only thing out here that reliably works, so it gets a
-- real light rather than a HUD icon.

local lamp = Instance.new("SpotLight")
lamp.Angle = 62
lamp.Brightness = 2.4
lamp.Range = 90
lamp.Color = Color3.fromRGB(255, 246, 224)
lamp.Shadows = true
lamp.Enabled = false

local function attachLamp()
	local char = player.Character
	local head = char and char:FindFirstChild("Head") :: BasePart?
	if head then lamp.Parent = head end
end
attachLamp()
player.CharacterAdded:Connect(function()
	task.wait(0.3)
	attachLamp()
end)

Net.event("Stats").OnClientEvent:Connect(function(s)
	lamp.Enabled = s.flashlight == true
	flashlightOn = s.flashlight == true
end)

-- ── Firing ─────────────────────────────────────────────────────────────────

local function muzzle(): (Vector3, Vector3)
	local char = player.Character
	local hrp = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	local origin = if hrp then hrp.Position + Vector3.new(0, 1.6, 0) else camera.CFrame.Position
	return origin, camera.CFrame.LookVector
end

local function tryFire()
	local now = os.clock()
	if now - lastFire < rate then return end
	lastFire = now
	local origin, dir = muzzle()
	FireEvent:FireServer(origin, dir)
end

-- ── Aim ────────────────────────────────────────────────────────────────────

local function setAiming(on: boolean)
	aiming = on
	AimEvent:FireServer(on, crouching)
	local target = if on then baseFov * prefs.adsSensitivity else baseFov
	TweenService:Create(camera, TweenInfo.new(0.18), { FieldOfView = target }):Play()
end

local function setSprinting(on: boolean)
	sprinting = on
	SprintEvent:FireServer(on)
end

local function setCrouching(on: boolean)
	crouching = on
	CrouchEvent:FireServer(on)
	AimEvent:FireServer(aiming, on)
end

-- ── Keyboard and mouse ─────────────────────────────────────────────────────

local QUICK = {
	[Enum.KeyCode.One] = 1, [Enum.KeyCode.Two] = 2, [Enum.KeyCode.Three] = 3,
	[Enum.KeyCode.Four] = 4, [Enum.KeyCode.Five] = 5,
}

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then return end

	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		firing = true
		tryFire()
		return
	end
	if input.UserInputType == Enum.UserInputType.MouseButton2 then
		setAiming(if prefs.toggleAds then not aiming else true)
		return
	end

	local slot = QUICK[input.KeyCode]
	if slot then
		UseEvent:FireServer(slot)
		return
	end

	if input.KeyCode == Enum.KeyCode.R then
		ReloadEvent:FireServer()
	elseif input.KeyCode == Enum.KeyCode.E then
		interacting = true
		InteractEvent:FireServer(true)
	elseif input.KeyCode == Enum.KeyCode.F then
		FlashlightEvent:FireServer(not flashlightOn)
	elseif input.KeyCode == Enum.KeyCode.M then
		-- Mark whatever you are looking at, out to 400 studs.
		local params = RaycastParams.new()
		params.FilterType = Enum.RaycastFilterType.Exclude
		params.FilterDescendantsInstances = { player.Character :: Instance }
		local hit = workspace:Raycast(camera.CFrame.Position, camera.CFrame.LookVector * 400, params)
		if hit then MarkEvent:FireServer(hit.Position) end
	elseif input.KeyCode == Enum.KeyCode.LeftShift then
		setSprinting(if prefs.toggleSprint then not sprinting else true)
	elseif input.KeyCode == Enum.KeyCode.LeftControl or input.KeyCode == Enum.KeyCode.C then
		setCrouching(if prefs.toggleCrouch then not crouching else true)
	elseif input.KeyCode == Enum.KeyCode.Q then
		-- The most appropriate medical item, whichever that is.
		UseEvent:FireServer("bandage")
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.UserInputType == Enum.UserInputType.MouseButton1 then
		firing = false
	elseif input.UserInputType == Enum.UserInputType.MouseButton2 then
		if not prefs.toggleAds then setAiming(false) end
	elseif input.KeyCode == Enum.KeyCode.E then
		interacting = false
		InteractEvent:FireServer(false)
	elseif input.KeyCode == Enum.KeyCode.LeftShift then
		if not prefs.toggleSprint then setSprinting(false) end
	elseif input.KeyCode == Enum.KeyCode.LeftControl or input.KeyCode == Enum.KeyCode.C then
		if not prefs.toggleCrouch then setCrouching(false) end
	end
end)

-- Mouse wheel cycles weapons.
UserInputService.InputChanged:Connect(function(input, gameProcessed)
	if gameProcessed then return end
	if input.UserInputType ~= Enum.UserInputType.MouseWheel then return end
	EquipEvent:FireServer(if input.Position.Z > 0 then 1 else -1)
end)

RunService.Heartbeat:Connect(function()
	if firing then tryFire() end
end)

-- ── Touch ──────────────────────────────────────────────────────────────────

if UserInputService.TouchEnabled then
	local function bind(name: string, title: string, position: UDim2, onDown: () -> (), onUp: (() -> ())?)
		ContextActionService:BindAction(name, function(_, state)
			if state == Enum.UserInputState.Begin then
				onDown()
			elseif state == Enum.UserInputState.End and onUp then
				onUp()
			end
			return Enum.ContextActionResult.Sink
		end, true)
		ContextActionService:SetTitle(name, title)
		ContextActionService:SetPosition(name, position)
	end

	bind("BlackrootFire", "FIRE", UDim2.new(1, -150, 1, -190),
		function() firing = true; tryFire() end,
		function() firing = false end)
	bind("BlackrootAim", "AIM", UDim2.new(1, -250, 1, -190),
		function() setAiming(true) end,
		function() setAiming(false) end)
	bind("BlackrootReload", "RLD", UDim2.new(1, -150, 1, -300),
		function() ReloadEvent:FireServer() end)
	bind("BlackrootInteract", "E", UDim2.new(1, -250, 1, -300),
		function() InteractEvent:FireServer(true) end,
		function() InteractEvent:FireServer(false) end)
	bind("BlackrootLamp", "LAMP", UDim2.new(1, -350, 1, -300),
		function() FlashlightEvent:FireServer(not flashlightOn) end)
	bind("BlackrootSprint", "RUN", UDim2.new(1, -350, 1, -190),
		function() setSprinting(true) end,
		function() setSprinting(false) end)
end

-- ── Gamepad ────────────────────────────────────────────────────────────────

UserInputService.InputBegan:Connect(function(input, gameProcessed)
	if gameProcessed then return end
	if input.KeyCode == Enum.KeyCode.ButtonR2 then
		firing = true; tryFire()
	elseif input.KeyCode == Enum.KeyCode.ButtonL2 then
		setAiming(true)
	elseif input.KeyCode == Enum.KeyCode.ButtonX then
		ReloadEvent:FireServer()
	elseif input.KeyCode == Enum.KeyCode.ButtonY then
		InteractEvent:FireServer(true)
	elseif input.KeyCode == Enum.KeyCode.ButtonL3 then
		setSprinting(true)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.KeyCode == Enum.KeyCode.ButtonR2 then
		firing = false
	elseif input.KeyCode == Enum.KeyCode.ButtonL2 then
		setAiming(false)
	elseif input.KeyCode == Enum.KeyCode.ButtonY then
		InteractEvent:FireServer(false)
	elseif input.KeyCode == Enum.KeyCode.ButtonL3 then
		setSprinting(false)
	end
end)

baseFov = camera.FieldOfView
