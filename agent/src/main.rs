mod api;
mod app;
mod audit;
mod cli;
mod commands;
mod config;
mod crypto;
mod fsguard;
mod gateway;
mod host;
mod jsonfile;
mod listener;
mod pairing;
mod ratelimit;
mod resources;
mod roles;
mod service;
mod state;
mod tls;
mod update;
mod users;

use std::process::ExitCode;

fn init_logging(args: &cli::Args) {
    let filter = tracing_subscriber::EnvFilter::try_from_env("VIBE_AGENT_LOG").unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    if args.service {
        let dir = config::resolve_dirs(args.data_dir.as_deref(), args.config_dir.as_deref()).data.join("logs");
        let _ = std::fs::create_dir_all(&dir);
        let file = tracing_appender::rolling::daily(dir, "agent.log");
        let _ = tracing_subscriber::fmt().with_env_filter(filter).with_writer(file).with_ansi(false).with_target(false).try_init();
    } else {
        let _ = tracing_subscriber::fmt().with_env_filter(filter).with_writer(std::io::stderr).with_target(false).try_init();
    }
}

fn fail(e: impl std::fmt::Display) -> ExitCode {
    eprintln!("Fehler: {e}");
    ExitCode::from(1)
}

fn main() -> ExitCode {
    let args = match cli::parse(std::env::args().skip(1)) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}\n\n{}", cli::HELP);
            return ExitCode::from(2);
        }
    };
    if args.version || args.command.first().map(String::as_str) == Some("version") {
        println!("vibe-agent {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    if args.help || args.command.is_empty() {
        print!("{}", cli::HELP);
        return if args.help { ExitCode::SUCCESS } else { ExitCode::from(2) };
    }
    vibe_server_core::product::set(host::product());
    let _ = rustls::crypto::ring::default_provider().install_default();
    init_logging(&args);
    let cmd: Vec<&str> = args.command.iter().map(String::as_str).collect();
    match cmd.as_slice() {
        ["run"] if args.service => run_service(args),
        ["run"] => {
            let rt = app::runtime();
            let token = tokio_util::sync::CancellationToken::new();
            rt.spawn(app::wait_for_signal(token.clone()));
            match rt.block_on(app::run(args, token)) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => fail(e),
            }
        }
        ["pair"] => commands::pair(&args).map(|_| ExitCode::SUCCESS).unwrap_or_else(fail),
        ["status"] => match app::runtime().block_on(commands::status(&args)) {
            Ok(true) => ExitCode::SUCCESS,
            Ok(false) => ExitCode::from(1),
            Err(e) => fail(e),
        },
        ["link"] | ["link", _] => app::runtime().block_on(commands::link(&args)).map(|_| ExitCode::SUCCESS).unwrap_or_else(fail),
        ["service", "install"] => service::install(&args).map(|_| ExitCode::SUCCESS).unwrap_or_else(fail),
        ["service", "uninstall"] => service::uninstall(&args).map(|_| ExitCode::SUCCESS).unwrap_or_else(fail),
        _ => {
            eprintln!("Unbekannter Befehl: {}\n\n{}", args.command.join(" "), cli::HELP);
            ExitCode::from(2)
        }
    }
}

#[cfg(windows)]
fn run_service(args: cli::Args) -> ExitCode {
    match service::win::run(args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => fail(e),
    }
}

#[cfg(not(windows))]
fn run_service(_args: cli::Args) -> ExitCode {
    fail("--service gibt es nur unter Windows; unter Linux startet systemd `vibe-agent run`.")
}
