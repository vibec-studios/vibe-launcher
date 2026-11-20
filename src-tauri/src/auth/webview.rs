use super::msa;
use super::pkce::{parse_redirect, Pkce, Redirect};
use crate::error::{AppError, AppResult};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio_util::sync::CancellationToken;

pub const LABEL_PREFIX: &str = "msa-login-";
const TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Debug)]
enum Outcome {
    Redirect(Redirect),
    Closed,
}

pub fn close_all(app: &AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with(LABEL_PREFIX) {
            let _ = w.destroy();
        }
    }
}

fn redirect_result(r: Redirect) -> AppResult<String> {
    match r {
        Redirect::Code(c) => Ok(c),
        Redirect::Error { error, description } => {
            let body = serde_json::json!({ "error": error, "error_description": description }).to_string();
            Err(msa::oauth_error(400, body.as_bytes()))
        }
        Redirect::StateMismatch => Err(AppError::Auth("Ungültige Antwort vom Anmeldefenster – bitte erneut anmelden.".into())),
        Redirect::None => Err(AppError::Cancelled),
    }
}

fn result(o: Option<Outcome>) -> AppResult<String> {
    match o {
        Some(Outcome::Redirect(r)) => redirect_result(r),
        Some(Outcome::Closed) | None => Err(AppError::Cancelled),
    }
}

fn watcher(state: String, tx: UnboundedSender<Outcome>) -> impl Fn(&url::Url) -> bool + Send + 'static {
    move |u| match parse_redirect(u, &state) {
        Redirect::None => true,
        r => {
            let _ = tx.send(Outcome::Redirect(r));
            false
        }
    }
}

pub async fn authorize(app: &AppHandle, label: &str, title: &str, client_id: &str, cancel: CancellationToken) -> AppResult<(String, Pkce)> {
    close_all(app);
    let pkce = Pkce::new();
    let (tx, mut rx) = unbounded_channel();
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(pkce.authorize_url(client_id, msa::MSA_SCOPE)))
        .title(title)
        .inner_size(500.0, 680.0)
        .min_inner_size(380.0, 480.0)
        .center()
        .focused(true)
        .incognito(true)
        .on_navigation(watcher(pkce.state.clone(), tx.clone()))
        .build()
        .map_err(|e| AppError::msg(format!("Anmeldefenster konnte nicht geöffnet werden: {e}")))?;
    let closed = tx.clone();
    window.on_window_event(move |e| {
        if matches!(e, WindowEvent::Destroyed) {
            let _ = closed.send(Outcome::Closed);
        }
    });
    drop(tx);
    let res = tokio::select! {
        _ = cancel.cancelled() => Err(AppError::Cancelled),
        _ = tokio::time::sleep(TIMEOUT) => Err(AppError::Auth("Die Anmeldung hat zu lange gedauert – bitte erneut versuchen.".into())),
        o = rx.recv() => result(o),
    };
    let _ = window.destroy();
    res.map(|code| (code, pkce))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcomes() {
        assert_eq!(result(Some(Outcome::Redirect(Redirect::Code("c".into())))).unwrap(), "c");
        assert!(matches!(result(Some(Outcome::Closed)), Err(AppError::Cancelled)));
        assert!(matches!(result(None), Err(AppError::Cancelled)));
        assert!(matches!(result(Some(Outcome::Redirect(Redirect::StateMismatch))), Err(AppError::Auth(_))));
        let denied = Redirect::Error { error: "access_denied".into(), description: "The user has denied access".into() };
        assert!(matches!(result(Some(Outcome::Redirect(denied))), Err(AppError::Auth(m)) if m.contains("abgelehnt")));
        let redirect = Redirect::Error {
            error: "invalid_request".into(),
            description: "The provided value for the input parameter 'redirect_uri' is not valid.".into(),
        };
        assert!(matches!(result(Some(Outcome::Redirect(redirect))), Err(AppError::NotConfigured(m)) if m.contains("Mobile and desktop applications")));
    }

    #[test]
    fn navigation_watcher_blocks_only_redirect() {
        let (tx, mut rx) = unbounded_channel();
        let w = watcher("s".into(), tx);
        assert!(w(&url::Url::parse("https://login.live.com/oauth20_authorize.srf?x=1").unwrap()));
        assert!(rx.try_recv().is_err());
        assert!(!w(&url::Url::parse("https://login.microsoftonline.com/common/oauth2/nativeclient?code=abc&state=s").unwrap()));
        assert!(matches!(rx.try_recv(), Ok(Outcome::Redirect(Redirect::Code(c))) if c == "abc"));
    }
}
