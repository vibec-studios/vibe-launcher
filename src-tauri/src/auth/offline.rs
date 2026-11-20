use super::{LaunchAccount, StoredAccount};
use crate::error::AppError;
use parking_lot::Mutex;
use std::time::{Duration, Instant};

const GRANT_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshFailure {
    Rejected,
    Network,
    Other,
}

pub fn classify(e: &AppError) -> RefreshFailure {
    match e {
        AppError::Auth(_) | AppError::NotConfigured(_) => RefreshFailure::Rejected,
        AppError::Http(_) | AppError::Unreachable(_) => RefreshFailure::Network,
        _ => RefreshFailure::Other,
    }
}

pub(super) fn eligible(acc: &StoredAccount, e: &AppError) -> bool {
    !acc.needs_relogin && acc.expires_at.is_some() && classify(e) == RefreshFailure::Network
}

pub(super) fn launch_account(acc: &StoredAccount) -> LaunchAccount {
    LaunchAccount {
        username: acc.username.clone(),
        uuid: acc.uuid.replace('-', ""),
        access_token: "0".into(),
        user_type: "msa".into(),
        xuid: acc.xuid.clone(),
        client_id: None,
    }
}

pub fn offer_message(username: &str) -> String {
    format!(
        "Microsoft ist gerade nicht erreichbar, {username} konnte nicht angemeldet werden. \
         Ein Offline-Start für Einzelspieler ist möglich – Mehrspieler-Server im Online-Modus gehen so nicht."
    )
}

#[derive(Default)]
pub struct Grants(Mutex<Option<(String, Instant)>>);

impl Grants {
    pub fn grant(&self, id: &str) {
        *self.0.lock() = Some((id.to_string(), Instant::now()));
    }

    pub fn take(&self, id: &str) -> bool {
        let mut g = self.0.lock();
        match g.as_ref() {
            Some((gid, at)) if gid == id && at.elapsed() < GRANT_TTL => {
                *g = None;
                true
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{msa, AccountKind};
    use super::super::fake_server::{closed_port_url, serve};
    use super::*;

    fn acc(needs_relogin: bool, expires_at: Option<i64>) -> StoredAccount {
        StoredAccount {
            id: "0123456789abcdef0123456789abcdef".into(),
            kind: AccountKind::Microsoft,
            username: "Steve".into(),
            uuid: "01234567-89ab-cdef-0123-456789abcdef".into(),
            skin_url: None,
            expires_at,
            needs_relogin,
            xuid: Some("2535".into()),
            added_at: 0,
        }
    }

    async fn refresh_err(url: &str) -> AppError {
        msa::refresh_msa_at(&reqwest::Client::new(), url, "cid", "rt").await.expect_err("Fehler erwartet")
    }

    #[tokio::test]
    async fn network_error_vs_rejection() {
        let offline = refresh_err(&closed_port_url().await).await;
        assert_eq!(classify(&offline), RefreshFailure::Network, "{offline:?}");

        let down = serve(503, r#"{"error":"temporarily_unavailable"}"#).await;
        let e = refresh_err(&down.url).await;
        assert!(matches!(e, AppError::Unreachable(_)), "{e:?}");
        assert_eq!(classify(&e), RefreshFailure::Network);

        let rejected = serve(400, r#"{"error":"invalid_grant","error_description":"AADSTS70000: revoked"}"#).await;
        let e = refresh_err(&rejected.url).await;
        assert_eq!(classify(&e), RefreshFailure::Rejected, "{e:?}");

        let bad_client = serve(400, r#"{"error":"unauthorized_client","error_codes":[700016]}"#).await;
        assert_eq!(classify(&refresh_err(&bad_client.url).await), RefreshFailure::Rejected);

        assert_eq!(classify(&AppError::Cancelled), RefreshFailure::Other);
        assert_eq!(classify(&AppError::msg("x")), RefreshFailure::Other);
    }

    #[tokio::test]
    async fn only_verified_accounts() {
        let net = refresh_err(&closed_port_url().await).await;
        assert!(eligible(&acc(false, Some(1)), &net));
        assert!(!eligible(&acc(true, Some(1)), &net));
        assert!(!eligible(&acc(false, None), &net));
        assert!(!eligible(&acc(false, Some(1)), &AppError::Auth("abgelehnt".into())));
        assert!(!eligible(&acc(false, Some(1)), &AppError::NotConfigured("x".into())));
        assert!(eligible(&acc(false, Some(1)), &AppError::Unreachable("503".into())));
    }

    #[test]
    fn offline_account_uses_real_profile() {
        let a = launch_account(&acc(false, Some(1)));
        assert_eq!(a.username, "Steve");
        assert_eq!(a.uuid, "0123456789abcdef0123456789abcdef");
        assert_eq!(a.user_type, "msa");
        assert_eq!(a.access_token, "0");
        assert_eq!(a.xuid.as_deref(), Some("2535"));
    }

    #[test]
    fn grants_are_single_use_and_per_account() {
        let g = Grants::default();
        assert!(!g.take("a"));
        g.grant("a");
        assert!(!g.take("b"));
        assert!(g.take("a"));
        assert!(!g.take("a"));
    }
}
