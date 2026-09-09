--!nonstrict
--[[
	BLACKROOT Studio Plugin — the bot's hands inside Studio.

	Studio cannot read your disk, so this asks a small server running on your
	own machine (roblox/tools/syncserver.mjs) for the source tree and rebuilds
	the instances from it. That is the same trick every Roblox source-sync tool
	uses; there is no other door into Studio, and there is deliberately no
	remote-control API for it.

	INSTALL
	  1. Copy this file to your Studio plugins folder:
	       Windows  %LOCALAPPDATA%\Roblox\Plugins\BlackrootSync.server.luau
	       macOS    ~/Documents/Roblox/Plugins/BlackrootSync.server.luau
	     (Or: right-click the script in Studio's Explorer → "Save as Local
	     Plugin", which puts it there for you. `npm run roblox:plugin` prints
	     the exact path for your machine.)
	  2. Run  npm run roblox:sync  in this repository.
	  3. Restart Studio. A BLACKROOT toolbar appears.

	BUTTONS
	  SYNC   pull once and rebuild
	  WATCH  poll every second and rebuild whenever the sources change
	  STOP   stop watching
	  WIPE   remove what the plugin built, leaving the rest of the place alone

	SAFETY
	  It only ever touches three containers, and only the specific children it
	  created (they are tagged). It will not delete anything you made by hand,
	  it cannot see anything outside roblox/src, and it talks to 127.0.0.1
	  only. If Studio refuses the request, enable HTTP for the place:
	  Home → Game Settings → Security → Allow HTTP Requests.
]]

local HttpService = game:GetService("HttpService")
local ServerScriptService = game:GetService("ServerScriptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterPlayer = game:GetService("StarterPlayer")
local CollectionService = game:GetService("CollectionService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local PORT = 34872
local BASE = `http://127.0.0.1:{PORT}`
local TAG = "BlackrootSynced"

local toolbar = plugin:CreateToolbar("BLACKROOT")
local syncButton = toolbar:CreateButton("SYNC", "Pull the Luau sources from disk once", "rbxasset://textures/ui/GuiImagePlaceholder.png")
local watchButton = toolbar:CreateButton("WATCH", "Re-sync whenever the sources change", "rbxasset://textures/ui/GuiImagePlaceholder.png")
local wipeButton = toolbar:CreateButton("WIPE", "Remove everything this plugin created", "rbxasset://textures/ui/GuiImagePlaceholder.png")

local watching = false
local lastHash: string? = nil

local function say(text: string)
	print(`[BLACKROOT] {text}`)
end

local function containerFor(name: string): Instance?
	if name == "ServerScriptService" then return ServerScriptService end
	if name == "ReplicatedStorage" then return ReplicatedStorage end
	if name == "StarterPlayerScripts" then
		return StarterPlayer:FindFirstChild("StarterPlayerScripts")
	end
	return nil
end

--- Build one node and its children. Returns the instance it made.
local function materialise(node, parent: Instance): Instance
	local inst: Instance
	if node.className == "Folder" then
		inst = Instance.new("Folder")
	else
		local s = Instance.new(node.className)
		;(s :: any).Source = node.source or ""
		inst = s
	end
	inst.Name = node.name
	CollectionService:AddTag(inst, TAG)
	inst.Parent = parent

	for _, child in node.children or {} do
		materialise(child, inst)
	end
	return inst
end

local function removeTagged(container: Instance, onlyNamed: string?)
	for _, child in container:GetChildren() do
		if CollectionService:HasTag(child, TAG) then
			if onlyNamed == nil or child.Name == onlyNamed then
				child:Destroy()
			end
		end
	end
end

local function wipe()
	local recording = ChangeHistoryService:TryBeginRecording("Blackroot wipe")
	for _, name in { "ServerScriptService", "ReplicatedStorage", "StarterPlayerScripts" } do
		local container = containerFor(name)
		if container then removeTagged(container) end
	end
	if recording then ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit) end
	lastHash = nil
	say("removed everything the plugin built")
end

local function fetch(pathName: string)
	local ok, result = pcall(function()
		return HttpService:GetAsync(BASE .. pathName, true)
	end)
	if not ok then
		return nil, tostring(result)
	end
	local decoded
	local ok2, err = pcall(function()
		decoded = HttpService:JSONDecode(result)
	end)
	if not ok2 then return nil, tostring(err) end
	return decoded, nil
end

local function syncOnce(quiet: boolean?): boolean
	local payload, err = fetch("/tree")
	if not payload then
		if not quiet then
			say(`could not reach the sync server: {err}`)
			say("start it with:  npm run roblox:sync")
			say("if Studio blocked the request: Home → Game Settings → Security → Allow HTTP Requests")
		end
		return false
	end

	local recording = ChangeHistoryService:TryBeginRecording("Blackroot sync")
	local made = 0

	for _, root in payload.roots do
		local container = containerFor(root.target)
		if not container then
			say(`no container named {root.target}; skipped`)
			continue
		end

		if root.inline then
			-- The children go straight into the container (StarterPlayerScripts).
			removeTagged(container)
			for _, child in root.tree.children or {} do
				materialise(child, container)
				made += 1
			end
		else
			removeTagged(container, root.tree.name)
			materialise(root.tree, container)
			made += 1
		end
	end

	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end

	lastHash = payload.hash
	say(`synced {made} top-level object(s), tree {payload.hash}`)
	return true
end

syncButton.Click:Connect(function()
	syncButton:SetActive(false)
	syncOnce(false)
end)

wipeButton.Click:Connect(function()
	wipeButton:SetActive(false)
	wipe()
end)

watchButton.Click:Connect(function()
	watching = not watching
	watchButton:SetActive(watching)
	if not watching then
		say("stopped watching")
		return
	end

	say("watching for changes")
	task.spawn(function()
		-- Poll the cheap /hash endpoint; only pull the whole tree when it moves.
		while watching do
			local payload = fetch("/hash")
			if payload and payload.hash and payload.hash ~= lastHash then
				syncOnce(true)
			end
			task.wait(1)
		end
	end)
end)

plugin.Unloading:Connect(function()
	watching = false
end)

say("plugin loaded. run `npm run roblox:sync`, then press SYNC.")
