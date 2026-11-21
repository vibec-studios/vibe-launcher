use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Owner,
    Admin,
    Operator,
    Viewer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Perm {
    ServersRead,
    ServersControl,
    ServersManage,
    FilesRead,
    FilesWrite,
    AgentAdmin,
}

impl Perm {
    pub const ALL: [Perm; 6] = [Perm::ServersRead, Perm::ServersControl, Perm::ServersManage, Perm::FilesRead, Perm::FilesWrite, Perm::AgentAdmin];

    pub fn as_str(self) -> &'static str {
        match self {
            Perm::ServersRead => "servers.read",
            Perm::ServersControl => "servers.control",
            Perm::ServersManage => "servers.manage",
            Perm::FilesRead => "files.read",
            Perm::FilesWrite => "files.write",
            Perm::AgentAdmin => "agent.admin",
        }
    }
}

impl Role {
    pub fn allows(self, p: Perm) -> bool {
        match self {
            Role::Owner | Role::Admin => true,
            Role::Operator => matches!(p, Perm::ServersRead | Perm::ServersControl | Perm::FilesRead),
            Role::Viewer => p == Perm::ServersRead,
        }
    }

    pub fn permissions(self) -> Vec<&'static str> {
        Perm::ALL.into_iter().filter(|p| self.allows(*p)).map(Perm::as_str).collect()
    }

    pub fn parse(s: &str) -> Option<Role> {
        serde_json::from_value(serde_json::Value::String(s.to_ascii_lowercase())).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_matrix() {
        assert!(Role::Owner.allows(Perm::AgentAdmin));
        assert!(Role::Admin.allows(Perm::FilesWrite));
        assert!(Role::Operator.allows(Perm::ServersControl));
        assert!(!Role::Operator.allows(Perm::ServersManage));
        assert!(!Role::Operator.allows(Perm::FilesWrite));
        assert!(Role::Viewer.allows(Perm::ServersRead));
        assert!(!Role::Viewer.allows(Perm::ServersControl));
        assert_eq!(Role::parse("Viewer"), Some(Role::Viewer));
        assert_eq!(Role::parse("root"), None);
        assert_eq!(Role::Viewer.permissions(), vec!["servers.read"]);
    }
}
