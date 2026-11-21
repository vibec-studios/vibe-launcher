use super::*;

#[cfg(test)]
thread_local! {
    /// Nach so vielen Schritten (rename/Journal) „stürzt“ der Ablauf ab: Fehler ohne Aufräumen.
    static CRASH_AT: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

pub(super) const CRASH_MSG: &str = "simulierter Absturz";

pub(super) fn crash_point() -> AppResult<()> {
    #[cfg(test)]
    {
        let hit = CRASH_AT.with(|c| match c.get() {
            Some(0) => true,
            Some(n) => {
                c.set(Some(n - 1));
                false
            }
            None => false,
        });
        if hit {
            return Err(AppError::msg(CRASH_MSG));
        }
    }
    Ok(())
}

pub(super) fn is_crash(e: &AppError) -> bool {
    cfg!(test) && matches!(e, AppError::Msg(m) if m == CRASH_MSG)
}

#[cfg(test)]
pub(crate) fn set_crash(at: Option<usize>) {
    CRASH_AT.with(|c| c.set(at));
}
