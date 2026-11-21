use super::files::AfkEvent;
use regex::Regex;
use std::sync::LazyLock;

const DEATH_WORDS: &[&str] = &[
    "died", "was slain", "was shot", "was killed", "was blown up", "blew up", "fell ", "fell off", "drowned", "burned", "went up in flames",
    "tried to swim in lava", "hit the ground", "starved", "suffocated", "was squashed", "was pricked", "was impaled", "was fireballed",
    "was stung", "was poked", "withered away", "froze to death", "experienced kinetic energy", "was struck by lightning", "walked into",
    "was squished", "discovered the floor was lava", "was obliterated", "was skewered", "didn't want to live", "left the confines",
];

static SENDER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:\[[^\]]{1,24}\]\s*)*<([A-Za-z0-9_]{1,16})>\s?(.*)$").unwrap());
static WHISPER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([A-Za-z0-9_]{1,16}) whispers(?: to you)?: (.*)$").unwrap());
static FORMAT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\u{a7}[0-9a-fk-orA-FK-OR]").unwrap());
static KICK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:client disconnected with reason|disconnected from server|kicked (?:from|by)|lost connection)[:\s]*(.*)$").unwrap()
});

pub fn chat_text(line: &str) -> Option<String> {
    let i = line.find("[CHAT] ")?;
    let text = FORMAT.replace_all(line[i + 7..].trim_end(), "").to_string();
    (!text.trim().is_empty()).then_some(text)
}

fn mentions(text: &str, words: &[String]) -> bool {
    let lower = text.to_lowercase();
    words.iter().filter(|w| w.len() >= 3).any(|w| {
        let w = w.to_lowercase();
        lower.match_indices(&w).any(|(i, _)| {
            let before = lower[..i].chars().next_back();
            let after = lower[i + w.len()..].chars().next();
            !before.is_some_and(|c| c.is_alphanumeric() || c == '_') && !after.is_some_and(|c| c.is_alphanumeric() || c == '_')
        })
    })
}

fn is_death(text: &str, own: &str) -> bool {
    let Some(rest) = text.strip_prefix(own) else { return false };
    rest.starts_with(' ') && DEATH_WORDS.iter().any(|w| rest.contains(w))
}

pub fn scan(line: &str, own: Option<&str>, words: &[String], ts: i64) -> Vec<AfkEvent> {
    let mut out = Vec::new();
    if let Some(text) = chat_text(line) {
        let mut ev = AfkEvent::new(ts, "chat").with("text", text.clone()).with("source", "log");
        if let Some(c) = SENDER.captures(&text) {
            let sender = c[1].to_string();
            let from_me = own.is_some_and(|o| o.eq_ignore_ascii_case(&sender));
            ev = ev.with("sender", sender).with("kind", "chat");
            if !from_me && mentions(&c[2], words) {
                out.push(AfkEvent::new(ts, "mention").with("text", text.clone()).with("sender", c[1].to_string()).with("source", "log"));
            }
        } else if let Some(c) = WHISPER.captures(&text) {
            ev = ev.with("sender", c[1].to_string()).with("kind", "whisper");
            out.push(AfkEvent::new(ts, "whisper").with("text", text.clone()).with("sender", c[1].to_string()).with("source", "log"));
        } else {
            ev = ev.with("kind", "system");
            if own.is_some_and(|o| is_death(&text, o)) {
                out.push(AfkEvent::new(ts, "death").with("message", text.clone()).with("source", "log"));
            }
        }
        out.insert(0, ev);
        return out;
    }
    if let Some(c) = KICK.captures(line) {
        let reason = FORMAT.replace_all(c[1].trim(), "").to_string();
        let mut ev = AfkEvent::new(ts, "disconnect").with("source", "log");
        if !reason.is_empty() {
            ev = ev.with("reason", reason.chars().take(300).collect::<String>());
        }
        out.push(ev);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(v: &[AfkEvent]) -> Vec<&str> {
        v.iter().map(|e| e.kind.as_str()).collect()
    }

    #[test]
    fn chat_lines_from_modern_and_old_logs() {
        let w = vec!["Steve".to_string()];
        let a = scan("[System] [CHAT] <Alex> hallo steve!", Some("Steve"), &w, 1);
        assert_eq!(kinds(&a), vec!["chat", "mention"]);
        assert_eq!(a[0].str("sender"), Some("Alex"));
        assert_eq!(a[0].str("text"), Some("<Alex> hallo steve!"));
        let b = scan("[CHAT] <Steve> ich bin afk", Some("Steve"), &w, 1);
        assert_eq!(kinds(&b), vec!["chat"]);
        let c = scan("[CHAT] <Alex> steveo ist toll", Some("Steve"), &w, 1);
        assert_eq!(kinds(&c), vec!["chat"]);
        let d = scan("[CHAT] \u{a7}7[Admin] <Alex> \u{a7}fHi", Some("Steve"), &w, 1);
        assert_eq!(d[0].str("text"), Some("[Admin] <Alex> Hi"));
        assert_eq!(d[0].str("sender"), Some("Alex"));
    }

    #[test]
    fn whisper_death_and_system() {
        let w = vec!["Steve".to_string()];
        let a = scan("[CHAT] Alex whispers to you: komm mal", Some("Steve"), &w, 1);
        assert_eq!(kinds(&a), vec!["chat", "whisper"]);
        assert_eq!(a[0].str("kind"), Some("whisper"));
        let b = scan("[CHAT] Steve was slain by Zombie", Some("Steve"), &w, 1);
        assert_eq!(kinds(&b), vec!["chat", "death"]);
        let c = scan("[CHAT] Alex was slain by Zombie", Some("Steve"), &w, 1);
        assert_eq!(kinds(&c), vec!["chat"]);
        let d = scan("[CHAT] Steve joined the game", Some("Steve"), &w, 1);
        assert_eq!(kinds(&d), vec!["chat"]);
    }

    #[test]
    fn kick_lines_and_noise() {
        let a = scan("Client disconnected with reason: Du wurdest wegen AFK gekickt", None, &[], 1);
        assert_eq!(kinds(&a), vec!["disconnect"]);
        assert_eq!(a[0].str("reason"), Some("Du wurdest wegen AFK gekickt"));
        assert!(scan("Loaded 127 recipes", None, &[], 1).is_empty());
        assert!(scan("[CHAT]    ", None, &[], 1).is_empty());
    }
}
