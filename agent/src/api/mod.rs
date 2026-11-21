pub mod addons;
pub mod agent;
pub mod auth;
pub mod backups;
pub mod body;
pub mod catalog;
pub mod error;
pub mod files;
pub mod modpack;
pub mod pair;
pub mod panel;
pub mod players;
pub mod servers;
pub mod tasks;
pub mod users;
pub mod ws;

use crate::state::Ctx;
use axum::extract::DefaultBodyLimit;
use axum::http::HeaderValue;
use axum::routing::{delete, get, patch, post, put};
use axum::Router;

pub const API_VERSION: u32 = 1;
pub const MIN_API_VERSION: u32 = 1;

async fn api_header(req: axum::extract::Request, next: axum::middleware::Next) -> axum::response::Response {
    let wanted = req.headers().get("x-vibe-api").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u32>().ok());
    let mut r = match wanted {
        Some(v) if v < MIN_API_VERSION || v > API_VERSION => {
            use axum::response::IntoResponse;
            error::ApiError::new(axum::http::StatusCode::UPGRADE_REQUIRED, "unsupported_api", format!("API-Version {v} wird nicht unterstützt (1–{API_VERSION}).")).into_response()
        }
        _ => next.run(req).await,
    };
    r.headers_mut().insert("x-vibe-agent-api", HeaderValue::from_static("1"));
    r
}

fn server_routes() -> Router<Ctx> {
    Router::new()
        .route("/servers", get(servers::list).post(servers::create))
        .route("/servers/statuses", get(servers::statuses))
        .route("/servers/import", post(modpack::import).layer(DefaultBodyLimit::disable()))
        .route("/servers/{id}", get(servers::get_one).patch(servers::update).delete(servers::remove))
        .route("/servers/{id}/install", post(servers::install))
        .route("/servers/{id}/eula", post(servers::eula))
        .route("/servers/{id}/start", post(servers::start))
        .route("/servers/{id}/stop", post(servers::stop))
        .route("/servers/{id}/restart", post(servers::restart))
        .route("/servers/{id}/kill", post(servers::kill))
        .route("/servers/{id}/command", post(servers::command))
        .route("/servers/{id}/status", get(servers::status))
        .route("/servers/{id}/log", get(servers::log))
        .route("/servers/{id}/addresses", get(servers::addresses))
        .route("/servers/{id}/tunnel", get(servers::tunnel))
        .route("/servers/{id}/tunnel/reset", post(servers::tunnel_reset))
        .route("/servers/{id}/properties", get(servers::properties).put(servers::set_properties))
        .route("/servers/{id}/properties/raw", get(servers::properties_raw).put(servers::set_properties_raw))
        .route("/servers/{id}/players", get(players::get_players))
        .route("/servers/{id}/players/{list}", post(players::action))
        .route("/servers/{id}/whitelist", put(players::whitelist))
        .route("/servers/{id}/kick", post(players::kick))
        .route("/servers/{id}/worlds", get(backups::worlds))
        .route("/servers/{id}/backups", get(backups::list).post(backups::create))
        .route("/servers/{id}/backups/{name}", delete(backups::remove))
        .route("/servers/{id}/backups/{name}/restore", post(backups::restore))
        .route("/servers/{id}/backups/{name}/download", get(backups::download))
        .route("/servers/{id}/files", get(files::list).delete(files::remove))
        .route("/servers/{id}/files/content", get(files::read).put(files::write).layer(DefaultBodyLimit::disable()))
        .route("/servers/{id}/files/mkdir", post(files::mkdir))
        .route("/servers/{id}/files/rename", post(files::rename))
        .route("/servers/{id}/addons", get(addons::list).post(addons::install))
        .route("/servers/{id}/addons/search", get(addons::search))
        .route("/servers/{id}/addons/upload", post(addons::upload).layer(DefaultBodyLimit::disable()))
        .route("/servers/{id}/addons/updates", get(addons::updates))
        .route("/servers/{id}/addons/update", post(addons::apply_updates))
        .route("/servers/{id}/addons/{file}", patch(addons::set_enabled).delete(addons::remove))
        .route("/servers/{id}/extras", get(addons::extras).put(addons::set_extras))
        .route("/servers/{id}/platform/build", post(catalog::set_build))
}

fn agent_routes() -> Router<Ctx> {
    Router::new()
        .route("/info", get(agent::info))
        .route("/me", get(agent::me))
        .route("/pair", post(pair::pair))
        .route("/pair/codes", post(pair::new_code))
        .route("/agent/resources", get(agent::resources))
        .route("/agent/settings", get(agent::settings).patch(agent::patch_settings))
        .route("/agent/audit", get(agent::audit))
        .route("/agent/update", get(agent::update_check).post(agent::update_apply))
        .route("/agent/relay", get(agent::relay))
        .route("/agent/gateway", get(agent::gateway))
        .route("/agent/gateway/link", post(agent::gateway_link).delete(agent::gateway_unlink))
        .route("/users", get(users::list))
        .route("/users/invite", post(users::invite))
        .route("/users/{id}", patch(users::update).delete(users::remove))
        .route("/tokens", get(users::tokens))
        .route("/tokens/rotate", post(users::rotate))
        .route("/tokens/{id}", delete(users::revoke))
        .route("/tasks", get(tasks::list))
        .route("/tasks/{id}", get(tasks::get_one))
        .route("/tasks/{id}/cancel", post(tasks::cancel))
        .route("/addons/hangar/{project}", get(addons::hangar_project))
        .route("/catalog/minecraft", get(catalog::minecraft))
        .route("/catalog/loaders/{kind}", get(catalog::loaders))
        .route("/catalog/platforms/{kind}", get(catalog::platform_versions))
        .route("/catalog/platforms/{kind}/builds", get(catalog::platform_builds))
        .route("/ws", get(ws::upgrade))
}

pub fn router(ctx: Ctx) -> Router {
    let api = agent_routes().merge(server_routes()).fallback(|| async { error::ApiError::not_found("API-Endpunkt") });
    Router::new()
        .nest("/api/v1", api)
        .fallback(panel::serve)
        .layer(axum::middleware::from_fn(api_header))
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024))
        .with_state(ctx)
}
