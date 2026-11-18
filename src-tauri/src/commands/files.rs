//! Datei-Bereich einer Instanz bzw. eines lokalen Servers (siehe `crate::files`). Alle Zugriffe laufen
//! blockierend in `spawn_blocking`; jeder Pfad wird in der Sandbox der jeweiligen Wurzel geprüft.
use crate::error::{AppError, AppResult};
use crate::files::validate::{self, ValidationError};
use crate::files::{ops, DeleteOutcome, FileContent, FileEntry, FileRoot, FileScope, FindResult, SearchResult};
use crate::state::AppState;
use tauri::State;

fn root(state: &AppState, scope: &FileScope) -> AppResult<FileRoot> {
    Ok(match scope {
        FileScope::Instance(id) => {
            state.instances.get(id)?;
            FileRoot::instance(&state.paths, id)
        }
        FileScope::Server(id) => {
            state.servers.get(id)?;
            FileRoot::server(&state.paths, id)
        }
    })
}

async fn run<T: Send + 'static>(state: &AppState, scope: FileScope, f: impl FnOnce(&FileRoot) -> AppResult<T> + Send + 'static) -> AppResult<T> {
    let r = root(state, &scope)?;
    tokio::task::spawn_blocking(move || f(&r)).await?
}

/// Direkte Einträge eines Ordners (`dir` leer = Hauptordner).
#[tauri::command]
pub async fn files_list(state: State<'_, AppState>, scope: FileScope, dir: String) -> AppResult<Vec<FileEntry>> {
    run(&state, scope, move |r| ops::list_dir(r, &dir)).await
}

#[tauri::command]
pub async fn files_stat(state: State<'_, AppState>, scope: FileScope, path: String) -> AppResult<FileEntry> {
    run(&state, scope, move |r| ops::stat(r, &path)).await
}

/// Namenssuche im ganzen Ordner (höchstens 500 Treffer).
#[tauri::command]
pub async fn files_find(state: State<'_, AppState>, scope: FileScope, query: String) -> AppResult<FindResult> {
    run(&state, scope, move |r| ops::find(r, &query)).await
}

/// Volltextsuche in Textdateien bis 1 MB (höchstens 200 Treffer), optional nur unter `dir`.
#[tauri::command]
pub async fn files_search(state: State<'_, AppState>, scope: FileScope, query: String, dir: Option<String>) -> AppResult<SearchResult> {
    run(&state, scope, move |r| ops::search(r, &query, dir.as_deref())).await
}

#[tauri::command]
pub async fn files_read(state: State<'_, AppState>, scope: FileScope, path: String) -> AppResult<FileContent> {
    run(&state, scope, move |r| ops::read(r, &path)).await
}

/// Speichert (vorher Sicherung der alten Fassung, höchstens 10 je Datei) und liefert die neue Fassung.
#[tauri::command]
pub async fn files_write(state: State<'_, AppState>, scope: FileScope, path: String, content: String) -> AppResult<FileContent> {
    run(&state, scope, move |r| ops::write(r, &path, &content)).await
}

/// Letzte Sicherung zurückspielen (die aktuelle Fassung wird dabei selbst gesichert).
#[tauri::command]
pub async fn files_restore(state: State<'_, AppState>, scope: FileScope, path: String) -> AppResult<FileContent> {
    run(&state, scope, move |r| ops::restore(r, &path)).await
}

#[tauri::command]
pub async fn files_validate(path: String, content: String) -> AppResult<Vec<ValidationError>> {
    Ok(tokio::task::spawn_blocking(move || validate::validate(&path, &content)).await?)
}

/// Bildvorschau als data-URL (bis 16 MB).
#[tauri::command]
pub async fn files_image(state: State<'_, AppState>, scope: FileScope, path: String) -> AppResult<String> {
    run(&state, scope, move |r| ops::image_data_url(r, &path)).await
}

#[tauri::command]
pub async fn files_create(state: State<'_, AppState>, scope: FileScope, dir: String, name: String, is_dir: bool) -> AppResult<String> {
    run(&state, scope, move |r| ops::create(r, &dir, &name, is_dir)).await
}

#[tauri::command]
pub async fn files_rename(state: State<'_, AppState>, scope: FileScope, path: String, new_name: String) -> AppResult<String> {
    run(&state, scope, move |r| ops::rename(r, &path, &new_name)).await
}

#[tauri::command]
pub async fn files_duplicate(state: State<'_, AppState>, scope: FileScope, path: String) -> AppResult<String> {
    run(&state, scope, move |r| ops::duplicate(r, &path)).await
}

/// In den Papierkorb (bzw. mit `permanent` endgültig).
#[tauri::command]
pub async fn files_delete(state: State<'_, AppState>, scope: FileScope, paths: Vec<String>, permanent: bool) -> AppResult<DeleteOutcome> {
    run(&state, scope, move |r| ops::delete(r, &paths, permanent)).await
}

/// Externe Dateien/Ordner (Drag & Drop, Dateidialog) in einen Ordner kopieren.
#[tauri::command]
pub async fn files_import(state: State<'_, AppState>, scope: FileScope, dir: String, sources: Vec<String>) -> AppResult<Vec<String>> {
    run(&state, scope, move |r| ops::import(r, &dir, &sources)).await
}

/// Absoluter Pfad (zum Kopieren).
#[tauri::command]
pub async fn files_abs_path(state: State<'_, AppState>, scope: FileScope, path: String) -> AppResult<String> {
    run(&state, scope, move |r| Ok(ops::abs_path(r, &path)?.to_string_lossy().to_string())).await
}

/// Im Explorer zeigen: Dateien markiert im Elternordner, Ordner (und der Hauptordner) geöffnet.
#[tauri::command]
pub async fn files_reveal(state: State<'_, AppState>, scope: FileScope, path: String) -> AppResult<()> {
    let p = run(&state, scope, move |r| ops::abs_path(r, &path)).await?;
    if p.is_dir() {
        crate::util::open_in_explorer(&p)
    } else {
        tauri_plugin_opener::reveal_item_in_dir(&p).map_err(|e| AppError::msg(e.to_string()))
    }
}
