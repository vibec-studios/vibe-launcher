use super::*;

// ------------------------------------------------------------------ Versionen

#[derive(Debug, Clone, PartialEq)]
pub(super) struct Ver {
    pub(super) nums: Vec<u64>,
    pub(super) pre: bool,
}

pub(super) fn parse_ver(s: &str) -> Option<Ver> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    let s = s.split('+').next()?;
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) => (c, !p.is_empty()),
        None => (s, false),
    };
    let mut nums = Vec::new();
    for part in core.split('.') {
        let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() {
            if nums.is_empty() {
                return None;
            }
            break;
        }
        nums.push(digits.parse().ok()?);
        if digits.len() != part.len() {
            break;
        }
    }
    if nums.is_empty() {
        return None;
    }
    Some(Ver { nums, pre })
}

pub(super) fn cmp_ver(a: &Ver, b: &Ver) -> Ordering {
    let n = a.nums.len().max(b.nums.len());
    for i in 0..n {
        let x = a.nums.get(i).copied().unwrap_or(0);
        let y = b.nums.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => {}
            o => return o,
        }
    }
    match (a.pre, b.pre) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => Ordering::Equal,
    }
}

/// Ein Fabric-Einzelausdruck (ohne Leerzeichen).
pub(super) fn fabric_term(term: &str, v: &Ver) -> Option<bool> {
    let term = term.trim();
    if term.is_empty() || term == "*" {
        return Some(true);
    }
    for op in [">=", "<=", ">", "<", "=", "~", "^"] {
        if let Some(rest) = term.strip_prefix(op) {
            if rest.contains(['x', 'X', '*']) {
                return wildcard(rest, v);
            }
            let t = parse_ver(rest)?;
            let o = cmp_ver(v, &t);
            return Some(match op {
                ">=" => o != Ordering::Less,
                "<=" => o != Ordering::Greater,
                ">" => o == Ordering::Greater,
                "<" => o == Ordering::Less,
                "=" => o == Ordering::Equal,
                "~" => {
                    // gleiche Major.Minor, mindestens t
                    o != Ordering::Less && v.nums.first() == t.nums.first() && v.nums.get(1).copied().unwrap_or(0) == t.nums.get(1).copied().unwrap_or(0)
                }
                _ => o != Ordering::Less && v.nums.first() == t.nums.first(),
            });
        }
    }
    if term.contains(['x', 'X', '*']) {
        return wildcard(term, v);
    }
    let t = parse_ver(term)?;
    Some(cmp_ver(v, &t) == Ordering::Equal)
}

/// `1.20.x` – alle angegebenen Stellen müssen passen.
pub(super) fn wildcard(pattern: &str, v: &Ver) -> Option<bool> {
    for (i, part) in pattern.split('.').enumerate() {
        if matches!(part, "x" | "X" | "*") {
            return Some(true);
        }
        let n: u64 = part.parse().ok()?;
        if v.nums.get(i).copied().unwrap_or(0) != n {
            return Some(false);
        }
    }
    Some(true)
}

pub(super) fn maven_range(range: &str, v: &Ver) -> Option<bool> {
    let r = range.trim();
    if !(r.starts_with('[') || r.starts_with('(')) {
        // Einfache Angabe = „empfohlen“, gilt als Mindestversion
        let t = parse_ver(r)?;
        return Some(cmp_ver(v, &t) != Ordering::Less);
    }
    // Mehrere Bereiche: "[1,2),[3,)"
    let mut any = false;
    let mut decided = false;
    let mut rest = r;
    while let Some(start) = rest.find(['[', '(']) {
        let end = rest[start..].find([']', ')'])? + start;
        let part = &rest[start..=end];
        rest = &rest[end + 1..];
        let inclusive_lo = part.starts_with('[');
        let inclusive_hi = part.ends_with(']');
        let inner = &part[1..part.len() - 1];
        let (lo, hi) = match inner.split_once(',') {
            Some((a, b)) => (a.trim(), b.trim()),
            None => (inner.trim(), inner.trim()),
        };
        let mut ok = true;
        if !lo.is_empty() {
            let t = parse_ver(lo)?;
            let o = cmp_ver(v, &t);
            ok &= if inclusive_lo { o != Ordering::Less } else { o == Ordering::Greater };
        }
        if !hi.is_empty() {
            let t = parse_ver(hi)?;
            let o = cmp_ver(v, &t);
            ok &= if inclusive_hi { o != Ordering::Greater } else { o == Ordering::Less };
        }
        decided = true;
        any |= ok;
    }
    decided.then_some(any)
}

/// Erfüllt `version` den Bereich? `None` = nicht auswertbar.
pub fn satisfies(range: &str, version: &str) -> Option<bool> {
    let v = parse_ver(version)?;
    let r = range.trim();
    if r.is_empty() || r == "*" {
        return Some(true);
    }
    if r.starts_with('[') || r.starts_with('(') {
        return maven_range(r, &v);
    }
    let mut undecided = false;
    for alt in r.split("||") {
        let mut all = Some(true);
        for term in alt.split_whitespace() {
            match fabric_term(term, &v) {
                Some(true) => {}
                Some(false) => {
                    all = Some(false);
                    break;
                }
                None => all = None,
            }
        }
        match all {
            Some(true) => return Some(true),
            None => undecided = true,
            Some(false) => {}
        }
    }
    if undecided {
        None
    } else {
        Some(false)
    }
}
