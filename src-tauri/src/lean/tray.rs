use crate::state::AppState;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

const ID: &str = "lean";

pub(super) struct Texts {
    pub open: &'static str,
    pub console: &'static str,
    pub quit: &'static str,
    pub idle: &'static str,
    pub playing: &'static str,
    pub confirm_title: &'static str,
    pub confirm_text: &'static str,
    pub cancel: &'static str,
}

pub(super) fn texts(lang: &str) -> Texts {
    if lang.starts_with("de") {
        Texts {
            open: "Vibe Launcher öffnen",
            console: "Konsole öffnen",
            quit: "Beenden",
            idle: "Vibe Launcher",
            playing: "Vibe Launcher – Minecraft läuft",
            confirm_title: "Vibe Launcher beenden?",
            confirm_text: "Minecraft läuft noch. Das Spiel läuft weiter, aber Spielzeit, Logs, AFK und Absturzerkennung werden für diese Sitzung nicht mehr erfasst.",
            cancel: "Abbrechen",
        }
    } else {
        Texts {
            open: "Open Vibe Launcher",
            console: "Open console",
            quit: "Quit",
            idle: "Vibe Launcher",
            playing: "Vibe Launcher – Minecraft is running",
            confirm_title: "Quit Vibe Launcher?",
            confirm_text: "Minecraft is still running. The game keeps running, but play time, logs, AFK and crash detection stop for this session.",
            cancel: "Cancel",
        }
    }
}

fn sessions(state: &AppState) -> Vec<(String, String)> {
    state
        .game
        .states()
        .into_iter()
        .filter(|s| s.state == crate::minecraft::RunState::Running)
        .map(|s| {
            let name = state.instances.get(&s.instance_id).map(|i| i.name).unwrap_or_else(|_| s.instance_id.clone());
            let since = s.started_at.and_then(chrono::DateTime::from_timestamp_millis).map(|t| t.with_timezone(&chrono::Local).format("%H:%M").to_string());
            let slot = if s.slot > 1 { format!(" #{}", s.slot) } else { String::new() };
            let label = match since {
                Some(t) => format!("▶ {name}{slot} · {t}"),
                None => format!("▶ {name}{slot}"),
            };
            (s.run_id, label)
        })
        .collect()
}

fn menu(app: &AppHandle, state: &AppState) -> tauri::Result<Menu<Wry>> {
    let t = texts(&state.settings().language);
    let m = Menu::new(app)?;
    m.append(&MenuItem::with_id(app, "open", t.open, true, None::<&str>)?)?;
    m.append(&MenuItem::with_id(app, "console", t.console, true, None::<&str>)?)?;
    let runs = sessions(state);
    if !runs.is_empty() {
        m.append(&PredefinedMenuItem::separator(app)?)?;
        for (id, label) in runs {
            m.append(&MenuItem::with_id(app, format!("run:{id}"), label, true, None::<&str>)?)?;
        }
    }
    m.append(&PredefinedMenuItem::separator(app)?)?;
    m.append(&MenuItem::with_id(app, "quit", t.quit, true, None::<&str>)?)?;
    Ok(m)
}

fn tooltip(state: &AppState) -> &'static str {
    let t = texts(&state.settings().language);
    if state.game.any_running() {
        t.playing
    } else {
        t.idle
    }
}

pub(super) fn show(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else { return };
    if app.tray_by_id(ID).is_some() {
        refresh(app);
        return;
    }
    let mut b = TrayIconBuilder::with_id(ID).tooltip(tooltip(&state)).show_menu_on_left_click(false).on_menu_event(on_menu).on_tray_icon_event(|tray, ev| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
            super::show_main(tray.app_handle());
        }
    });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    match menu(app, &state) {
        Ok(m) => b = b.menu(&m),
        Err(e) => tracing::warn!("Tray-Menü: {e}"),
    }
    if let Err(e) = b.build(app) {
        tracing::warn!("Tray-Symbol nicht erstellt: {e}");
    }
}

pub(super) fn refresh(app: &AppHandle) {
    let (Some(state), Some(tray)) = (app.try_state::<AppState>(), app.tray_by_id(ID)) else { return };
    let _ = tray.set_tooltip(Some(tooltip(&state)));
    if let Ok(m) = menu(app, &state) {
        let _ = tray.set_menu(Some(m));
    }
}

pub(super) fn remove(app: &AppHandle) {
    let _ = app.remove_tray_by_id(ID);
}

fn on_menu(app: &AppHandle, ev: MenuEvent) {
    let id = ev.id().as_ref();
    match id {
        "open" => super::show_main(app),
        "console" => open_console(app, None),
        "quit" => quit(app),
        _ => {
            if let Some(run) = id.strip_prefix("run:") {
                open_console(app, Some(run.to_string()));
            }
        }
    }
}

fn open_console(app: &AppHandle, run: Option<String>) {
    let h = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = crate::console::open(&h, run.as_deref()) {
            tracing::warn!("{e}");
        }
    });
}

fn quit(app: &AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let Some(state) = app.try_state::<AppState>() else { return app.exit(0) };
    if !state.game.any_running() {
        return app.exit(0);
    }
    let t = texts(&state.settings().language);
    let h = app.clone();
    app.dialog()
        .message(t.confirm_text)
        .title(t.confirm_title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(t.quit.to_string(), t.cancel.to_string()))
        .show(move |ok| {
            if ok {
                h.exit(0);
            }
        });
}
