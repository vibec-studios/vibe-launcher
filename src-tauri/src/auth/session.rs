use super::*;

impl AuthState {

    /// Ergebnis eines Logins/Refreshs übernehmen. Gibt die Account-ID zurück.
    pub(super) fn apply_login(&self, mc: &msa::McLogin, refresh_token: Option<String>) -> AppResult<String> {
        let id = mc.profile.id.to_lowercase();
        let uuid = uuid::Uuid::parse_str(&id).map(|u| u.hyphenated().to_string()).unwrap_or_else(|_| id.clone());
        let old = self.load_secrets(&id);
        self.store_secrets(
            &id,
            &mc.profile.name,
            &Secrets {
                msa_refresh_token: refresh_token.or(old.msa_refresh_token),
                mc_access_token: Some(mc.access_token.clone()),
            },
        );
        self.upsert(StoredAccount {
            id: id.clone(),
            kind: AccountKind::Microsoft,
            username: mc.profile.name.clone(),
            uuid,
            skin_url: mc.profile.skin_url.clone(),
            expires_at: Some(now_ms() + mc.expires_in as i64 * 1000),
            needs_relogin: false,
            xuid: mc.xuid.clone(),
            added_at: now_ms(),
        });
        self.persist()?;
        Ok(id)
    }

    pub(super) fn mark_relogin(&self, id: &str) {
        {
            let mut s = self.store.lock();
            if let Some(a) = s.accounts.iter_mut().find(|a| a.id == id) {
                a.needs_relogin = true;
            }
        }
        let _ = self.persist();
    }

    /// Microsoft-Tokens erneuern (komplette Kette ab Refresh-Token).
    /// `force = false`: nur, wenn der Minecraft-Token bald abläuft.
    pub async fn refresh(&self, state: &crate::state::AppState, id: &str, force: bool) -> AppResult<Account> {
        let _guard = self.refresh_lock.lock().await;
        let acc = self.store.lock().accounts.iter().find(|a| a.id == id).cloned().ok_or_else(|| AppError::NotFound("Account".into()))?;
        if !force && !acc.needs_relogin && acc.expires_at.is_some_and(|e| e - now_ms() > REFRESH_MARGIN_MS) && self.load_secrets(id).mc_access_token.is_some() {
            return self.get(id); // inzwischen von einem anderen Aufruf erneuert
        }
        let client_id = msa_client_id(state)?;
        let Some(refresh_token) = self.load_secrets(id).msa_refresh_token else {
            self.mark_relogin(id);
            return Err(AppError::Auth(format!("Für {} sind keine Zugangsdaten gespeichert – bitte neu mit Microsoft anmelden.", acc.username)));
        };
        let client = state.net.client.clone();
        let res = async {
            let tokens = msa::refresh_msa(&client, &client_id, &refresh_token).await?;
            // Neues Refresh-Token sofort sichern (das alte wird ungültig)
            if let Some(rt) = &tokens.refresh_token {
                let mut s = self.load_secrets(id);
                s.msa_refresh_token = Some(rt.clone());
                self.store_secrets(id, &acc.username, &s);
            }
            let mc = msa::minecraft_login(&client, &tokens.access_token).await?;
            Ok::<_, AppError>((tokens, mc))
        }
        .await;
        match res {
            Ok((tokens, mc)) => {
                if mc.profile.id.to_lowercase() != id {
                    self.mark_relogin(id);
                    return Err(AppError::Auth("Das Microsoft-Konto gehört zu einem anderen Minecraft-Profil – bitte neu anmelden.".into()));
                }
                self.apply_login(&mc, tokens.refresh_token)?;
                tracing::info!("Microsoft-Account {} erneuert", mc.profile.name);
                self.get(id)
            }
            Err(e @ (AppError::Auth(_) | AppError::NotConfigured(_))) => {
                tracing::warn!("Erneuern von {} fehlgeschlagen: {e}", acc.username);
                self.mark_relogin(id);
                let inner = match e {
                    AppError::Auth(m) | AppError::NotConfigured(m) => m,
                    _ => unreachable!(),
                };
                let base = format!("Die Anmeldung von {} ist abgelaufen – bitte unter Accounts neu mit Microsoft anmelden.", acc.username);
                Err(AppError::Auth(if inner.contains("neu anmelden") { base } else { format!("{base} ({inner})") }))
            }
            Err(e) => {
                // Netzwerk o. ä.: nicht als "neu anmelden" markieren
                tracing::warn!("Erneuern von {} fehlgeschlagen: {e}", acc.username);
                Err(e)
            }
        }
    }

