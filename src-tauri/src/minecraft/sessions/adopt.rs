use super::*;

impl Registry {
    pub fn adopt(&mut self, mut st: GameState) -> GameState {
        if let Some(n) = st.run_id.strip_prefix("run-").and_then(|n| n.parse::<u64>().ok()) {
            self.next = self.next.max(n);
        }
        self.next += 1;
        if st.run_id.is_empty() || self.map.contains_key(&st.run_id) {
            st.run_id = format!("run-{}", self.next);
        }
        let taken = self.map.values().any(|s| s.state.instance_id == st.instance_id && active(s) && s.state.slot == st.slot);
        if st.slot == 0 || taken {
            st.slot = self.free_slot(&st.instance_id);
        }
        st.state = RunState::Running;
        if let Some(t) = st.started_at {
            let c = self.clocks.entry(st.instance_id.clone()).or_insert(t);
            *c = (*c).min(t);
        }
        self.map.insert(
            st.run_id.clone(),
            Session { state: st.clone(), log: VecDeque::new(), seq: 0, pending: Vec::new(), killed: false, task_id: None, secret: None, spark_report: None, order: self.next },
        );
        st
    }
}
