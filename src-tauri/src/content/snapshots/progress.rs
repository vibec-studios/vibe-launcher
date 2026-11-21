use super::*;

/// Fortschritt + Abbruch für die blockierenden Kernabläufe. Generisch, damit die Unit-Tests ohne
/// Tauri-Laufzeit auskommen (`()` = kein Fortschritt).
pub(crate) trait Prog: Clone + Send + 'static {
    fn set(&self, p: f64);
    fn message(&self, m: &str);
    fn check(&self) -> AppResult<()>;
    fn sub(&self, from: f64, to: f64) -> Self;
}

/// Fortschritt einer Aufgabe (optional).
#[derive(Clone, Default)]
pub(crate) struct Progress(pub Option<SubProgress>);

impl Progress {
    pub fn from(p: Option<&SubProgress>) -> Self {
        Progress(p.cloned())
    }
}

impl Prog for Progress {
    fn set(&self, p: f64) {
        if let Some(s) = &self.0 {
            s.progress(p);
        }
    }
    fn message(&self, m: &str) {
        if let Some(s) = &self.0 {
            s.message(m);
        }
    }
    fn check(&self) -> AppResult<()> {
        match &self.0 {
            Some(s) => s.check(),
            None => Ok(()),
        }
    }
    fn sub(&self, from: f64, to: f64) -> Progress {
        Progress(self.0.as_ref().map(|s| s.sub(from, to)))
    }
}

#[cfg(test)]
impl Prog for () {
    fn set(&self, _: f64) {}
    fn message(&self, _: &str) {}
    fn check(&self) -> AppResult<()> {
        Ok(())
    }
    fn sub(&self, _: f64, _: f64) {}
}
