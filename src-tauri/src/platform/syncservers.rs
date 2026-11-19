//! Server-Liste synchronisieren: `servers.dat` jeder Instanz wird mit einer gemeinsamen Liste
//! (`<data>/sync/servers.dat`, gleiches NBT-Format) zusammengeführt – nie einfach überschrieben.
//!
//! Schlüssel eines Eintrags ist die Adresse (klein geschrieben, ohne Standard-Port 25565). `ServerBase` merkt sich
//! je Instanz die Liste nach dem letzten Abgleich (Schlüssel + Prüfsumme des Eintrags). Damit gilt:
//! - in der Instanz hinzugefügt/geändert/gelöscht/umsortiert -> in die gemeinsame Liste übernehmen
//! - anderswo hinzugefügt/gelöscht -> in die Instanz übernehmen
//! - beide Seiten unverändert -> nichts schreiben
//!
//! Alle NBT-Felder eines Eintrags bleiben erhalten (auch unbekannte). Versteckte Einträge (`hidden`) bleiben lokal.
//! Ist eine der Dateien beschädigt, wird nichts geschrieben.
use super::servers::{nbt_read, nbt_write, Nbt};
use crate::error::AppResult;
use std::collections::HashMap;
use std::path::Path;

/// (Schlüssel, Prüfsumme) in Listenreihenfolge.
pub type ServerBase = Vec<(String, String)>;

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ServersReport {
    pub to_instance: u32,
    pub to_shared: u32,
    pub total: u32,
}

fn field<'a>(n: &'a Nbt, k: &str) -> Option<&'a Nbt> {
    n.get(k)
}

fn ip_of(n: &Nbt) -> Option<&str> {
    match field(n, "ip") {
        Some(Nbt::String(s)) => Some(s.as_str()),
        _ => None,
    }
}

fn hidden(n: &Nbt) -> bool {
    matches!(field(n, "hidden"), Some(Nbt::Byte(b)) if *b != 0)
}

/// Adresse vergleichbar machen.
pub fn key_of(ip: &str) -> String {
    let k = ip.trim().trim_end_matches('.').to_ascii_lowercase();
    k.strip_suffix(":25565").map(str::to_string).unwrap_or(k)
}

/// Prüfsumme eines Eintrags (Felder sortiert, damit die Reihenfolge keine Rolle spielt).
fn hash(n: &Nbt) -> String {
    use sha1::{Digest, Sha1};
    let canon = match n {
        Nbt::Compound(v) => {
            let mut v = v.clone();
            v.sort_by(|a, b| a.0.cmp(&b.0));
            Nbt::Compound(v)
        }
        o => o.clone(),
    };
    hex::encode(Sha1::digest(nbt_write(&canon)))
}

