use crate::error::AppError;
use crate::instance::BedrockChannel;
use parking_lot::Mutex;
use std::collections::HashSet;

pub const LOCKED_MARK: &str = "wird gerade von einem anderen Programm benutzt";

static LOCKED: Mutex<Option<HashSet<BedrockChannel>>> = parking_lot::const_mutex(None);

pub fn is_lock_error(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33)) || e.kind() == std::io::ErrorKind::PermissionDenied
}

pub fn locked_error(what: &std::path::Path) -> AppError {
    AppError::Invalid(format!(
        "{what:?} {LOCKED_MARK} (Minecraft oder ein Explorer-Fenster). Deine Welten sind sicher geparkt – schließe Minecraft und den Explorer und klicke dann auf „Zurücktauschen“."
    ))
}

pub fn record(ch: BedrockChannel, r: &Result<impl Sized, AppError>) {
    let locked = matches!(r, Err(e) if e.to_string().contains(LOCKED_MARK));
    let mut g = LOCKED.lock();
    let s = g.get_or_insert_with(HashSet::new);
    if locked {
        s.insert(ch);
    } else if r.is_ok() {
        s.remove(&ch);
    }
}

pub fn is_locked(ch: BedrockChannel) -> bool {
    LOCKED.lock().as_ref().is_some_and(|s| s.contains(&ch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_errors_are_tracked() {
        let ch = BedrockChannel::Preview;
        let err: Result<(), AppError> = Err(locked_error(std::path::Path::new("x")));
        record(ch, &err);
        assert!(is_locked(ch));
        let other: Result<(), AppError> = Err(AppError::msg("anders"));
        record(ch, &other);
        assert!(is_locked(ch));
        record(ch, &Ok::<(), AppError>(()));
        assert!(!is_locked(ch));
        assert!(is_lock_error(&std::io::Error::from_raw_os_error(32)));
        assert!(!is_lock_error(&std::io::Error::from(std::io::ErrorKind::NotFound)));
    }
}
