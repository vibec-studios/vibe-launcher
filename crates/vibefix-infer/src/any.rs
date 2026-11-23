use std::path::Path;

use serde_json::{json, Map, Value};

use crate::error::{Error, Result};
use crate::package::{package_version, read_file};
use crate::v2::Model2;
use crate::v3::Model3;
use crate::{bound_text, Analysis, LogFile, Model};

pub enum AnyModel {
    V1(Box<Model>),
    V2(Box<Model2>),
    V3(Box<Model3>),
}

fn bounded(files: &[LogFile]) -> Vec<LogFile> {
    files
        .iter()
        .map(|f| LogFile { kind: f.kind.clone(), name: f.name.clone(), text: bound_text(&f.text).into_owned() })
        .collect()
}

impl AnyModel {
    pub fn load(directory: impl AsRef<Path>) -> Result<Self> {
        let dir = directory.as_ref();
        let config = read_file(dir, "config.json")?;
        let tokenizer = read_file(dir, "tokenizer.json")?;
        let weights = read_file(dir, "weights.bin")?;
        Self::from_bytes(&config, &tokenizer, &weights)
    }

    pub fn from_bytes(config: &[u8], tokenizer: &[u8], weights: &[u8]) -> Result<Self> {
        Ok(match package_version(config)? {
            1 => AnyModel::V1(Box::new(Model::from_bytes(config, tokenizer, weights)?)),
            2 => AnyModel::V2(Box::new(Model2::from_bytes(config, tokenizer, weights)?)),
            _ => AnyModel::V3(Box::new(Model3::from_bytes(config, tokenizer, weights)?)),
        })
    }

    pub fn version(&self) -> u32 {
        match self {
            AnyModel::V1(_) => 1,
            AnyModel::V2(_) => 2,
            AnyModel::V3(_) => 3,
        }
    }

    pub fn set_profile(&mut self, name: Option<&str>) -> Result<()> {
        match self {
            AnyModel::V2(model) => model.set_profile(name),
            _ if name.is_some_and(|name| !name.is_empty()) => {
                Err(Error::Package(format!("VibeFix v{} unterstützt keine Profile", self.version())))
            }
            _ => Ok(()),
        }
    }

    pub fn analyze_with_meta(&self, files: &[LogFile], meta: Option<&Map<String, Value>>) -> Analysis {
        match self {
            AnyModel::V1(model) => model.analyze_exact(&bounded(files)),
            AnyModel::V2(model) => model.analyze_with_meta(&bounded(files), meta),
            AnyModel::V3(model) => model.analyze_with_meta(files, meta),
        }
    }

    pub fn analyze(&self, files: &[LogFile]) -> Analysis {
        self.analyze_with_meta(files, None)
    }

    pub fn predict(&self, files: &[LogFile]) -> Value {
        match self {
            AnyModel::V1(model) => json!(model.predict(&bounded(files))),
            AnyModel::V2(model) => json!(model.predict(&bounded(files), None)),
            AnyModel::V3(model) => json!(model.predict(files, None)),
        }
    }
}
