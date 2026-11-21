use super::AuthState;

impl AuthState {
    pub fn forget_local_secrets(&self) -> Vec<String> {
        let ids: Vec<String> = self.store.lock().accounts.iter().map(|a| a.id.clone()).collect();
        for id in &ids {
            self.delete_secrets(id);
        }
        ids
    }
}
