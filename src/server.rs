pub mod sockets {
    use std::{
        collections::HashMap, env, io::Error as IoError, net::SocketAddr, str::FromStr, sync::{atomic::{AtomicU32, Ordering}, Arc}
    };

    use futures_channel::mpsc::{unbounded, UnboundedSender};
    use futures_util::{stream::TryStreamExt, StreamExt};
    use tokio::{
        net::{TcpListener, TcpStream},
        task,
    };
    use tokio::sync::Mutex; 
    use tokio_tungstenite::tungstenite::protocol::Message;

    type Tx = UnboundedSender<Message>;
    type PeerMap = Arc<Mutex<HashMap<SocketAddr, Tx>>>;

    enum Visitor {
        Guest(String),
        User(User),
    }
    struct User {
        name: String,
        password: String,
        token: Option<String>,
    }
    struct Client {
        id: u32,
        roomid: u32,
        user: Visitor,
    }

    static USER_ID: AtomicU32 = AtomicU32::new(1);

    async fn handle_connection(peer_map: PeerMap, raw_stream: TcpStream, addr: SocketAddr) {
        println!("Incoming connection from: {}", addr);

        let ws_stream = match tokio_tungstenite::accept_async(raw_stream).await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("{} handshake failed: {}", addr, e);
                return;
            }
        };
        println!("Connection established: {}", addr);

        let user_id = USER_ID.fetch_add(1, Ordering::SeqCst);
        let client = Client {
            id: user_id,
            roomid: 16,
            user: Visitor::Guest(String::from("Anon")),
        };

        let (tx, rx) = unbounded::<Message>();

        {
            let mut peers = peer_map.lock().await;
            peers.insert(addr, tx.clone());
        }

        let (mut outgoing, incoming) = ws_stream.split();

        let reader_peer_map = peer_map.clone();
        let reader = incoming.try_for_each(move |msg| {
            let reader_peer_map = reader_peer_map.clone();
            let from_addr = addr;
            async move {
                if msg.is_close() {
                    return Ok(());
                }

                let (recipients, mut to_remove): (Vec<(SocketAddr, Tx)>, Vec<SocketAddr>);
                {
                    let peers = reader_peer_map.lock().await;
                    let mut list = Vec::with_capacity(peers.len());
                    for (peer_addr, sink) in peers.iter() {
                        if *peer_addr != from_addr {
                            list.push((*peer_addr, sink.clone()));
                        }
                    }
                    recipients = list;
                }

                to_remove = Vec::new();
                for (peer_addr, sink) in recipients {
                    if let Err(e) = sink.unbounded_send(msg.clone()) {
                        eprintln!("Failed to send to {}: {}", peer_addr, e);
                        to_remove.push(peer_addr);
                    }
                }

                if !to_remove.is_empty() {
                    let mut peers = reader_peer_map.lock().await;
                    for dead in to_remove {
                        peers.remove(&dead);
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
            let mut peers = peer_map.lock().await;
            peers.remove(&addr);
        }
        println!("{} disconnected", addr);
    }

    #[tokio::main]
    pub async fn main() -> Result<(), IoError> {
        let addr = env::args()
            .nth(1)
            .unwrap_or_else(|| "127.0.0.1:8080".to_string());

        let state: PeerMap = Arc::new(Mutex::new(HashMap::new()));

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
