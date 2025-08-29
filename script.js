let websocket_host = "xxx.xxx.xxx.xxx:8080";
let server_host = "xxx.xxx.xxx.xxx:3000";

let ws = new WebSocket(`ws://${websocket_host}`);
let current_roomid = "16";
let message_count = 1;
let current_username = "guest";
let emojimap = null;

fetch("./EmojisMap.json")
  .then(res => res.json())
  .then(data => {
    emojimap = data;
});


Notification.requestPermission();
if (localStorage.getItem("token")) {
    fetch(`http://${server_host}/api/protected`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": localStorage.getItem("token")
        }
    })
    .then(response => response.json())
    .then(data => {
        current_username = data.user.username;
        document.getElementById("username").innerText = "Username : " + current_username;

        // Update buttons
        const loginBtn = document.getElementById("login_button");
        const logoutBtn = document.getElementById("logout_button");

        loginBtn.disabled = true;
        loginBtn.style.cssText = "pointer-events: none; opacity: 0.5; cursor: not-allowed;";

        logoutBtn.disabled = false;
        logoutBtn.style.cssText = "pointer-events: auto; opacity: 1; cursor: auto;";
    })
    .catch(error => {
        console.error("Error:", error);
        localStorage.removeItem("token"); // clear invalid token
    });
} else {
    console.log("User not logged in");
    document.getElementById("user_del").style.display = "none";
}

function parseJwt (token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}

function favicon_ping() {
    setTimeout(() => {
        let flashing = setInterval(() => {
            if (document.hidden) {
                const favicon = document.getElementById("favicon");
                favicon.href = favicon.href.endsWith("red_square.png")
                    ? "green_square.png"
                    : "red_square.png";
            } else {
                clearInterval(flashing);
                document.getElementById("favicon").href = "none.ico";
            }
        }, 500);
    }, 100); 
}

// Disable logout buttons initially
document.getElementById("logout_button").style = "pointer-events: none; opacity: 0.5; cursor: not-allowed;";
document.getElementById("CR_logout_button").style = "pointer-events: none; opacity: 0.5; cursor: not-allowed;";

// Display current room
document.getElementById("roomid").innerText = "room_id : " + current_roomid;

// --- WebSocket Handlers ---
ws.onopen = function () {
    console.log("WebSocket connection established.");
    document.getElementById("status_value").innerText="WebSocket connected";
    document.getElementById("status_value").style.color = "green";
    document.getElementById("reconnect").style.display = "none";

    if (ws.readyState === WebSocket.OPEN) {
        //ws.send(JSON.stringify({ text: "", sender: current_username, roomid: current_roomid, token: localStorage["token"] }));
    }
    document.getElementById("roomid").innerText = "room_id : " + current_roomid;
};

ws.onmessage = function (event) {
    const data = JSON.parse(event.data);
    add_foreign_message(data.text, data.sender);
};
ws.onclose = function () {
    document.getElementById("status_value").innerText = "Not connected";
    document.getElementById("status_value").style.color = "red";
    document.getElementById("roomid").innerText = "room_id : --";

    document.getElementById("reconnect").style.display = "inline-block";
};

// --- Message Functions ---

function ConvertToEmoji(text) {
  if (!emojimap) {
    console.warn("Emojis not loaded yet!");
    return text;
  }
  return text.replace(/:\w+(?:-\w+)*:/g, match => emojimap[match] || match);
}

function add_message(message, sender = current_username) {
    if (!message) return;
    if (message.length > 1000) {
        message = message.substring(0, 1000) + "...";
    }

    let timestamp = new Date();
    let timeStr = timestamp.getHours() + ":" + (timestamp.getMinutes() < 10 ? "0" : "") + timestamp.getMinutes();

    let container = document.createElement("div");
    container.id = "user_message_container" + message_count;
    container.className = "user_message_container";

    let senderDiv = document.createElement("div");
    senderDiv.className = "sender";
    senderDiv.innerText = sender;

    let messageDiv = document.createElement("div");
    messageDiv.className = "message";
    if (/\.(jpeg|jpg|gif|png|webp|svg)$/i.test(message)) {
        const img = document.createElement("img");
        img.src = message;
        img.alt = "shared image";
        img.style.maxWidth = "300px";
        img.style.maxHeight = "300px";
        img.style.paddingTop = "5px";
        messageDiv.appendChild(img);
    } else {
        messageDiv.innerText = ConvertToEmoji(message);
    }

    let timestampDiv = document.createElement("div");
    timestampDiv.className = "timestamp";
    timestampDiv.innerText = timeStr;

    container.appendChild(senderDiv);
    container.appendChild(messageDiv);
    container.appendChild(timestampDiv);

    const messageArea = document.getElementById("user_messages");
    messageArea.appendChild(container);
    messageArea.scrollTop = messageArea.scrollHeight; // <-- auto-scroll

    message_count++;
    console.log({ Sender: sender, message, timestamp: timeStr });
}

