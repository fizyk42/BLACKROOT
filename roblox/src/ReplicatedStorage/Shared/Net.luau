--!strict
--[[
	Net — the remote surface, created once on the server and found (never
	created) on the client. Everything the client can ask for is listed here so
	the attack surface is one file long and readable in one sitting.

	Rule the server keeps: a remote is a *request*, never an instruction. The
	client may ask to fire, to buy, to use a kit. The server decides.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Net = {}

Net.EVENTS = {
	-- client → server
	"Fire",          -- (origin: Vector3, direction: Vector3)
	"Reload",
	"Aim",           -- (held: boolean, crouched: boolean)
	"Equip",         -- (id: string) or (direction: number) to cycle
	"Fit",           -- (slot: string, attachmentId: string)
	"Upgrade",       -- (trackId: string)
	"UseItem",       -- (id: string) or (slot: number)
	"AssignQuick",   -- (slot: number, id: string?)
	"DropItem",      -- (id: string, qty: number)
	"Interact",      -- (target: Instance)
	"Flashlight",    -- (on: boolean)
	"Sprint",        -- (on: boolean)
	"Crouch",        -- (on: boolean)
	"Mark",          -- (position: Vector3)   waypoint ping, shared in co-op
	"Revive",        -- (target: Player)
	"Chat",          -- (text: string)
	"RequestBuy",    -- (key: string, kind: string)
	"SetDifficulty", -- (id: string)
	"SetMod",        -- (id: string, value: any)   sandbox only
	"RunMod",        -- (id: string)               sandbox only
	"StartRun",      -- (mode: string, options: table)

	-- server → client
	"Stats",         -- (table)
	"Objective",     -- (position: Vector3?, label: string, distance: number)
	"Toast",         -- (text: string, tone: string)
	"Inventory",     -- (table)
	"Owned",         -- (table<string, boolean>)  passes the player holds
	"Hitmark",       -- (killed: boolean, headshot: boolean, landed: boolean)
	"RunState",      -- (table)
	"BossState",     -- (table?)  nil clears the bar
	"Squad",         -- (table)   everyone else's condition
	"Marks",         -- (table)   shared waypoints
	"Sandbox",       -- (table)   current mod values
	"Interactable",  -- (label: string?, target: Instance?)
}

Net.FUNCTIONS = {
	"GetCatalogue", -- () → { products, passes, owned }
	"GetRunState",
	"GetCatalogueData", -- () → items, weapons, attachments, upgrades, mods
}

local function container(): Folder
	local f = ReplicatedStorage:FindFirstChild("BlackrootNet")
	if f then return f :: Folder end
	assert(RunService:IsServer(), "BlackrootNet is missing — the server builds it")
	local made = Instance.new("Folder")
	made.Name = "BlackrootNet"
	made.Parent = ReplicatedStorage
	return made
end

--- Server-side: create every remote listed above. Idempotent.
function Net.build()
	assert(RunService:IsServer(), "Net.build is server-only")
	local f = container()
	for _, name in Net.EVENTS do
		if not f:FindFirstChild(name) then
			local e = Instance.new("RemoteEvent")
			e.Name = name
			e.Parent = f
		end
	end
	for _, name in Net.FUNCTIONS do
		if not f:FindFirstChild(name) then
			local e = Instance.new("RemoteFunction")
			e.Name = name
			e.Parent = f
		end
	end
end

--- Either side: fetch a remote by name, waiting on the client.
function Net.get(name: string): Instance
	local f = container()
	if RunService:IsServer() then
		local found = f:FindFirstChild(name)
		assert(found, `unknown remote "{name}" — add it to Net.EVENTS`)
		return found :: Instance
	end
	return f:WaitForChild(name, 20) :: Instance
end

function Net.event(name: string): RemoteEvent
	return Net.get(name) :: RemoteEvent
end

function Net.func(name: string): RemoteFunction
	return Net.get(name) :: RemoteFunction
end

return Net
