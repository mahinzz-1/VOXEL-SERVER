const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 19130, host: '127.0.0.1' });
const players = {};
const world = {};
const bedAlive = { red: true, blue: true };

function initWorld() {
    for (let x = -6; x <= 6; x++) {
        for (let z = -21; z <= -9; z++) {
            const dist = Math.hypot(x, z + 15);
            if (dist <= 5) {
                const height = 4;
                for (let y = 0; y <= height; y++) {
                    world[`${x},${y},${z}`] = y === height ? 'grass' : (y > height - 3 ? 'dirt' : 'stone');
                }
            }
        }
    }
    world['0,5,-15'] = 'blue_wool';

    for (let x = -6; x <= 6; x++) {
        for (let z = 9; z <= 21; z++) {
            const dist = Math.hypot(x, z - 15);
            if (dist <= 5) {
                const height = 4;
                for (let y = 0; y <= height; y++) {
                    world[`${x},${y},${z}`] = y === height ? 'grass' : (y > height - 3 ? 'dirt' : 'stone');
                }
            }
        }
    }
    world['0,5,15'] = 'red_wool';
}
initWorld();

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(2, 9);

    ws.on('message', (message) => {
        try {
            const packet = JSON.parse(message);
            switch (packet.type) {
                case 'Handshake':
                    const redCount = Object.values(players).filter(p => p.team === 'red').length;
                    const blueCount = Object.values(players).filter(p => p.team === 'blue').length;
                    const assignedTeam = redCount <= blueCount ? 'red' : 'blue';
                    const spawnZ = assignedTeam === 'red' ? 15.5 : -15.5;

                    players[playerId] = { 
                        x: 0.5, 
                        y: 16.61, 
                        z: spawnZ, 
                        yaw: 0, 
                        pitch: 0, 
                        activeBlock: 'sword',
                        name: packet.name,
                        team: assignedTeam,
                        health: 100
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
                    if (packet.x === 0 && packet.y === 5 && packet.z === -15) {
                        bedAlive.blue = false;
                        broadcast({ type: 'BedBroken', team: 'blue' });
                    }
                    if (packet.x === 0 && packet.y === 5 && packet.z === 15) {
                        bedAlive.red = false;
                        broadcast({ type: 'BedBroken', team: 'red' });
                    }
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

                case 'PlayerHit':
                    const attacker = players[playerId];
                    const victim = players[packet.targetId];
                    if (attacker && victim && attacker.team !== victim.team) {
                        victim.health -= 20;

                        const dx = victim.x - attacker.x;
                        const dz = victim.z - attacker.z;
                        const dist = Math.hypot(dx, dz) || 1;
                        
                        const knockbackX = (dx / dist) * 6;
                        const knockbackY = 4.5;
                        const knockbackZ = (dz / dist) * 6;

                        if (victim.health <= 0) {
                            victim.health = 100;
                            const respawnZ = victim.team === 'red' ? 15.5 : -15.5;
                            victim.x = 0.5;
                            victim.y = 16.61;
                            victim.z = respawnZ;

                            broadcast({
                                type: 'PlayerRespawn',
                                id: packet.targetId,
                                x: victim.x,
                                y: victim.y,
                                z: victim.z
                            });
                        } else {
                            broadcast({
                                type: 'PlayerDamaged',
                                id: packet.targetId,
                                attackerId: playerId,
                                knockbackX,
                                knockbackY,
                                knockbackZ,
                                health: victim.health
                            });
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

console.log('Multiplayer Game Server running on ws://127.0.0.1:19130');