function add_foreign_message(message, sender = "SYS") {
    if (!message) return;

    let timestamp = new Date();
    let timeStr = timestamp.getHours() + ":" + (timestamp.getMinutes() < 10 ? "0" : "") + timestamp.getMinutes();

    let container = document.createElement("div");
    container.id = "foreign_message_container" + message_count;

    let senderDiv = document.createElement("div");
    senderDiv.className = "sender";
    senderDiv.innerText = sender;

    let messageDiv = document.createElement("div");
    if (/\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i.test(message)) {
    const img = document.createElement("img");
    img.src = message;
    img.alt = "shared image";
    img.style.maxWidth = "300px";
    img.style.maxHeight = "300px";
    img.style.paddingTop = "5px";
    messageDiv.appendChild(img);

    container.className = "foreign_message_container";
    } else if (message.includes("@" + current_username) && current_username !== "guest") {
        if (Notification.permission === 'granted' || document.hidden) {
            new Notification("new mention from: " + sender, {
                body: message,
        });
        }
        favicon_ping();
        container.className = "foreign_message_mention_container";
        messageDiv.innerText = message;
        messageDiv.className = "message_mention";
        } else {
            container.className = "foreign_message_container";
            messageDiv.className = "message";
            messageDiv.innerText = message;
        }

    let timestampDiv = document.createElement("div");
    timestampDiv.className = "timestamp";
    timestampDiv.innerText = timeStr;

    container.appendChild(senderDiv);
    container.appendChild(messageDiv);
    container.appendChild(timestampDiv);

    const messageArea = document.getElementById("user_messages");
    messageArea.appendChild(container);
    messageArea.scrollTop = messageArea.scrollHeight; // <-- auto-scroll

    message_count++;
    console.log({ Sender: sender, message, timestamp: timeStr });
    if (document.hidden) {
        document.getElementById("title").innerText = "New Message!"
    }
}

function clear_messages() {
    document.getElementById("user_messages").innerText = "";
    message_count = 1;
}

// --- Event Listeners ---
document.querySelector("#send").addEventListener("click", () => {
    let message = document.getElementById("input_message").value.trim();
    if (!message) return;

    add_message(message);

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            text: message,
            sender: current_username,
            roomid: current_roomid,
            token: localStorage["token"]
        }));
    }

    document.getElementById("input_message").value = "";
});


document.getElementById("input_message").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        document.querySelector("#send").click();
    }
});


