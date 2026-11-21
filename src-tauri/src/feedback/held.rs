use super::*;

#[derive(Clone)]
pub(super) struct Held {
    pub(super) name: String,
    pub(super) mime: String,
    pub(super) bytes: Vec<u8>,
}

pub(super) fn held() -> &'static Mutex<HashMap<String, Held>> {
    static H: OnceLock<Mutex<HashMap<String, Held>>> = OnceLock::new();
    H.get_or_init(Default::default)
}

/// Fertiges Paket (genau das, was gesendet wird).
#[derive(Clone)]
pub struct Prepared {
    pub meta: Value,
    pub logs: Vec<(String, String)>,
    pub shots: Vec<(String, String, Vec<u8>)>,
    pub bearer: Option<String>,
    pub(super) shot_ids: Vec<String>,
}

pub(super) fn prepared() -> &'static Mutex<Option<(String, Prepared, Instant)>> {
    static P: OnceLock<Mutex<Option<(String, Prepared, Instant)>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

/// Screenshots aus dem Speicher entfernen (Dialog geschlossen / Bild abgewählt).
pub fn discard(ids: &[String]) {
    let mut h = held().lock();
    for id in ids {
        h.remove(id);
    }
}
