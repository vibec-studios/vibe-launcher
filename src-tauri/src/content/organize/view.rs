use super::needs::{self, Node};
use super::store::{self, Group, OrganizeFile};
use super::{collect, nodes, Entry};
use crate::content::ContentKind;
use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashSet};

#[derive(Debug, Clone, Serialize)]
pub struct ItemInfo {
    pub kind: ContentKind,
    pub file: String,
    pub group: Option<String>,
    pub tags: Vec<String>,
    pub from_pack: bool,
    pub auto: bool,
    pub unused: bool,
    pub needed_by: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupInfo {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub count: u32,
    pub enabled: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Organize {
    pub groups: Vec<GroupInfo>,
    pub items: Vec<ItemInfo>,
    pub tags: Vec<String>,
    pub has_pack: bool,
    pub pack_count: u32,
    pub unused_count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemovalExtra {
    pub kind: ContentKind,
    pub file_name: String,
    pub name: String,
    pub enabled: bool,
}

fn needed_by(entries: &[Entry], all: &[Node], d: &Node, file: &OrganizeFile) -> Vec<String> {
    let names: BTreeMap<&str, &str> = entries.iter().map(|e| (e.key.as_str(), e.name.as_str())).collect();
    let mut out: Vec<String> = needs::dependents(all, d, &file.auto).iter().filter_map(|n| names.get(n.key.as_str()).map(|s| s.to_string())).collect();
    out.sort_by_key(|s| s.to_lowercase());
    out.dedup();
    out
}

pub fn build(entries: &[Entry], has_pack: bool, file: &OrganizeFile) -> Organize {
    let all = nodes(entries);
    let unused = needs::unneeded(&all, &file.auto, &HashSet::new());
    let items: Vec<ItemInfo> = entries
        .iter()
        .map(|e| {
            let auto = e.kind == ContentKind::Mod && file.auto.contains_key(&e.key) && !e.from_pack;
            ItemInfo {
                kind: e.kind,
                file: e.file.clone(),
                group: file.members.get(&e.key).filter(|g| file.group_exists(g)).cloned(),
                tags: file.tags.get(&e.key).map(|t| t.iter().cloned().collect()).unwrap_or_default(),
                from_pack: e.from_pack,
                auto,
                unused: auto && unused.contains(&e.key),
                needed_by: if auto { e.node.as_ref().map(|n| needed_by(entries, &all, n, file)).unwrap_or_default() } else { vec![] },
            }
        })
        .collect();
    let groups = file
        .groups
        .iter()
        .map(|g: &Group| {
            let members: Vec<&Entry> = entries.iter().filter(|e| file.members.get(&e.key) == Some(&g.id)).collect();
            GroupInfo {
                id: g.id.clone(),
                name: g.name.clone(),
                color: g.color.clone(),
                count: members.len() as u32,
                enabled: members.iter().filter(|e| e.enabled).count() as u32,
            }
        })
        .collect();
    let present: HashSet<&str> = entries.iter().map(|e| e.key.as_str()).collect();
    let mut tags: BTreeSet<String> = BTreeSet::new();
    for (k, t) in &file.tags {
        if present.contains(k.as_str()) {
            tags.extend(t.iter().cloned());
        }
    }
    let mut tags: Vec<String> = tags.into_iter().collect();
    tags.sort_by_key(|s| s.to_lowercase());
    tags.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    Organize {
        groups,
        pack_count: items.iter().filter(|i| i.from_pack).count() as u32,
        unused_count: items.iter().filter(|i| i.unused).count() as u32,
        items,
        tags,
        has_pack,
    }
}

pub async fn get(state: &AppState, instance_id: &str) -> AppResult<Organize> {
    let (entries, has_pack) = collect(state, instance_id).await?;
    let file = store::load(&state.paths, instance_id);
    Ok(build(&entries, has_pack, &file))
}

pub fn extras(entries: &[Entry], file: &OrganizeFile, removed: &HashSet<String>) -> Vec<RemovalExtra> {
    let freed = needs::freed_by(&nodes(entries), &file.auto, removed);
    let mut out: Vec<RemovalExtra> = entries
        .iter()
        .filter(|e| freed.contains(&e.key) && !e.from_pack)
        .map(|e| RemovalExtra { kind: e.kind, file_name: e.file_name.clone(), name: e.name.clone(), enabled: e.enabled })
        .collect();
    out.sort_by_key(|e| e.name.to_lowercase());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::organize::store::AutoDep;

    fn entry(key: &str, name: &str, ids: &[&str], req: &[&str], pack: bool) -> Entry {
        Entry {
            kind: ContentKind::Mod,
            file: format!("{name}.jar"),
            file_name: format!("{name}.jar"),
            enabled: true,
            name: name.into(),
            key: key.into(),
            from_pack: pack,
            node: Some(Node { key: key.into(), mod_ids: ids.iter().map(|s| s.to_string()).collect(), requires: req.iter().map(|s| s.to_string()).collect() }),
        }
    }

    #[test]
    fn view_marks_groups_auto_and_unused() {
        let entries = vec![
            entry("modrinth:menu", "Mod Menu", &["modmenu"], &["fabric-api"], false),
            entry("modrinth:api", "Fabric API", &["fabric-api"], &[], false),
            entry("modrinth:kotlin", "Kotlin", &["fabric-language-kotlin"], &[], false),
            entry("modrinth:pack", "Pack Mod", &["packmod"], &[], true),
        ];
        let mut file = OrganizeFile::default();
        file.groups.push(Group { id: "g1".into(), name: "Karte".into(), color: None, created: 0 });
        file.members.insert("modrinth:menu".into(), "g1".into());
        file.members.insert("modrinth:api".into(), "deleted".into());
        file.auto.insert("modrinth:api".into(), AutoDep::default());
        file.auto.insert("modrinth:kotlin".into(), AutoDep::default());
        let v = build(&entries, true, &file);
        assert_eq!(v.groups[0].count, 1);
        assert_eq!(v.items[0].group.as_deref(), Some("g1"));
        assert_eq!(v.items[1].group, None);
        assert!(v.items[1].auto && !v.items[1].unused);
        assert_eq!(v.items[1].needed_by, vec!["Mod Menu".to_string()]);
        assert!(v.items[2].unused);
        assert_eq!(v.unused_count, 1);
        assert_eq!(v.pack_count, 1);
        let ex = extras(&entries, &file, &HashSet::from(["modrinth:menu".to_string()]));
        assert_eq!(ex.len(), 1);
        assert_eq!(ex[0].name, "Fabric API");
    }
}
