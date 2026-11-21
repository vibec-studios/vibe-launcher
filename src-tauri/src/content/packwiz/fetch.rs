use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub enum Loc {
    Http(url::Url),
    File(PathBuf),
}

impl Loc {
    pub fn parse(input: &str) -> AppResult<Loc> {
        let s = input.trim();
        if s.starts_with("https://") || s.starts_with("http://") {
            let u = url::Url::parse(&github_raw(s)).map_err(|_| AppError::Invalid("Ungültiger Link".into()))?;
            return Ok(Loc::Http(u));
        }
        let p = PathBuf::from(s);
        if p.is_dir() {
            return Ok(Loc::File(p.join("pack.toml")));
        }
        Ok(Loc::File(p))
    }

    pub fn join(&self, rel: &str) -> AppResult<Loc> {
        if !super::model::valid_rel(rel) {
            return Err(AppError::Invalid(format!("Das Pack enthält einen unzulässigen Pfad: {rel}")));
        }
        match self {
            Loc::Http(u) => u.join(rel).map(Loc::Http).map_err(|_| AppError::Invalid(format!("Ungültiger Pfad im Pack: {rel}"))),
            Loc::File(p) => {
                let dir = p.parent().map(|d| d.to_path_buf()).unwrap_or_default();
                crate::util::safe_join(&dir, rel).map(Loc::File).ok_or_else(|| AppError::Invalid(format!("Das Pack enthält einen unzulässigen Pfad: {rel}")))
            }
        }
    }

    pub fn display(&self) -> String {
        match self {
            Loc::Http(u) => u.to_string(),
            Loc::File(p) => p.display().to_string(),
        }
    }

    pub async fn fetch(&self, state: &AppState) -> AppResult<Vec<u8>> {
        match self {
            Loc::Http(u) => Ok(state.net.get_bytes(u.as_str()).await?.to_vec()),
            Loc::File(p) => tokio::fs::read(p).await.map_err(|e| AppError::NotFound(format!("{} ({e})", p.display()))),
        }
    }
}

pub fn github_raw(url: &str) -> String {
    let Some(rest) = url.strip_prefix("https://github.com/") else { return url.to_string() };
    let parts: Vec<&str> = rest.splitn(4, '/').collect();
    match parts.as_slice() {
        [owner, repo, "blob", tail] => format!("https://raw.githubusercontent.com/{owner}/{repo}/{tail}"),
        _ => url.to_string(),
    }
}

pub fn hash_hex(format: &str, bytes: &[u8]) -> Option<String> {
    use sha1::Digest;
    Some(match format.to_ascii_lowercase().as_str() {
        "sha1" => hex::encode(sha1::Sha1::digest(bytes)),
        "sha256" => hex::encode(sha2::Sha256::digest(bytes)),
        "sha512" => hex::encode(sha2::Sha512::digest(bytes)),
        "md5" => hex::encode(md5::Md5::digest(bytes)),
        _ => return None,
    })
}

pub fn verify(format: Option<&str>, expected: Option<&str>, bytes: &[u8], what: &str) -> AppResult<()> {
    let (Some(f), Some(e)) = (format, expected) else { return Ok(()) };
    match hash_hex(f, bytes) {
        Some(h) if !h.eq_ignore_ascii_case(e.trim()) => Err(AppError::Invalid(format!("Prüfsumme von {what} stimmt nicht – das Pack wurde vermutlich gerade geändert, bitte gleich noch einmal versuchen"))),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_links() {
        assert_eq!(github_raw("https://github.com/a/b/blob/main/pack.toml"), "https://raw.githubusercontent.com/a/b/main/pack.toml");
        assert_eq!(github_raw("https://github.com/a/b/blob/main/sub/pack.toml"), "https://raw.githubusercontent.com/a/b/main/sub/pack.toml");
        assert_eq!(github_raw("https://example.com/pack.toml"), "https://example.com/pack.toml");
    }

    #[test]
    fn join_and_hash() {
        let l = Loc::parse("https://example.com/packs/my/pack.toml").unwrap();
        assert_eq!(l.join("index.toml").unwrap().display(), "https://example.com/packs/my/index.toml");
        assert_eq!(l.join("mods/a b.pw.toml").unwrap().display(), "https://example.com/packs/my/mods/a%20b.pw.toml");
        assert!(l.join("../x").is_err());
        assert_eq!(hash_hex("sha1", b"abc").unwrap(), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert!(verify(Some("sha1"), Some("A9993E364706816ABA3E25717850C26C9CD0D89D"), b"abc", "x").is_ok());
        assert!(verify(Some("sha1"), Some("00"), b"abc", "x").is_err());
        assert!(verify(Some("murmur2"), Some("00"), b"abc", "x").is_ok());
    }
}
