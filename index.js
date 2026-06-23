const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 19130;
const TICK_INTERVAL_MS = 50;
const MAX_STACK_SIZE = 64;

const STARTER_BLOCKS = ['grass', 'dirt', 'stone', 'wood'];
const STARTER_BLOCK_COUNT = 32;

const ITEM_MAPPING = {
    1: 'grass',
    2: 'stone',
    3: 'wood',
    4: 'dirt'
};

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('WebSocket Server Running');
});

const wss = new WebSocketServer({ server });

const players = {};
const world = {};

function initWorld() {
    for (let x = -12; x < 12; x++) {
        for (let z = -12; z < 12; z++) {
            const height = Math.floor(Math.sin(x * 0.15) * Math.cos(z * 0.15) * 3 + 4);
            for (let y = 0; y <= height; y++) {
                const type = y === height ? 'grass' : (y > height - 3 ? 'dirt' : 'stone');
                world[`${x},${y},${z}`] = type;
            }
        }
    }
}

initWorld();

function createStarterInventory() {
    const inventory = {};
    for (const blockType of STARTER_BLOCKS) {
        inventory[blockType] = {
            count: STARTER_BLOCK_COUNT,
            maxCount: MAX_STACK_SIZE
        };
    }
    return inventory;
}

function buildWorldSnapshot() {
    return { ...world };
}

function buildPlayerListSnapshot() {
    return Object.keys(players).map(id => ({ id, ...players[id] }));
}

function buildInventorySnapshot(playerId) {
    const player = players[playerId];
    if (!player || !player.inventory) return null;

    const snapshot = {};
    for (const blockType of Object.keys(player.inventory)) {
        const slot = player.inventory[blockType];
        snapshot[blockType] = {
            count: slot.count,
            maxCount: slot.maxCount
        };
    }
    return snapshot;
}

