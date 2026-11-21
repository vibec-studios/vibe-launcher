use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use vibe_server_core::error::{AppError, AppResult};

pub const DEFAULT_PORT: u16 = 25580;
pub const CONFIG_FILE: &str = "agent.toml";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub bind: String,
    pub port: u16,
    pub tls: bool,
    pub tls_cert: Option<String>,
    pub tls_key: Option<String>,
    pub gateway_enabled: bool,
    pub gateway_url: Option<String>,
    pub api_url: Option<String>,
    pub curseforge_api_key: Option<String>,
    pub allowed_java: Vec<String>,
    pub auto_java: bool,
    pub concurrent_downloads: u32,
    pub hosting: bool,
}

impl Default for AgentConfig {
    fn default() -> Self {
        AgentConfig {
            id: format!("agt_{}", uuid::Uuid::new_v4().simple()),
            name: hostname(),
            bind: "0.0.0.0".into(),
            port: DEFAULT_PORT,
            tls: true,
            tls_cert: None,
            tls_key: None,
            gateway_enabled: false,
            gateway_url: None,
            api_url: None,
            curseforge_api_key: None,
            allowed_java: Vec::new(),
            auto_java: true,
            concurrent_downloads: 8,
            hosting: true,
        }
    }
}

pub fn hostname() -> String {
    sysinfo::System::host_name().filter(|h| !h.trim().is_empty()).unwrap_or_else(|| "Vibe Agent".into())
}

#[derive(Debug, Clone)]
pub struct Dirs {
    pub config: PathBuf,
    pub data: PathBuf,
}

impl Dirs {
    pub fn tls(&self) -> PathBuf {
        self.config.join("tls")
    }
    pub fn users_file(&self) -> PathBuf {
        self.config.join("users.json")
    }
    pub fn gateway_file(&self) -> PathBuf {
        self.config.join("gateway.json")
    }
    pub fn pair_file(&self) -> PathBuf {
        self.config.join("pairing.json")
    }
    pub fn audit_file(&self) -> PathBuf {
        self.data.join("audit.log")
    }
}

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var(name).ok().filter(|p| !p.trim().is_empty()).map(PathBuf::from)
}

fn docker_dir(p: &str) -> Option<PathBuf> {
    (Path::new("/.dockerenv").exists() && Path::new(p).is_dir()).then(|| PathBuf::from(p))
}

pub fn default_data_dir() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into())).join("VibeAgent")
    } else {
        PathBuf::from("/var/lib/vibe-agent")
    }
}

pub fn resolve_dirs(data_cli: Option<&str>, config_cli: Option<&str>) -> Dirs {
    let data = data_cli
        .map(PathBuf::from)
        .or_else(|| env_dir("VIBE_AGENT_DATA_DIR"))
        .or_else(|| docker_dir("/data"))
        .unwrap_or_else(default_data_dir);
    let config = config_cli.map(PathBuf::from).or_else(|| env_dir("VIBE_AGENT_CONFIG_DIR")).unwrap_or_else(|| data.join("config"));
    Dirs { config, data }
}

pub fn env_override(cfg: &mut AgentConfig, port_cli: Option<u16>, bind_cli: Option<&str>) {
    if let Some(p) = port_cli.or_else(|| std::env::var("VIBE_AGENT_PORT").ok().and_then(|v| v.trim().parse().ok())) {
        cfg.port = p;
    }
    if let Some(b) = bind_cli.map(str::to_string).or_else(|| std::env::var("VIBE_AGENT_BIND").ok().filter(|v| !v.trim().is_empty())) {
        cfg.bind = b.trim().to_string();
    }
}

pub fn load_or_create(dir: &Path) -> AppResult<AgentConfig> {
    let path = dir.join(CONFIG_FILE);
    if let Ok(text) = std::fs::read_to_string(&path) {
        return toml::from_str(&text).map_err(|e| AppError::Invalid(format!("{}: {e}", path.display())));
    }
    let cfg = AgentConfig::default();
    save(dir, &cfg)?;
    Ok(cfg)
}

pub fn save(dir: &Path, cfg: &AgentConfig) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    let text = toml::to_string_pretty(cfg).map_err(|e| AppError::msg(e.to_string()))?;
    let path = dir.join(CONFIG_FILE);
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}
