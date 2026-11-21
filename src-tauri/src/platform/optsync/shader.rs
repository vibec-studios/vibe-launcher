use super::*;

/// (Datei, Iris-Format mit `enableShaders`)
pub(super) const SHADER_FILES: [(&str, bool); 3] = [("optionsshaders.txt", false), ("config/iris.properties", true), ("config/oculus.properties", true)];

pub(super) fn prop_key(line: &str) -> Option<&str> {
    let l = line.trim_start();
    if l.is_empty() || l.starts_with('#') || l.starts_with('!') {
        return None;
    }
    let i = l.find(['=', ':'])?;
    Some(l[..i].trim())
}

pub(super) fn prop_get(text: &str, key: &str) -> Option<String> {
    text.lines().find(|l| prop_key(l) == Some(key)).map(|l| {
        let l = l.trim_start();
        let i = l.find(['=', ':']).unwrap_or(l.len());
        l[(i + 1).min(l.len())..].trim_start().to_string()
    })
}

pub(super) fn prop_set(text: &str, key: &str, value: &str) -> String {
    let mut found = false;
    let mut out: Vec<String> = text
        .lines()
        .map(|l| {
            if prop_key(l) == Some(key) {
                found = true;
                format!("{key}={value}")
            } else {
                l.to_string()
            }
        })
        .collect();
    if !found {
        out.push(format!("{key}={value}"));
    }
    out.join("\n") + "\n"
}

pub(super) fn read_shader_file(text: &str, iris: bool) -> ShaderSel {
    let pack = prop_get(text, "shaderPack").unwrap_or_default();
    if iris {
        let enabled = prop_get(text, "enableShaders").map(|v| v.trim() == "true").unwrap_or(!pack.is_empty());
        ShaderSel { pack, enabled }
    } else if pack == "OFF" || pack == "(internal)" || pack.is_empty() {
        ShaderSel { pack: String::new(), enabled: false }
    } else {
        ShaderSel { pack, enabled: true }
    }
}

/// Aktuelle Shader-Wahl einer Instanz (aus der zuletzt geänderten Datei).
pub(super) fn read_shader(game_dir: &Path) -> Option<ShaderSel> {
    SHADER_FILES
        .iter()
        .filter_map(|(f, iris)| {
            let p = game_dir.join(f);
            let m = std::fs::metadata(&p).ok()?.modified().ok()?;
            Some((m, std::fs::read_to_string(&p).ok()?, *iris))
        })
        .max_by_key(|(m, ..)| *m)
        .map(|(_, t, iris)| read_shader_file(&t, iris))
}

/// Shader-Wahl in alle vorhandenen Shader-Dateien schreiben. Gibt die Anzahl geänderter Dateien zurück.
pub(super) fn write_shader(game_dir: &Path, sel: &ShaderSel) -> AppResult<usize> {
    let mut n = 0;
    for (f, iris) in SHADER_FILES {
        let p = game_dir.join(f);
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let new = if iris {
            let t = if sel.pack.is_empty() { text.clone() } else { prop_set(&text, "shaderPack", &sel.pack) };
            prop_set(&t, "enableShaders", if sel.enabled { "true" } else { "false" })
        } else {
            prop_set(&text, "shaderPack", if sel.enabled && !sel.pack.is_empty() { &sel.pack } else { "OFF" })
        };
        if new != text {
            std::fs::write(&p, new)?;
            n += 1;
        }
    }
    Ok(n)
}
