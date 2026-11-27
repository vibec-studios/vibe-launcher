import { call } from "./call";
import type * as T from "../types";

export const ticketsApi = {
  ticketsLocal: () => call<T.LocalTicket[]>("tickets_local"),
  ticketsList: (background: boolean) => call<T.TicketList>("tickets_list", { background }),
  ticketGet: (ticket: string, after: number | null) => call<T.TicketDetail>("ticket_get", { ticket, after }),
  ticketRead: (ticket: string) => call<void>("ticket_read", { ticket }),
  ticketReply: (ticket: string, body: string, fulfills: string[]) => call<T.TicketPosted>("ticket_reply", { ticket, body, fulfills }),
  ticketReplyPreview: (draft: T.TicketReplyDraft) => call<T.TicketReplyPreview>("ticket_reply_preview", { draft }),
  ticketReplySend: (token: string) => call<T.TicketPosted>("ticket_reply_send", { token }),
  ticketAttachment: (ticket: string, id: string) => call<T.TicketAttachmentData>("ticket_attachment", { ticket, id }),
  ticketReportChat: (report: T.ChatReportDraft) => call<{ id: string; ticket: string }>("ticket_report_chat", { report }),
};
