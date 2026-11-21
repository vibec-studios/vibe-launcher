use super::*;

pub fn os_name() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

pub fn arch_name() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "x86_64"
    }
}

pub(super) fn os_version() -> String {
    if cfg!(windows) {
        // Windows 10/11 melden beide "10.0"; Build-Nummer aus dem Kernel.
        let build = sysinfo::System::kernel_version().unwrap_or_default();
        let build: String = build.chars().take_while(|c| c.is_ascii_digit()).collect();
        if build.is_empty() { "10.0".into() } else { format!("10.0.{build}") }
    } else {
        sysinfo::System::os_version().unwrap_or_default()
    }
}

pub(super) fn cmp_dotted(a: &str, b: &str) -> std::cmp::Ordering {
    let pa: Vec<u64> = a.split(['.', '_', '-']).map(|x| x.parse().unwrap_or(0)).collect();
    let pb: Vec<u64> = b.split(['.', '_', '-']).map(|x| x.parse().unwrap_or(0)).collect();
    for i in 0..pa.len().max(pb.len()) {
        let x = pa.get(i).copied().unwrap_or(0);
        let y = pb.get(i).copied().unwrap_or(0);
        if x != y {
            return x.cmp(&y);
        }
    }
    std::cmp::Ordering::Equal
}

pub(super) fn rule_matches(rule: &Rule, env: &Env) -> bool {
    if let Some(os) = &rule.os {
        if let Some(name) = &os.name {
            if name != env.os {
                return false;
            }
        }
        if let Some(arch) = &os.arch {
            let ok = match arch.as_str() {
                "x86" => env.arch == "x86",
                "x86_64" | "x64" | "amd64" => env.arch == "x86_64",
                "arm64" | "aarch64" => env.arch == "aarch64",
                other => other == env.arch,
            };
            if !ok {
                return false;
            }
        }
        if let Some(v) = &os.version {
            match regex::Regex::new(v) {
                Ok(re) => {
                    if !re.is_match(&env.os_version) {
                        return false;
                    }
                }
                Err(_) => return false,
            }
        }
        if let Some(r) = &os.version_range {
            if let Some(min) = &r.min {
                if cmp_dotted(&env.os_version, min) == std::cmp::Ordering::Less {
                    return false;
                }
            }
            if let Some(max) = &r.max {
                if cmp_dotted(&env.os_version, max) != std::cmp::Ordering::Less {
                    return false;
                }
            }
        }
    }
    if let Some(features) = &rule.features {
        for (k, v) in features {
            if env.features.get(k).copied().unwrap_or(false) != *v {
                return false;
            }
        }
    }
    true
}

/// Mojang-Logik: ohne Regeln erlaubt; mit Regeln zählt die letzte passende.
pub fn rules_allow(rules: Option<&[Rule]>, env: &Env) -> bool {
    let Some(rules) = rules else { return true };
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for r in rules {
        if rule_matches(r, env) {
            allowed = r.action == "allow";
        }
    }
    allowed
}

/// Argumente einer Liste auswerten (Regeln anwenden, Werte flach machen).
pub fn eval_args(args: &[Argument], env: &Env) -> Vec<String> {
    let mut out = Vec::new();
    for a in args {
        match a {
            Argument::Plain(s) => out.push(s.clone()),
            Argument::Ruled { rules, value } => {
                if rules_allow(Some(rules), env) {
                    out.extend(value.to_vec());
                }
            }
        }
    }
    out
}
