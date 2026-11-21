use super::*;

impl AuthState {
    pub fn load(paths: Paths, app: AppHandle) -> Arc<Self> {
        let file = paths.accounts_file();
        let mut store: AccountsFile = match std::fs::read(&file) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
                tracing::warn!("accounts.json unlesbar ({e}) – Sicherung als accounts.json.bak");
                let _ = std::fs::copy(&file, file.with_extension("json.bak"));
                AccountsFile::default()
            }),
            Err(_) => AccountsFile::default(),
        };
        if store.active.as_ref().map_or(true, |a| !store.accounts.iter().any(|x| &x.id == a)) {
            store.active = store.accounts.first().map(|a| a.id.clone());
        }
        let secrets = secrets::SecretStore::new(&paths);
        let skins = skins::Library::load(&paths.root);
        Arc::new(AuthState {
            paths,
            app,
            store: Mutex::new(store),
            secrets,
            secret_cache: Mutex::new(HashMap::new()),
            pending: Mutex::new(None),
            window_login: Mutex::new(None),
            offline: Default::default(),
            vault_warned: Mutex::new(HashSet::new()),
            generation: Default::default(),
            refresh_lock: tokio::sync::Mutex::new(()),
            skins,
        })
    }

    pub fn list(&self) -> Vec<Account> {
        let s = self.store.lock();
        s.accounts.iter().map(|a| to_public(a, s.active.as_deref())).collect()
    }

    pub(super) fn get(&self, id: &str) -> AppResult<Account> {
        self.list().into_iter().find(|a| a.id == id).ok_or_else(|| AppError::NotFound("Account".into()))
    }

    /// Speichern + `accounts://changed`.
    pub(super) fn persist(&self) -> AppResult<()> {
        let res = {
            let s = self.store.lock();
            crate::util::write_json_atomic(&self.paths.accounts_file(), &*s)
        };
        events::emit(&self.app, events::ACCOUNTS_CHANGED, &self.list());
        res
    }

    pub(super) fn upsert(&self, acc: StoredAccount) {
        let mut s = self.store.lock();
        match s.accounts.iter_mut().find(|a| a.id == acc.id) {
            Some(existing) => {
                let added = existing.added_at;
                *existing = acc;
                existing.added_at = added;
            }
            None => s.accounts.push(acc),
        }
        if s.active.is_none() {
            s.active = s.accounts.first().map(|a| a.id.clone());
        }
    }

    // -------------------------------------------------------------- Secrets

    pub(super) fn load_secrets(&self, id: &str) -> Secrets {
        if let Some(s) = self.secret_cache.lock().get(id) {
            return s.clone();
        }
        let s = match self.secrets.load(id) {
            Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_else(|_| {
                tracing::warn!("Zugangsdaten für Account {id} im Schlüsselbund unlesbar");
                Secrets::default()
            }),
            Ok(None) => Secrets::default(),
            Err(e) => {
                tracing::warn!("Zugangsdaten für Account {id} nicht lesbar: {e}");
                Secrets::default()
            }
        };
        self.secret_cache.lock().insert(id.to_string(), s.clone());
        s
    }

    pub(super) fn store_secrets(&self, id: &str, name: &str, s: &Secrets) {
        self.secret_cache.lock().insert(id.to_string(), s.clone());
        let json = match serde_json::to_string(s) {
            Ok(j) => j,
            Err(_) => return,
        };
        if let Err(e) = self.secrets.save(id, &json) {
            // Sitzung funktioniert weiter (Cache); nach Neustart ist eine neue Anmeldung nötig.
            tracing::error!("Zugangsdaten für Account {id} nicht gespeichert: {e}");
            if self.vault_warned.lock().insert(id.to_string()) {
                events::emit(&self.app, events::AUTH_VAULT_WARNING, &VaultWarning { account_id: id.to_string(), username: name.to_string(), message: e.to_string() });
            }
        }
    }

    pub(super) fn delete_secrets(&self, id: &str) {
        self.secret_cache.lock().remove(id);
        self.secrets.delete(id);
    }
}
