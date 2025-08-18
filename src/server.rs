pub mod sockets {
    use std::{
        net::TcpListener,
        sync::atomic::{AtomicU32, Ordering},
        thread::spawn,
        time::{SystemTime, UNIX_EPOCH},
    };
    use tungstenite::{
        accept_hdr,
        handshake::server::{Request, Response},
    };
    static USER_ID: AtomicU32 = AtomicU32::new(1);
    pub fn websocket() {
        let server = TcpListener::bind("127.0.0.1:8080").unwrap();
        for stream in server.incoming() {
            spawn(move || {
                let user_id = USER_ID.fetch_add(1, Ordering::SeqCst);
                let callback = |req: &Request, response: Response| {
                    let date = match SystemTime::now().duration_since(UNIX_EPOCH) {
                        Ok(d) => d.as_secs(),
                        Err(_) => 0,
                    };
                    println!("New user connected at {} as {:?}", date, user_id);
                    // for (header, _value) in req.headers() {
                    //     println!("* {header}");
                    // }
                    Ok(response)
                };
                let mut websocket = accept_hdr(stream.unwrap(), callback).unwrap();

                loop {
                    let date = match SystemTime::now().duration_since(UNIX_EPOCH) {
                        Ok(d) => d.as_secs(),
                        Err(_) => 0,
                    };
                    match websocket.read() {
                        Ok(msg) => match msg {
                            tungstenite::Message::Text(txt) => println!("{}", txt),
                            tungstenite::Message::Close(_) => {
                                println!("Client {} disconnected at {:?}.", user_id, date);
                                break;
                            }
                            _ => {
                                println!("Error disconnecting {:?}", msg)
                            }
                        },
                        Err(e) => {
                            println!("Error reading message: {:?}", e);
                            break;
                        }
                    }
                }
            });
        }
    }
}
