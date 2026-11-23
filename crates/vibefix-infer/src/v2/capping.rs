use std::borrow::Cow;

use serde::Deserialize;

use crate::host::context::file_order;
use crate::LogFile;

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Budget {
    pub limit: usize,
    pub head: usize,
    pub total: usize,
    pub minimum: usize,
}

impl Default for Budget {
    fn default() -> Self {
        Self { limit: 400_000, head: 100_000, total: 600_000, minimum: 24_000 }
    }
}

fn byte_at(text: &str, chars: usize) -> usize {
    text.char_indices().nth(chars).map_or(text.len(), |(i, _)| i)
}

pub fn cap_text(text: &str, limit: usize, head: usize) -> Cow<'_, str> {
    let length = text.chars().count();
    if length <= limit {
        return Cow::Borrowed(text);
    }
    let head = head.min(limit / 4);
    let head_byte = byte_at(text, head);
    let cut = text[..head_byte].rfind('\n').map_or(head_byte, |i| i + 1);
    let from_char = length - (limit - head);
    let from_byte = byte_at(text, from_char);
    let start = text[from_byte..].find('\n').map_or(from_byte, |i| from_byte + i + 1);
    if start <= cut {
        return Cow::Borrowed(text);
    }
    let gap = text[cut..start].matches('\n').count();
    let mut out = String::with_capacity(cut + gap + text.len() - start);
    out.push_str(&text[..cut]);
    out.extend(std::iter::repeat('\n').take(gap));
    out.push_str(&text[start..]);
    Cow::Owned(out)
}

pub fn cap_files(files: &[LogFile], budget: &Budget) -> Vec<LogFile> {
    let sizes: Vec<usize> = files.iter().map(|f| f.text.chars().count()).collect();
    let total: usize = sizes.iter().sum();
    if files.is_empty() || (total <= budget.total && sizes.iter().max().copied().unwrap_or(0) <= budget.limit) {
        return files.to_vec();
    }
    let mut order: Vec<usize> = (0..files.len()).collect();
    order.sort_by_key(|&i| (file_order(&files[i].kind), i));
    let mut shares = vec![0; files.len()];
    let mut remaining = budget.total;
    for i in order {
        let share = budget.minimum.max(budget.limit.min(remaining));
        shares[i] = share;
        remaining = remaining.saturating_sub(sizes[i].min(share));
    }
    files
        .iter()
        .zip(shares)
        .map(|(f, share)| LogFile {
            kind: f.kind.clone(),
            name: f.name.clone(),
            text: cap_text(&f.text, share, budget.head).into_owned(),
        })
        .collect()
}
