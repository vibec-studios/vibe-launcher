use super::*;

impl AuthState {

    // -------------------------------------------------------------- Verwaltung

    pub fn remove(&self, id: &str) -> AppResult<()> {
        {
            let mut s = self.store.lock();
            let before = s.accounts.len();
            s.accounts.retain(|a| a.id != id);
            if s.accounts.len() == before {
                return Err(AppError::NotFound("Account".into()));
            }
            if s.active.as_deref() == Some(id) {
                s.active = s.accounts.first().map(|a| a.id.clone());
            }
        }
        self.delete_secrets(id);
        tracing::info!("Account {id} entfernt");
        self.persist()
    }

    pub fn set_active(&self, id: &str) -> AppResult<()> {
        {
            let mut s = self.store.lock();
            if !s.accounts.iter().any(|a| a.id == id) {
                return Err(AppError::NotFound("Account".into()));
            }
            s.active = Some(id.to_string());
        }
        self.persist()
    }

    // -------------------------------------------------------------- Microsoft-Login

    /// Device-Code anfordern (bricht einen laufenden Login ab).
    pub async fn msa_begin(&self, state: &crate::state::AppState) -> AppResult<DeviceCode> {
        let client_id = msa_client_id(state)?;
        self.msa_cancel();
        let dc = msa::request_device_code(&state.net.client, &client_id).await?;
        let generation = self.generation.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        *self.pending.lock() = Some(PendingLogin {
            generation,
            client_id,
            device_code: dc.device_code.clone(),
            interval: dc.interval.max(1),
            deadline: Instant::now() + Duration::from_secs(dc.expires_in),
            cancel: CancellationToken::new(),
        });
        tracing::info!("Microsoft-Login gestartet (Code gültig {} s)", dc.expires_in);
        let message = format!("Öffne {} im Browser und gib den Code {} ein.", dc.verification_uri, dc.user_code);
        Ok(DeviceCode {
            user_code: dc.user_code,
            verification_uri: dc.verification_uri,
            expires_in: dc.expires_in,
            interval: dc.interval,
            message,
        })
    }

    /// Wartet auf die Eingabe des Codes und legt den Account an.
    pub async fn msa_wait(&self, state: &crate::state::AppState) -> AppResult<Account> {
        let (generation, client_id, device_code, mut interval, deadline, cancel) = {
            let p = self.pending.lock();
            let p = p.as_ref().ok_or_else(|| AppError::Invalid("Kein laufender Microsoft-Login – bitte zuerst starten.".into()))?;
            (p.generation, p.client_id.clone(), p.device_code.clone(), p.interval, p.deadline, p.cancel.clone())
        };
        let client = state.net.client.clone();
        let flow = async {
            let mut net_errors = 0;
            let tokens = loop {
                tokio::time::sleep(Duration::from_secs(interval)).await;
                if Instant::now() > deadline {
                    return Err(AppError::Auth("Der Anmeldecode ist abgelaufen – bitte den Login erneut starten.".into()));
                }
                match msa::poll_device_code(&client, &client_id, &device_code).await {
                    Ok(msa::Poll::Pending) => net_errors = 0,
                    Ok(msa::Poll::SlowDown) => interval += 5,
                    Ok(msa::Poll::Done(t)) => break t,
                    Err(AppError::Http(e)) if net_errors < 5 => {
                        net_errors += 1;
                        tracing::warn!("Login-Polling: Netzwerkfehler ({e}), neuer Versuch");
                    }
                    Err(e) => return Err(e),
                }
            };
            let mc = msa::minecraft_login(&client, &tokens.access_token).await?;
            Ok::<_, AppError>((tokens, mc))
        };
        let result = tokio::select! {
            _ = cancel.cancelled() => Err(AppError::Cancelled),
            r = flow => r,
        };
        {
            let mut p = self.pending.lock();
            if p.as_ref().is_some_and(|p| p.generation == generation) {
                *p = None;
            }
        }
        let (tokens, mc) = match result {
            Ok(v) => v,
            Err(e) => {
                if !matches!(e, AppError::Cancelled) {
                    tracing::warn!("Microsoft-Login fehlgeschlagen: {e}");
                }
                return Err(e);
            }
        };
        let id = self.apply_login(&mc, tokens.refresh_token)?;
        tracing::info!("Microsoft-Account {} angemeldet", mc.profile.name);
        self.get(&id)
    }

    pub fn msa_cancel(&self) {
        if let Some(p) = self.pending.lock().take() {
            p.cancel.cancel();
        }
        if let Some((_, c)) = self.window_login.lock().take() {
            c.cancel();
        }
    }

    pub async fn msa_window_login(&self, state: &crate::state::AppState, title: &str) -> AppResult<Account> {
        let client_id = msa_client_id(state)?;
        self.msa_cancel();
        let generation = self.generation.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        let cancel = CancellationToken::new();
        *self.window_login.lock() = Some((generation, cancel.clone()));
        let label = format!("{}{generation}", webview::LABEL_PREFIX);
        let client = state.net.client.clone();
        let flow = async {
            let (code, pkce) = webview::authorize(&self.app, &label, title, &client_id, cancel.clone()).await?;
            let tokens = msa::exchange_code(&client, &client_id, &code, &pkce.verifier).await?;
            let mc = tokio::select! {
                _ = cancel.cancelled() => return Err(AppError::Cancelled),
                r = msa::minecraft_login(&client, &tokens.access_token) => r?,
            };
            Ok::<_, AppError>((tokens, mc))
        };
        let result = flow.await;
        {
            let mut w = self.window_login.lock();
            if w.as_ref().is_some_and(|(g, _)| *g == generation) {
                *w = None;
            }
        }
        let (tokens, mc) = result.inspect_err(|e| {
            if !matches!(e, AppError::Cancelled) {
                tracing::warn!("Microsoft-Login (Fenster) fehlgeschlagen: {e}");
            }
        })?;
        let id = self.apply_login(&mc, tokens.refresh_token)?;
        tracing::info!("Microsoft-Account {} angemeldet (Fenster)", mc.profile.name);
        self.get(&id)
    }

    pub fn grant_offline(&self, account_id: Option<&str>) {
        let id = account_id.filter(|s| !s.is_empty()).map(str::to_string).or_else(|| self.store.lock().active.clone());
        if let Some(id) = id {
            self.offline.grant(&id);
        }
    }
}
