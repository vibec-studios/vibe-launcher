use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use serde_json::json;
use vibefix_infer::{identify, package_version, read_log, AnyModel, LogFile};

const USAGE: &str = "vibefix-infer [--model DIR] [--profile NAME] [--raw] [--pretty] [--time] <logs…>";

struct Args {
    model: PathBuf,
    profile: Option<String>,
    raw: bool,
    pretty: bool,
    time: bool,
    logs: Vec<PathBuf>,
}

fn package_exists(path: &Path) -> bool {
    ["config.json", "weights.bin", "tokenizer.json"].iter().all(|name| path.join(name).is_file())
}

fn recommended(path: &Path) -> bool {
    let Ok(readme) = std::fs::read_to_string(path.join("README.md")) else { return false };
    let status = regex::Regex::new(concat!(
        r"(?im)^[ \t]*(?:[#*\-]+[ \t]*|<!--[ \t]*)?(?:(?:\*\*)?status\*{0,2}:(?:\*\*)?[ \t]*)?",
        r"(?:\*\*)?(?:recommended|empfohlen)(?:\*\*)?(?:[ \t]*-->)?[.!]?[ \t]*\r?$",
    ))
    .expect("VibeFix README-Status");
    status.is_match(&readme)
        && std::fs::read(path.join("config.json"))
            .ok()
            .is_some_and(|config| matches!(package_version(&config), Ok(2 | 3)))
}

fn default_model(profile: Option<&str>) -> PathBuf {
    if let Some(dir) = std::env::var_os("VIBEFIX_MODEL") {
        return PathBuf::from(dir);
    }
    let v3 = Path::new("export/v3");
    if profile.is_none() && package_exists(v3) && recommended(v3) {
        return v3.to_owned();
    }
    let v2 = Path::new("export/v2");
    if package_exists(v2) {
        return v2.to_owned();
    }
    PathBuf::from("export")
}

fn parse() -> Result<Args, String> {
    let mut model = None;
    let mut args =
        Args { model: PathBuf::new(), profile: None, raw: false, pretty: false, time: false, logs: Vec::new() };
    let mut items = std::env::args_os().skip(1);
    while let Some(item) = items.next() {
        match item.to_str() {
            Some("--model") => model = Some(items.next().map(PathBuf::from).ok_or("--model braucht ein Verzeichnis")?),
            Some("--profile") => {
                args.profile =
                    Some(items.next().and_then(|item| item.into_string().ok()).ok_or("--profile braucht einen Namen")?);
            }
            Some("--raw") => args.raw = true,
            Some("--pretty") => args.pretty = true,
            Some("--time") => args.time = true,
            Some("-h" | "--help") => return Err(USAGE.into()),
            _ => args.logs.push(PathBuf::from(item)),
        }
    }
    if args.logs.is_empty() {
        return Err(USAGE.into());
    }
    args.model = model.unwrap_or_else(|| default_model(args.profile.as_deref().filter(|name| !name.is_empty())));
    Ok(args)
}

fn log_file(path: &Path) -> LogFile {
    let mut name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if name.to_lowercase().ends_with(".gz") {
        name.truncate(name.len() - 3);
    }
    let text = read_log(path);
    LogFile { kind: identify(&text, &name).to_owned(), name, text }
}

fn main() -> ExitCode {
    let args = match parse() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    let model = match AnyModel::load(&args.model).and_then(|mut model| {
        model.set_profile(args.profile.as_deref())?;
        Ok(model)
    }) {
        Ok(model) => model,
        Err(error) => {
            eprintln!("Modell aus {} nicht ladbar: {error}", args.model.display());
            return ExitCode::from(1);
        }
    };
    let files: Vec<LogFile> = args.logs.iter().map(|p| log_file(p)).collect();
    let started = Instant::now();
    let mut value = if args.raw { model.predict(&files) } else { json!(model.analyze(&files)) };
    value["model_version"] = json!(model.version());
    if args.time {
        value["elapsed_ms"] = json!(started.elapsed().as_secs_f64() * 1000.0);
    }
    let kinds: Vec<_> = files.iter().map(|f| json!({"name": f.name, "kind": f.kind})).collect();
    value["files"] = json!(kinds);
    let text = if args.pretty { serde_json::to_string_pretty(&value) } else { serde_json::to_string(&value) };
    println!("{}", text.unwrap_or_default());
    ExitCode::SUCCESS
}
