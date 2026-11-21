use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerEntry {
    pub name: String,
    /// Adresse wie im Spiel (Host[:Port])
    pub ip: String,
    /// Favicon als Base64-PNG (ohne data:-Präfix), vom Spiel gespeichert
    #[serde(default)]
    pub icon: Option<String>,
    /// Ressourcenpakete des Servers: None = fragen, true = erlauben, false = ablehnen
    #[serde(default)]
    pub accept_textures: Option<bool>,
    #[serde(default)]
    pub hidden: bool,
}

pub fn read_servers(path: &Path) -> AppResult<Vec<ServerEntry>> {
    let b = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    if b.is_empty() {
        return Ok(vec![]);
    }
    let root = nbt_read(&b)?;
    let mut out = vec![];
    if let Some(Nbt::List(_, list)) = root.get("servers") {
        for s in list {
            out.push(ServerEntry {
                name: s
                    .get("name")
                    .and_then(|x| x.str())
                    .unwrap_or("Minecraft-Server")
                    .to_string(),
                ip: s.get("ip").and_then(|x| x.str()).unwrap_or("").to_string(),
                icon: s.get("icon").and_then(|x| x.str()).map(String::from),
                accept_textures: s
                    .get("acceptTextures")
                    .and_then(|x| x.byte())
                    .map(|b| b != 0),
                hidden: s.get("hidden").and_then(|x| x.byte()).unwrap_or(0) != 0,
            });
        }
    }
    Ok(out)
}

/// Schreibt die Liste. Unbekannte Felder vorhandener Einträge (gleiche Adresse) bleiben erhalten.
pub fn write_servers(path: &Path, servers: &[ServerEntry]) -> AppResult<()> {
    let old: Vec<Nbt> = std::fs::read(path)
        .ok()
        .and_then(|b| nbt_read(&b).ok())
        .and_then(|r| match r.get("servers") {
            Some(Nbt::List(_, l)) => Some(l.clone()),
            _ => None,
        })
        .unwrap_or_default();
    let mut list = vec![];
    for s in servers {
        if s.ip.trim().is_empty() {
            continue;
        }
        let mut fields: Vec<(String, Nbt)> = old
            .iter()
            .find(|o| o.get("ip").and_then(|x| x.str()) == Some(s.ip.as_str()))
            .and_then(|o| match o {
                Nbt::Compound(v) => Some(v.clone()),
                _ => None,
            })
            .unwrap_or_default();
        let mut set = |k: &str, v: Option<Nbt>| {
            fields.retain(|(n, _)| n != k);
            if let Some(v) = v {
                fields.push((k.to_string(), v));
            }
        };
        set("name", Some(Nbt::String(s.name.clone())));
        set("ip", Some(Nbt::String(s.ip.trim().to_string())));
        set("icon", s.icon.clone().map(Nbt::String));
        set(
            "acceptTextures",
            s.accept_textures.map(|b| Nbt::Byte(b as i8)),
        );
        set("hidden", if s.hidden { Some(Nbt::Byte(1)) } else { None });
        list.push(Nbt::Compound(fields));
    }
    let root = Nbt::Compound(vec![("servers".into(), Nbt::List(10, list))]);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("dat_tmp");
    std::fs::write(&tmp, nbt_write(&root))?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Domain-Umzug: Relay-Adressen `name.vibey.henny.dev[:port]` auf `name.axolite.cc[:port]` umstellen (gleicher Name,
/// neue Domain). Alle anderen Felder bleiben unverändert. Liefert die Anzahl geänderter Einträge.
pub fn modernize_relay_addresses(root: &mut Nbt) -> usize {
    let Nbt::Compound(fields) = root else { return 0 };
    let Some((_, Nbt::List(_, list))) = fields.iter_mut().find(|(n, _)| n == "servers") else { return 0 };
    let mut n = 0;
    for entry in list.iter_mut() {
        let Nbt::Compound(f) = entry else { continue };
        if let Some((_, Nbt::String(ip))) = f.iter_mut().find(|(k, _)| k == "ip") {
            if let Some(new) = crate::domains::modern_server_address(ip) {
                *ip = new;
                n += 1;
            }
        }
    }
    n
}

/// `servers.dat` einer Instanz umstellen (siehe [`modernize_relay_addresses`]). Ohne Treffer bleibt die Datei unberührt.
pub fn modernize_servers_file(path: &Path) -> AppResult<usize> {
    let b = match std::fs::read(path) {
        Ok(b) if !b.is_empty() => b,
        Ok(_) => return Ok(0),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e.into()),
    };
    let mut root = nbt_read(&b)?;
    let n = modernize_relay_addresses(&mut root);
    if n > 0 {
        let tmp = path.with_extension("dat_tmp");
        std::fs::write(&tmp, nbt_write(&root))?;
        std::fs::rename(&tmp, path)?;
    }
    Ok(n)
}
