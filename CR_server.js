const WebSocket = require('ws');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const wss = new WebSocket.Server({ port: 8080});
let clients = [];

let nextClientId = 1;

wss.on('connection', (ws) => {
    if (clients.length === 0) {
        nextClientId = 1;
    }
    ws.id = nextClientId++;
    ws.roomid = 16;
    clients.push(ws);
    console.log(`${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')} : New client connected: id ${ws.id}`);

    ws.on('message', (message) => {
        let parsed = JSON.parse(message);
        if (typeof parsed.roomid !== "undefined") {
            ws.roomid = parsed.roomid;
        }
        if (parsed.token == "null") {
            return 0;
        }
        else {
            jwt.verify(parsed.token, "your_secret_key", (err, decoded) => {
                if (err) {
                    console.log("Token verification failed");
                    return 0;
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

//

const app = express();

const users = [{username: "admin", password: "$2b$12$mG.qkW8CqUUt7taY5BH4weOmuHY1smFXFY3EGjxls699EIZespALa", token: null}, {username: "Arvid", password: bcrypt.hashSync("1234", 12), token: null}]; //admin : password

app.use(express.json());
app.use(cors({origin: '*'}));
const SECRET_KEY = "your_secret_key";

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(user => user.username === username);
    
    if (user && bcrypt.compareSync(password, user.password)) {
        const token = jwt.sign({ username }, SECRET_KEY);
        res.json({ token: token });
        user.token = token;
    } else {
        res.status(401).json({ message: "Invalid credentials" });
    }
});

app.get('/protected', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(403).json({ message: "No token provided" });
    }
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: "Invalid token" });
        }
        res.json({ message: "Protected data", user: decoded });
    });
});
app.listen(3000, () => {
    console.log("Server is running on port 3000");
});
