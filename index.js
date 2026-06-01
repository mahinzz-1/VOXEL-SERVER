const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;

const players = {};
const world = {};

function initWorld() {
    for (let x = -15; x <= 15; x++) {
        for (let z = -15; z <= 15; z++) {
            world[`${x},4,${z}`] =
                (Math.abs(x) === 15 || Math.abs(z) === 15)
                    ? 'wood'
                    : 'stone';

            if (Math.abs(x) === 14 && Math.abs(z) === 14) {
                for (let y = 5; y <= 9; y++) {
                    world[`${x},${y},${z}`] = 'wood';
                }
                world[`${x},10,${z}`] = 'grass';
            }
        }
    }
}

initWorld();

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Server Running');
});

const wss = new WebSocketServer({ server });

function broadcast(data) {
    const payload = JSON.stringify(data);

    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(payload);
        }
    });
}

wss.on('connection', (ws) => {
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
                        activeBlock: 'grass',
                        name: packet.name,
                        health: 20
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
    });
});

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
    console.log(`Server running on 0.0.0.0:${PORT}`);
});
