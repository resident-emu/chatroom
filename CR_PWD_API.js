import bcrypt from 'bcrypt';
import express from 'express';
import session from 'express-session';

//express-session ids

const app = express();
app.use(express.json());

app.use(session({
  secret: '',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60, // 1 hour
  }
}));

let clients = [{username: "admin", password: "$2b$12$mG.qkW8CqUUt7taY5BH4weOmuHY1smFXFY3EGjxls699EIZespALa"}];

async function login(password, username) {
    const user = clients.find(client => client.username === username);
    if (!user) {
        throw new Error("User not found");
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        throw new Error("Invalid password");
    }
    return user;
}

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        let user = await login(password, username);

        // Store user info in the session
        req.session.userId = user.username; // or user.id if you have one
        
        res.json(JSON.stringify({ message: "Login successful", username: user.username, sessionId: req.sessionID }));
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});
//send sessionid to websocket server for storage and validation
app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");

});
