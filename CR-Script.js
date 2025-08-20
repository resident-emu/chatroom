let ws = new WebSocket("ws://xxx.xxx.xxx.xxx:8080");
let current_roomid = 16;
let message_count = 1;
let current_username = "anon";

Notification.requestPermission();

if (localStorage["token"] !== null) {
    fetch("http://xxx.xxx.xxx.xxx:3000/protected", {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": localStorage["token"]
}
})
  .then(response => response.json())
  .then(data => {
    current_username = data.user.username;
    document.getElementById("username").innerText = "Username : " + data.user.username;
    document.getElementById("login_button").disabled = true;
    document.getElementById("login_button").style = "pointer-events: none; opacity: 0.5; cursor: not-allowed;";
    document.getElementById("logout_button").style = "pointer-events: auto; opacity: 1; cursor: auto;";
    document.getElementById("logout_button").disabled = false;

  })
  .catch(error => {
    console.error("Error:", error);
  });
}
else {
    localStorage["token"] = null;
}

function parseJwt (token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}

// Disable logout buttons initially
document.getElementById("logout_button").style = "pointer-events: none; opacity: 0.5; cursor: not-allowed;";
document.getElementById("CR_logout_button").style = "pointer-events: none; opacity: 0.5; cursor: not-allowed;";

// Display current room
document.getElementById("roomid").innerHTML = "room_id : " + current_roomid;

// --- WebSocket Handlers ---
ws.onopen = function () {
    console.log("WebSocket connection established.");
    document.getElementById("status_value").innerText="WebSocket connected";
    document.getElementById("status_value").style.color = "green";

    if (ws.readyState === WebSocket.OPEN) {
        //ws.send(JSON.stringify({ text: "", sender: current_username, roomid: current_roomid, token: localStorage["token"] }));
    }
    document.getElementById("roomid").innerHTML = "room_id : " + current_roomid;
};

ws.onmessage = function (event) {
    const data = JSON.parse(event.data);
    add_foreign_message(data.text, data.sender);
};

ws.onclose = function () {
    document.getElementById("status_value").innerText = "Not connected";
    document.getElementById("status_value").style.color = "red";
    document.getElementById("roomid").innerHTML = "room_id : --";
};

// --- Message Functions ---
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
    messageDiv.innerText = message;

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
    container.className = "foreign_message_container";

    let senderDiv = document.createElement("div");
    senderDiv.className = "sender";
    senderDiv.innerText = sender;

    let messageDiv = document.createElement("div");
    messageDiv.className = "message";
    messageDiv.innerText = message;

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
    if (Notification.permission === 'granted' && document.visibilityState === 'hidden') {
        new Notification("new message from: " + sender, {
            body: message,
        });
    }
}

function clear_messages() {
    document.getElementById("user_messages").innerHTML = "";
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
    current_username = usernameInput || "anon";

    const login_request = fetch("http://xxx.xxx.xxx.xxx:3000/login", {
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
            throw new Error("Login failed");
        }
    })
    .then(data => {
        const token = data.token;
        localStorage["token"] = token;
        console.log(token)

        document.getElementById("inputed_username").value = "";
        document.getElementById("inputed_password").value = "";

        document.getElementById("login_button").disabled = true;
        document.getElementById("logout_button").disabled = false;
        document.getElementById("logout_button").style = "pointer-events: all; opacity: 1; cursor: pointer;";
        document.getElementById("login_button").style = "pointer-events: none; opacity: 0.5; cursor: not-allowed;";

        document.getElementById("username").innerText = "Username : " + usernameInput;
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
    current_username = "anon";
    document.getElementById("username").innerText = "Username : " + current_username;

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
    document.getElementById("roomid").innerHTML = "room_id : " + current_roomid;

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: "", sender: "anon", roomid: current_roomid, token: localStorage.getItem("token") }));
    }
});


function connect() {
    if (ws.readyState === WebSocket.OPEN) ws.close();
    ws = new WebSocket("ws://xxx.xxx.xxx.xxx:8080");

    ws.onopen = () => {
        console.log("WebSocket connection established.");
        document.getElementById("status_value").innerText = "WebSocket connected";
        document.getElementById("roomid").innerHTML = "room_id : " + current_roomid;
        document.getElementById("status_value").style.color = "green";
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        add_foreign_message(data.text, data.sender);
    };

    ws.onclose = () => {
        document.getElementById("status_value").innerText = "Not connected";
        document.getElementById("status_value").style.color = "red";
    };
}
