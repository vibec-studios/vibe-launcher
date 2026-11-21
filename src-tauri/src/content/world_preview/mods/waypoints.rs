use serde::Serialize;
use std::collections::HashSet;

pub const MAX_WAYPOINTS: usize = 1000;

const COLORS: [[u8; 3]; 20] = [
    [0x00, 0x00, 0x00],
    [0x00, 0x00, 0xAA],
    [0x00, 0xAA, 0x00],
    [0x00, 0xAA, 0xAA],
    [0xAA, 0x00, 0x00],
    [0xAA, 0x00, 0xAA],
    [0xFF, 0xAA, 0x00],
    [0xAA, 0xAA, 0xAA],
    [0x55, 0x55, 0x55],
    [0x55, 0x55, 0xFF],
    [0x55, 0xFF, 0x55],
    [0x55, 0xFF, 0xFF],
    [0xFF, 0x55, 0x55],
    [0xFF, 0x55, 0xFF],
    [0xFF, 0xFF, 0x55],
    [0xFF, 0xFF, 0xFF],
    [0xC7, 0x4E, 0xBD],
    [0x3A, 0xB3, 0xDA],
    [0x80, 0xC7, 0x1F],
    [0xF3, 0x8B, 0xAA],
];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Waypoint {
    pub name: String,
    pub initials: String,
    pub x: i32,
    pub y: Option<i32>,
    pub z: i32,
    pub color: String,
    pub death: bool,
}

pub fn parse(text: &str, out: &mut Vec<Waypoint>, seen: &mut HashSet<(String, i32, i32)>) {
    for line in text.lines() {
        if out.len() >= MAX_WAYPOINTS {
            return;
        }
        if let Some(point) = line_waypoint(line.trim_end_matches('\r')) {
            if seen.insert((point.name.clone(), point.x, point.z)) {
                out.push(point);
            }
        }
    }
}

fn line_waypoint(line: &str) -> Option<Waypoint> {
    let fields: Vec<&str> = line.strip_prefix("waypoint:")?.split(':').collect();
    if fields.len() < 9 || fields[6] == "true" {
        return None;
    }
    let text = |value: &str| {
        value
            .replace("§§", ":")
            .chars()
            .filter(|c| !c.is_control())
            .take(64)
            .collect::<String>()
    };
    let coordinate = |value: &str| {
        value
            .parse::<i32>()
            .ok()
            .filter(|v| v.unsigned_abs() <= 30_000_000)
    };
    let color = fields[5]
        .parse::<usize>()
        .ok()
        .map_or(COLORS[15], |index| COLORS[index % COLORS.len()]);
    Some(Waypoint {
        name: text(fields[0]),
        initials: text(fields[1]).chars().take(3).collect(),
        x: coordinate(fields[2])?,
        y: fields[3].parse().ok(),
        z: coordinate(fields[4])?,
        color: format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2]),
        death: matches!(fields[7], "1" | "2"),
    })
}

pub fn file_matches(name: &str, multiworld: Option<&str>) -> bool {
    let Some(stem) = name.strip_suffix(".txt") else {
        return false;
    };
    match multiworld {
        Some(mw) => stem
            .strip_prefix(mw)
            .is_some_and(|rest| rest.starts_with('_')),
        None => stem == "waypoints" || stem.contains('_'),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_map_waypoints_parse_names_colors_and_skip_disabled() {
        let text = "#\nsets:gui.xaero_default\nwaypoint:Base§§ Haus:B:-24:64:209:6:false:0:gui.xaero_default:false:0:0:false\nwaypoint:Tod:X:5:~:7:12:false:1:gui.xaero_default:false:0:0:false\nwaypoint:Aus:A:1:2:3:0:true:0:gui.xaero_default:false:0:0:false\nwaypoint:kaputt:k:a:1:2:0:false:0:x\n";
        let mut out = Vec::new();
        parse(text, &mut out, &mut HashSet::new());
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name, "Base: Haus");
        assert_eq!((out[0].x, out[0].y, out[0].z), (-24, Some(64), 209));
        assert_eq!(out[0].color, "#ffaa00");
        assert!(!out[0].death);
        assert_eq!(out[1].y, None);
        assert!(out[1].death);
        assert!(file_matches("mw$default_1.txt", Some("mw$default")));
        assert!(!file_matches("mw$other_1.txt", Some("mw$default")));
        assert!(file_matches("waypoints.txt", None));
    }
}
