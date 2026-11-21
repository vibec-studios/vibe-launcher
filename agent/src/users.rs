use crate::crypto;
use crate::jsonfile;
use crate::roles::Role;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use vibe_server_core::error::{AppError, AppResult};
use vibe_server_core::util::now_ms;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub role: Role,
    #[serde(default = "all_servers")]
    pub servers: Vec<String>,
    pub created_at: i64,
    #[serde(default)]
    pub vibe_user_id: Option<String>,
}

fn all_servers() -> Vec<String> {
    vec!["*".into()]
}

impl User {
    pub fn can_access(&self, server_id: &str) -> bool {
        self.servers.iter().any(|s| s == "*" || s == server_id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenRecord {
    pub id: String,
    pub user_id: String,
    pub hash: String,
    pub client_name: String,
    pub client_kind: String,
    pub created_at: i64,
    #[serde(default)]
    pub last_used_at: Option<i64>,
    #[serde(default)]
    pub last_ip: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenInfo {
    pub id: String,
    pub user_id: String,
    pub client_name: String,
    pub client_kind: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub last_ip: Option<String>,
}

impl From<&TokenRecord> for TokenInfo {
    fn from(t: &TokenRecord) -> Self {
        TokenInfo {
            id: t.id.clone(),
            user_id: t.user_id.clone(),
            client_name: t.client_name.clone(),
            client_kind: t.client_kind.clone(),
            created_at: t.created_at,
            last_used_at: t.last_used_at,
            last_ip: t.last_ip.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct UsersFile {
    #[serde(default)]
    users: Vec<User>,
    #[serde(default)]
    tokens: Vec<TokenRecord>,
}

pub struct UserStore {
    path: PathBuf,
    data: RwLock<UsersFile>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct UserPatch {
    pub name: Option<String>,
    pub role: Option<Role>,
    pub servers: Option<Vec<String>>,
}

fn clean_name(n: &str) -> String {
    n.trim().chars().take(80).collect()
}

impl UserStore {
    pub fn load(path: PathBuf) -> Self {
        let data = jsonfile::read(&path);
        UserStore { path, data: RwLock::new(data) }
    }

    fn save(&self, d: &UsersFile) -> AppResult<()> {
        jsonfile::write(&self.path, d)
    }

    pub fn has_owner(&self) -> bool {
        self.data.read().users.iter().any(|u| u.role == Role::Owner)
    }

    pub fn list(&self) -> Vec<User> {
        self.data.read().users.clone()
    }

    pub fn get(&self, id: &str) -> Option<User> {
        self.data.read().users.iter().find(|u| u.id == id).cloned()
    }

    pub fn by_vibe_user(&self, vibe_id: &str) -> Option<User> {
        self.data.read().users.iter().find(|u| u.vibe_user_id.as_deref() == Some(vibe_id)).cloned()
    }

    pub fn create(&self, name: &str, role: Role, servers: Vec<String>, vibe_user_id: Option<String>) -> AppResult<User> {
        let mut d = self.data.write();
        let role = if role == Role::Owner && d.users.iter().any(|u| u.role == Role::Owner) { Role::Admin } else { role };
        let u = User {
            id: crypto::new_id("usr"),
            name: clean_name(name),
            role,
            servers: if servers.is_empty() { all_servers() } else { servers },
            created_at: now_ms(),
            vibe_user_id,
        };
        d.users.push(u.clone());
        self.save(&d)?;
        Ok(u)
    }

    pub fn update(&self, id: &str, p: UserPatch) -> AppResult<User> {
        let mut d = self.data.write();
        let u = d.users.iter_mut().find(|u| u.id == id).ok_or_else(|| AppError::NotFound(format!("Benutzer {id}")))?;
        if let Some(r) = p.role {
            if u.role == Role::Owner && r != Role::Owner {
                return Err(AppError::Invalid("Der Besitzer kann nicht herabgestuft werden.".into()));
            }
            if r == Role::Owner && u.role != Role::Owner {
                return Err(AppError::Invalid("Es gibt genau einen Besitzer.".into()));
            }
            u.role = r;
        }
        if let Some(n) = p.name.filter(|n| !n.trim().is_empty()) {
            u.name = clean_name(&n);
        }
        if let Some(s) = p.servers {
            u.servers = if s.is_empty() { all_servers() } else { s };
        }
        let out = u.clone();
        self.save(&d)?;
        Ok(out)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let mut d = self.data.write();
        let u = d.users.iter().find(|u| u.id == id).ok_or_else(|| AppError::NotFound(format!("Benutzer {id}")))?;
        if u.role == Role::Owner {
            return Err(AppError::Invalid("Der Besitzer kann nicht entfernt werden.".into()));
        }
        d.users.retain(|u| u.id != id);
        d.tokens.retain(|t| t.user_id != id);
        self.save(&d)
    }

    pub fn issue_token(&self, user_id: &str, client_name: &str, client_kind: &str) -> AppResult<(String, TokenInfo)> {
        let token = crypto::new_token();
        let rec = TokenRecord {
            id: crypto::new_id("tok"),
            user_id: user_id.to_string(),
            hash: crypto::sha256_hex(token.as_bytes()),
            client_name: clean_name(client_name),
            client_kind: client_kind.to_string(),
            created_at: now_ms(),
            last_used_at: None,
            last_ip: None,
        };
        let info = TokenInfo::from(&rec);
        let mut d = self.data.write();
        d.tokens.push(rec);
        self.save(&d)?;
        Ok((token, info))
    }

    pub fn authenticate(&self, token: &str) -> Option<(User, String)> {
        if !token.starts_with("va_") {
            return None;
        }
        let hash = crypto::sha256_hex(token.as_bytes());
        let d = self.data.read();
        let t = d.tokens.iter().find(|t| crypto::ct_eq(&t.hash, &hash))?;
        let u = d.users.iter().find(|u| u.id == t.user_id)?;
        Some((u.clone(), t.id.clone()))
    }

    pub fn touch(&self, token_id: &str, ip: Option<String>) {
        let mut d = self.data.write();
        let now = now_ms();
        let Some(t) = d.tokens.iter_mut().find(|t| t.id == token_id) else { return };
        let stale = t.last_used_at.map_or(true, |l| now - l > 60_000) || t.last_ip != ip;
        t.last_used_at = Some(now);
        t.last_ip = ip;
        if stale {
            let _ = self.save(&d);
        }
    }

    pub fn tokens(&self, user_id: Option<&str>) -> Vec<TokenInfo> {
        self.data.read().tokens.iter().filter(|t| user_id.map_or(true, |u| t.user_id == u)).map(TokenInfo::from).collect()
    }

    pub fn token_owner(&self, token_id: &str) -> Option<String> {
        self.data.read().tokens.iter().find(|t| t.id == token_id).map(|t| t.user_id.clone())
    }

    pub fn revoke(&self, token_id: &str) -> AppResult<()> {
        let mut d = self.data.write();
        let before = d.tokens.len();
        d.tokens.retain(|t| t.id != token_id);
        if d.tokens.len() == before {
            return Err(AppError::NotFound(format!("Token {token_id}")));
        }
        self.save(&d)
    }

    pub fn rotate(&self, token_id: &str) -> AppResult<(String, TokenInfo)> {
        let (user_id, name, kind) = {
            let d = self.data.read();
            let t = d.tokens.iter().find(|t| t.id == token_id).ok_or_else(|| AppError::NotFound(format!("Token {token_id}")))?;
            (t.user_id.clone(), t.client_name.clone(), t.client_kind.clone())
        };
        self.revoke(token_id)?;
        self.issue_token(&user_id, &name, &kind)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (UserStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("vibe-agent-users-{}", crypto::new_id("t")));
        std::fs::create_dir_all(&dir).unwrap();
        (UserStore::load(dir.join("users.json")), dir)
    }

    #[test]
    fn tokens_are_hashed_and_rotate() {
        let (s, dir) = store();
        let u = s.create("Henny", Role::Owner, vec![], None).unwrap();
        let (tok, info) = s.issue_token(&u.id, "Launcher", "launcher").unwrap();
        let raw = std::fs::read_to_string(dir.join("users.json")).unwrap();
        assert!(!raw.contains(&tok));
        assert_eq!(s.authenticate(&tok).unwrap().0.id, u.id);
        assert!(s.authenticate("va_falsch").is_none());
        let (tok2, _) = s.rotate(&info.id).unwrap();
        assert!(s.authenticate(&tok).is_none());
        assert!(s.authenticate(&tok2).is_some());
        let reloaded = UserStore::load(dir.join("users.json"));
        assert!(reloaded.authenticate(&tok2).is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn single_owner() {
        let (s, dir) = store();
        let o = s.create("A", Role::Owner, vec![], None).unwrap();
        let b = s.create("B", Role::Owner, vec!["srv".into()], None).unwrap();
        assert_eq!(b.role, Role::Admin);
        assert!(b.can_access("srv") && !b.can_access("other"));
        assert!(s.delete(&o.id).is_err());
        assert!(s.update(&o.id, UserPatch { role: Some(Role::Viewer), ..Default::default() }).is_err());
        s.delete(&b.id).unwrap();
        assert!(s.get(&b.id).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
