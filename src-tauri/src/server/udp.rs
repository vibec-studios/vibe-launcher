//! UDP-Tunnel zum Vibe-Relay (Vertrag 04/28, `relay/UDP.md`): Host-Seite für Sprachchat (Simple Voice Chat) und
//! Bedrock (Geyser) auf dedizierten Servern aus dem Launcher. Ein Socket zum Relay; je Gegenstelle ein eigener lokaler
//! Socket, der nur mit `127.0.0.1:<Kanal-Port>` spricht.
use super::extras::LocalPorts;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub const MAGIC: [u8; 4] = [0x00, 0x56, 0x42, 0x55];
const HELLO: u8 = 0x01;
const DATA: u8 = 0x02;
const CLOSE: u8 = 0x03;
const ACK: u8 = 0x81;
const RELAY_DATA: u8 = 0x82;
const RELAY_CLOSE: u8 = 0x83;
const MAX_PAYLOAD: usize = 2048;
const IDLE: Duration = Duration::from_secs(60);

pub fn parse_token(hex_token: &str) -> Option<[u8; 16]> {
    let b = hex::decode(hex_token).ok()?;
    b.try_into().ok()
}

pub fn packet(kind: u8, token: &[u8; 16], peer: Option<u32>, payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(4 + 1 + 16 + 4 + payload.len());
    v.extend_from_slice(&MAGIC);
    v.push(kind);
    v.extend_from_slice(token);
    if let Some(p) = peer {
        v.extend_from_slice(&p.to_be_bytes());
    }
    v.extend_from_slice(payload);
    v
}

#[derive(Debug, PartialEq, Eq)]
pub enum FromRelay<'a> {
    Ack,
    Data { peer: u32, channel: u8, payload: &'a [u8] },
    Close { peer: u32 },
}

pub fn parse(msg: &[u8]) -> Option<FromRelay<'_>> {
    if msg.len() < 5 || msg[..4] != MAGIC {
        return None;
    }
    match msg[4] {
        ACK => Some(FromRelay::Ack),
        RELAY_CLOSE if msg.len() >= 9 => Some(FromRelay::Close { peer: u32::from_be_bytes(msg[5..9].try_into().ok()?) }),
        RELAY_DATA if msg.len() >= 10 => Some(FromRelay::Data { peer: u32::from_be_bytes(msg[5..9].try_into().ok()?), channel: msg[9], payload: &msg[10..] }),
        _ => None,
    }
}

pub fn channel_port(local: &LocalPorts, channel: u8) -> Option<u16> {
    match channel {
        1 => local.voice,
        2 => local.bedrock,
        _ => None,
    }
}

struct Peer {
    sock: Arc<UdpSocket>,
    last: Arc<AtomicI64>,
    task: tokio::task::JoinHandle<()>,
}

struct Shared {
    sock: UdpSocket,
    relay: Mutex<SocketAddr>,
    token: Mutex<[u8; 16]>,
}

