use super::*;

pub(super) fn need_key(n: &Need) -> Option<String> {
    Some(match n {
        Need::Install { dep_id, .. } => format!("install:{dep_id}"),
        Need::Enable { file, .. } => format!("enable:{file}"),
        Need::Disable { file, .. } | Need::Swap { file, .. } | Need::Update { file, .. } => format!("file:{file}"),
        Need::ResetConfig { path, .. } => format!("config:{path}"),
        Need::Java { .. } => "java".into(),
        Need::Ram { .. } => "ram".into(),
        Need::Unfixable(_) => return None,
    })
}

fn from_crash(n: &Need) -> bool {
    match n {
        Need::Install { cause, .. }
        | Need::Enable { cause, .. }
        | Need::Disable { cause, .. }
        | Need::Swap { cause, .. }
        | Need::Update { cause, .. }
        | Need::ResetConfig { cause, .. }
        | Need::Java { cause, .. }
        | Need::Ram { cause, .. } => cause.is_some(),
        Need::Unfixable(_) => false,
    }
}

pub struct ModelGate {
    active: bool,
    statics: HashSet<String>,
}

impl ModelGate {
    pub fn new(model: bool, issues: &[DepIssue], names: &HashMap<String, String>) -> Self {
        let statics = if model { needs(issues, &[], names).iter().filter_map(need_key).collect() } else { HashSet::new() };
        ModelGate { active: model, statics }
    }

    pub fn applies(&self, n: &Need) -> bool {
        self.active && from_crash(n) && need_key(n).is_some_and(|k| !self.statics.contains(&k))
    }
}

pub(super) fn ask_all(steps: &mut [FixStep]) {
    for s in steps {
        s.confirm = true;
        s.selected = false;
    }
}
