use crate::error::AppResult;
use crate::state::AppState;
use crate::tickets::{self, AttachmentData, ChatReport, Created, LocalTicket, ReplyDraft, ReplyPreview, TicketList, TicketResult};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn tickets_local(state: State<'_, AppState>) -> AppResult<Vec<LocalTicket>> {
    let st = state.inner().clone();
    Ok(tokio::task::spawn_blocking(move || tickets::local(&st)).await?)
}

#[tauri::command]
pub async fn tickets_list(state: State<'_, AppState>, background: bool) -> TicketResult<TicketList> {
    tickets::list(&state, background).await
}

#[tauri::command]
pub async fn ticket_get(state: State<'_, AppState>, ticket: String, after: Option<i64>) -> TicketResult<Value> {
    tickets::get(&state, &ticket, after).await
}

#[tauri::command]
pub async fn ticket_read(state: State<'_, AppState>, ticket: String) -> TicketResult<()> {
    tickets::read(&state, &ticket).await
}

#[tauri::command]
pub async fn ticket_reply(state: State<'_, AppState>, ticket: String, body: String, fulfills: Vec<String>) -> TicketResult<Value> {
    tickets::reply_text(&state, &ticket, &body, &fulfills).await
}

#[tauri::command]
pub async fn ticket_reply_preview(state: State<'_, AppState>, draft: ReplyDraft) -> AppResult<ReplyPreview> {
    let st = state.inner().clone();
    tokio::task::spawn_blocking(move || tickets::prepare_reply(&st, &draft)).await?
}

#[tauri::command]
pub async fn ticket_reply_send(state: State<'_, AppState>, token: String) -> TicketResult<Value> {
    tickets::send_reply(&state, &token).await
}

#[tauri::command]
pub async fn ticket_attachment(state: State<'_, AppState>, ticket: String, id: String) -> TicketResult<AttachmentData> {
    tickets::attachment(&state, &ticket, &id).await
}

#[tauri::command]
pub async fn ticket_report_chat(state: State<'_, AppState>, report: ChatReport) -> TicketResult<Created> {
    tickets::report_chat(&state, &report).await
}
