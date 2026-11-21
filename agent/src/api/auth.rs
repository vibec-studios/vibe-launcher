use super::error::ApiError;
use crate::roles::Perm;
use crate::state::{AgentState, Ctx};
use crate::users::User;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use std::net::SocketAddr;

#[derive(Debug, Clone, Copy)]
pub struct Peer(pub Option<SocketAddr>);

#[derive(Debug, Clone)]
pub struct ViaGateway {
    pub vibe_user_id: String,
    pub name: String,
    pub role: crate::roles::Role,
}

#[derive(Debug, Clone)]
pub struct Authed {
    pub user: User,
    pub token_id: Option<String>,
    pub ip: Option<String>,
    pub via: &'static str,
}

impl Authed {
    pub fn require(&self, p: Perm) -> Result<(), ApiError> {
        if self.user.role.allows(p) {
            Ok(())
        } else {
            Err(ApiError::forbidden(p.as_str()))
        }
    }

    pub fn server(&self, p: Perm, id: &str) -> Result<(), ApiError> {
        self.require(p)?;
        if self.user.can_access(id) {
            Ok(())
        } else {
            Err(ApiError::forbidden(&format!("{} ({id})", p.as_str())))
        }
    }

    pub fn audit(&self, st: &AgentState, action: &str, target: Option<&str>, ok: bool, detail: Option<String>) {
        st.audit(Some(&self.user), self.ip.clone(), self.via, action, target, ok, detail);
    }
}

pub fn peer_ip(parts: &Parts) -> Option<String> {
    parts.extensions.get::<Peer>().and_then(|p| p.0).map(|a| a.ip().to_string())
}

pub fn bearer(parts: &Parts) -> Option<String> {
    let h = parts.headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    h.strip_prefix("Bearer ").or_else(|| h.strip_prefix("bearer ")).map(|t| t.trim().to_string())
}

pub fn query_token(parts: &Parts) -> Option<String> {
    let q = parts.uri.query()?;
    url::form_urlencoded::parse(q.as_bytes()).find(|(k, _)| k == "token").map(|(_, v)| v.to_string())
}

pub fn authenticate(st: &AgentState, token: &str, ip: Option<String>) -> Result<Authed, ApiError> {
    let key = ip.clone().unwrap_or_else(|| "local".into());
    if let Some(s) = st.pair_limit.blocked(&format!("auth:{key}")) {
        return Err(ApiError::rate_limited(s));
    }
    let Some((user, token_id)) = st.users.authenticate(token) else {
        st.pair_limit.note(&format!("auth:{key}"));
        return Err(ApiError::unauthorized());
    };
    if let Err(s) = st.api_limit.check(&token_id) {
        return Err(ApiError::rate_limited(s));
    }
    st.users.touch(&token_id, ip.clone());
    Ok(Authed { user, token_id: Some(token_id), ip, via: "direct" })
}

pub fn gateway_user(st: &AgentState, g: &ViaGateway) -> Result<Authed, ApiError> {
    use crate::roles::Role;
    let user = match st.users.by_vibe_user(&g.vibe_user_id) {
        Some(u) if u.role == g.role || u.role == Role::Owner => u,
        Some(u) => {
            let role = if g.role == Role::Owner { Role::Admin } else { g.role };
            st.users.update(&u.id, crate::users::UserPatch { role: Some(role), ..Default::default() })?
        }
        None => st.users.create(&g.name, g.role, vec![], Some(g.vibe_user_id.clone()))?,
    };
    if let Err(s) = st.api_limit.check(&format!("gw:{}", g.vibe_user_id)) {
        return Err(ApiError::rate_limited(s));
    }
    Ok(Authed { user, token_id: None, ip: None, via: "gateway" })
}

impl FromRequestParts<Ctx> for Authed {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, st: &Ctx) -> Result<Self, Self::Rejection> {
        if let Some(g) = parts.extensions.get::<ViaGateway>() {
            return gateway_user(st, g);
        }
        let token = bearer(parts).ok_or_else(ApiError::unauthorized)?;
        authenticate(st, &token, peer_ip(parts))
    }
}
