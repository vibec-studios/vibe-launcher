use super::store::{self, Group, OrganizeFile};
use super::view::{self, Organize, RemovalExtra};
use super::{collect, target_key, Target};
use crate::content::index::ContentIndex;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::collections::HashSet;

pub const MAX_GROUPS: usize = 40;
pub const MAX_NAME: usize = 40;
pub const MAX_TAG: usize = 24;
pub const MAX_TAGS_PER_ITEM: usize = 12;

fn clean_name(name: &str) -> AppResult<String> {
    let n = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if n.is_empty() {
        return Err(AppError::Invalid("Bitte gib der Gruppe einen Namen.".into()));
    }
    if n.chars().count() > MAX_NAME {
        return Err(AppError::Invalid(format!("Der Gruppenname darf höchstens {MAX_NAME} Zeichen lang sein.")));
    }
    Ok(n)
}

fn clean_color(color: Option<String>) -> AppResult<Option<String>> {
    match color.map(|c| c.trim().to_ascii_lowercase()).filter(|c| !c.is_empty()) {
        None => Ok(None),
        Some(c) if c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()) => Ok(Some(c)),
        Some(c) => Err(AppError::Invalid(format!("Ungültige Farbe: {c}"))),
    }
}

pub fn clean_tag(tag: &str) -> Option<String> {
    let t = tag.split_whitespace().collect::<Vec<_>>().join(" ");
    let t: String = t.trim_start_matches('#').chars().take(MAX_TAG).collect();
    let t = t.trim().to_string();
    (!t.is_empty()).then_some(t)
}

fn keys(state: &AppState, instance_id: &str, targets: &[Target]) -> AppResult<Vec<String>> {
    state.instances.get(instance_id)?;
    let idx = ContentIndex::load(&state.paths, instance_id);
    Ok(targets.iter().map(|t| target_key(&idx, t)).collect())
}

pub fn save_group(file: &mut OrganizeFile, group_id: Option<&str>, name: &str, color: Option<String>, members: &[String]) -> AppResult<String> {
    let name = clean_name(name)?;
    let color = clean_color(color)?;
    if file.groups.iter().any(|g| Some(g.id.as_str()) != group_id && g.name.eq_ignore_ascii_case(&name)) {
        return Err(AppError::Invalid(format!("Es gibt schon eine Gruppe „{name}“.")));
    }
    let id = match group_id {
        Some(id) => {
            let g = file.groups.iter_mut().find(|g| g.id == id).ok_or_else(|| AppError::NotFound("Gruppe".into()))?;
            g.name = name;
            g.color = color;
            id.to_string()
        }
        None => {
            if file.groups.len() >= MAX_GROUPS {
                return Err(AppError::Invalid(format!("Höchstens {MAX_GROUPS} Gruppen je Instanz.")));
            }
            let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
            file.groups.push(Group { id: id.clone(), name, color, created: crate::util::now_ms() });
            id
        }
    };
    for k in members {
        file.members.insert(k.clone(), id.clone());
    }
    Ok(id)
}

pub fn delete_group(file: &mut OrganizeFile, group_id: &str) {
    file.groups.retain(|g| g.id != group_id);
    file.members.retain(|_, g| g != group_id);
}

pub fn assign(file: &mut OrganizeFile, members: &[String], group_id: Option<&str>) -> AppResult<()> {
    if let Some(g) = group_id {
        if !file.group_exists(g) {
            return Err(AppError::NotFound("Gruppe".into()));
        }
    }
    for k in members {
        match group_id {
            Some(g) => file.members.insert(k.clone(), g.to_string()),
            None => file.members.remove(k),
        };
    }
    Ok(())
}

pub fn edit_tags(file: &mut OrganizeFile, members: &[String], add: &[String], remove: &[String]) -> AppResult<()> {
    let add: Vec<String> = add.iter().filter_map(|t| clean_tag(t)).collect();
    let remove: Vec<String> = remove.iter().filter_map(|t| clean_tag(t)).collect();
    for k in members {
        let set = file.tags.entry(k.clone()).or_default();
        set.retain(|t| !remove.iter().any(|r| r.eq_ignore_ascii_case(t)));
        for a in &add {
            if set.iter().any(|t| t.eq_ignore_ascii_case(a)) {
                continue;
            }
            if set.len() >= MAX_TAGS_PER_ITEM {
                return Err(AppError::Invalid(format!("Höchstens {MAX_TAGS_PER_ITEM} Schlagwörter je Eintrag.")));
            }
            set.insert(a.clone());
        }
        if set.is_empty() {
            file.tags.remove(k);
        }
    }
    Ok(())
}

