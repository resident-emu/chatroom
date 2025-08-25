const WebSocket = require('ws');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const mysql = require('mysql');

const wss = new WebSocket.Server({ port: 8080});
let clients = [];

let con = mysql.createConnection({
  host: "ip",
  port: port,
  user: "dbuser",
  password: "dbpwd",
  database: "db"
});

con.connect(function(err) {
    if (err) throw err;
    console.log("Database connected");

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

    con.query(
        "SELECT * FROM users WHERE name = ?",[parsed.sender],(err, result) => {
        if (err) throw err;
        if (result.length === 0) {
            parsed.sender = "guest";
        }});

            let response = JSON.stringify({
                text: parsed.text,
                sender: parsed.sender || "guest",
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

//

const app = express();

app.use(express.json());
app.use(cors({origin: '*'}));
const SECRET_KEY = "your_secret_key";

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    con.query("SELECT * FROM users WHERE name = ?", [username], (err, results) => {
        if (err) throw err;
        const user = results[0];
        if (user && bcrypt.compareSync(password, user.hash)) {
            const token = jwt.sign({ username }, SECRET_KEY);
            res.json({ token: token });
        } else {
            res.status(401).json({ message: "Invalid credentials" });
        }
    });
});

app.get('/api/protected', (req, res) => {
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
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;

     con.query("SELECT * FROM users WHERE name = ?", [username], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Database error" });
        }

        if (results.length > 0) {
            return res.status(400).json({ message: "User already exists" });
        }

    const hashedPassword = bcrypt.hashSync(password, 12);
    con.query("INSERT INTO users (name, hash) VALUES (?, ?)", [username, hashedPassword], (err, result) => {
        if (err) {
            return res.status(500).json({ message: "Error registering user" });
        }
        res.status(201).json({ message: "User registered successfully" });
    });
});
});
app.listen(3000, () => {
    console.log("Server is running on port 3000");
});
});
