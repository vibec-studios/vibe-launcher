use crate::cli::Args;
use vibe_server_core::error::{AppError, AppResult};

pub const SERVICE_NAME: &str = "VibeAgent";

#[cfg(target_os = "linux")]
const UNIT_PATH: &str = "/etc/systemd/system/vibe-agent.service";

#[cfg(target_os = "linux")]
pub fn unit_file(exe: &str, data: &str) -> String {
    format!(
        "[Unit]
Description=Vibe Server Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vibe-agent
Group=vibe-agent
EnvironmentFile=-/etc/vibe-agent/agent.env
Environment=VIBE_AGENT_DATA_DIR={data}
ExecStart={exe} run
Restart=always
RestartSec=5
TimeoutStopSec=90
KillMode=mixed
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths={data}
WorkingDirectory={data}

[Install]
WantedBy=multi-user.target
"
    )
}

fn run_cmd(cmd: &str, args: &[&str]) -> AppResult<()> {
    let st = std::process::Command::new(cmd).args(args).status().map_err(|e| AppError::msg(format!("{cmd}: {e}")))?;
    if st.success() {
        Ok(())
    } else {
        Err(AppError::msg(format!("{cmd} {} fehlgeschlagen ({st})", args.join(" "))))
    }
}

#[cfg(target_os = "linux")]
pub fn install(args: &Args) -> AppResult<()> {
    let exe = std::env::current_exe()?.to_string_lossy().to_string();
    let dirs = crate::config::resolve_dirs(args.data_dir.as_deref(), args.config_dir.as_deref());
    let data = dirs.data.to_string_lossy().to_string();
    if run_cmd("id", &["-u", "vibe-agent"]).is_err() {
        run_cmd("useradd", &["--system", "--home-dir", &data, "--shell", "/usr/sbin/nologin", "vibe-agent"])?;
    }
    std::fs::create_dir_all(&dirs.data)?;
    run_cmd("chown", &["-R", "vibe-agent:vibe-agent", &data])?;
    std::fs::create_dir_all("/etc/vibe-agent")?;
    std::fs::write(UNIT_PATH, unit_file(&exe, &data))?;
    run_cmd("systemctl", &["daemon-reload"])?;
    run_cmd("systemctl", &["enable", "--now", "vibe-agent"])?;
    println!("Dienst vibe-agent eingerichtet und gestartet. Kopplungscode: sudo -u vibe-agent {exe} pair");
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn uninstall(_args: &Args) -> AppResult<()> {
    let _ = run_cmd("systemctl", &["disable", "--now", "vibe-agent"]);
    let _ = std::fs::remove_file(UNIT_PATH);
    run_cmd("systemctl", &["daemon-reload"])?;
    println!("Dienst entfernt (Datenordner bleibt erhalten).");
    Ok(())
}

#[cfg(windows)]
pub fn install(args: &Args) -> AppResult<()> {
    let exe = std::env::current_exe()?.to_string_lossy().to_string();
    let dirs = crate::config::resolve_dirs(args.data_dir.as_deref(), args.config_dir.as_deref());
    std::fs::create_dir_all(&dirs.data)?;
    let bin = format!("\"{exe}\" run --service");
    run_cmd("sc.exe", &["create", SERVICE_NAME, "binPath=", &bin, "start=", "auto", "obj=", "NT SERVICE\\VibeAgent", "DisplayName=", "Vibe Server Agent"])?;
    let _ = run_cmd("sc.exe", &["failure", SERVICE_NAME, "reset=", "86400", "actions=", "restart/5000/restart/5000/restart/30000"]);
    let _ = run_cmd("sc.exe", &["failureflag", SERVICE_NAME, "1"]);
    let data = dirs.data.to_string_lossy().to_string();
    let _ = run_cmd("icacls", &[&data, "/grant", "NT SERVICE\\VibeAgent:(OI)(CI)M"]);
    run_cmd("sc.exe", &["start", SERVICE_NAME])?;
    println!("Dienst {SERVICE_NAME} eingerichtet und gestartet. Kopplungscode: vibe-agent pair");
    Ok(())
}

#[cfg(windows)]
pub fn uninstall(_args: &Args) -> AppResult<()> {
    let _ = run_cmd("sc.exe", &["stop", SERVICE_NAME]);
    run_cmd("sc.exe", &["delete", SERVICE_NAME])?;
    println!("Dienst entfernt (Datenordner bleibt erhalten).");
    Ok(())
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn install(_args: &Args) -> AppResult<()> {
    let _ = run_cmd;
    Err(AppError::NotConfigured("Dienst-Einrichtung gibt es nur für Linux (systemd) und Windows.".into()))
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn uninstall(args: &Args) -> AppResult<()> {
    install(args)
}

#[cfg(windows)]
pub mod win {
    use super::SERVICE_NAME;
    use std::ffi::OsString;
    use std::time::Duration;
    use windows_service::service::{ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType};
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::{define_windows_service, service_dispatcher};

    static ARGS: std::sync::OnceLock<crate::cli::Args> = std::sync::OnceLock::new();

    define_windows_service!(ffi_service_main, service_main);

    pub fn run(args: crate::cli::Args) -> Result<(), String> {
        let _ = ARGS.set(args);
        service_dispatcher::start(SERVICE_NAME, ffi_service_main).map_err(|e| format!("Windows-Dienst: {e}"))
    }

    fn status(state: ServiceState, accept: ServiceControlAccept, code: u32) -> ServiceStatus {
        ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: accept,
            exit_code: ServiceExitCode::Win32(code),
            checkpoint: 0,
            wait_hint: Duration::from_secs(90),
            process_id: None,
        }
    }

    fn service_main(_argv: Vec<OsString>) {
        let token = tokio_util::sync::CancellationToken::new();
        let t2 = token.clone();
        let handler = move |c| match c {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                t2.cancel();
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        };
        let Ok(h) = service_control_handler::register(SERVICE_NAME, handler) else { return };
        let _ = h.set_service_status(status(ServiceState::Running, ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN, 0));
        let args = ARGS.get().cloned().unwrap_or_default();
        let rt = crate::app::runtime();
        let res = rt.block_on(crate::app::run(args, token.clone()));
        if let Err(e) = &res {
            tracing::error!("Agent beendet mit Fehler: {e}");
        }
        let _ = h.set_service_status(status(ServiceState::StopPending, ServiceControlAccept::empty(), 0));
        let _ = h.set_service_status(status(ServiceState::Stopped, ServiceControlAccept::empty(), if res.is_ok() { 0 } else { 1 }));
    }
}