pub async fn group_save(state: &AppState, instance_id: &str, group_id: Option<String>, name: String, color: Option<String>, targets: Vec<Target>) -> AppResult<Organize> {
    let members = keys(state, instance_id, &targets)?;
    store::modify(&state.paths, instance_id, |f| save_group(f, group_id.as_deref(), &name, color, &members))?;
    view::get(state, instance_id).await
}

pub async fn group_delete(state: &AppState, instance_id: &str, group_id: String) -> AppResult<Organize> {
    state.instances.get(instance_id)?;
    store::modify(&state.paths, instance_id, |f| {
        delete_group(f, &group_id);
        Ok(())
    })?;
    view::get(state, instance_id).await
}

pub async fn group_assign(state: &AppState, instance_id: &str, targets: Vec<Target>, group_id: Option<String>) -> AppResult<Organize> {
    let members = keys(state, instance_id, &targets)?;
    store::modify(&state.paths, instance_id, |f| assign(f, &members, group_id.as_deref()))?;
    view::get(state, instance_id).await
}

pub async fn tags(state: &AppState, instance_id: &str, targets: Vec<Target>, add: Vec<String>, remove: Vec<String>) -> AppResult<Organize> {
    let members = keys(state, instance_id, &targets)?;
    store::modify(&state.paths, instance_id, |f| edit_tags(f, &members, &add, &remove))?;
    view::get(state, instance_id).await
}

pub async fn keep(state: &AppState, instance_id: &str, targets: Vec<Target>) -> AppResult<Organize> {
    let members = keys(state, instance_id, &targets)?;
    store::modify(&state.paths, instance_id, |f| {
        for k in &members {
            f.auto.remove(k);
        }
        Ok(())
    })?;
    view::get(state, instance_id).await
}

pub async fn removal_extras(state: &AppState, instance_id: &str, targets: Vec<Target>) -> AppResult<Vec<RemovalExtra>> {
    let removed: HashSet<String> = keys(state, instance_id, &targets)?.into_iter().collect();
    let (entries, _) = collect(state, instance_id).await?;
    let file = store::load(&state.paths, instance_id);
    Ok(view::extras(&entries, &file, &removed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_roundtrip() {
        let mut f = OrganizeFile::default();
        let id = save_group(&mut f, None, "  Karten  &  Minimap ", Some("#AABBCC".into()), &["modrinth:a".into()]).unwrap();
        assert_eq!(f.groups[0].name, "Karten & Minimap");
        assert_eq!(f.groups[0].color.as_deref(), Some("#aabbcc"));
        assert_eq!(f.members.get("modrinth:a"), Some(&id));
        assert!(save_group(&mut f, None, "karten & minimap", None, &[]).is_err());
        assert!(save_group(&mut f, None, " ", None, &[]).is_err());
        assert!(save_group(&mut f, None, "X", Some("red".into()), &[]).is_err());
        save_group(&mut f, Some(&id), "Karten", None, &[]).unwrap();
        assert_eq!(f.groups[0].name, "Karten");
        assign(&mut f, &["modrinth:b".into()], Some(&id)).unwrap();
        assert!(assign(&mut f, &["modrinth:b".into()], Some("nope")).is_err());
        assign(&mut f, &["modrinth:a".into()], None).unwrap();
        assert_eq!(f.members.len(), 1);
        delete_group(&mut f, &id);
        assert!(f.groups.is_empty() && f.members.is_empty());
    }

    #[test]
    fn tags_dedupe_and_remove() {
        let mut f = OrganizeFile::default();
        let k = vec!["file:mods/x.jar".to_string()];
        edit_tags(&mut f, &k, &["#PvP".into(), "pvp".into(), "  Grafik  ".into(), "".into()], &[]).unwrap();
        assert_eq!(f.tags[&k[0]].len(), 2);
        edit_tags(&mut f, &k, &[], &["PVP".into(), "grafik".into()]).unwrap();
        assert!(f.tags.is_empty());
        assert_eq!(clean_tag(&"a".repeat(40)).unwrap().len(), MAX_TAG);
    }
}
