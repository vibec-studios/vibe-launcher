use std::collections::HashMap;

use crate::error::{Error, Result};

#[derive(Debug, Clone)]
pub struct Tensor {
    pub shape: Vec<usize>,
    pub data: Vec<f32>,
}

#[derive(Debug, Default)]
pub struct Weights {
    tensors: HashMap<String, Tensor>,
}

impl Weights {
    pub fn insert(&mut self, name: String, shape: Vec<usize>, data: Vec<f32>) {
        self.tensors.insert(name, Tensor { shape, data });
    }

    pub fn take(&mut self, name: &str, shape: &[usize]) -> Result<Vec<f32>> {
        let tensor = self.tensors.remove(name).ok_or_else(|| Error::tensor(name, "fehlt in weights.bin"))?;
        if tensor.shape != shape {
            return Err(Error::tensor(name, format!("hat Form {:?}, erwartet {:?}", tensor.shape, shape)));
        }
        Ok(tensor.data)
    }

    pub fn take_rows(&mut self, name: &str, columns: usize) -> Result<(usize, Vec<f32>)> {
        let tensor = self.tensors.get(name).ok_or_else(|| Error::tensor(name, "fehlt in weights.bin"))?;
        if tensor.shape.len() != 2 || tensor.shape[1] != columns {
            return Err(Error::tensor(name, format!("hat Form {:?}, erwartet [_, {columns}]", tensor.shape)));
        }
        let rows = tensor.shape[0];
        Ok((rows, self.take(name, &[rows, columns])?))
    }

    pub fn finish(self) -> Result<()> {
        let mut rest: Vec<&String> = self.tensors.keys().collect();
        rest.sort();
        match rest.first() {
            Some(name) => Err(Error::tensor(name, "wird von diesem Netz nicht verwendet (neuer Baustein?)")),
            None => Ok(()),
        }
    }
}
