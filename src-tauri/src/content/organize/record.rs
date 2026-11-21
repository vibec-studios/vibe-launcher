use super::store::{self, AutoDep};
use crate::content::install::Planned;
use crate::content::DependencyKind;
use crate::paths::Paths;

#[derive(Debug, Clone, Default)]
pub struct InstallNote {
    roots: Vec<String>,
    deps: Vec<String>,
    edges: Vec<(String, String)>,
    user_choice: bool,
}

fn pkey(source: crate::content::Source, id: &str) -> String {
    format!("{}:{id}", source.as_string())
}

impl InstallNote {
    pub fn new(planned: &[Planned], root_count: usize, user_choice: bool) -> InstallNote {
        let mut note = InstallNote { user_choice, ..Default::default() };
        for (i, p) in planned.iter().enumerate() {
            let me = pkey(p.source, &p.brief.id);
            for d in p.version.dependencies.iter().filter(|d| d.kind == DependencyKind::Required) {
                if let Some(pid) = &d.project_id {
                    note.edges.push((pkey(d.source.unwrap_or(p.source), pid), me.clone()));
                }
            }
            if i < root_count {
                note.roots.push(me);
            } else {
                note.deps.push(me);
            }
        }
        note
    }

    pub fn apply_to(&self, f: &mut store::OrganizeFile, now: i64) {
        if self.user_choice {
            for r in &self.roots {
                f.auto.remove(r);
            }
        }
        for d in &self.deps {
            f.auto.entry(d.clone()).or_insert(AutoDep { required_by: Default::default(), installed_at: now });
        }
        for (dep, by) in &self.edges {
            if let Some(a) = f.auto.get_mut(dep) {
                a.required_by.insert(by.clone());
            }
        }
    }

    pub fn commit(&self, paths: &Paths, instance_id: &str) {
        if self.roots.is_empty() && self.deps.is_empty() {
            return;
        }
        let now = crate::util::now_ms();
        if let Err(e) = store::modify(paths, instance_id, |f| {
            self.apply_to(f, now);
            Ok(())
        }) {
            tracing::warn!("organize.json von {instance_id} nicht gespeichert: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_deps_and_clears_user_choice() {
        let note = InstallNote {
            roots: vec!["modrinth:menu".into()],
            deps: vec!["modrinth:api".into()],
            edges: vec![("modrinth:api".into(), "modrinth:menu".into()), ("modrinth:other".into(), "modrinth:menu".into())],
            user_choice: true,
        };
        let mut f = store::OrganizeFile::default();
        f.auto.insert("modrinth:menu".into(), AutoDep::default());
        note.apply_to(&mut f, 5);
        assert!(!f.auto.contains_key("modrinth:menu"));
        assert!(f.auto["modrinth:api"].required_by.contains("modrinth:menu"));
        assert!(!f.auto.contains_key("modrinth:other"));
        let update = InstallNote { user_choice: false, ..note.clone() };
        let mut g = store::OrganizeFile::default();
        g.auto.insert("modrinth:menu".into(), AutoDep::default());
        update.apply_to(&mut g, 5);
        assert!(g.auto.contains_key("modrinth:menu"));
    }
}
