use super::*;

// ------------------------------------------------------------------ Schätzen aus dem Ordner

pub(super) fn version_in(s: &str) -> Option<String> {
    let re = regex::Regex::new(r"\d+\.\d+(\.\d+)?").ok()?;
    // Minecraft hat keine "x.y.0"-Versionen ("1.21.0" heißt "1.21")
    re.find(s).map(|m| m.as_str().strip_suffix(".0").filter(|v| v.matches('.').count() == 1).unwrap_or(m.as_str()).to_string())
}

/// Loader + Minecraft-Version aus den Mod-Metadaten schätzen (höchstens 25 JARs).
pub fn infer(game_dir: &Path) -> (String, Loader) {
    let Ok(rd) = std::fs::read_dir(game_dir.join("mods")) else { return (String::new(), vanilla()) };
    let mut loaders: HashMap<LoaderKind, u32> = HashMap::new();
    let mut versions: HashMap<String, u32> = HashMap::new();
    let jars: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("jar"))).take(25).collect();
    for jar in jars {
        let Ok(f) = std::fs::File::open(&jar) else { continue };
        let Ok(mut z) = zip::ZipArchive::new(std::io::BufReader::new(f)) else { continue };
        let mut read = |n: &str| -> Option<Vec<u8>> {
            use std::io::Read;
            let mut e = z.by_name(n).ok()?;
            let mut v = Vec::new();
            e.read_to_end(&mut v).ok()?;
            Some(v)
        };
        if let Some(v) = read("fabric.mod.json").and_then(|b| crate::content::meta::lenient_json(&b)) {
            *loaders.entry(LoaderKind::Fabric).or_default() += 1;
            let dep = v.get("depends").and_then(|d| d.get("minecraft"));
            let txt = match dep {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).next().map(str::to_string),
                _ => None,
            };
            if let Some(v) = txt.as_deref().and_then(version_in) {
                *versions.entry(v).or_default() += 1;
            }
        } else if read("quilt.mod.json").is_some() {
            *loaders.entry(LoaderKind::Quilt).or_default() += 1;
        } else if let Some((kind, t)) = read("META-INF/neoforge.mods.toml").map(|t| (LoaderKind::Neoforge, t)).or_else(|| read("META-INF/mods.toml").map(|t| (LoaderKind::Forge, t))) {
            *loaders.entry(kind).or_default() += 1;
            let text = String::from_utf8_lossy(&t);
            // [[dependencies.x]] modId="minecraft" ... versionRange="[1.20.1,1.21)"
            if let Some(pos) = text.find("modId=\"minecraft\"").or_else(|| text.find("modId = \"minecraft\"")) {
                let rest = &text[pos..text.len().min(pos + 400)];
                if let Some(vr) = rest.find("versionRange") {
                    if let Some(v) = version_in(&rest[vr..rest.len().min(vr + 60)]) {
                        *versions.entry(v).or_default() += 1;
                    }
                }
            }
        }
    }
    let loader = loaders.into_iter().max_by_key(|(_, n)| *n).map(|(k, _)| Loader { kind: k, version: None }).unwrap_or_else(vanilla);
    // "1.20" (aus ">=1.20") zählt für die spezifischste passende Version ("1.20.1")
    let keys: Vec<String> = versions.keys().cloned().collect();
    for k in &keys {
        let prefix = format!("{k}.");
        if let Some(best) = keys.iter().filter(|o| o.starts_with(&prefix)).max_by_key(|o| versions.get(*o).copied().unwrap_or(0)).cloned() {
            if let Some(n) = versions.remove(k) {
                *versions.entry(best).or_default() += n;
            }
        }
    }
    let mc = versions.into_iter().max_by(|a, b| a.1.cmp(&b.1).then(a.0.len().cmp(&b.0.len())).then(a.0.cmp(&b.0))).map(|(v, _)| v).unwrap_or_default();
    (mc, loader)
}

pub(super) fn with_guess(mut f: Found) -> Found {
    let (mc, loader) = infer(&f.game_dir);
    f.info.mc_version = mc;
    f.info.loader = loader;
    f.info.warning = Some(if f.info.mc_version.is_empty() { WARN_UNKNOWN } else { WARN_GUESSED }.into());
    f
}
