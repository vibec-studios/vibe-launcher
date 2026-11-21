use super::links::AppAction;

pub const SCHEME: &str = "modrinth";

const PROJECT_TYPES: [&str; 7] = ["mod", "modpack", "plugin", "resourcepack", "shader", "datapack", "project"];

fn ok(s: &str) -> bool {
    s != "." && s != ".." && !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn looks_like_id(s: &str) -> bool {
    s.len() == 8 && s.chars().all(|c| c.is_ascii_alphanumeric())
}

fn install(project: &str, version: Option<&str>) -> Option<AppAction> {
    ok(project).then(|| AppAction::Install { source: "modrinth".into(), project_id: project.to_string(), version: version.filter(|v| ok(v)).map(str::to_string) })
}

fn from_parts(parts: &[String], web: bool) -> Option<AppAction> {
    let kind = parts.first()?.to_ascii_lowercase();
    if kind == "version" && !web {
        return match parts {
            [_, v] if ok(v) => Some(AppAction::InstallVersion { source: "modrinth".into(), version_id: v.clone() }),
            _ => None,
        };
    }
    if !PROJECT_TYPES.contains(&kind.as_str()) {
        return None;
    }
    match parts {
        [_, p] => install(p, None),
        [_, p, tab] if web && !tab.is_empty() => install(p, None),
        [_, p, v, ver] if v == "version" => install(p, Some(ver.as_str()).filter(|x| !web || looks_like_id(x))),
        [_, p, ..] if web => install(p, None),
        _ => None,
    }
}

pub fn parse(raw: &str) -> Option<AppAction> {
    let path = raw.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase();
    if path.split(['/', '\\']).any(|p| p == "." || p == ".." || p == "%2e%2e" || p == "%2e") {
        return None;
    }
    let url = url::Url::parse(raw.trim()).ok()?;
    let web = match url.scheme() {
        SCHEME => false,
        "https" => matches!(url.host_str(), Some("modrinth.com") | Some("www.modrinth.com")),
        _ => return None,
    };
    if url.scheme() == "https" && !web {
        return None;
    }
    let mut parts: Vec<String> = Vec::new();
    if !web {
        if let Some(h) = url.host_str() {
            parts.push(h.to_string());
        }
    }
    parts.extend(url.path().split('/').filter(|p| !p.is_empty()).filter_map(|p| urlencoding::decode(p).ok().map(|c| c.into_owned())));
    from_parts(&parts, web)
}

pub fn from_args<'a, I: IntoIterator<Item = &'a String>>(args: I) -> Vec<AppAction> {
    args.into_iter().filter(|a| a.trim_start().to_ascii_lowercase().starts_with("modrinth:")).filter_map(|a| parse(a)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inst(p: &str, v: Option<&str>) -> Option<AppAction> {
        Some(AppAction::Install { source: "modrinth".into(), project_id: p.into(), version: v.map(Into::into) })
    }

    #[test]
    fn scheme_links() {
        assert_eq!(parse("modrinth://mod/sodium"), inst("sodium", None));
        assert_eq!(parse("modrinth://modpack/fabulously-optimized"), inst("fabulously-optimized", None));
        assert_eq!(parse("modrinth://shader/complementary-reimagined/"), inst("complementary-reimagined", None));
        assert_eq!(parse("modrinth://mod/sodium/version/b4hTi3mo"), inst("sodium", Some("b4hTi3mo")));
        assert_eq!(parse("modrinth://version/b4hTi3mo"), Some(AppAction::InstallVersion { source: "modrinth".into(), version_id: "b4hTi3mo".into() }));
        assert_eq!(parse("modrinth://server/abc"), None);
        assert_eq!(parse("modrinth://mod/../../x"), None);
        assert_eq!(parse("modrinth://mod/%2e%2e/x"), None);
        assert_eq!(parse("modrinth://mod/a%20b"), None);
        assert_eq!(parse("modrinth://mod"), None);
    }

    #[test]
    fn web_links() {
        assert_eq!(parse("https://modrinth.com/mod/sodium"), inst("sodium", None));
        assert_eq!(parse("https://modrinth.com/mod/sodium/versions"), inst("sodium", None));
        assert_eq!(parse("https://modrinth.com/mod/sodium/version/b4hTi3mo"), inst("sodium", Some("b4hTi3mo")));
        assert_eq!(parse("https://modrinth.com/mod/sodium/version/mc1.21-0.6.0"), inst("sodium", None));
        assert_eq!(parse("https://www.modrinth.com/modpack/cobblemon-fabric"), inst("cobblemon-fabric", None));
        assert_eq!(parse("https://evil.example/mod/sodium"), None);
        assert_eq!(parse("http://modrinth.com/mod/sodium"), None);
        assert_eq!(parse("https://modrinth.com/user/jellysquid3"), None);
        assert_eq!(parse("https://modrinth.com/version/b4hTi3mo"), None);
    }

    #[test]
    fn args() {
        let a: Vec<String> = ["C:\\vibe.exe", "modrinth://mod/sodium", "vibelauncher://launch/x", "--launch"].map(String::from).to_vec();
        assert_eq!(from_args(a.iter().skip(1)), vec![inst("sodium", None).unwrap()]);
    }
}