/// Einträge einer servers.dat (None = Datei fehlt/leer). Fehler = beschädigt.
fn read(path: &Path) -> AppResult<Option<(Nbt, Vec<Nbt>)>> {
    let b = match std::fs::read(path) {
        Ok(b) if !b.is_empty() => b,
        Ok(_) => return Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let root = nbt_read(&b)?;
    let list = match root.get("servers") {
        Some(Nbt::List(_, l)) => l.clone(),
        _ => vec![],
    };
    Ok(Some((root, list)))
}

fn write(path: &Path, root: Option<Nbt>, list: Vec<Nbt>) -> AppResult<()> {
    let mut fields = match root {
        Some(Nbt::Compound(v)) => v,
        _ => vec![],
    };
    fields.retain(|(k, _)| k != "servers");
    fields.insert(0, ("servers".into(), Nbt::List(10, list)));
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("dat_vltmp");
    std::fs::write(&tmp, nbt_write(&Nbt::Compound(fields)))?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Liste mit eindeutigen Schlüsseln (doppelte Adressen bekommen „#2“ usw., damit nichts verloren geht).
fn keyed(list: Vec<Nbt>) -> Vec<(String, Nbt)> {
    let mut seen: HashMap<String, u32> = HashMap::new();
    let mut out = vec![];
    for n in list {
        let Some(ip) = ip_of(&n) else { continue };
        if ip.trim().is_empty() {
            continue;
        }
        let k = key_of(ip);
        let c = seen.entry(k.clone()).or_insert(0);
        *c += 1;
        out.push((if *c == 1 { k } else { format!("{k}#{c}") }, n));
    }
    out
}

/// Instanz-Liste `inst_file` mit der gemeinsamen Liste `shared_file` abgleichen.
pub fn sync(inst_file: &Path, shared_file: &Path, base: &mut Option<ServerBase>) -> AppResult<ServersReport> {
    let inst = read(inst_file)?;
    let shared = read(shared_file)?;
    let (inst_root, inst_list) = match inst {
        Some((r, l)) => (Some(r), l),
        None => (None, vec![]),
    };
    let (shared_root, shared_list) = match shared {
        Some((r, l)) => (Some(r), l),
        None => (None, vec![]),
    };
    let (hidden_entries, visible): (Vec<Nbt>, Vec<Nbt>) = inst_list.iter().cloned().partition(hidden);
    let local = keyed(visible);
    let master = keyed(shared_list.iter().filter(|n| !hidden(n)).cloned().collect());
    let b = base.clone().unwrap_or_default();
    let lk: Vec<String> = local.iter().map(|(k, _)| k.clone()).collect();
    let mk: Vec<String> = master.iter().map(|(k, _)| k.clone()).collect();
    let bk: Vec<String> = b.iter().map(|(k, _)| k.clone()).collect();
    let bh: HashMap<&str, &str> = b.iter().map(|(k, h)| (k.as_str(), h.as_str())).collect();
    let lmap: HashMap<&str, &Nbt> = local.iter().map(|(k, n)| (k.as_str(), n)).collect();
    let mmap: HashMap<&str, &Nbt> = master.iter().map(|(k, n)| (k.as_str(), n)).collect();

    let keys = super::optsync::merge_list(&mk, &bk, &lk);
    let mut merged: Vec<(String, Nbt, String)> = vec![];
    for k in &keys {
        let v = match (lmap.get(k.as_str()), mmap.get(k.as_str())) {
            (Some(l), Some(m)) => {
                let lh = hash(l);
                // In der Instanz geändert -> Instanz gewinnt, sonst gemeinsamer Stand
                if bh.get(k.as_str()) != Some(&lh.as_str()) {
                    (*l).clone()
                } else {
                    (*m).clone()
                }
            }
            (Some(l), None) => (*l).clone(),
            (None, Some(m)) => (*m).clone(),
            (None, None) => continue,
        };
        let h = hash(&v);
        merged.push((k.clone(), v, h));
    }

    let new_hashes: Vec<(String, String)> = merged.iter().map(|(k, _, h)| (k.clone(), h.clone())).collect();
    let master_hashes: Vec<(String, String)> = master.iter().map(|(k, n)| (k.clone(), hash(n))).collect();
    let local_hashes: Vec<(String, String)> = local.iter().map(|(k, n)| (k.clone(), hash(n))).collect();
    let mut rep = ServersReport { total: merged.len() as u32, ..Default::default() };
    if new_hashes != master_hashes {
        rep.to_shared = new_hashes.iter().filter(|x| !master_hashes.contains(x)).count() as u32 + (master_hashes.len() as u32).saturating_sub(new_hashes.len() as u32);
        let list: Vec<Nbt> = merged.iter().map(|(_, n, _)| n.clone()).collect();
        write(shared_file, shared_root, list)?;
    }
    if new_hashes != local_hashes {
        rep.to_instance = new_hashes.iter().filter(|x| !local_hashes.contains(x)).count() as u32 + (local_hashes.len() as u32).saturating_sub(new_hashes.len() as u32);
        let mut list: Vec<Nbt> = merged.into_iter().map(|(_, n, _)| n).collect();
        list.extend(hidden_entries);
        write(inst_file, inst_root, list)?;
    }
    *base = Some(new_hashes);
    Ok(rep)
}

/// Anzahl Einträge der gemeinsamen Liste.
pub fn count(shared_file: &Path) -> usize {
    read(shared_file).ok().flatten().map(|(_, l)| l.iter().filter(|n| !hidden(n)).count()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, ip: &str, extra: Option<(&str, Nbt)>) -> Nbt {
        let mut v = vec![("name".to_string(), Nbt::String(name.into())), ("ip".to_string(), Nbt::String(ip.into()))];
        if let Some((k, n)) = extra {
            v.push((k.to_string(), n));
        }
        Nbt::Compound(v)
    }

    fn put(path: &Path, list: Vec<Nbt>) {
        write(path, None, list).unwrap();
    }

    fn names(path: &Path) -> Vec<String> {
        read(path)
            .unwrap()
            .map(|(_, l)| l)
            .unwrap_or_default()
            .iter()
            .map(|n| match n.get("name") {
                Some(Nbt::String(s)) => s.clone(),
                _ => String::new(),
            })
            .collect()
    }

    #[test]
    fn merges_instead_of_overwriting() {
        let dir = std::env::temp_dir().join(format!("vl-syncsrv-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (a, b, shared) = (dir.join("a.dat"), dir.join("b.dat"), dir.join("shared.dat"));
        // A hat zwei Server (einer mit Icon + unbekanntem Feld), B hat einen eigenen und einen gleichen (anderer Port-Schreibweise)
        put(&a, vec![entry("Hypixel", "mc.hypixel.net", Some(("icon", Nbt::String("AAAA".into())))), entry("Freunde", "freunde.example:25566", Some(("zukunft", Nbt::Int(7))))]);
        put(&b, vec![entry("Mein Server", "home.example", None), entry("Hypixel B", "MC.hypixel.net:25565", None), entry("Versteckt", "direct.example", Some(("hidden", Nbt::Byte(1))))]);
        let (mut ba, mut bb) = (None, None);
        sync(&a, &shared, &mut ba).unwrap();
        assert_eq!(names(&shared), vec!["Hypixel", "Freunde"]);
        let r = sync(&b, &shared, &mut bb).unwrap();
        // Erster Abgleich von B: B's Liste + was nur gemeinsam existiert; gleiche Adresse nicht doppelt
        assert_eq!(r.total, 3);
        assert_eq!(names(&b), vec!["Mein Server", "Hypixel B", "Freunde", "Versteckt"]);
        assert_eq!(names(&shared), vec!["Mein Server", "Hypixel B", "Freunde"]);
        // Unbekannte Felder bleiben erhalten
        let (_, l) = read(&b).unwrap().unwrap();
        let fr = l.iter().find(|n| ip_of(n) == Some("freunde.example:25566")).unwrap();
        assert_eq!(fr.get("zukunft"), Some(&Nbt::Int(7)));
        // Versteckte Einträge bleiben lokal
        assert!(!names(&shared).contains(&"Versteckt".to_string()));

        // A bekommt den neuen Server, eigenes bleibt
        sync(&a, &shared, &mut ba).unwrap();
        assert_eq!(names(&a), vec!["Mein Server", "Hypixel B", "Freunde"]);
        // Unverändert -> nichts geschrieben
        let r = sync(&a, &shared, &mut ba).unwrap();
        assert_eq!((r.to_instance, r.to_shared), (0, 0));

        // In A gelöscht und umbenannt -> überall
        put(&a, vec![entry("Hypixel neu", "mc.hypixel.net", None), entry("Freunde", "freunde.example:25566", Some(("zukunft", Nbt::Int(7))))]);
        sync(&a, &shared, &mut ba).unwrap();
        sync(&b, &shared, &mut bb).unwrap();
        assert_eq!(names(&b), vec!["Hypixel neu", "Freunde", "Versteckt"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn broken_file_is_not_touched() {
        let dir = std::env::temp_dir().join(format!("vl-syncsrv-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (a, shared) = (dir.join("a.dat"), dir.join("shared.dat"));
        std::fs::write(&a, b"\x0akaputt").unwrap();
        put(&shared, vec![entry("X", "x.example", None)]);
        assert!(sync(&a, &shared, &mut None).is_err());
        assert_eq!(std::fs::read(&a).unwrap(), b"\x0akaputt");
        assert_eq!(key_of(" Play.Example.COM:25565 "), "play.example.com");
        assert_eq!(key_of("play.example.com:25566"), "play.example.com:25566");
        std::fs::remove_dir_all(&dir).ok();
    }
}
