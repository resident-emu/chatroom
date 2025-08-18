const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080});
let clients = [];

let nextClientId = 1;

wss.on('connection', (ws) => {
    ws.id = nextClientId++;
    ws.roomid = 16;
    clients.push(ws);
    console.log(`${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')} : New client connected: id ${ws.id}`);

    ws.on('message', (message) => {
        let parsed = JSON.parse(message);
        if (typeof parsed.roomid !== "undefined") {
            ws.roomid = parsed.roomid;
        }

        let response = JSON.stringify({
            text: parsed.text,
            sender: parsed.sender || "anon",
            id: ws.id,
            roomid: ws.roomid
        });

        for (let client of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN && client.roomid == ws.roomid) {
                client.send(response);
            }
        }
    });
    ws.on('close', () => {
        clients = clients.filter(client => client !== ws);
        console.log(`${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')} : Client with id ${ws.id} disconnected`);
    });
});
setInterval(() => {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.ping();
        }
    });
}, 300);

