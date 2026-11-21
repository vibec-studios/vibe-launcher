use super::*;

/// Höchste Schema-Version, die wir verstehen (höhere werden übersprungen).
pub(crate) const SCHEMA: i64 = 1;
pub(super) const TITLE_MAX: usize = 100;
pub(super) const TAGS_MAX: usize = 16;
pub(super) const TAG_MAX: usize = 32;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClipEvent {
    pub t_ms: i64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub victim: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClipPlayer {
    pub name: Option<String>,
    pub uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Clip {
    pub instance_id: String,
    pub id: String,
    /// Absoluter Pfad der MP4
    pub video_path: String,
    /// Absoluter Pfad des Vorschaubilds (fehlt, wenn das Spiel keins schreiben konnte)
    pub thumbnail_path: Option<String>,
    /// ms seit 1970 (aus `created_at`, sonst aus der id bzw. der Änderungszeit)
    pub created_at: i64,
    pub duration_ms: Option<i64>,
    pub size_bytes: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    /// `hotkey`, `kill`, `multikill`, `clutch`, `death` – oder Unbekanntes (Frontend zeigt dann „Clip“)
    pub reason: String,
    pub kills: Option<i64>,
    pub highlight_ms: Option<i64>,
    pub events: Vec<ClipEvent>,
    pub player: Option<ClipPlayer>,
    pub mode: Option<String>,
    /// Nur bei `multiplayer` und nur, wenn das Spiel sie gespeichert hat (nie ergänzen)
    pub server: Option<String>,
    /// Nur bei `singleplayer`/`hosting`
    pub world: Option<String>,
    pub minecraft: Option<String>,
    pub loader: Option<String>,
    pub client_version: Option<String>,
    pub encoder: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub kept: bool,
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub keyframes_ms: Vec<i64>,
    pub cuts_ms: Vec<i64>,
    pub rewind: bool,
    pub trim_hint: Option<TrimRange>,
    pub trim: Option<TrimRange>,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct TrimRange {
    pub in_ms: i64,
    pub out_ms: i64,
}

pub(super) fn ms_list(o: &Map<String, Value>, k: &str, max: usize) -> Vec<i64> {
    let mut v: Vec<i64> = o
        .get(k)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64))).filter(|n| *n >= 0).take(max).collect())
        .unwrap_or_default();
    v.sort_unstable();
    v.dedup();
    v
}

pub(crate) fn trim_field(o: &Map<String, Value>, k: &str) -> Option<TrimRange> {
    let t = o.get(k)?.as_object()?;
    let r = TrimRange { in_ms: int_field(t, "in_ms")?, out_ms: int_field(t, "out_ms")? };
    (r.in_ms >= 0 && r.in_ms < r.out_ms).then_some(r)
}