document.getElementById("login_button").addEventListener("click", () => {
    let usernameInput = document.getElementById("inputed_username").value.trim();
    let passwordInput = document.getElementById("inputed_password").value.trim();

    const login_request = fetch(`http://${server_host}/api/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        } else {
            document.getElementById("inputed_username").value = "";
            document.getElementById("inputed_password").value = "";
            alert("login failed");
            throw new Error("Login failed");
        }
    })
    .then(data => {
        const token = data.token;
        localStorage["token"] = token;

        document.getElementById("inputed_username").value = "";
        document.getElementById("inputed_password").value = "";

        document.getElementById("login_button").disabled = true;
        document.getElementById("logout_button").disabled = false;
        document.getElementById("logout_button").style = "pointer-events: all; opacity: 1; cursor: pointer;";
        document.getElementById("login_button").style = "pointer-events: none; opacity: 0.5; cursor: not-allowed;";

        document.getElementById("username").innerText = "Username : " + usernameInput;
        document.getElementById("user_del").style.display = "block";
        current_username = usernameInput;
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ text: "", sender: current_username, roomid: current_roomid, token: localStorage["token"] }));
        }
    })
    .catch(error => {
        console.error(error);
    });
});

document.getElementById("logout_button").addEventListener("click", () => {
    localStorage.removeItem("token");
    current_username = "guest";
    document.getElementById("username").innerText = "Username : " + current_username;
    document.getElementById("user_del").style.display = "none";
    document.getElementById("login_button").disabled = false;
    document.getElementById("logout_button").disabled = true;
    document.getElementById("logout_button").style = "pointer-events: none; opacity: 0.5; cursor: not-allowed;";
    document.getElementById("login_button").style = "pointer-events: all; opacity: 1; cursor: pointer;";
});

// Login to a chatroom
document.getElementById("CR_login_button").addEventListener("click", () => {
    clear_messages();
    let roomInput = document.querySelector("#chatroom_login_container input[type='text']").value.trim();
    current_roomid = roomInput || 0;
    document.querySelector("#chatroom_login_container input[type='text']").value = "";
    document.getElementById("roomid").innerText = "room_id : " + current_roomid;

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: "", sender: "guest", roomid: current_roomid, token: localStorage.getItem("token") }));
    }
});

document.getElementById("new_user_container_a").addEventListener("click", function() {
    document.getElementById("new_user_container_b").style.display = "block";
    document.getElementById("new_user_container_a").style.display = "none";
});

document.getElementById("register").addEventListener("click", function() {
    let new_username = document.getElementById("new_username").value.trim();
    let new_password = document.getElementById("new_password").value.trim();
    if (!new_username || !new_password) {
        alert("Username and password cannot be empty.");
        return;
    }
    fetch("http://" + server_host + "/api/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username: new_username, password: new_password })
    })
    .then(response => {
        if (response.ok) {
            alert("Registration successful!");
            document.getElementById("new_username").value = "";
            document.getElementById("new_password").value = "";
            document.getElementById("new_user_container_b").style.display = "none";
            document.getElementById("new_user_container_a").style.display = "block"
        } else {
            if (response.status = 400) {
                alert("user already exists")
            }
        }
    })
    .catch(error => {
        console.error("Error:", error);
    });

});

document.getElementById("close_register").addEventListener("click", function() {
    document.getElementById("new_user_container_b").style.display = "none";
    document.getElementById("new_user_container_a").style.display = "block";
});

document.addEventListener("visibilitychange", function() {
    if (!document.hidden) {
        document.getElementById("title").innerText = "chatroom"
    }
})
document.getElementById("user_del").addEventListener("click", async function() {
    const token = localStorage.getItem("token");
    if (!token) {
        alert("You are not logged in.");
        return;
    }

    try {
        const userResponse = await fetch(`http://${server_host}/api/protected`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            }
        });

        if (!userResponse.ok) throw new Error("Failed to fetch user info.");

        const userData = await userResponse.json();
        const username = userData.user.username;

        
        if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
            return;
        }
        const deleteResponse = await fetch(`http://${server_host}/api/delete`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            },
            body: JSON.stringify({ username })
        });

        if (deleteResponse.ok) {
            alert("User deleted successfully!");
            localStorage.removeItem("token");
            location.reload();
        } else {
            const errText = await deleteResponse.text();
            alert("Error deleting user: " + errText);
        }

    } catch (error) {
        console.error("Error:", error);
        localStorage.removeItem("token");
        alert("An error occurred. Please log in again.");
        location.reload();
    }
});
document.getElementById("reconnect").addEventListener("click", function() {
    connect();
});
function connect() {
    document.getElementById("status_value").style.color = "orange";
    document.getElementById("status_value").innerText = "Connecting...";
    document.getElementById("reconnect").disabled = true;
    
    if (ws.readyState === WebSocket.OPEN) ws.close();
    ws = new WebSocket("ws://" + websocket_host);

    ws.onopen = () => {
        ws.send(JSON.stringify({ text: "", sender: current_username, roomid: current_roomid, token: localStorage["token"] }));
        console.log("WebSocket connection established.");
        document.getElementById("status_value").innerText = "WebSocket connected";
        document.getElementById("roomid").innerText = "room_id : " + current_roomid;
        document.getElementById("status_value").style.color = "green";

        document.getElementById("reconnect").style.display = "none";
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        add_foreign_message(data.text, data.sender);
    };

    ws.onclose = () => {
        document.getElementById("status_value").innerText = "Not connected";
        document.getElementById("status_value").style.color = "red";
        document.getElementById("roomid").innerText = "room_id : --";

        document.getElementById("reconnect").style.display = "inline-block";
    };
}

