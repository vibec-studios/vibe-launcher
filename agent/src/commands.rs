use crate::app;
use crate::cli::Args;
use crate::pairing::{self, PairingStore};
use crate::roles::Role;
use crate::users::UserStore;
use serde_json::json;
use std::time::Duration;
use vibe_server_core::error::{AppError, AppResult};

pub fn pair(args: &Args) -> AppResult<()> {
    let r = pair_inner(args);
    if let Ok(p) = app::prepare(args) {
        crate::jsonfile::fix_owner_tree(&p.dirs.data);
    }
    r
}

fn pair_inner(args: &Args) -> AppResult<()> {
    let p = app::prepare(args)?;
    let fingerprint = if p.cfg.tls { Some(crate::tls::load_or_create(&p.cfg, &p.dirs)?.fingerprint) } else { None };
    let users = UserStore::load(p.dirs.users_file());
    let role = match args.role.as_deref() {
        Some(r) => Role::parse(r).ok_or_else(|| AppError::Invalid(format!("Unbekannte Rolle: {r} (owner, admin, operator, viewer)")))?,
        None if users.has_owner() => Role::Admin,
        None => Role::Owner,
    };
    let code = PairingStore::new(p.dirs.pair_file()).create(role, vec![])?;
    if args.json {
        let out = json!({ "code": pairing::display(&code.code), "expires_at": code.expires_at, "role": code.role, "fingerprint": fingerprint, "urls": app::local_urls(&p.cfg) });
        println!("{out}");
    } else {
        app::print_code(&code, fingerprint.as_deref(), &p.cfg);
        println!("Im Vibe Launcher: Server → Remote-Server hinzufügen → Adresse und Code eingeben.");
    }
    Ok(())
}

pub fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .user_agent(vibe_server_core::product::user_agent())
        .build()
        .map_err(|e| AppError::msg(e.to_string()))
}

pub async fn status(args: &Args) -> AppResult<bool> {
    let p = app::prepare(args)?;
    let host = match p.cfg.bind.trim().trim_start_matches('[').trim_end_matches(']') {
        "0.0.0.0" | "" => "127.0.0.1".to_string(),
        "::" => "[::1]".to_string(),
        b if b.contains(':') => format!("[{b}]"),
        b => b.to_string(),
    };
    let scheme = if p.cfg.tls { "https" } else { "http" };
    let url = format!("{scheme}://{host}:{}/api/v1/info", p.cfg.port);
    let expected_id = p.cfg.id.clone();
    let res = match client()?.get(&url).send().await {
        Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().await.ok(),
        _ => None,
    };
    let running = res.as_ref().is_some_and(|v| v["id"].as_str() == Some(expected_id.as_str()));
    if args.json {
        println!("{}", json!({ "running": running, "url": url, "info": res }));
    } else if running {
        let v = res.unwrap_or_default();
        println!("Vibe Agent läuft: {} (Version {}, {})", url.trim_end_matches("/api/v1/info"), v["version"].as_str().unwrap_or("?"), v["name"].as_str().unwrap_or(""));
        println!("Gekoppelt: {} · Vibe-Gateway: {}", if v["paired"] == true { "ja" } else { "nein" }, if v["gateway"]["connected"] == true { "verbunden" } else { "nicht verbunden" });
    } else if res.is_some() {
        println!("Auf {url} antwortet ein anderer Agent (anderer Datenordner).");
    } else {
        println!("Vibe Agent läuft nicht (keine Antwort auf {url}).");
    }
    Ok(running)
}

pub async fn link(args: &Args) -> AppResult<()> {
    let r = link_inner(args).await;
    if let Ok(p) = app::prepare(args) {
        crate::jsonfile::fix_owner_tree(&p.dirs.data);
    }
    r
}

async fn link_inner(args: &Args) -> AppResult<()> {
    let p = app::prepare(args)?;
    let ctx = crate::state::AgentState::new(p.dirs, p.cfg, None);
    if crate::gateway::load(&ctx).agent_token.is_some() {
        println!("Der Agent ist schon mit einem Vibe-Konto verbunden.");
        return Ok(());
    }
    {
        ctx.cfg.write().gateway_enabled = true;
    }
    let cfg = ctx.cfg.read().clone();
    crate::config::save(&ctx.dirs.config, &cfg)?;
    if let Some(c) = args.command.get(1) {
        crate::gateway::link_with_code(&ctx, c).await?;
        println!("Mit dem Vibe-Konto verbunden. Der laufende Agent meldet sich in Kürze beim Vibe-Gateway an.");
        return Ok(());
    }
    let code = crate::gateway::start_pairing(&ctx).await?;
    println!("Vibe-Code:  {}   (15 Minuten gültig)", code.display);
    println!("Im Vibe Launcher oder unter https://vibe.axolite.app/panel/ eingeben. Warte auf Bestätigung …");
    while vibe_server_core::util::now_ms() < code.expires_at {
        tokio::time::sleep(Duration::from_secs(3)).await;
        if crate::gateway::load(&ctx).agent_token.is_some() {
            println!("Verbunden. Der laufende Agent meldet sich in Kürze beim Vibe-Gateway an.");
            return Ok(());
        }
        if ctx.gateway.read().pairing.is_none() {
            break;
        }
    }
    Err(AppError::Invalid("Der Code wurde nicht bestätigt oder ist abgelaufen.".into()))
}
