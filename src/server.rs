pub mod sockets {
    use std::{
        collections::HashMap,
        env,
        io::Error as IoError,
        net::SocketAddr,
        sync::{atomic::{AtomicU32,
                        Ordering},
                        Arc}
    };

    use futures_channel::mpsc::{unbounded, UnboundedSender};
    use futures_util::{stream::TryStreamExt, StreamExt};
    use tokio::{
        net::{TcpListener, TcpStream},
        task,
    };
    use tokio::sync::Mutex;
    use tokio_tungstenite::tungstenite::protocol::Message;

    use serde::{Deserialize, Serialize};
    use serde_json::{Value, json};

    use axum::{
        routing::{get, post},
        http::{StatusCode, header::HeaderMap},
        response::{IntoResponse, Json},
        Router,
    };
    use jsonwebtoken::{decode,
                       DecodingKey,
                       Validation,
                       Algorithm,
                       encode,
                       Header};

    use mysql::*;
    use mysql::prelude::*;
    use bcrypt::verify;


    // Custom types for the websocket, stolen from the example
    type Tx = UnboundedSender<Message>;
    type Clients = Arc<Mutex<HashMap<u32, (Client, Tx)>>>;

    // Structs and enums for serverside message validation and such, currently not very used
    #[derive(Clone, Debug)]
    enum Visitor {
        Guest(String),
        User(User),
    }

    #[derive(Clone, Debug)]
    struct User {
        name: String,
        password: String,
        token: Option<String>,
    }

    #[derive(Clone, Debug)]
    struct Client {
        id: u32,
        roomid: String,
        user: Visitor,
        addr: SocketAddr,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct Jwt {
        username: String,
    }

    // Clients and for now also the secrets
    static CLIENT_ID: AtomicU32 = AtomicU32::new(1);
    static SECRET_KEY: &str = "your_secret_key";

    static DB_HOST: &str = "127.0.0.1";
    static DB_PORT: &str = "6969";
    static DB_USER: &str = "osmo";
    static DB_PASSWORD: &str = "osmo";
    static DB_DB: &str = "chatroom";

    // This little guy handles each incoming websocket connection
    async fn handle_connection(clients: Clients, raw_stream: TcpStream, addr: SocketAddr) {
        println!("Incoming connection from: {}", addr);

        // Try to connect
        let ws_stream = match tokio_tungstenite::accept_async(raw_stream).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("{} handshake failed: {}", addr, e);
                return;
            }
        };
        println!("Connection established: {}", addr);

        // Give and increment client_id, set client struct (this needs to be changed) and split the stream, this is done on each connection
        let client_id = CLIENT_ID.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = unbounded::<Message>();

        let client = Client {
            id: client_id,
            roomid: String::from("16"),
            user: Visitor::Guest(String::from("Anon")),
            addr,
        };

        {
            let mut guard = clients.lock().await;
            guard.insert(client_id, (client.clone(), tx.clone()));
            println!("Added client {} (current number of clients {})", client_id, guard.len());
        }

        let (mut outgoing, incoming) = ws_stream.split();

        // The reader takes the new websocket message and distributes it
        let reader_clients = clients.clone();
        let reader = incoming.try_for_each(move |msg| {
            let reader_clients = reader_clients.clone();
            async move {
                if msg.is_close() {
                    return Ok(());
                }

                let text_opt = msg.clone().into_text().ok();

                let mut recipients: Vec<(u32, Tx)> = Vec::new();
                let mut sender_room = String::new(); // This gives a warning for unused code, however it is clearly used below

                if let Some(text) = text_opt.as_ref() {
                    if let Ok(message) = serde_json::from_str::<Value>(text) {
                        let mut guard = reader_clients.lock().await;

                        if let Some(room_str) = message["roomid"].as_str() {
                            if let Some((client_entry, _)) = guard.get_mut(&client_id) {
                                client_entry.roomid = room_str.to_string();
                            }
                        }

                        if let Some((client_entry, _)) = guard.get(&client_id) {
                            sender_room = client_entry.roomid.clone();
                        } else {
                            sender_room = String::from("16");
                        }

                        // If theres text and its walid, send it forward to clients in the same room
                        for (cid, (c, sink)) in guard.iter() {
                            if *cid != client_id && c.roomid == sender_room {
                                recipients.push((*cid, sink.clone()));
                            }
                        }
                    } else {
                        // If not, tweak out
                        let guard = reader_clients.lock().await;
                        if let Some((client_entry, _)) = guard.get(&client_id) {
                            sender_room = client_entry.roomid.clone();
                        } else {
                            sender_room = String::from("16");
                        }
                        for (cid, (c, sink)) in guard.iter() {
                            if *cid != client_id && c.roomid == sender_room {
                                recipients.push((*cid, sink.clone()));
                            }
                        }
                        println!("What the fuck are you doing {}: {}", client_id, text);
                    }
                } else {
                    // This is for the initial connection where theres no text
                    let guard = reader_clients.lock().await;
                    if let Some((client_entry, _)) = guard.get(&client_id) {
                        sender_room = client_entry.roomid.clone();
                    } else {
                        sender_room = String::from("16");
                    }
                    for (cid, (c, sink)) in guard.iter() {
                        if *cid != client_id && c.roomid == sender_room {
                            recipients.push((*cid, sink.clone()));
                        }
                    }
                }

                // Remove dead clients (without removing everyone)
                let mut to_remove: Vec<u32> = Vec::new();
                for (cid, sink) in recipients {
                    if let Err(e) = sink.unbounded_send(msg.clone()) {
                        eprintln!("Failed to send to client {}: {}", cid, e);
                        to_remove.push(cid);
                    }
                }

                if !to_remove.is_empty() {
                    let mut guard = reader_clients.lock().await;
                    for dead in to_remove {
                        guard.remove(&dead);
                        println!("Removed dead client {}", dead);
                    }
                }

                Ok(())
            }
        });

        // Take the messages from others, receive them
        let writer = rx.map(Ok).forward(&mut outgoing);

        // This fuckass runs both of them concurrently
        tokio::pin!(reader);
        tokio::pin!(writer);

        tokio::select! {
            _ = &mut reader => {  }
            _ = &mut writer => {  }
        }

        let _ = tx.unbounded_send(Message::Close(None));
        {
           println!("Client {} disconnected", client_id);
        }
    }

    // The axum /login endpoint (also functions as register)
    async fn login(Json(payload): Json<Value>) -> impl IntoResponse {
        // Cors is a pain in the ass but have to give these in the header for the browser
        let cors = [("Access-Control-Allow-Origin", "*"),
                    ("Access-Control-Allow-Headers", "authorization, content-type")];
        // Database connection information built from the secrets
        let opts = OptsBuilder::new()
            .ip_or_hostname(Some(DB_HOST))
            .tcp_port(DB_PORT.parse().unwrap_or(6969))
            .user(Some(DB_USER))
            .pass(Some(DB_PASSWORD))
            .db_name(Some(DB_DB));

        // Extract the stuff we need from the payload
        let username = payload
            .get("username")
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let password = payload
            .get("password")
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        // If either are empty, return
        if username.is_empty() || password.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                cors,
                Json(json!({ "message": "Username or password missing" })),
            );
        };

        // Make a database connection
        let pool = match Pool::new(opts) {
            Ok(p) => p,
            Err(_) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    cors,
                    Json(json!({ "message": "DB connection failed" })),
                )
            }
        };
        let mut conn = match pool.get_conn() {
            Ok(c) => c,
            Err(_) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    cors,
                    Json(json!({ "message": "Failed to get DB connection" })),
                )
            }
        };

        // Check if the user exists in the database
        let result: Option<(String, String)> = conn
            .exec_first("SELECT name, hash FROM users WHERE name = :username",
                        params! { "username" => &username })
            .unwrap_or(None);

        match result {
            // If it does, check against password hash and return the jwt
            Some((name, hash)) => {
                if verify(&password, &hash).unwrap_or(false) {
                    let jwt = Jwt {
                        username: name.clone(),
                    };
                    let token = encode(
                        &Header::default(),
                        &jwt,
                        &jsonwebtoken::EncodingKey::from_secret(SECRET_KEY.as_bytes()),
                    ).unwrap();

                    return (
                        StatusCode::OK,
                        cors,
                        Json(json!({ "token": token })),
                    );
                }
            },
            // If it didn't find the user, make one
            None => {
                let hash = match bcrypt::hash(password, 10) {
                    Ok(h) => h,
                    Err(e) => {
                        eprintln!("Could not hash password: {:?}", e);
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            cors,
                            Json(json!({ "message": "Password hashing failed" })),
                        )
                    },
                };
                match conn
                        .exec_drop("INSERT INTO users (name, hash)
                                    VALUES (:username, :hash)",
                        params! { "username" => &username, "hash" => &hash }) {
                            Ok(()) => {
                                let jwt = Jwt {
                                    username: username.clone(),
                                };
                                let token = encode(
                                    &Header::default(),
                                    &jwt,
                                    &jsonwebtoken::EncodingKey::from_secret(SECRET_KEY.as_bytes()),
                                ).unwrap();

                                return (
                                StatusCode::OK,
                                cors,
                                Json(json!({ "token": token })),
                            )},
                            Err(e) => {return (
                                StatusCode::UNAUTHORIZED,
                                cors,
                                Json(json!({ "message": format!("Failed to create user: {:?}]", e) })),
                            )},
                }
            },
        }

        // This is required for syntax, however this should not be possible to reach
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            cors,
            Json(json!({ "message": "This should not be reached" })),
        )
    }

    // The axum /protected endpoint for who knows what (prolly just cheking that the token is correct, I just translated this)
    async fn protected(headers: HeaderMap) -> impl IntoResponse {
        let cors = [("Access-Control-Allow-Origin", "*"),
                    ("Access-Control-Allow-Headers", "authorization, content-type")];
        let token = match headers.get("authorization") {
            Some(t) => t.to_str().unwrap_or(""),
            None => "",
        };

        if token.is_empty() || token == "undefined" {
            return (
                StatusCode::FORBIDDEN,
                cors,
                Json(json!({ "Message": "No token provided, also this propably should not have happened" })),
            );
        }
        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_exp = false;
        validation.required_spec_claims.clear();
        
        let token_data: jsonwebtoken::TokenData<Jwt> = match decode::<Jwt>(
            token.trim(),
            &DecodingKey::from_secret(SECRET_KEY.as_bytes()),
            &validation,
        ) {
            Ok(data) => data,
            Err(e) => {
                return (
                    StatusCode::UNAUTHORIZED,
                    cors,
                    Json(json!({ "Message": format!("Token invalid: {:?}", e) })),
                );
            }
        };

        let username = token_data.claims.username;

        (
            StatusCode::OK,
            cors,
            Json(json!({
                "message": "Protected data",
                "user": { "username": username }
            })),
        )
    }

    // Cors preflight layer, I'm not sure if this is just a bun requirement 
    async fn cors_preflight() -> impl IntoResponse {
        let mut response = axum::response::Response::new(<String as Default>::default());
        let headers = response.headers_mut();

        headers.insert("Access-Control-Allow-Origin", "*".parse().unwrap());
        headers.insert("Access-Control-Allow-Methods", "GET, POST, OPTIONS".parse().unwrap());
        headers.insert("Access-Control-Allow-Headers", "authorization, content-type".parse().unwrap());

        *response.status_mut() = StatusCode::NO_CONTENT;
        response
    }

    // The main function responsible for running both the axum and tungstenite endpoints
    #[tokio::main]
    pub async fn main() -> Result<(), IoError> {
        let app = Router::new()
            .route("/api/login", post(login).options(cors_preflight))
            .route("/api/protected", get(protected).options(cors_preflight));

        let bind_location = "127.0.0.1:3100";
        let axum_listener = TcpListener::bind(bind_location).await?;
        let axum_server = axum::serve(axum_listener, app);
        println!("Axum listening on: {}", bind_location);

        let addr: SocketAddr = env::args()
            .nth(1)
            .unwrap_or_else(|| "127.0.0.1:8080".to_string())
            .parse()
            .unwrap();

        let state: Clients = Arc::new(Mutex::new(HashMap::new()));
        let websocket_server = async move {
            let listener = TcpListener::bind(addr).await.expect("Failed to bind");
            println!("WebSocket listening on: {}", addr);

            loop {
                let (stream, peer) = listener.accept().await?;
                let state = state.clone();
                task::spawn(async move {
                    handle_connection(state, stream, peer).await;
                });
            }

            #[allow(unreachable_code)]
            Ok::<_, IoError>(())
        };

        tokio::select! {
            res = axum_server => { res?; }
            res = websocket_server => { res?; }
        }

    Ok(())
    }
}
