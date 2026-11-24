use crate::paths::Paths;
use crate::util::testdir::TestDir;
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};

mod install;
mod pack;
mod store;
mod validate;

pub(super) const JAR: &[u8] = b"PK-example-loader-jar";
pub(super) const PNG: &[u8] = b"\x89PNG\r\n\x1a\nexample";
pub(super) const ASM_SHA1: &str = "0123456789abcdef0123456789abcdef01234567";

pub(super) fn manifest() -> Value {
    json!({
        "format": "vibe-launcher-loader",
        "version": 1,
        "id": "example",
        "name": "Example Loader",
        "loader_version": "0.1.0",
        "description": "Ein erfundener Loader für Tests.",
        "author": "Example",
        "homepage": "https://example.com/loader",
        "icon": "icon.png",
        "minecraft": ["26.3", "26.2"],
        "mods": "fabric",
        "profile": {
            "mainClass": "com.example.loader.Main",
            "arguments": { "jvm": ["-Dexample.flag=true"], "game": [] },
            "libraries": [
                { "name": "com.example:example-loader:0.1.0", "file": "libraries/example-loader-0.1.0.jar" },
                { "name": "org.ow2.asm:asm:9.7", "url": "https://repo1.maven.org/maven2/org/ow2/asm/asm/9.7/asm-9.7.jar", "sha1": ASM_SHA1, "size": 123 }
            ]
        }
    })
}

pub(super) struct Env {
    pub dir: TestDir,
    pub paths: Paths,
}

impl Env {
    pub fn new(tag: &str) -> Self {
        let dir = TestDir::new(tag);
        let paths = Paths { root: dir.path().join("data") };
        Env { dir, paths }
    }

    pub fn zip(&self, name: &str, files: &[(&str, &[u8])]) -> PathBuf {
        write_zip(&self.dir.path().join(name), files)
    }

    pub fn pack(&self, m: &Value) -> PathBuf {
        let bytes = m.to_string();
        self.zip("pack.vibeloader", &[("vibeloader.json", bytes.as_bytes()), ("icon.png", PNG), ("libraries/example-loader-0.1.0.jar", JAR)])
    }
}

pub(super) fn write_zip(path: &Path, files: &[(&str, &[u8])]) -> PathBuf {
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    for (name, data) in files {
        z.start_file(*name, o).unwrap();
        z.write_all(data).unwrap();
    }
    z.finish().unwrap();
    path.to_path_buf()
}

pub(super) fn sha1(b: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    hex::encode(Sha1::digest(b))
}