function sendToClient(ws, data) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(data, excludePlayerId = null) {
    const payload = JSON.stringify(data);

    wss.clients.forEach((client) => {
        if (client.readyState !== 1) return;
        if (excludePlayerId && client.playerId === excludePlayerId) return;
        client.send(payload);
    });
}

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(2, 9);
    ws.playerId = playerId;

    console.log('Client connected:', playerId);

    ws.on('message', (message) => {
        try {
            const packet = JSON.parse(message);

            switch (packet.type) {
                case 'Handshake':
                    players[playerId] = {
                        x: 0.5,
                        y: 16.61,
                        z: 0.5,
                        yaw: 0,
                        pitch: 0,
                        activeBlock: 'grass',
                        name: packet.name,
                        inventory: createStarterInventory(),
                        command: true,
                        fly: false
                    };

                    sendToClient(ws, {
                        type: 'PlayerJoin',
                        id: playerId,
                        world: buildWorldSnapshot(),
                        players: buildPlayerListSnapshot()
                    });

                    broadcast({
                        type: 'PlayerJoin',
                        id: playerId,
                        state: players[playerId]
                    }, playerId);

                    broadcast({
                        type: 'SyncPlayerName',
                        id: playerId,
                        name: packet.name
                    });

                    sendToClient(ws, {
                        type: 'SyncPlayerInventory',
                        inventory: buildInventorySnapshot(playerId)
                    });
                    break;

                case 'PlayerPosition':
                    if (players[playerId] && !players[playerId].fly) {
                        Object.assign(players[playerId], {
                            x: packet.x,
                            y: packet.y,
                            z: packet.z,
                            yaw: packet.yaw,
                            pitch: packet.pitch
                        });
                    }
                    break;

                case 'PlayerFlyMove':
                    if (players[playerId] && players[playerId].fly) {
                        Object.assign(players[playerId], {
                            x: packet.x,
                            y: packet.y,
                            z: packet.z,
                            yaw: packet.yaw,
                            pitch: packet.pitch
                        });
                    }
                    break;

                case 'PlayerJump':
                    broadcast({ type: 'PlayerJump', id: playerId }, playerId);
                    break;

                case 'PlayerPlaceBlock':
                    if (players[playerId]) {
                        const key = `${packet.x},${packet.y},${packet.z}`;
                        const blockType = packet.blockType;
                        const slot = players[playerId].inventory && players[playerId].inventory[blockType];

                        if (slot && slot.count > 0 && !world[key]) {
                            world[key] = blockType;
                            slot.count -= 1;

                            broadcast({
                                type: 'PlayerPlaceBlock',
                                x: packet.x,
                                y: packet.y,
                                z: packet.z,
                                blockType: blockType
                            });

                            sendToClient(ws, {
                                type: 'SyncPlayerInventory',
                                inventory: buildInventorySnapshot(playerId)
                              });
                        }
                    }
                    break;

                case 'PlayerBreakBlock':
                    if (players[playerId]) {
                        const key = `${packet.x},${packet.y},${packet.z}`;
                        const blockType = world[key];

                        if (blockType) {
                            delete world[key];

                            if (!players[playerId].inventory) players[playerId].inventory = {};
                            const slot = players[playerId].inventory[blockType];

                            if (slot) {
                                slot.count = Math.min(slot.count + 1, slot.maxCount);
                            } else {
                                players[playerId].inventory[blockType] = {
                                    count: 1,
                                    maxCount: MAX_STACK_SIZE
                                };
                            }

                            broadcast({
                                type: 'PlayerBreakBlock',
                                x: packet.x,
                                y: packet.y,
                                z: packet.z
                            });

                            sendToClient(ws, {
                                type: 'SyncPlayerInventory',
                                inventory: buildInventorySnapshot(playerId)
                            });
                        }
                    }
                    break;

                case 'PlayerSelectSlot':
                    if (players[playerId]) {
                        players[playerId].activeBlock = packet.activeBlock;
                    }
                    break;

                case 'PlayerSendMessage':
                    if (players[playerId]) {
                        broadcast({
                            type: 'PlayerSendMessage',
                            id: playerId,
                            name: players[playerId].name,
                            message: packet.message
                        });
                    }
                    break;

                case 'PlayerAddItem':
                    if (packet.playerid && packet.itemid) {
                        const targetPlayer = players[packet.playerid];
                        if (targetPlayer) {
                            const blockType = ITEM_MAPPING[packet.itemid];
                            if (blockType) {
                                if (!targetPlayer.inventory) {
                                    targetPlayer.inventory = {};
                                }
                                if (!targetPlayer.inventory[blockType]) {
                                    targetPlayer.inventory[blockType] = {
                                        count: 0,
                                        maxCount: MAX_STACK_SIZE
                                    };
                                }
                                const slot = targetPlayer.inventory[blockType];
                                const addCount = packet.count !== undefined ? packet.count : 1;
                                slot.count = Math.min(slot.count + addCount, slot.maxCount);

                                wss.clients.forEach((client) => {
                                    if (client.readyState === 1 && client.playerId === packet.playerid) {
                                        sendToClient(client, {
                                            type: 'SyncPlayerInventory',
                                            inventory: buildInventorySnapshot(packet.playerid)
                                        });
                                    }
                                });
                            }
                        }
                    }
                    break;

                case 'ChatCommand':
                    if (players[playerId] && players[playerId].command) {
                        const cmdText = packet.command;
                        const parts = cmdText.trim().split(/\s+/);
                        if (parts[0] === '/player') {
                            if (parts[1] === 'fly') {
                                if (parts[2] === 'on') {
                                    players[playerId].fly = true;
                                    sendToClient(ws, {
                                        type: 'SyncPlayerData',
                                        fly: true,
                                        command: players[playerId].command
                                    });
                                } else if (parts[2] === 'off') {
                                    players[playerId].fly = false;
                                    sendToClient(ws, {
                                        type: 'SyncPlayerData',
                                        fly: false,
                                        command: players[playerId].command
                                    });
                                }
                            } else if (parts[1] === 'tp') {
                                const tx = parseFloat(parts[2]);
                                const ty = parseFloat(parts[3]);
                                const tz = parseFloat(parts[4]);
                                if (!isNaN(tx) && !isNaN(ty) && !isNaN(tz)) {
                                    players[playerId].x = tx;
                                    players[playerId].y = ty;
                                    players[playerId].z = tz;
                                    sendToClient(ws, {
                                        type: 'SyncPlayerData',
                                        x: tx,
                                        y: ty,
                                        z: tz,
                                        fly: players[playerId].fly,
                                        command: players[playerId].command
                                    });
                                }
                            } else if (parts[1] === 'ai') {
                                const itemId = parseInt(parts[2]);
                                const itemCount = parseInt(parts[3]) || 1;
                                const blockType = ITEM_MAPPING[itemId];
                                if (blockType && !isNaN(itemCount)) {
                                    if (!players[playerId].inventory) {
                                        players[playerId].inventory = {};
                                    }
                                    if (!players[playerId].inventory[blockType]) {
                                        players[playerId].inventory[blockType] = {
                                            count: 0,
                                            maxCount: MAX_STACK_SIZE
                                        };
                                    }
                                    const slot = players[playerId].inventory[blockType];
                                    slot.count = Math.min(slot.count + itemCount, slot.maxCount);

                                    sendToClient(ws, {
                                        type: 'SyncPlayerInventory',
                                        inventory: buildInventorySnapshot(playerId)
                                    });
                                }
                            }
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        delete players[playerId];
        broadcast({ type: 'PlayerLeave', id: playerId });
    });
});

setInterval(() => {
    broadcast({
        type: 'Tick',
        players: buildPlayerListSnapshot()
    });
}, TICK_INTERVAL_MS);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
