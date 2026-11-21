use crate::cli::Args;
use crate::config::{self, AgentConfig, Dirs};
use crate::pairing;
use crate::roles::Role;
use crate::state::{AgentState, Ctx};
use tokio_util::sync::CancellationToken;
use vibe_server_core::error::AppResult;

pub struct Prepared {
    pub dirs: Dirs,
    pub cfg: AgentConfig,
}

pub fn prepare(args: &Args) -> AppResult<Prepared> {
    let dirs = config::resolve_dirs(args.data_dir.as_deref(), args.config_dir.as_deref());
    std::fs::create_dir_all(&dirs.data)?;
    std::fs::create_dir_all(&dirs.config)?;
    let mut cfg = config::load_or_create(&dirs.config)?;
    config::env_override(&mut cfg, args.port, args.bind.as_deref());
    Ok(Prepared { dirs, cfg })
}

pub fn local_urls(cfg: &AgentConfig) -> Vec<String> {
    let scheme = if cfg.tls { "https" } else { "http" };
    let mut hosts: Vec<String> = crate::tls::local_ips().into_iter().map(|ip| if ip.is_ipv6() { format!("[{ip}]") } else { ip.to_string() }).collect();
    hosts.push("localhost".into());
    hosts.into_iter().map(|h| format!("{scheme}://{h}:{}/", cfg.port)).collect()
}

pub fn print_code(code: &pairing::PairCode, fingerprint: Option<&str>, cfg: &AgentConfig) {
    println!("Kopplungscode:  {}   (15 Minuten gültig)", pairing::display(&code.code));
    if let Some(fp) = fingerprint {
        println!("Fingerabdruck:  {}", crate::crypto::fingerprint_display(fp));
    }
    for (i, u) in local_urls(cfg).iter().enumerate() {
        println!("{}{u}", if i == 0 { "Panel:          " } else { "                " });
    }
}

pub fn ensure_first_code(ctx: &AgentState) {
    if ctx.users.has_owner() || !ctx.pairing.active().is_empty() {
        return;
    }
    match ctx.pairing.create(Role::Owner, vec![]) {
        Ok(c) => {
            let cfg = ctx.cfg.read().clone();
            tracing::info!("Erster Start: Kopplungscode {} (15 Minuten gültig, neuer Code mit `vibe-agent pair`)", pairing::display(&c.code));
            print_code(&c, ctx.fingerprint.as_deref(), &cfg);
        }
        Err(e) => tracing::warn!("Kopplungscode nicht erzeugt: {e}"),
    }
}

pub async fn run(args: Args, shutdown: CancellationToken) -> AppResult<()> {
    vibe_server_core::rt::set_handle(tokio::runtime::Handle::current());
    let p = prepare(&args)?;
    let tls = if p.cfg.tls { Some(crate::tls::load_or_create(&p.cfg, &p.dirs)?) } else { None };
    let fingerprint = tls.as_ref().map(|t| t.fingerprint.clone());
    let addr = crate::listener::bind_addr(&p.cfg.bind, p.cfg.port)?;
    let listener = crate::listener::bind(addr).await?;
    let ctx: Ctx = AgentState::new(p.dirs, p.cfg, fingerprint);
    tracing::info!("Vibe Agent {} hört auf {}://{addr} (Daten: {})", env!("CARGO_PKG_VERSION"), if tls.is_some() { "https" } else { "http" }, ctx.dirs.data.display());
    ensure_first_code(&ctx);
    let router = crate::api::router(ctx.clone());
    crate::gateway::spawn(ctx.clone(), router.clone());
    ctx.core.server_mgr.on_startup(&ctx.core);
    let serve = tokio::spawn(crate::listener::serve(listener, router, tls.map(|t| t.config), shutdown.clone()));
    shutdown.cancelled().await;
    tracing::info!("Agent wird beendet – Minecraft-Server werden gestoppt …");
    ctx.core.server_mgr.set_quitting();
    ctx.core.server_mgr.stop_all().await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), serve).await;
    Ok(())
}

pub async fn wait_for_signal(token: CancellationToken) {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).expect("SIGTERM");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
            _ = token.cancelled() => {}
        }
    }
    #[cfg(not(unix))]
    {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = token.cancelled() => {}
        }
    }
    token.cancel();
}

pub fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread().enable_all().thread_name("vibe-agent").build().expect("Tokio-Laufzeit")
}
