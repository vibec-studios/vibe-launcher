use super::*;

#[derive(Deserialize)]
pub(super) struct MmcPack {
    #[serde(default)]
    pub(super) components: Vec<MmcComponent>,
}

#[derive(Deserialize)]
pub(super) struct MmcComponent {
    pub(super) uid: String,
    #[serde(default)]
    pub(super) version: Option<String>,
    #[serde(rename = "cachedVersion", default)]
    pub(super) cached_version: Option<String>,
}

/// Ausgewertete Prism-/MultiMC-Instanz (`instance.cfg` + `mmc-pack.json`).
#[derive(Debug, Clone)]
pub struct PrismInfo {
    pub format: PackFormat,
    pub name: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    pub settings: PrismSettings,
    /// Icon-Schlüssel (`iconKey`), ohne eingebaute Standard-Icons
    pub icon_key: Option<String>,
    /// Zuletzt gestartet (ms)
    pub last_launch: Option<i64>,
    /// Gesamtspielzeit (s)
    pub total_time: Option<u64>,
}

pub fn prism_info(cfg_text: &str, mmc_pack: Option<&[u8]>) -> PrismInfo {
    let cfg = parse_ini(cfg_text);
    let pack: Option<MmcPack> = mmc_pack.and_then(|b| serde_json::from_slice(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(b)).ok());
    let mut mc = cfg.get("IntendedVersion").cloned().unwrap_or_default();
    let mut loader = Loader { kind: LoaderKind::Vanilla, version: None };
    if let Some(p) = &pack {
        for c in &p.components {
            let v = c.version.clone().or(c.cached_version.clone());
            match c.uid.as_str() {
                "net.minecraft" => mc = v.unwrap_or_default(),
                "net.fabricmc.fabric-loader" => loader = Loader { kind: LoaderKind::Fabric, version: v },
                "org.quiltmc.quilt-loader" => loader = Loader { kind: LoaderKind::Quilt, version: v },
                "net.minecraftforge" => loader = Loader { kind: LoaderKind::Forge, version: v },
                "net.neoforged" => loader = Loader { kind: LoaderKind::Neoforge, version: v },
                _ => {}
            }
        }
    }
    let mem = |k: &str| cfg.get(k).and_then(|v| v.parse::<u32>().ok());
    let override_mem = cfg.get("OverrideMemory").is_some_and(|v| v == "true");
    let override_args = cfg.get("OverrideJavaArgs").is_some_and(|v| v == "true");
    PrismInfo {
        format: if cfg_text.contains("[General]") { PackFormat::Prism } else { PackFormat::Multimc },
        name: cfg.get("name").cloned().filter(|n| !n.is_empty()),
        mc_version: mc,
        loader,
        settings: PrismSettings {
            min_memory_mb: if override_mem { mem("MinMemAlloc") } else { None },
            max_memory_mb: if override_mem { mem("MaxMemAlloc") } else { None },
            jvm_args: if override_args { cfg.get("JvmArgs").cloned().filter(|s| !s.is_empty()) } else { None },
            notes: cfg.get("notes").cloned().filter(|s| !s.is_empty()),
        },
        icon_key: cfg.get("iconKey").cloned().filter(|k| !k.is_empty() && k != "default"),
        last_launch: cfg.get("lastLaunchTime").and_then(|v| v.parse::<i64>().ok()).filter(|v| *v > 0),
        total_time: cfg.get("totalTimePlayed").and_then(|v| v.parse::<u64>().ok()),
    }
}
