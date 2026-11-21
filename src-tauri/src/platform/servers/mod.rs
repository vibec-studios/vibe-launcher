//! Server-Liste (`servers.dat`, unkomprimiertes NBT) lesen/schreiben und Server per
//! Server-List-Ping (SLP, Protokoll ab 1.7) abfragen.
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

mod nbt;
mod list;
mod address;
mod ping;

pub use nbt::*;
pub use list::*;
pub use address::*;
pub use ping::*;

#[cfg(test)]
mod tests;
