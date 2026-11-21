use super::*;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct UdpChannel {
    pub host: String,
    pub port: u16,
    pub address: String,
}



#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UdpDenied {
    pub channel: String,
    pub code: String,
}



/// `waiting` (angefragt), `ok` (Tunnel funktioniert), `blocked` (kein udp_ok nach 5 s: Netz blockiert UDP),
/// `unavailable` (Relay kann kein UDP oder antwortet nicht), `off` (alle Kanäle abgelehnt)
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UdpStatus {
    pub state: String,
    pub voice: Option<UdpChannel>,
    pub bedrock: Option<UdpChannel>,
    pub denied: Vec<UdpDenied>,
}



pub(super) fn udp_states() -> &'static Mutex<HashMap<String, UdpStatus>> {
    static S: OnceLock<Mutex<HashMap<String, UdpStatus>>> = OnceLock::new();
    S.get_or_init(Default::default)
}



pub(super) fn set_udp(state: &Core, id: &str, f: impl FnOnce(&mut Option<UdpStatus>)) {
    let next = {
        let mut map = udp_states().lock();
        let mut cur = map.get(id).cloned();
        f(&mut cur);
        match &cur {
            Some(u) => map.insert(id.to_string(), u.clone()),
            None => map.remove(id),
        };
        cur
    };
    if let Some(t) = state.server_mgr.status(id).and_then(|s| s.tunnel).filter(|t| t.kind == ServerConnection::Relay) {
        state.server_mgr.set_tunnel(id, Some(TunnelStatus { udp: next, ..t }));
    }
}



pub(super) fn udp(state: &str) -> UdpStatus {
    UdpStatus { state: state.into(), voice: None, bedrock: None, denied: Vec::new() }
}



pub(super) fn udp_timeout(state: &Core, id: &str, cancel: &CancellationToken, from: &'static str, to: &'static str) {
    let (st, id, c) = (state.clone(), id.to_string(), cancel.clone());
    tokio::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(5)) => {}
            _ = c.cancelled() => return,
        }
        set_udp(&st, &id, |u| {
            if let Some(x) = u.as_mut().filter(|x| x.state == from) {
                x.state = to.into();
            }
        });
    });
}



pub fn parse_udp_ready(msg: &Value) -> (Option<UdpChannel>, Option<UdpChannel>, Vec<UdpDenied>) {
    let ch = |name: &str| -> Option<UdpChannel> {
        let c = msg["channels"].get(name)?;
        let port = c["port"].as_u64().and_then(|p| u16::try_from(p).ok())?;
        let address = c["address"].as_str().unwrap_or_default().to_string();
        let host = c["host"].as_str().map(str::to_string).unwrap_or_else(|| split_host_port(&address).0);
        Some(UdpChannel { host, port, address })
    };
    let denied = msg["denied"]
        .as_object()
        .map(|o| o.iter().map(|(k, v)| UdpDenied { channel: k.clone(), code: v["code"].as_str().unwrap_or("disabled").to_string() }).collect())
        .unwrap_or_default();
    (ch("voice"), ch("bedrock"), denied)
}