    /// Account-ID + gültiger Minecraft-Token für Profil-Änderungen (Skins/Capes). Frischt bei Bedarf auf.
    pub async fn mc_session(&self, state: &crate::state::AppState, account_id: Option<&str>) -> AppResult<(String, String)> {
        let explicit = account_id.filter(|s| !s.is_empty()).map(str::to_string);
        let active = self.store.lock().active.clone();
        let id = explicit
            .or(active)
            .ok_or_else(|| AppError::NotConfigured("Kein Account – bitte unter Accounts mit Microsoft anmelden".into()))?;
        let la = self.online_account(state, Some(&id)).await?;
        Ok((id, la.access_token))
    }

    /// Nach Skin-Änderungen: Skin-URL im Account aktualisieren (-> `accounts://changed`).
    pub fn set_skin_url(&self, id: &str, url: Option<String>) {
        let changed = {
            let mut s = self.store.lock();
            match s.accounts.iter_mut().find(|a| a.id == id) {
                Some(a) if a.skin_url != url => {
                    a.skin_url = url;
                    true
                }
                _ => false,
            }
        };
        if changed {
            let _ = self.persist();
        }
    }

    /// Gültige Zugangsdaten für den Start (frischt Microsoft-Tokens bei Bedarf auf).
    /// `account_id = None` -> aktiver Account. Kein Account -> Fehler `NotConfigured`.
    pub async fn launch_account(&self, state: &crate::state::AppState, account_id: Option<&str>) -> AppResult<LaunchAccount> {
        self.account_for(state, account_id, true).await
    }

    pub async fn online_account(&self, state: &crate::state::AppState, account_id: Option<&str>) -> AppResult<LaunchAccount> {
        self.account_for(state, account_id, false).await
    }

    pub(super) async fn account_for(&self, state: &crate::state::AppState, account_id: Option<&str>, game: bool) -> AppResult<LaunchAccount> {
        let explicit = account_id.filter(|s| !s.is_empty()).map(str::to_string);
        let active = self.store.lock().active.clone();
        let Some(id) = explicit.or(active) else {
            #[cfg(debug_assertions)]
            if let Some(acc) = dev_offline_account() {
                return Ok(acc);
            }
            return Err(AppError::NotConfigured("Kein Account – bitte unter Accounts mit Microsoft anmelden".into()));
        };
        let acc = self.store.lock().accounts.iter().find(|a| a.id == id).cloned().ok_or_else(|| AppError::NotFound("Account".into()))?;
        let uuid = acc.uuid.replace('-', "");

        let secrets = self.load_secrets(&id);
        let expires = acc.expires_at.unwrap_or(0);
        let needs_refresh = acc.needs_relogin || secrets.mc_access_token.is_none() || expires - now_ms() < REFRESH_MARGIN_MS;
        let (acc, token) = if needs_refresh {
            match self.refresh(state, &id, false).await {
                Ok(_) => {
                    let acc = self.store.lock().accounts.iter().find(|a| a.id == id).cloned().ok_or_else(|| AppError::NotFound("Account".into()))?;
                    let token = self.load_secrets(&id).mc_access_token.ok_or_else(|| AppError::Auth("Kein Minecraft-Token".into()))?;
                    (acc, token)
                }
                // Netzwerkproblem, Token aber noch gültig -> damit starten
                Err(e) if !matches!(e, AppError::Auth(_)) && expires - now_ms() > 30_000 && secrets.mc_access_token.is_some() => {
                    tracing::warn!("Token-Erneuerung fehlgeschlagen, nutze vorhandenen Token: {e}");
                    (acc, secrets.mc_access_token.unwrap_or_default())
                }
                Err(e) if game && offline::eligible(&acc, &e) => {
                    if self.offline.take(&id) {
                        tracing::warn!("Offline-Start (Einzelspieler) für {} – Microsoft nicht erreichbar: {e}", acc.username);
                        return Ok(offline::launch_account(&acc));
                    }
                    tracing::warn!("Token-Erneuerung ohne Verbindung fehlgeschlagen, Offline-Start möglich: {e}");
                    return Err(AppError::OfflineAvailable(offline::offer_message(&acc.username)));
                }
                Err(e) => return Err(e),
            }
        } else {
            (acc, secrets.mc_access_token.unwrap_or_default())
        };
        Ok(LaunchAccount {
            username: acc.username,
            uuid,
            access_token: token,
            user_type: "msa".into(),
            xuid: acc.xuid,
            client_id: state.settings().msa_client(),
        })
    }
}
