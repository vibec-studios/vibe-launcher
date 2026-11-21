use crate::content::HttpCache;
use crate::events::Sink;
use crate::host::Host;
use crate::net::Net;
use crate::paths::Paths;
use crate::server::{ServerManager, ServerStore};
use crate::tasks::Tasks;
use std::sync::Arc;

#[derive(Clone)]
pub struct Core {
    pub paths: Paths,
    pub net: Arc<Net>,
    pub tasks: Arc<Tasks>,
    pub events: Sink,
    pub servers: Arc<ServerStore>,
    pub server_mgr: Arc<ServerManager>,
    pub http_cache: Arc<HttpCache>,
    pub install_lock: Arc<tokio::sync::Mutex<()>>,
    pub host: Arc<dyn Host>,
}

impl Core {
    pub fn new(paths: Paths, net: Arc<Net>, events: Sink, host: Arc<dyn Host>) -> Core {
        let tasks = Tasks::new(events.clone());
        let servers = ServerStore::load(paths.clone(), events.clone());
        let server_mgr = ServerManager::new(paths.clone(), events.clone());
        Core {
            paths,
            net,
            tasks,
            events,
            servers,
            server_mgr,
            http_cache: Arc::new(HttpCache::default()),
            install_lock: Arc::new(tokio::sync::Mutex::new(())),
            host,
        }
    }
}
