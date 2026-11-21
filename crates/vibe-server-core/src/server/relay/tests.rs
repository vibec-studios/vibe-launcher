#[test]
fn udp_ready_parsing() {
    let m: serde_json::Value = serde_json::from_str(
        r#"{"t":"udp_ready","token":"9f","tunnel":{"port":24454},
        "channels":{"voice":{"port":24454,"address":"mossy-otter-27.axolite.cc:24454","voiceHost":"24454"},
        "bedrock":{"port":19207,"address":"mossy-otter-27.axolite.cc:19207","host":"mossy-otter-27.axolite.cc"}},
        "denied":{"x":{"code":"no_port","msg":"m"}}}"#,
    )
    .unwrap();
    let (v, b, d) = super::parse_udp_ready(&m);
    assert_eq!(v.unwrap().host, "mossy-otter-27.axolite.cc");
    let b = b.unwrap();
    assert_eq!((b.host.as_str(), b.port), ("mossy-otter-27.axolite.cc", 19207));
    assert_eq!(d[0].code, "no_port");
    let empty: serde_json::Value = serde_json::from_str(r#"{"t":"udp_ready","token":"","channels":{},"denied":{"bedrock":{"code":"disabled"}}}"#).unwrap();
    let (v, b, d) = super::parse_udp_ready(&empty);
    assert!(v.is_none() && b.is_none() && d.len() == 1);
}

#[test]
fn host_port() {
    assert_eq!(super::split_host_port("relay.axolite.cc:25565"), ("relay.axolite.cc".into(), 25565));
    assert_eq!(super::split_host_port("localhost"), ("localhost".into(), 25565));
    assert_eq!(super::split_host_port("127.0.0.1:25599"), ("127.0.0.1".into(), 25599));
}
