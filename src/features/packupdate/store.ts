import { create } from "zustand";
import type { Instance } from "@/lib/types";
import type { PackInput } from "./api";

type State = { pick: Instance | null; preview: { instance: Instance; input: PackInput } | null };

export const usePackUpdate = create<State>(() => ({ pick: null, preview: null }));

export const openPackUpdate = (instance: Instance) => usePackUpdate.setState({ pick: instance, preview: null });
export const openPackPreview = (instance: Instance, input: PackInput) => usePackUpdate.setState({ pick: null, preview: { instance, input } });
export const closePackUpdate = () => usePackUpdate.setState({ pick: null, preview: null });
