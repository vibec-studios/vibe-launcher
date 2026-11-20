use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NrGlobal {
    pub custom_dir: Option<PathBuf>,
    pub memory: Value,
    pub jvm_args: Option<String>,
    pub pre_launch: Option<String>,
    pub wrapper: Option<String>,
    pub post_exit: Option<String>,
}

fn text(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.trim().is_empty())
}

pub fn parse(v: &Value) -> NrGlobal {
    let hooks = v.get("hooks");
    let hook = |k: &str| text(hooks.and_then(|h| h.get(k)));
    NrGlobal {
        custom_dir: text(v.get("custom_game_directory")).map(PathBuf::from),
        memory: v.get("global_memory_settings").filter(|m| m.is_object()).cloned().unwrap_or(Value::Null),
        jvm_args: text(v.get("global_custom_jvm_args")),
        pre_launch: hook("pre_launch"),
        wrapper: hook("wrapper"),
        post_exit: hook("post_exit"),
    }
}

pub fn read(root: &Path) -> NrGlobal {
    let b = match std::fs::metadata(root.join("launcher_config.json")) {
        Ok(m) if m.len() <= 1024 * 1024 => std::fs::read(root.join("launcher_config.json")).ok(),
        _ => None,
    };
    b.and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|v| parse(&v)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_fields_only() {
        let v = serde_json::json!({
            "custom_game_directory": "D:/NR", "global_memory_settings": {"min": 1024, "max": 6144},
            "global_custom_jvm_args": "-XX:+UseZGC", "hooks": {"pre_launch": "echo hi", "wrapper": null, "post_exit": " "},
            "last_played_profile": "x", "referral": {"code": "secret"}
        });
        let g = parse(&v);
        assert_eq!(g.custom_dir, Some(PathBuf::from("D:/NR")));
        assert_eq!(g.memory["max"], 6144);
        assert_eq!(g.jvm_args.as_deref(), Some("-XX:+UseZGC"));
        assert_eq!(g.pre_launch.as_deref(), Some("echo hi"));
        assert!(g.wrapper.is_none() && g.post_exit.is_none());
        assert_eq!(parse(&serde_json::json!({})), NrGlobal::default());
    }
}
