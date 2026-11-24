import { useState, type ReactNode } from "react";
import { create } from "zustand";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { Button, Dialog, toast } from "@/components/ui";
import { t as tt, useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatBytes, loaderNames } from "@/lib/format";
import type { CustomLoaderPreview } from "@/lib/types";
import { issueText, refreshCustomLoaders } from "./api";
import { PackIcon } from "./LoaderBadge";

interface ImportState {
  path: string | null;
  preview: CustomLoaderPreview | null;
  close: () => void;
}

const useImport = create<ImportState>((set) => ({ path: null, preview: null, close: () => set({ path: null, preview: null }) }));

export async function pickCustomLoader() {
  let path: string | null = null;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, directory: false, title: tt("cl.import.pick"), filters: [{ name: tt("cl.import.filter"), extensions: ["vibeloader", "zip"] }] });
    path = typeof r === "string" ? r : null;
  } catch (e) {
    toast.error(e);
  }
  if (path) await inspectCustomLoader(path);
}

export async function inspectCustomLoader(path: string) {
  try {
    const r = await api.customLoaderInspect(path);
    if (r.status === "error") toast.error(tt("cl.import.invalid"), issueText(tt, r.issue));
    else useImport.setState({ path, preview: r.preview });
  } catch (e) {
    toast.error(e, tt("cl.import.invalid"));
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 py-1 text-[13px] max-[560px]:grid-cols-1 max-[560px]:gap-0.5">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 break-words text-text">{children}</span>
    </div>
  );
}

function Details({ p }: { p: CustomLoaderPreview }) {
  const t = useT();
  return (
    <div className="flex flex-col divide-y divide-line rounded-card bg-surface px-4 py-2">
      <Row label={t("cl.field.version")}>{p.loader_version}</Row>
      {p.author && <Row label={t("cl.field.author")}>{p.author}</Row>}
      {p.homepage && <Row label={t("cl.field.homepage")}>{p.homepage}</Row>}
      <Row label={t("cl.field.minecraft")}>{p.minecraft.join(", ")}</Row>
      <Row label={t("cl.field.mods")}>{p.mods === "vanilla" ? t("cl.mods.none") : loaderNames[p.mods]}</Row>
      <Row label={t("cl.field.libraries")}>{t("cl.libraries.summary", { n: p.library_count, local: p.local_count, size: formatBytes(p.library_bytes) })}</Row>
      <Row label={t("cl.field.remote")}>
        {p.remote.length ? (
          <ul className="flex flex-col gap-0.5">
            {p.remote.map((r) => (
              <li key={r.name} className="break-all font-mono text-[11.5px]">{r.url}</li>
            ))}
          </ul>
        ) : (
          t("cl.remote.none")
        )}
      </Row>
      <Row label={t("cl.field.main_class")}><span className="font-mono text-[12px]">{p.main_class}</span></Row>
      <Row label={t("cl.field.jvm")}>
        {p.jvm_args.length ? <span className="font-mono text-[12px]">{p.jvm_args.join(" ")}</span> : t("cl.jvm.none")}
      </Row>
    </div>
  );
}

export function CustomLoaderImportHost() {
  const t = useT();
  const { path, preview: p, close } = useImport();
  const [busy, setBusy] = useState(false);
  if (!path || !p) return null;
  const submit = async () => {
    setBusy(true);
    try {
      const pack = await api.customLoaderImport(path, p.exists);
      await refreshCustomLoaders();
      toast.success(t("cl.import.done", { name: pack.name, version: pack.loader_version }));
      close();
    } catch (e) {
      toast.error(e, t("cl.import.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && close()}
      size="lg"
      locked={busy}
      title={
        <span className="flex items-center gap-2">
          <PackIcon src={p.icon} size={22} />
          {p.name}
        </span>
      }
      description={p.description ?? undefined}
      footer={
        <>
          <Button variant="subtle" onClick={close} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant={p.exists ? "danger" : "primary"} onClick={submit} loading={busy}>
            {p.exists ? t("cl.import.replace") : t("cl.import.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="alert" className="flex items-start gap-3 rounded-card border border-danger/40 bg-danger/[.08] px-4 py-3 text-[13px] text-danger">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <span>{t("cl.import.warning")}</span>
        </div>
        {p.exists && (
          <div className="flex items-start gap-3 rounded-card border border-warn/30 bg-warn/[.06] px-4 py-3 text-[13px] text-warn">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span>{t("cl.import.exists", { version: p.loader_version })}</span>
          </div>
        )}
        {!p.exists && p.installed_versions.length > 0 && (
          <p className="text-[13px] text-muted">{t("cl.import.other_versions", { versions: p.installed_versions.join(", ") })}</p>
        )}
        <Details p={p} />
      </div>
    </Dialog>
  );
}
