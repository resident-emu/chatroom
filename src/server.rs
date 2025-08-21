pub mod sockets {
    use std::{
        collections::HashMap,
        env,
        io::Error as IoError,
        net::SocketAddr,
        sync::{atomic::{AtomicU32, Ordering}, Arc}
    };

    use futures_channel::mpsc::{unbounded, UnboundedSender};
    use futures_util::{stream::TryStreamExt, StreamExt};
    use tokio::{
        net::{TcpListener, TcpStream},
        task,
    };
    use tokio::sync::Mutex;
    use tokio_tungstenite::tungstenite::protocol::Message;
    use serde_json::Value;

    type Tx = UnboundedSender<Message>;
    type Clients = Arc<Mutex<HashMap<u32, (Client, Tx)>>>;

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

    static CLIENT_ID: AtomicU32 = AtomicU32::new(1);

    async fn handle_connection(clients: Clients, raw_stream: TcpStream, addr: SocketAddr) {
        println!("Incoming connection from: {}", addr);

        let ws_stream = match tokio_tungstenite::accept_async(raw_stream).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("{} handshake failed: {}", addr, e);
                return;
            }
        };
        println!("Connection established: {}", addr);

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

        let reader_clients = clients.clone();
        let reader = incoming.try_for_each(move |msg| {
            let reader_clients = reader_clients.clone();
            async move {
                if msg.is_close() {
                    return Ok(());
                }

                let recipients = {
                    let guard = reader_clients.lock().await;
                    let mut list = Vec::with_capacity(guard.len());
                    for (cid, (_client, sink)) in guard.iter() {
                        if *cid != client_id {
                            list.push((*cid, sink.clone()));
                        }
                    }
                    list
                };

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
                        println!("{} disconnected", dead);
                    }
                }

                if let Ok(text) = msg.clone().into_text() {
                    if let Ok(message) = serde_json::from_str::<Value>(&text) {
                        if let Some(room_str) = message["roomid"].as_str() {
                            let mut guard = reader_clients.lock().await;
                            if let Some((client_entry, _)) = guard.get_mut(&client_id) {
                                client_entry.roomid = room_str.to_string();
                            }
                        }
                        println!("Message from {}: {:?}", client_id, message);
                    } else {
                        println!("What the fuck are you doing {}: {}", client_id, text);
                    }
                }

                Ok(())
            }
        });

        let writer = rx.map(Ok).forward(&mut outgoing);

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

    #[tokio::main]
    pub async fn main() -> Result<(), IoError> {
        let addr = env::args()
            .nth(1)
            .unwrap_or_else(|| "127.0.0.1:8080".to_string());

        let state: Clients = Arc::new(Mutex::new(HashMap::new()));

        let listener = TcpListener::bind(&addr).await.expect("Failed to bind");
        println!("Listening on: {}", addr);

        loop {
            let (stream, addr) = listener.accept().await?;
            let state = state.clone();
            task::spawn(async move {
                handle_connection(state, stream, addr).await;
            });
        }
    }
}
