use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

pub struct RateLimiter {
    window: Duration,
    max: usize,
    hits: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        RateLimiter { window, max, hits: Mutex::new(HashMap::new()) }
    }

    pub fn check(&self, key: &str) -> Result<(), u64> {
        let now = Instant::now();
        let mut map = self.hits.lock();
        if map.len() > 10_000 {
            map.retain(|_, q| q.back().is_some_and(|t| now.duration_since(*t) < self.window));
        }
        let q = map.entry(key.to_string()).or_default();
        while q.front().is_some_and(|t| now.duration_since(*t) >= self.window) {
            q.pop_front();
        }
        if q.len() >= self.max {
            let wait = q.front().map(|t| self.window.saturating_sub(now.duration_since(*t))).unwrap_or(self.window);
            return Err(wait.as_secs().max(1));
        }
        q.push_back(now);
        Ok(())
    }

    pub fn blocked(&self, key: &str) -> Option<u64> {
        let now = Instant::now();
        let map = self.hits.lock();
        let q = map.get(key)?;
        let recent = q.iter().filter(|t| now.duration_since(**t) < self.window).count();
        (recent >= self.max).then(|| q.front().map(|t| self.window.saturating_sub(now.duration_since(*t)).as_secs().max(1)).unwrap_or(1))
    }

    pub fn note(&self, key: &str) {
        let _ = self.check(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_per_key() {
        let r = RateLimiter::new(2, Duration::from_secs(60));
        assert!(r.check("a").is_ok());
        assert!(r.check("a").is_ok());
        assert!(r.check("a").is_err());
        assert!(r.check("b").is_ok());
        assert!(r.blocked("a").is_some());
        assert!(r.blocked("b").is_none());
    }
}
