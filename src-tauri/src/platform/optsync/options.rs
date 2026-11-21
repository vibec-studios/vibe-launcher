use super::*;

/// options.txt -> Liste (Reihenfolge bleibt erhalten).
pub fn parse_options(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            l.split_once(':')
                .map(|(k, v)| (k.to_string(), v.to_string()))
        })
        .filter(|(k, _)| !k.is_empty())
        .collect()
}

pub(super) fn render_options(opts: &[(String, String)]) -> String {
    let mut s = String::new();
    for (k, v) in opts {
        s.push_str(k);
        s.push(':');
        s.push_str(v);
        s.push('\n');
    }
    s
}

pub(super) fn set_opt(opts: &mut Vec<(String, String)>, k: &str, v: String) {
    match opts.iter_mut().find(|(ok, _)| ok == k) {
        Some(e) => e.1 = v,
        None => opts.push((k.to_string(), v)),
    }
}

/// Neues Format der Tastenbelegung (ab 1.13: „key.keyboard.w“) vs. alt (Zahlencodes)?
pub(super) fn modern_binding(value: &str) -> bool {
    value.starts_with("key.") || value == "unknown"
}

pub(super) fn modern_keys(opts: &[(String, String)]) -> Option<bool> {
    opts.iter()
        .find(|(k, _)| k.starts_with("key_"))
        .map(|(_, v)| modern_binding(v))
}

/// Master-Werte der gewählten Kategorien in eine options.txt einmischen.
pub fn merge_into(
    existing: &str,
    master: &BTreeMap<String, String>,
    categories: &[String],
    target_modern_keys: bool,
) -> String {
    let mut opts = parse_options(existing);
    for (k, v) in master {
        let Some(cat) = category_of(k) else { continue };
        if !categories.iter().any(|c| c == cat) {
            continue;
        }
        if k.starts_with("key_") && modern_binding(v) != target_modern_keys
        {
            continue;
        }
        set_opt(&mut opts, k, v.clone());
    }
    render_options(&opts)
}

/// Bekannte Schlüssel der gewählten Kategorien aus einer options.txt ins Master-Profil übernehmen.
pub fn capture(text: &str, master: &mut BTreeMap<String, String>, categories: &[String]) -> usize {
    let mut n = 0;
    for (k, v) in parse_options(text) {
        if let Some(cat) = category_of(&k) {
            if categories.iter().any(|c| c == cat) {
                master.insert(k, v);
                n += 1;
            }
        }
    }
    n
}

pub(super) fn applied_options(opts: &[(String, String)], cats: &[String], modern: bool) -> BTreeMap<String, String> {
    opts.iter()
        .filter(|(k, v)| {
            category_of(k).is_some_and(|cat| cats.iter().any(|c| c == cat) && (cat != "keybinds" || modern_binding(v) == modern))
        })
        .cloned()
        .collect()
}

pub(super) fn capture_options(
    cfg: &mut SyncConfig,
    text: &str,
    cats: &[String],
    mc: &str,
    baseline: Option<&BTreeMap<String, String>>,
    replace: bool,
) -> usize {
    let opts = parse_options(text);
    let modern = modern_keys(&opts).unwrap_or_else(|| !is_pre_113(mc));
    let mut n = 0;
    for cat in cats {
        let master = if cat == "keybinds" && !modern { &mut cfg.legacy_keybinds } else { &mut cfg.master };
        if replace {
            master.retain(|k, _| category_of(k) != Some(cat.as_str()));
        }
        for (k, v) in &opts {
            if category_of(k) != Some(cat.as_str()) || (cat == "keybinds" && modern_binding(v) != modern) {
                continue;
            }
            let current = master.get(k);
            let untouched = current.is_some() && baseline.and_then(|base| base.get(k)) == Some(v);
            if current != Some(v) && !untouched {
                master.insert(k.clone(), v.clone());
                n += 1;
            }
        }
    }
    n
}

pub(super) fn is_pre_113(mc: &str) -> bool {
    let mut it = mc.split('.');
    match (it.next(), it.next()) {
        (Some("1"), Some(m)) => m.parse::<u32>().map(|m| m < 13).unwrap_or(false),
        _ => false,
    }
}
