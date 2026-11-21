use super::*;

impl Appearance {
    /// Unbekannte Werte auf Standard zurücksetzen, Zahlen begrenzen, eigene Themes bereinigen.
    pub fn sanitize(&mut self) {
        self.sanitize_values();
        theme::sanitize(self);
    }

    /// Wie `sanitize`, aber ohne die Liste der eigenen Themes.
    pub(crate) fn sanitize_values(&mut self) {
        let d = Appearance::default();
        let pick = |v: &mut String, allowed: &[&str], def: &str| {
            if !allowed.contains(&v.as_str()) {
                *v = def.to_string();
            }
        };
        fix_hex(&mut self.accent, &d.accent);
        pick(
            &mut self.theme,
            THEME_IDS,
            &d.theme,
        );
        pick(&mut self.design, &["v1", "v2"], &d.design);
        pick(&mut self.app_icon, crate::platform::app_icon::MOTIFS, &d.app_icon);
        fix_hex(&mut self.app_icon_color, &d.app_icon_color);
        pick(&mut self.font, &["inter", "inter_tight", "system", "mono"], &d.font);
        pick(&mut self.headings, &["default", "pixel", "pixel_all"], &d.headings);
        self.font_scale = self.font_scale.clamp(90, 115);
        pick(&mut self.contrast, &["normal", "high"], &d.contrast);
        pick(&mut self.cards, &["flat", "outlined", "raised", "pixel"], &d.cards);
        self.glass = self.glass.min(100);
        pick(&mut self.icon_size, &["large", "small"], &d.icon_size);
        pick(&mut self.library_view, &["grid", "list"], &d.library_view);
        pick(&mut self.motion, &["normal", "more"], &d.motion);
        pick(&mut self.sidebar.mode, &["compact", "wide"], &d.sidebar.mode);
        pick(&mut self.sidebar.style, &["solid", "floating", "tinted"], &d.sidebar.style);
        // Reihenfolge: nur bekannte Einträge, jeder genau einmal; fehlende hinten anhängen
        let mut order: Vec<String> = Vec::new();
        for k in self.sidebar.order.iter().chain(d.sidebar.order.iter()) {
            if NAV_KEYS.contains(&k.as_str()) && !order.contains(k) {
                order.push(k.clone());
            }
        }
        self.sidebar.order = order;
        // „Start“ bleibt immer sichtbar
        let mut hidden: Vec<String> = Vec::new();
        for k in &self.sidebar.hidden {
            if NAV_KEYS.contains(&k.as_str()) && k != "home" && !hidden.contains(k) {
                hidden.push(k.clone());
            }
        }
        self.sidebar.hidden = hidden;
        fix_hex(&mut self.status.ok, &d.status.ok);
        fix_hex(&mut self.status.warn, &d.status.warn);
        fix_hex(&mut self.status.danger, &d.status.danger);
        self.effects.snow_amount = self.effects.snow_amount.clamp(10, 100);
        pick(&mut self.tone, &["dark", "dim", "oled", "light"], &d.tone);
        pick(&mut self.radius, &["square", "slight", "round", "custom"], &d.radius);
        self.radius_px = self.radius_px.min(24);
        pick(&mut self.density, &["compact", "normal"], &d.density);
        self.ui_scale = self.ui_scale.clamp(80, 130);
        let b = &mut self.background;
        let db = Background::default();
        pick(&mut b.kind, &["none", "color", "gradient", "image", "animated"], &db.kind);
        pick(&mut b.gradient, &["accent", "dusk", "ocean", "ember", "forest", "pixel", "custom"], &db.gradient);
        fix_hex(&mut b.color, &db.color);
        fix_hex(&mut b.gradient_from, &db.gradient_from);
        fix_hex(&mut b.gradient_to, &db.gradient_to);
        b.gradient_angle = b.gradient_angle.min(360);
        pick(&mut b.animated, &["aurora", "particles", "waves", "blocks", "custom"], &db.animated);
        b.dim = b.dim.min(90);
        b.blur = b.blur.min(40);
    }
}

/// Hex-Farbe normalisieren ("FF00AA" -> "#ff00aa"), ungültig -> Standard.
pub(super) fn fix_hex(v: &mut String, def: &str) {
    let hex = v.trim_start_matches('#');
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        *v = def.to_string();
    } else {
        *v = format!("#{}", hex.to_ascii_lowercase());
    }
}
