const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 19130;

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

wss.on('connection', (ws) => {
    console.log('Client connected');

    const playerId = Math.random().toString(36).substring(2, 9);

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
                        name: packet.name
                    };

                    ws.send(JSON.stringify({
                        type: 'PlayerJoin',
                        id: playerId,
                        world,
                        players: Object.keys(players).map(id => ({
                            id,
                            ...players[id]
                        }))
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
                    broadcast({
                        type: 'PlayerJump',
                        id: playerId
                    }, playerId);
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
            }
        } catch (err) {
            console.error(err);
        }
    });

    ws.on('close', () => {
        delete players[playerId];

        broadcast({
            type: 'leave',
            id: playerId
        });

        console.log('Client disconnected');
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
    broadcast({
        type: 'Tick',
        players: Object.keys(players).map(id => ({
            id,
            ...players[id]
        }))
    });
}, 50);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
