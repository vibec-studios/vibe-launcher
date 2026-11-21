/// 3-Wege-Zusammenführung einer geordneten Liste eindeutiger Schlüssel.
/// `master` = gemeinsamer Stand, `base` = Stand der Instanz nach dem letzten Abgleich, `local` = Instanz jetzt.
/// Hat die Instanz nichts geändert, gilt `master`. Sonst gilt die Instanz (inkl. Reihenfolge) – ohne das, was
/// anderswo inzwischen gelöscht wurde, plus das, was anderswo neu dazukam (hinter seinem Vorgänger).
pub fn merge_list<T: PartialEq + Clone>(master: &[T], base: &[T], local: &[T]) -> Vec<T> {
    if local == base {
        return master.to_vec();
    }
    if base.is_empty() {
        // Erster Abgleich: eigene Einträge zuerst, dann was es sonst noch gibt
        let mut out = local.to_vec();
        out.extend(master.iter().filter(|x| !local.contains(x)).cloned());
        return out;
    }
    let mut out: Vec<T> = local.iter().filter(|x| !base.contains(x) || master.contains(x)).cloned().collect();
    for (i, x) in master.iter().enumerate() {
        if local.contains(x) || base.contains(x) || out.contains(x) {
            continue;
        }
        let pos = master[..i].iter().rev().find_map(|p| out.iter().position(|o| o == p)).map(|p| p + 1).unwrap_or(0);
        out.insert(pos, x.clone());
    }
    out
}

/// Fehlende Einträge aus `reference` wieder einsetzen (hinter ihrem Vorgänger), wenn `keep` zutrifft.
pub(super) fn reinsert<T: PartialEq + Clone>(list: &mut Vec<T>, reference: &[T], keep: impl Fn(&T) -> bool) {
    for (i, x) in reference.iter().enumerate() {
        if list.contains(x) || !keep(x) {
            continue;
        }
        let pos = reference[..i].iter().rev().find_map(|p| list.iter().position(|o| o == p)).map(|p| p + 1).unwrap_or(0);
        list.insert(pos, x.clone());
    }
}
