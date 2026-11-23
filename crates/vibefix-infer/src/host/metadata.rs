use std::sync::LazyLock;

use serde_json::{json, Map, Value};

use super::mods::{extract_mods, ModTable};
use super::pyre::{Hay, Py};
use super::segment::{segment, Kind, LogLine};
use crate::category::exception;
use crate::LogFile;

const VERSION: &str = r"(\d[\w.+-]*)";
const MC_VERSION: &str = r"(\d+\.\d+(?:\.\d+)?(?:[-_](?:pre|rc|snapshot)[\w.-]*)?|\d{2}w\d{2}[a-z])";

type Spec<'a> = (String, &'a [&'a str]);

fn compile(flags: &str, patterns: &[Spec<'_>]) -> Vec<Py> {
    patterns.iter().map(|(p, n)| Py::new(&format!("{flags}{p}")).needing(n)).collect()
}

static MC: LazyLock<Vec<Py>> = LazyLock::new(|| {
    let v = MC_VERSION;
    compile(
        "(?im)",
        &[
            (format!(r"^\s*Minecraft Version(?: ID)?:\s*{v}"), &["minecraft version"]),
            (format!(r"\bLoading Minecraft\s+{v}"), &["loading minecraft"]),
            (
                format!(r#"(?i:--fml\.mcVersion|--minecraftVersion)[,=: \t]+["']?{v}"#),
                &["--fml.mcversion", "--minecraftversion"],
            ),
            (format!(r#"--version[,=: \t]+["']?{v}(?=-(?:neo)?forge\b|["',\]\s]|$)"#), &["--version"]),
            (format!(r"\bStarting minecraft server version\s+{v}"), &["starting minecraft server version"]),
            (format!(r"\bMinecraft(?:®)?(?: Game)? Version[:= ]+\s*{v}"), &["minecraft"]),
            (format!(r"\bMinecraft\s+{v}\b"), &["minecraft"]),
        ],
    )
});
static LOADER: LazyLock<Py> = LazyLock::new(|| {
    Py::new(&format!(r"(?i)\bwith (Fabric|Quilt) Loader\s+{VERSION}"))
        .needing(&["with fabric loader", "with quilt loader"])
});
static LOADER_VERSIONS: LazyLock<Vec<(&str, Vec<Py>)>> = LazyLock::new(|| {
    let v = VERSION;
    vec![
        (
            "fabric",
            compile(
                "(?i)",
                &[
                    (format!(r"\bFabric Loader(?: Version)?[ :=v]+{v}"), &["fabric loader"]),
                    (format!(r"\bfabricloader(?:[-/: ]+){v}(?:\.jar|\b)"), &["fabricloader"]),
                ],
            ),
        ),
        ("quilt", compile("(?i)", &[(format!(r"\bQuilt Loader(?: Version)?[ :=v]+{v}"), &["quilt loader"])])),
        (
            "neoforge",
            compile(
                "(?i)",
                &[
                    (format!(r#"--fml\.neoForgeVersion[,=: \t]+["']?{v}"#), &["--fml.neoforgeversion"]),
                    (format!(r"\bNeoForge(?: Version)?[ :=v]+{v}"), &["neoforge"]),
                    (
                        r"\bneoforge-(\d+(?:\.\d+){1,3}(?:-beta)?)-(?:universal|client|server)\.jar".to_owned(),
                        &["neoforge-"],
                    ),
                ],
            ),
        ),
        (
            "forge",
            compile(
                "(?i)",
                &[
                    (format!(r"MinecraftForge(?: Version)?[ :=v]+{v}"), &["minecraftforge"]),
                    (format!(r"\bForge Mod Loader version\s+{v}"), &["forge mod loader version"]),
                    (format!(r#"--fml\.forgeVersion[,=: \t]+["']?{v}"#), &["--fml.forgeversion"]),
                    (r#"--version[,=: \t]+["']?\d+\.\d+(?:\.\d+)?-forge-(\d+(?:\.\d+){1,3})"#.to_owned(), &["-forge-"]),
                    (r"\bforge-\d+\.\d+(?:\.\d+)?-(\d+(?:\.\d+){1,3})(?:[-.]|$)".to_owned(), &["forge-"]),
                    (format!(r"\bForge(?: Version)?[ :=v]+{v}"), &["forge"]),
                ],
            ),
        ),
    ]
});
static LOADER_HINTS: LazyLock<Vec<(&str, Py)>> = LazyLock::new(|| {
    vec![
        ("quilt", Py::new(r"\borg\.quiltmc\.loader\.").needing(&["org.quiltmc.loader."])),
        ("fabric", Py::new(r"\bnet\.fabricmc\.loader\.").needing(&["net.fabricmc.loader."])),
        ("neoforge", Py::new(r"\bnet\.neoforged\.(?:fml|neoforge)\.").needing(&["net.neoforged."])),
        ("forge", Py::new(r"\bnet\.minecraftforge\.(?:fml|common)\.").needing(&["net.minecraftforge."])),
        ("vanilla", Py::new(r"(?im)^\s*Is Modded:\s*Probably not\.").needing(&["is modded:"])),
    ]
});
static JAVA: LazyLock<Vec<Py>> = LazyLock::new(|| {
    compile(
        "(?i)",
        &[
            (r#"\bJava(?: (?:runtime|VM))? version[:= ]+\s*["']?(?:1\.)?(\d+)"#.to_owned(), &["java"]),
            (r#"\b(?:openjdk|java) (?:version|runtime) ["']?(?:1\.)?(\d+)"#.to_owned(), &["openjdk ", "java "]),
            (r"\bJava is version\s+(?:1\.)?(\d+)".to_owned(), &["java is version"]),
            (r"\b(?:Java|OpenJDK)\b[^\n]{0,100}?\bJRE\W+(?:1\.)?(\d+)".to_owned(), &["jre"]),
            (r"\bJRE version:[^(]*\((?:1\.)?(\d+)".to_owned(), &["jre version:"]),
        ],
    )
});
static JAVA_MAJOR: LazyLock<Py> = LazyLock::new(|| Py::anchored(r"(?:1\.)?(\d+)"));
static EXIT: LazyLock<Py> = LazyLock::new(|| {
    Py::new(concat!(
        r"(?i)\b(?:exit(?:ed)?(?:\s+with)?(?:\s+exit)?[ _-]*(?:code|status)",
        r"|process (?:exited|ended|returned)(?: with)?(?: code)?)[:= ]+\s*(-?(?:0x[0-9a-f]+|\d+))"
    ))
    .needing(&["exit", "process "])
});
pub(crate) fn last_exit_code(hay: &Hay<'_>) -> Value {
    EXIT.iter_in(hay).last().and_then(|c| c.get(1)).map_or(Value::Null, |m| parse_exit(m.as_str()))
}

pub static FATAL: LazyLock<Py> = LazyLock::new(|| {
    Py::new(concat!(
        r"(?im)^\s*(?:---- Minecraft Crash Report ----|# A fatal error has been detected by the Java Runtime Environment)",
        r#"|(?:^|\]:\s*)Exception in thread "main""#,
        r"|\b(?:crash report (?:has been )?saved|(?:game|minecraft|server) crashed|",
        r"encountered an unexpected exception|failed to start the minecraft server|",
        r"incompatible mods found|incompatible mod set|a potential solution has been determined|",
        r"(?:an )?error occurred during initialization of (?:vm|boot layer)|could not create the java virtual machine)\b"
    ))
    .needing(&[
        "---- minecraft crash report ----",
        "# a fatal error has been detected by the java runtime environment",
        "exception in thread \"main\"",
        "crash report ",
        " crashed",
        "encountered an unexpected exception",
        "failed to start the minecraft server",
        "incompatible mod",
        "a potential solution has been determined",
        "error occurred during initialization of ",
        "could not create the java virtual machine",
    ])
});

pub fn fatal(text: &str) -> bool {
    FATAL.is_match_in(&Hay::new(text))
}

fn first_match(patterns: &[Py], hay: &Hay<'_>) -> Option<String> {
    patterns.iter().find_map(|p| p.search_in(hay).map(|c| c.get(1).map_or("", |m| m.as_str()).to_owned()))
}

fn loader_details(hay: &Hay<'_>, mods: &ModTable) -> (Option<String>, Option<String>) {
    if let Some(m) = LOADER.search_in(hay) {
        return (Some(m[1].to_lowercase()), Some(m[2].to_owned()));
    }
    for (loader, patterns) in LOADER_VERSIONS.iter() {
        let id = match *loader {
            "fabric" => "fabricloader",
            "quilt" => "quilt_loader",
            other => other,
        };
        let known = mods.get(id).and_then(|e| e.1.clone()).filter(|v| !v.is_empty());
        let version = known.or_else(|| first_match(patterns, hay)).filter(|v| !v.is_empty());
        if let Some(v) = version {
            return (Some((*loader).to_owned()), Some(v.strip_suffix(".jar").unwrap_or(&v).to_owned()));
        }
    }
    let hint = LOADER_HINTS.iter().find(|(_, p)| p.is_match_in(hay)).map(|(l, _)| (*l).to_owned());
    (hint, None)
}

fn chains(lines: &[LogLine], file: &str, out: &mut Vec<Value>) {
    let mut chain: Vec<Value> = Vec::new();
    let flush = |chain: &mut Vec<Value>, out: &mut Vec<Value>| {
        if out.len() < 96 {
            out.push(Value::Array(chain.iter().take(32).cloned().collect()));
        }
        chain.clear();
    };
    for line in lines {
        if let Some(m) = exception(line.message()) {
            let relation = match m.relation {
                Some("Caused by") => "cause",
                Some("Suppressed") => "suppressed",
                _ => "root",
            };
            if relation == "root" && !chain.is_empty() {
                flush(&mut chain, out);
            }
            chain.push(json!({"type": m.kind, "message": m.message.unwrap_or(""), "relation": relation,
                              "file": file, "line": line.number}));
        } else if !chain.is_empty() && !matches!(line.kind, Kind::Exception | Kind::Blank) {
            flush(&mut chain, out);
        }
    }
    if !chain.is_empty() {
        flush(&mut chain, out);
    }
}

fn parse_exit(value: &str) -> Value {
    let (negative, body) = value.strip_prefix('-').map_or((false, value), |rest| (true, rest));
    let parsed = if value.to_lowercase().contains("0x") {
        i64::from_str_radix(&body[2..], 16).ok()
    } else {
        body.parse::<i64>().ok()
    };
    parsed.map_or(Value::Null, |v| json!(if negative { -v } else { v }))
}

pub fn extract_meta(files: &[LogFile]) -> Map<String, Value> {
    let mut all = ModTable::default();
    let mut exceptions = Vec::new();
    let mut texts = Vec::new();
    let mut crash = false;
    for file in files {
        let lines = segment(&file.text);
        let text = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
        crash |= matches!(file.kind.as_str(), "crash_report" | "hs_err") || fatal(&text);
        for (id, version, jar) in extract_mods(&lines).entries {
            all.record(&id, version.as_deref(), jar.as_deref());
        }
        chains(&lines, &file.name, &mut exceptions);
        texts.push(text);
    }
    let text = texts.join("\n");
    let hay = Hay::new(&text);
    let mc =
        first_match(&MC, &hay).filter(|v| !v.is_empty()).or_else(|| all.get("minecraft").and_then(|e| e.1.clone()));
    let (loader, loader_version) = loader_details(&hay, &all);
    let java_text =
        first_match(&JAVA, &hay).filter(|v| !v.is_empty()).or_else(|| all.get("java").and_then(|e| e.1.clone()));
    let java = java_text.and_then(|t| JAVA_MAJOR.group(&t, 1).and_then(|d| d.parse::<i64>().ok()));
    let exit = last_exit_code(&hay);
    let crash = crash || !(exit.is_null() || exit == json!(0));
    let mut meta = Map::new();
    meta.insert("mc".into(), json!(mc));
    meta.insert("loader".into(), json!(loader));
    meta.insert("loader_version".into(), json!(loader_version));
    meta.insert("java".into(), json!(java));
    meta.insert("exit_code".into(), exit);
    meta.insert("mods".into(), Value::Array(all.values()));
    meta.insert("exceptions".into(), Value::Array(exceptions));
    meta.insert("crash".into(), json!(crash));
    meta
}
