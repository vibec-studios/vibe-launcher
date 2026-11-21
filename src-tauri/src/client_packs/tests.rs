use super::*;

fn ids(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn definitions_are_consistent() {
    let mut seen = std::collections::HashSet::new();
    for p in PACKS {
        assert!(seen.insert(p.id), "doppelte ID {}", p.id);
        assert!(!p.loaders.is_empty());
        for c in p.conflicts {
            assert!(def(c).is_some(), "unbekannter Konflikt {c}");
        }
        if p.category == Category::Community {
            assert!(p.vendor.is_some() && p.homepage.is_some(), "Community-Pack {} ohne Herkunft", p.id);
        }
    }
    assert_eq!(def("vibey").unwrap().category, Category::Official);
    assert!(def("gibtsnicht").is_none());
}

/// Pack außerhalb der Client-Gruppe (z. B. ein späteres Performance-Pack)
const EXTRA: PackDef = PackDef {
    id: "extra",
    category: Category::Community,
    source: PackSource::Modrinth(&[("AANobbMI", &["sodium"])]),
    group: None,
    loaders: &[LoaderKind::Fabric],
    conflicts: &[],
    vendor: Some("Modrinth"),
    homepage: Some("https://modrinth.com"),
};

#[test]
fn clients_exclude_each_other() {
    let clients: Vec<&PackDef> = ["vibey", "norisk", "norisk-mini", "essential"].iter().map(|id| def(id).unwrap()).collect();
    for a in &clients {
        assert!(!excludes(a, a));
        for b in &clients {
            if a.id != b.id {
                assert!(excludes(a, b), "{} und {} müssen sich ausschließen", a.id, b.id);
            }
        }
        // Packs ohne Gruppe vertragen sich mit Clients
        assert!(!excludes(a, &EXTRA) && !excludes(&EXTRA, a));
    }
}

#[test]
fn replacement_on_switch() {
    // Wechsel Vibey -> NoRisk: Vibey muss raus, unbekannte/fremde Einträge bleiben unberührt
    assert_eq!(to_replace("norisk", &ids(&["vibey"])), ids(&["vibey"]));
    // NoRisk -> Mini, Mini -> Essential, Essential -> Vibey
    assert_eq!(to_replace("norisk-mini", &ids(&["norisk"])), ids(&["norisk"]));
    assert_eq!(to_replace("essential", &ids(&["norisk-mini"])), ids(&["norisk-mini"]));
    assert_eq!(to_replace("vibey", &ids(&["essential"])), ids(&["essential"]));
    // Erneut installieren (Update) ersetzt nichts
    assert!(to_replace("norisk", &ids(&["norisk"])).is_empty());
    assert!(to_replace("essential", &ids(&["essential"])).is_empty());
    // Nichts installiert
    assert!(to_replace("vibey", &[]).is_empty());
    // Unbekannte Einträge werden ignoriert
    assert!(to_replace("vibey", &ids(&["alt"])).is_empty());
    assert!(to_replace("alt", &ids(&["vibey"])).is_empty());
    // Mehrere (inkonsistenter Altzustand): alle Clients raus
    assert_eq!(to_replace("essential", &ids(&["vibey", "norisk"])), ids(&["vibey", "norisk"]));
}

#[test]
fn essential_is_modrinth_pack() {
    let e = def("essential").unwrap();
    assert_eq!(e.category, Category::Community);
    assert_eq!(e.source.kind(), "modrinth");
    assert!(matches!(e.source, PackSource::Modrinth(p) if p[0].0 == "k2ZPuTBm"));
    assert_eq!(base_offer(e).projects, vec!["k2ZPuTBm"]);
    assert!(e.vendor.unwrap().contains("Essential"));
}

#[test]
fn explicit_conflicts_are_symmetric() {
    let a = PackDef { id: "a", conflicts: &["b"], ..EXTRA };
    let b = PackDef { id: "b", ..EXTRA };
    assert!(excludes(&a, &b) && excludes(&b, &a));
    assert!(!excludes(&a, &EXTRA));
}

#[test]
fn state_file_roundtrip() {
    let mut f = PacksFile::default();
    f.upsert(InstalledPack { id: "norisk-mini".into(), version: Some("26.4.1+fabric.26.3".into()), files: ids(&["nrc-mini-26.4.1+fabric.26.3.jar"]), mc_version: "26.3".into(), loader: "fabric".into(), ..Default::default() });
    f.upsert(InstalledPack { id: "norisk-mini".into(), version: Some("26.4.2+fabric.26.3".into()), ..Default::default() });
    assert_eq!(f.packs.len(), 1);
    assert_eq!(f.get("norisk-mini").unwrap().version.as_deref(), Some("26.4.2+fabric.26.3"));
    let j = serde_json::to_string(&f).unwrap();
    assert_eq!(serde_json::from_str::<PacksFile>(&j).unwrap(), f);
    let old: PacksFile = serde_json::from_str(r#"{"packs":[{"id":"x","neu":1}]}"#).unwrap();
    assert_eq!(old.packs[0].id, "x");
    assert!(f.remove("norisk-mini").is_some() && f.packs.is_empty());
}
