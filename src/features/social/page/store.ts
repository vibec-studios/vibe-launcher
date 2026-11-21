import { create } from "zustand";

export type PageDialog = "add" | "share" | "import" | "blocked" | null;
export const usePageDialog = create<{ open: PageDialog }>(() => ({ open: null }));
export const openPageDialog = (open: PageDialog) => usePageDialog.setState({ open });
export const closePageDialog = () => usePageDialog.setState({ open: null });
