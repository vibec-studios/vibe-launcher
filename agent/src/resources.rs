use serde::Serialize;
use std::path::Path;
use sysinfo::{Disks, Pid, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize)]
pub struct ServerUsage {
    pub id: String,
    pub pid: Option<u32>,
    pub cpu_percent: f32,
    pub mem_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Resources {
    pub cpu_percent: f32,
    pub cpu_cores: usize,
    pub mem_total: u64,
    pub mem_used: u64,
    pub disk_total: u64,
    pub disk_free: u64,
    pub uptime_s: u64,
    pub servers: Vec<ServerUsage>,
}

fn disk_for(path: &Path) -> (u64, u64) {
    let canon = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let disks = Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| canon.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| (d.total_space(), d.available_space()))
        .unwrap_or((0, 0))
}

pub async fn sample(data_dir: &Path, servers: Vec<(String, Option<u32>)>) -> Resources {
    let data_dir = data_dir.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        let pids: Vec<Pid> = servers.iter().filter_map(|(_, p)| p.map(Pid::from_u32)).collect();
        sys.refresh_processes(ProcessesToUpdate::Some(&pids), true);
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL.max(std::time::Duration::from_millis(250)));
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        sys.refresh_processes(ProcessesToUpdate::Some(&pids), true);
        let (disk_total, disk_free) = disk_for(&data_dir);
        let servers = servers
            .into_iter()
            .map(|(id, pid)| {
                let p = pid.and_then(|p| sys.process(Pid::from_u32(p)));
                ServerUsage { id, pid, cpu_percent: p.map(|p| p.cpu_usage()).unwrap_or(0.0), mem_bytes: p.map(|p| p.memory()).unwrap_or(0) }
            })
            .collect();
        Resources {
            cpu_percent: sys.global_cpu_usage(),
            cpu_cores: sys.cpus().len(),
            mem_total: sys.total_memory(),
            mem_used: sys.used_memory(),
            disk_total,
            disk_free,
            uptime_s: System::uptime(),
            servers,
        }
    })
    .await
    .unwrap_or_else(|_| Resources { cpu_percent: 0.0, cpu_cores: 0, mem_total: 0, mem_used: 0, disk_total: 0, disk_free: 0, uptime_s: 0, servers: vec![] })
}
