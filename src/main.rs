mod server;
use crate::server::sockets;
fn main() {
    sockets::websocket();
}
