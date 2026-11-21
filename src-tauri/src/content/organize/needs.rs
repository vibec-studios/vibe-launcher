use super::store::AutoDep;
use std::collections::{BTreeMap, BTreeSet, HashSet};

#[derive(Debug, Clone, Default)]
pub struct Node {
    pub key: String,
    pub mod_ids: Vec<String>,
    pub requires: Vec<String>,
}

const BUILTIN: [&str; 8] = ["minecraft", "java", "fabricloader", "fabric-loader", "quilt_loader", "forge", "neoforge", "mixinextras"];

fn needs(n: &Node, d: &Node, auto: &BTreeMap<String, AutoDep>) -> bool {
    if n.key == d.key {
        return false;
    }
    if auto.get(&d.key).is_some_and(|a| a.required_by.contains(&n.key)) {
        return true;
    }
    n.requires.iter().filter(|r| !BUILTIN.contains(&r.as_str())).any(|r| d.mod_ids.iter().any(|m| m.eq_ignore_ascii_case(r)))
}

pub fn dependents<'a>(nodes: &'a [Node], d: &Node, auto: &BTreeMap<String, AutoDep>) -> Vec<&'a Node> {
    nodes.iter().filter(|n| needs(n, d, auto)).collect()
}

pub fn unneeded(nodes: &[Node], auto: &BTreeMap<String, AutoDep>, removed: &HashSet<String>) -> BTreeSet<String> {
    let present: Vec<&Node> = nodes.iter().filter(|n| !removed.contains(&n.key)).collect();
    let mut reached: HashSet<&str> = present.iter().filter(|n| !auto.contains_key(&n.key)).map(|n| n.key.as_str()).collect();
    let mut frontier: Vec<&Node> = present.iter().copied().filter(|n| reached.contains(n.key.as_str())).collect();
    while let Some(n) = frontier.pop() {
        for d in present.iter().copied() {
            if !reached.contains(d.key.as_str()) && needs(n, d, auto) {
                reached.insert(d.key.as_str());
                frontier.push(d);
            }
        }
    }
    present.iter().filter(|n| auto.contains_key(&n.key) && !reached.contains(n.key.as_str())).map(|n| n.key.clone()).collect()
}

pub fn freed_by(nodes: &[Node], auto: &BTreeMap<String, AutoDep>, removed: &HashSet<String>) -> BTreeSet<String> {
    let before = unneeded(nodes, auto, &HashSet::new());
    unneeded(nodes, auto, removed).into_iter().filter(|k| !before.contains(k)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(key: &str, ids: &[&str], req: &[&str]) -> Node {
        Node { key: key.into(), mod_ids: ids.iter().map(|s| s.to_string()).collect(), requires: req.iter().map(|s| s.to_string()).collect() }
    }

    fn auto(entries: &[(&str, &[&str])]) -> BTreeMap<String, AutoDep> {
        entries.iter().map(|(k, by)| (k.to_string(), AutoDep { required_by: by.iter().map(|s| s.to_string()).collect(), installed_at: 0 })).collect()
    }

    #[test]
    fn recorded_edge_keeps_dep() {
        let nodes = vec![node("mr:menu", &["modmenu"], &[]), node("mr:api", &["fabric-api"], &[])];
        let a = auto(&[("mr:api", &["mr:menu"])]);
        assert!(unneeded(&nodes, &a, &HashSet::new()).is_empty());
        let freed = freed_by(&nodes, &a, &HashSet::from(["mr:menu".to_string()]));
        assert_eq!(freed, BTreeSet::from(["mr:api".to_string()]));
    }

    #[test]
    fn metadata_edge_keeps_dep() {
        let nodes = vec![node("file:mods/x.jar", &["x"], &["fabric-api", "minecraft"]), node("mr:api", &["fabric-api"], &[])];
        let a = auto(&[("mr:api", &[])]);
        assert!(unneeded(&nodes, &a, &HashSet::new()).is_empty());
    }

    #[test]
    fn orphan_detected() {
        let nodes = vec![node("mr:sodium", &["sodium"], &[]), node("mr:kotlin", &["fabric-language-kotlin"], &[])];
        let a = auto(&[("mr:kotlin", &["mr:gone"])]);
        assert_eq!(unneeded(&nodes, &a, &HashSet::new()), BTreeSet::from(["mr:kotlin".to_string()]));
    }

    #[test]
    fn transitive_and_cycles() {
        let nodes = vec![
            node("mr:ipn", &["inventoryprofilesnext"], &["libipn"]),
            node("mr:libipn", &["libipn"], &["fabric-language-kotlin"]),
            node("mr:kotlin", &["fabric-language-kotlin"], &["libipn"]),
            node("mr:other", &["other"], &[]),
        ];
        let a = auto(&[("mr:libipn", &["mr:ipn"]), ("mr:kotlin", &["mr:libipn"])]);
        assert!(unneeded(&nodes, &a, &HashSet::new()).is_empty());
        let freed = freed_by(&nodes, &a, &HashSet::from(["mr:ipn".to_string()]));
        assert_eq!(freed, BTreeSet::from(["mr:kotlin".to_string(), "mr:libipn".to_string()]));
    }

    #[test]
    fn shared_dep_stays_while_one_user_left() {
        let nodes = vec![node("mr:a", &["a"], &[]), node("mr:b", &["b"], &["fabric-api"]), node("mr:api", &["fabric-api"], &[])];
        let a = auto(&[("mr:api", &["mr:a"])]);
        assert!(freed_by(&nodes, &a, &HashSet::from(["mr:a".to_string()])).is_empty());
    }
}
