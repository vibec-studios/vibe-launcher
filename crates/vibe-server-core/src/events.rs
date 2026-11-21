use serde::Serialize;
use std::sync::Arc;

pub const TASK_UPDATE: &str = "task://update";

pub trait EventSink: Send + Sync {
    fn emit_json(&self, event: &str, payload: serde_json::Value);
}

pub type Sink = Arc<dyn EventSink>;

pub fn emit<S: Serialize + ?Sized>(sink: &Sink, event: &str, payload: &S) {
    match serde_json::to_value(payload) {
        Ok(v) => sink.emit_json(event, v),
        Err(e) => tracing::warn!("emit {event} fehlgeschlagen: {e}"),
    }
}

pub struct NullSink;

impl EventSink for NullSink {
    fn emit_json(&self, _event: &str, _payload: serde_json::Value) {}
}

pub struct ChannelSink(pub tokio::sync::broadcast::Sender<(String, serde_json::Value)>);

impl EventSink for ChannelSink {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        let _ = self.0.send((event.to_string(), payload));
    }
}
