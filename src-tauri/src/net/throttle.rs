use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Notify;

const MAX_PAUSE: Duration = Duration::from_secs(90);
const TIMEOUTS_BEFORE_DROP: u32 = 3;
const OKS_BEFORE_RAISE: u32 = 16;

#[derive(Debug, Clone)]
pub struct Limits {
    pub max: usize,
    pub limit: usize,
    pub pause_until: Option<Instant>,
    strikes: u32,
    timeouts: u32,
    oks: u32,
}

impl Limits {
    pub fn new(max: usize) -> Self {
        let max = max.max(1);
        Limits { max, limit: max, pause_until: None, strikes: 0, timeouts: 0, oks: 0 }
    }

    pub fn set_max(&mut self, max: usize) {
        self.max = max.max(1);
        self.limit = self.limit.min(self.max).max(1);
    }

    pub fn on_too_many(&mut self, now: Instant, retry_after: Option<Duration>) {
        self.strikes = (self.strikes + 1).min(6);
        let wait = retry_after.unwrap_or_else(|| Duration::from_secs(1 << self.strikes)).min(MAX_PAUSE);
        let until = now + wait;
        self.pause_until = Some(self.pause_until.map_or(until, |p| p.max(until)));
        self.limit = (self.limit / 2).max(1);
        self.oks = 0;
    }

    pub fn on_timeout(&mut self) {
        self.timeouts += 1;
        self.oks = 0;
        if self.timeouts >= TIMEOUTS_BEFORE_DROP {
            self.timeouts = 0;
            self.limit = (self.limit / 2).max(1);
        }
    }

    pub fn on_ok(&mut self) {
        self.timeouts = 0;
        self.oks += 1;
        if self.oks >= OKS_BEFORE_RAISE {
            self.oks = 0;
            self.strikes = self.strikes.saturating_sub(1);
            self.limit = (self.limit + 1).min(self.max);
        }
    }

    pub fn wait(&self, now: Instant) -> Option<Duration> {
        self.pause_until.filter(|p| *p > now).map(|p| p - now)
    }
}

pub fn parse_retry_after(v: &str, now: chrono::DateTime<chrono::Utc>) -> Option<Duration> {
    let v = v.trim();
    if let Ok(s) = v.parse::<u64>() {
        return Some(Duration::from_secs(s));
    }
    let at = chrono::DateTime::parse_from_rfc2822(v).ok()?;
    let secs = (at.with_timezone(&chrono::Utc) - now).num_seconds();
    Some(Duration::from_secs(secs.max(0) as u64))
}

struct Host {
    limits: Mutex<Limits>,
    active: Mutex<usize>,
    notify: Notify,
}

pub struct Permit {
    host: Arc<Host>,
}

impl Drop for Permit {
    fn drop(&mut self) {
        *self.host.active.lock() -= 1;
        self.host.notify.notify_waiters();
    }
}

impl Permit {
    pub fn too_many(&self, retry_after: Option<Duration>) {
        self.host.limits.lock().on_too_many(Instant::now(), retry_after);
        tracing::warn!("Server bremst (HTTP 429) – Downloads werden kurz gedrosselt");
    }
    pub fn timeout(&self) {
        self.host.limits.lock().on_timeout();
    }
    pub fn ok(&self) {
        self.host.limits.lock().on_ok();
        self.host.notify.notify_waiters();
    }
}

#[derive(Default)]
pub struct Throttle {
    hosts: Mutex<HashMap<String, Arc<Host>>>,
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default()
}

impl Throttle {
    fn host(&self, url: &str, max: usize) -> Arc<Host> {
        let mut map = self.hosts.lock();
        let h = map
            .entry(host_of(url))
            .or_insert_with(|| Arc::new(Host { limits: Mutex::new(Limits::new(max)), active: Mutex::new(0), notify: Notify::new() }))
            .clone();
        h.limits.lock().set_max(max);
        h
    }

    pub async fn acquire(&self, url: &str, max: usize) -> Permit {
        let host = self.host(url, max);
        loop {
            let wait = host.limits.lock().wait(Instant::now());
            if let Some(w) = wait {
                tokio::time::sleep(w).await;
                continue;
            }
            {
                let limit = host.limits.lock().limit;
                let mut active = host.active.lock();
                if *active < limit {
                    *active += 1;
                    return Permit { host: host.clone() };
                }
            }
            let _ = tokio::time::timeout(Duration::from_millis(250), host.notify.notified()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn too_many_halves_and_pauses() {
        let now = Instant::now();
        let mut l = Limits::new(8);
        l.on_too_many(now, Some(Duration::from_secs(5)));
        assert_eq!(l.limit, 4);
        assert_eq!(l.wait(now), Some(Duration::from_secs(5)));
        l.on_too_many(now, Some(Duration::from_secs(500)));
        assert_eq!(l.limit, 2);
        assert_eq!(l.wait(now), Some(MAX_PAUSE));
        assert_eq!(l.wait(now + MAX_PAUSE + Duration::from_secs(1)), None);
    }

    #[test]
    fn backoff_without_header_grows() {
        let now = Instant::now();
        let mut l = Limits::new(4);
        l.on_too_many(now, None);
        assert_eq!(l.wait(now), Some(Duration::from_secs(2)));
        l.on_too_many(now, None);
        assert_eq!(l.wait(now), Some(Duration::from_secs(4)));
    }

    #[test]
    fn timeouts_drop_and_successes_recover() {
        let mut l = Limits::new(8);
        for _ in 0..TIMEOUTS_BEFORE_DROP {
            l.on_timeout();
        }
        assert_eq!(l.limit, 4);
        for _ in 0..(OKS_BEFORE_RAISE * 10) {
            l.on_ok();
        }
        assert_eq!(l.limit, 8);
    }

    #[test]
    fn retry_after_formats() {
        let now = chrono::DateTime::parse_from_rfc2822("Wed, 21 Oct 2026 07:28:00 GMT").unwrap().with_timezone(&chrono::Utc);
        assert_eq!(parse_retry_after("12", now), Some(Duration::from_secs(12)));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2026 07:28:30 GMT", now), Some(Duration::from_secs(30)));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2026 07:27:00 GMT", now), Some(Duration::ZERO));
        assert_eq!(parse_retry_after("bald", now), None);
    }

    #[tokio::test]
    async fn permits_respect_limit() {
        let t = Throttle::default();
        let a = t.acquire("https://x.test/a", 1).await;
        let waiting = tokio::time::timeout(Duration::from_millis(100), t.acquire("https://x.test/b", 1)).await;
        assert!(waiting.is_err());
        let other_host = tokio::time::timeout(Duration::from_millis(100), t.acquire("https://y.test/b", 1)).await;
        assert!(other_host.is_ok());
        drop(a);
        assert!(tokio::time::timeout(Duration::from_millis(500), t.acquire("https://x.test/c", 1)).await.is_ok());
    }
}
