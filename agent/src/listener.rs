use crate::api::auth::Peer;
use hyper::body::Incoming;
use hyper::Request;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto::Builder;
use hyper_util::service::TowerToHyperService;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;
use vibe_server_core::error::{AppError, AppResult};

pub fn bind_addr(bind: &str, port: u16) -> AppResult<SocketAddr> {
    let b = bind.trim().trim_start_matches('[').trim_end_matches(']');
    let ip: std::net::IpAddr = b.parse().map_err(|_| AppError::Invalid(format!("Ungültige Bind-Adresse: {bind}")))?;
    Ok(SocketAddr::new(ip, port))
}

pub async fn bind(addr: SocketAddr) -> AppResult<TcpListener> {
    TcpListener::bind(addr).await.map_err(|e| AppError::msg(format!("Port {} ist nicht verfügbar ({e}).", addr.port())))
}

pub async fn serve(listener: TcpListener, router: axum::Router, tls: Option<Arc<rustls::ServerConfig>>, shutdown: CancellationToken) {
    let acceptor = tls.map(tokio_rustls::TlsAcceptor::from);
    loop {
        let (tcp, peer) = tokio::select! {
            _ = shutdown.cancelled() => break,
            r = listener.accept() => match r {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!("Verbindung nicht angenommen: {e}");
                    continue;
                }
            },
        };
        let _ = tcp.set_nodelay(true);
        let svc = router.clone().map_request(move |mut r: Request<Incoming>| {
            r.extensions_mut().insert(Peer(Some(peer)));
            r
        });
        let acceptor = acceptor.clone();
        let stop = shutdown.clone();
        tokio::spawn(async move {
            let builder = Builder::new(TokioExecutor::new());
            let hyper_svc = TowerToHyperService::new(svc);
            match acceptor {
                Some(acc) => {
                    let Ok(Ok(stream)) = tokio::time::timeout(std::time::Duration::from_secs(15), acc.accept(tcp)).await else { return };
                    let conn = builder.serve_connection_with_upgrades(TokioIo::new(stream), hyper_svc);
                    tokio::select! { _ = conn => {}, _ = stop.cancelled() => {} }
                }
                None => {
                    let conn = builder.serve_connection_with_upgrades(TokioIo::new(tcp), hyper_svc);
                    tokio::select! { _ = conn => {}, _ = stop.cancelled() => {} }
                }
            }
        });
    }
}