impl Shared {
    async fn send(&self, kind: u8, peer: Option<u32>, payload: &[u8]) {
        let pkt = packet(kind, &self.token.lock(), peer, payload);
        let to = *self.relay.lock();
        let _ = self.sock.send_to(&pkt, to).await;
    }
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Stats {
    pub peers: usize,
    pub acked: bool,
}

pub struct UdpHost {
    tx: mpsc::UnboundedSender<(String, u16)>,
    acked: Arc<AtomicBool>,
    peers: Arc<Mutex<usize>>,
    cancel: CancellationToken,
}

impl UdpHost {
    pub fn update(&self, token: String, tunnel_port: u16) {
        let _ = self.tx.send((token, tunnel_port));
    }
    pub fn stats(&self) -> Stats {
        Stats { peers: *self.peers.lock(), acked: self.acked.load(Ordering::SeqCst) }
    }
}

impl Drop for UdpHost {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn resolve(host: &str, port: u16) -> Option<SocketAddr> {
    tokio::net::lookup_host((host, port)).await.ok()?.find(|a| a.is_ipv4())
}

pub async fn start(relay_host: String, tunnel_port: u16, token: [u8; 16], local: LocalPorts, parent: &CancellationToken) -> std::io::Result<UdpHost> {
    let relay = resolve(&relay_host, tunnel_port).await.ok_or_else(|| std::io::Error::other("Relay-Adresse nicht auflösbar"))?;
    let sock = UdpSocket::bind(("0.0.0.0", 0)).await?;
    let shared = Arc::new(Shared { sock, relay: Mutex::new(relay), token: Mutex::new(token) });
    let (tx, mut rx) = mpsc::unbounded_channel::<(String, u16)>();
    let acked = Arc::new(AtomicBool::new(false));
    let peer_count = Arc::new(Mutex::new(0usize));
    let cancel = parent.child_token();
    let host = UdpHost { tx, acked: acked.clone(), peers: peer_count.clone(), cancel: cancel.clone() };
    tokio::spawn(async move {
        let mut peers: HashMap<u32, Peer> = HashMap::new();
        let mut buf = vec![0u8; 65536];
        let started = Instant::now();
        let mut next_hello = Instant::now();
        let mut sweep = tokio::time::interval(Duration::from_secs(5));
        loop {
            let fast = !acked.load(Ordering::SeqCst) && started.elapsed() < Duration::from_secs(30);
            if Instant::now() >= next_hello {
                shared.send(HELLO, None, &[]).await;
                next_hello = Instant::now() + if fast { Duration::from_secs(2) } else { Duration::from_secs(15) };
            }
            let wait = next_hello.saturating_duration_since(Instant::now());
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = tokio::time::sleep(wait) => {}
                cmd = rx.recv() => {
                    let Some((t, port)) = cmd else { break };
                    if let Some(tok) = parse_token(&t) {
                        *shared.token.lock() = tok;
                    }
                    if let Some(a) = resolve(&relay_host, port).await {
                        *shared.relay.lock() = a;
                    }
                    next_hello = Instant::now();
                }
                _ = sweep.tick() => {
                    let cutoff = now_ms() - IDLE.as_millis() as i64;
                    let idle: Vec<u32> = peers.iter().filter(|(_, p)| p.last.load(Ordering::SeqCst) < cutoff).map(|(k, _)| *k).collect();
                    for id in idle {
                        if let Some(p) = peers.remove(&id) {
                            p.task.abort();
                            shared.send(CLOSE, Some(id), &[]).await;
                        }
                    }
                    *peer_count.lock() = peers.len();
                }
                r = shared.sock.recv_from(&mut buf) => {
                    let Ok((n, from)) = r else { continue };
                    if from != *shared.relay.lock() {
                        continue;
                    }
                    match parse(&buf[..n]) {
                        Some(FromRelay::Ack) => acked.store(true, Ordering::SeqCst),
                        Some(FromRelay::Close { peer }) => {
                            if let Some(p) = peers.remove(&peer) {
                                p.task.abort();
                            }
                        }
                        Some(FromRelay::Data { peer, channel, payload }) => {
                            let Some(port) = channel_port(&local, channel) else { continue };
                            if payload.len() > MAX_PAYLOAD {
                                continue;
                            }
                            if !peers.contains_key(&peer) {
                                match open_peer(shared.clone(), peer, port).await {
                                    Some(p) => {
                                        peers.insert(peer, p);
                                    }
                                    None => continue,
                                }
                            }
                            if let Some(p) = peers.get(&peer) {
                                p.last.store(now_ms(), Ordering::SeqCst);
                                let _ = p.sock.send(payload).await;
                            }
                        }
                        None => {}
                    }
                    *peer_count.lock() = peers.len();
                }
            }
        }
        for (_, p) in peers.drain() {
            p.task.abort();
        }
    });
    Ok(host)
}

async fn open_peer(shared: Arc<Shared>, peer: u32, port: u16) -> Option<Peer> {
    let sock = Arc::new(UdpSocket::bind(("127.0.0.1", 0)).await.ok()?);
    sock.connect(("127.0.0.1", port)).await.ok()?;
    let last = Arc::new(AtomicI64::new(now_ms()));
    let (s2, l2) = (sock.clone(), last.clone());
    let task = tokio::spawn(async move {
        let mut buf = vec![0u8; 65536];
        loop {
            let Ok(n) = s2.recv(&mut buf).await else { break };
            if n > MAX_PAYLOAD {
                continue;
            }
            l2.store(now_ms(), Ordering::SeqCst);
            shared.send(DATA, Some(peer), &buf[..n]).await;
        }
    });
    Some(Peer { sock, last, task })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packets() {
        let tok = parse_token("000102030405060708090a0b0c0d0e0f").unwrap();
        assert!(parse_token("abc").is_none());
        let p = packet(HELLO, &tok, None, &[]);
        assert_eq!(p.len(), 21);
        assert_eq!(&p[..5], &[0, 0x56, 0x42, 0x55, 1]);
        let d = packet(DATA, &tok, Some(7), b"hi");
        assert_eq!(&d[21..25], &7u32.to_be_bytes());
        assert_eq!(&d[25..], b"hi");
        let mut m = MAGIC.to_vec();
        m.push(RELAY_DATA);
        m.extend_from_slice(&9u32.to_be_bytes());
        m.push(2);
        m.extend_from_slice(b"raknet");
        assert_eq!(parse(&m), Some(FromRelay::Data { peer: 9, channel: 2, payload: b"raknet" }));
        assert_eq!(parse(&[0, 0x56, 0x42, 0x55, ACK]), Some(FromRelay::Ack));
        assert_eq!(parse(&[0, 0x56, 0x42, 0x59, ACK]), None);
        let lp = LocalPorts { voice: Some(24460), bedrock: None };
        assert_eq!(channel_port(&lp, 1), Some(24460));
        assert_eq!(channel_port(&lp, 2), None);
    }

    #[tokio::test]
    async fn tunnel_roundtrip() {
        let relay = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let relay_port = relay.local_addr().unwrap().port();
        let echo = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let echo_port = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut b = [0u8; 2048];
            loop {
                let (n, from) = echo.recv_from(&mut b).await.unwrap();
                echo.send_to(&b[..n], from).await.unwrap();
            }
        });
        let tok = [7u8; 16];
        let cancel = CancellationToken::new();
        let host = start("127.0.0.1".into(), relay_port, tok, LocalPorts { voice: Some(echo_port), bedrock: None }, &cancel).await.unwrap();
        let mut b = [0u8; 4096];
        let (n, host_addr) = tokio::time::timeout(Duration::from_secs(3), relay.recv_from(&mut b)).await.unwrap().unwrap();
        assert_eq!(&b[..n], packet(HELLO, &tok, None, &[]).as_slice());
        relay.send_to(&[0, 0x56, 0x42, 0x55, ACK], host_addr).await.unwrap();
        let mut m = MAGIC.to_vec();
        m.push(RELAY_DATA);
        m.extend_from_slice(&5u32.to_be_bytes());
        m.push(1);
        m.extend_from_slice(&[0xFF, 1, 2, 3]);
        relay.send_to(&m, host_addr).await.unwrap();
        let reply = loop {
            let (n, _) = tokio::time::timeout(Duration::from_secs(3), relay.recv_from(&mut b)).await.unwrap().unwrap();
            if b[4] == DATA {
                break b[..n].to_vec();
            }
        };
        assert_eq!(reply, packet(DATA, &tok, Some(5), &[0xFF, 1, 2, 3]));
        assert!(host.stats().acked);
        assert_eq!(host.stats().peers, 1);
        drop(host);
    }
}
