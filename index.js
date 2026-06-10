const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const players = {};
const world = {};

function initWorld() {
    for (let x = -24; x < 24; x++) {
        for (let z = -24; z < 24; z++) {
            world[`${x},0,${z}`] = 'stone';
            world[`${x},1,${z}`] = 'dirt';
            world[`${x},2,${z}`] = 'grass';
        }
    }
}
initWorld();

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(2, 9);

    ws.on('message', (message) => {
        try {
            const packet = JSON.parse(message);
            switch (packet.type) {
                case 'Handshake':
                    players[playerId] = { 
                        x: 0.5, 
                        y: 14.61, 
                        z: 0.5, 
                        yaw: 0, 
                        pitch: 0, 
                        activeBlock: 'grass',
                        name: packet.name 
                    };

                    ws.send(JSON.stringify({
                        type: 'PlayerJoin',
                        id: playerId,
                        world: world,
                        players: Object.keys(players).map(id => ({ id, ...players[id] }))
                    }));

                    broadcast({
                        type: 'PlayerJoin',
                        id: playerId,
                        state: players[playerId]
                    }, playerId);

                    broadcast({
                        type: 'PlayerName',
                        id: playerId,
                        name: packet.name
                    });
                    break;

                case 'PlayerPosition':
                    if (players[playerId]) {
                        players[playerId].x = packet.x;
                        players[playerId].y = packet.y;
                        players[playerId].z = packet.z;
                        players[playerId].yaw = packet.yaw;
                        players[playerId].pitch = packet.pitch;
                    }
                    break;

                case 'PlayerJump':
                    broadcast({ type: 'PlayerJump', id: playerId }, playerId);
                    break;

                case 'PlayerPlaceBlock':
                    world[`${packet.x},${packet.y},${packet.z}`] = packet.blockType;
                    broadcast({
                        type: 'PlayerPlaceBlock',
                        x: packet.x,
                        y: packet.y,
                        z: packet.z,
                        blockType: packet.blockType
                    });
                    break;

                case 'PlayerBreakBlock':
                    delete world[`${packet.x},${packet.y},${packet.z}`];
                    broadcast({
                        type: 'PlayerBreakBlock',
                        x: packet.x,
                        y: packet.y,
                        z: packet.z
                    });
                    break;

                case 'PlayerInventory':
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
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => {
        delete players[playerId];
        broadcast({ type: 'leave', id: playerId });
    });
});

function broadcast(data, excludeId = null) {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(payload);
        }
    });
}

setInterval(() => {
    const tickData = {
        type: 'Tick',
        players: Object.keys(players).map(id => ({ id, ...players[id] }))
    };
    broadcast(tickData);
}, 50);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});
