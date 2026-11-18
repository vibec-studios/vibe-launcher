// Creator-Bereich, Reiter „Tools“: Blockbench finden/herunterladen, Vibey-Plugin bereitstellen (bebilderte
// Schritt-für-Schritt-Anleitung) und den Creator-Modus (Live-Link ins Spiel) erklären.
//
// Blockbench installiert Plugins nur über die eigene Oberfläche (Datei ziehen oder „Plugin aus Datei laden“), merkt
// sich dann aber den Pfad und lädt die Datei bei jedem Start neu – darum hält der Launcher `vibey.js` an einem festen
// Ort aktuell (siehe src-tauri/src/vibey_client/blockbench.rs).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Download, ExternalLink, FileCode2, FolderOpen, MousePointerClick, Play, RefreshCw, Wifi } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, IconButton, Spinner, cn, toast } from "@/components/ui";
import { copyText, openExternal } from "@/components/content/util";
import { useT } from "@/i18n";
import { vapi } from "./api";
import { cqk } from "./data";

const BLOCKBENCH_DOWNLOAD = "https://www.blockbench.net/downloads";

export function CreatorTools({ online }: { online: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const bb = useQuery({ queryKey: cqk.blockbench, queryFn: vapi.blockbenchStatus, refetchOnWindowFocus: true, staleTime: 5_000 });
  const inst = useQuery({ queryKey: cqk.instances, queryFn: vapi.clientInstances, refetchOnWindowFocus: true });
  const [busy, setBusy] = useState(false);
  const s = bb.data;

  const install = async (quiet = false) => {
    setBusy(true);
    try {
      const st = await vapi.blockbenchInstallPlugin();
      qc.setQueryData(cqk.blockbench, st);
      if (!quiet) toast.success(t("cre.plugin.ready", { v: st.plugin_version ?? "" }));
      else toast.info(t("cre.plugin.updated", { v: st.plugin_version ?? "" }), t("cre.plugin.updated_text"));
    } catch (e) {
      toast.error(e, t("cre.plugin.failed"));
    } finally {
      setBusy(false);
    }
  };

  // Plugin liegt schon bereit, aber es gibt ein neueres -> still aktualisieren (Blockbench lädt es beim nächsten Start)
  const autoDone = useRef(false);
  useEffect(() => {
    if (s?.plugin_present && s.update_available && !autoDone.current && online) {
      autoDone.current = true;
      void install(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.plugin_present, s?.update_available, online]);

  const step1Done = !!s?.blockbench;
  const step2Done = !!s?.plugin_present;
  const step3Done = s?.registered === true;

  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-5 p-6">
      {/* Kopf: Status */}
      <div className="grid grid-cols-3 gap-3">
        <StatusTile ok={step1Done} label={t("cre.tile.blockbench")} value={s ? (s.blockbench ? t("cre.found") : t("cre.missing")) : "…"} />
        <StatusTile ok={step2Done} label={t("cre.tile.plugin")} value={s ? (s.plugin_present ? `v${s.plugin_version ?? "?"}` : t("cre.not_ready")) : "…"} />
        <StatusTile
          ok={step3Done}
          label={t("cre.tile.registered")}
          value={s ? (s.registered === true ? t("cre.yes") : s.registered === false ? t("cre.not_yet") : t("cre.unknown")) : "…"}
        />
      </div>

      <section className="flex flex-col gap-2">
        <header className="flex items-center gap-3 px-1">
          <h2 className="text-section text-text">{t("cre.setup")}</h2>
          <span className="truncate text-meta text-dim">{t("cre.setup_hint")}</span>
          <IconButton label={t("cre.refresh")} tip variant="ghost" size="sm" className="ml-auto" onClick={() => void bb.refetch()}>
            {bb.isFetching ? <Spinner size={13} /> : <RefreshCw size={14} />}
          </IconButton>
        </header>
        <ol className="divide-y divide-line overflow-hidden rounded-card bg-surface">
          <Step n={1} done={step1Done} title={t("cre.s1.title")} art={<ArtDownload />}>
            <p className="[overflow-wrap:anywhere]">{s?.blockbench ? t("cre.s1.found", { path: s.blockbench }) : t("cre.s1.text")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {s?.blockbench ? (
                <Button size="sm" icon={<Play size={14} />} onClick={() => vapi.blockbenchOpen().catch((e) => toast.error(e))}>
                  {t("cre.open_bb")}
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} onClick={() => void openExternal(BLOCKBENCH_DOWNLOAD)}>
                  {t("cre.download_bb")}
                </Button>
              )}
            </div>
          </Step>
          <Step n={2} done={step2Done} title={t("cre.s2.title")} art={<ArtFile version={s?.plugin_version ?? s?.latest_version ?? null} />}>
            <p>{t("cre.s2.text")}</p>
            {!online && <p className="mt-1.5 text-warn">{t("cre.s2.offline")}</p>}
            {s?.error && online && <p className="mt-1.5 text-danger">{s.error}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {/* Nur eine farbige Hauptaktion: erst Blockbench holen, dann das Plugin */}
              <Button size="sm" variant={step2Done || !step1Done ? "ghost" : "primary"} loading={busy} disabled={!online} icon={<Download size={14} />} onClick={() => void install()}>
                {step2Done ? (s?.update_available ? t("cre.s2.update", { v: s.latest_version ?? "" }) : t("cre.s2.again")) : t("cre.s2.get")}
              </Button>
              {step2Done && (
                <>
                  <IconButton label={t("cre.reveal")} tip variant="ghost" size="sm" onClick={() => vapi.blockbenchRevealPlugin().catch((e) => toast.error(e))}>
                    <FolderOpen size={15} />
                  </IconButton>
                  <IconButton
                    label={t("cre.copy_path")}
                    tip
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void copyText(s!.plugin_path);
                      toast.success(t("cre.copied"));
                    }}
                  >
                    <Copy size={14} />
                  </IconButton>
                </>
              )}
            </div>
            {step2Done && <code className="mt-2 block truncate font-mono text-[11px] text-dim">{s?.plugin_path}</code>}
          </Step>
          <Step n={3} done={step3Done} title={t("cre.s3.title")} art={<ArtDrag />}>
            <p>{t("cre.s3.text")}</p>
            <p className="mt-2 text-dim">{t("cre.s3.alt")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
              <Kbd>{t("cre.bb.file")}</Kbd>
              <span className="text-dim">›</span>
              <Kbd>{t("cre.bb.plugins")}</Kbd>
              <span className="text-dim">›</span>
              <Kbd>
                <FileCode2 size={12} className="mr-1 inline" />
                {t("cre.bb.load_file")}
              </Kbd>
            </div>
          </Step>
          <Step n={4} done={step3Done} title={t("cre.s4.title")} art={<ArtConfirm />}>
            <p>{t("cre.s4.text")}</p>
            <p className="mt-2 text-dim">{t("cre.s4.updates")}</p>
          </Step>
        </ol>
      </section>

      <section className="flex flex-col gap-2">
        <header className="flex items-center gap-2 px-1">
          <Wifi size={14} className="text-dim" />
          <h2 className="text-section text-text">{t("cre.live.title")}</h2>
        </header>
        <div className="overflow-hidden rounded-card bg-surface">
        <div className="grid grid-cols-[1fr_300px] gap-6 p-5 text-[13px] leading-relaxed text-muted">
          <div>
            <p>{t("cre.live.text")}</p>
            <ol className="mt-3 flex flex-col gap-2">
              {[1, 2, 3, 4].map((i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-pill bg-surface3 text-[11px] font-semibold text-muted">{i}</span>
                  <span>{t(`cre.live.s${i}`)}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[12px] text-dim">{t("cre.live.note")}</p>
          </div>
          <ArtLive />
        </div>
        <div className="border-t border-line px-5 py-4">
          <div className="mb-2 text-caption font-semibold text-dim">{t("cre.live.instances")}</div>
          {inst.data && inst.data.length === 0 && <p className="text-[13px] text-muted">{t("cre.live.none")}</p>}
          <div className="-mx-2 flex flex-col">
            {inst.data?.map((i) => (
              <div key={i.instance_id} className="flex items-center gap-3 rounded-ctl px-2 py-1.5 transition-colors hover:bg-white/[.03]">
                <span className={cn("h-2 w-2 shrink-0 rounded-dot", i.devlink ? "bg-ok" : "bg-surface3")} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-text">{i.name}</div>
                  <div className="truncate font-mono text-[11px] text-dim">{i.game_dir}</div>
                </div>
                <span className={cn("text-[12px]", i.devlink ? "text-ok" : "text-dim")}>{i.devlink ? t("cre.live.devlink_on") : t("cre.live.devlink_off")}</span>
                <IconButton
                  label={t("cre.live.copy_dir")}
                  tip
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void copyText(i.game_dir);
                    toast.success(t("cre.copied"));
                  }}
                >
                  <Copy size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
        </div>
      </section>
    </div>
  );
}

function StatusTile({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface px-4 py-3">
      <span className={cn("grid h-5 w-5 shrink-0 place-items-center", ok ? "text-ok" : "text-dim")}>
        {ok ? <CheckCircle2 size={16} /> : <span className="h-2 w-2 rounded-dot bg-surface3" />}
      </span>
      <div className="min-w-0">
        <div className="text-caption font-semibold text-dim">{label}</div>
        <div className="truncate text-[14px] font-semibold text-text">{value}</div>
      </div>
    </div>
  );
}

function Step({ n, done, title, art, children }: { n: number; done: boolean; title: string; art: ReactNode; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_1fr_260px] gap-5 px-5 py-5">
      <span className={cn("grid h-7 w-7 place-items-center rounded-pill text-[13px] font-bold", done ? "bg-ok/10 text-ok" : "bg-surface3 text-muted")}>
        {done ? <CheckCircle2 size={16} /> : n}
      </span>
      <div className="min-w-0 text-[13px] leading-relaxed text-muted">
        <h3 className="mb-1.5 text-[14px] font-semibold text-text">{title}</h3>
        {children}
      </div>
      <div className="self-start">{art}</div>
    </li>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => <span className="rounded-xs bg-surface3 px-1.5 py-0.5 font-mono text-[11px] text-text">{children}</span>;

// ------------------------------------------------------------------ Illustrationen (schematisch, Blockbench-Look)

function Frame({ children, title = "Blockbench" }: { children: ReactNode; title?: string }) {
  return (
    <div className="overflow-hidden rounded-card bg-[#1c1f26]">
      <div className="flex h-5 items-center gap-1.5 border-b border-black/40 bg-[#2a2e37] px-2">
        <span className="h-1.5 w-1.5 bg-[#3e8bff]" />
        <span className="font-sans text-[9px] font-semibold text-[#c8ccd6]">{title}</span>
      </div>
      <div className="relative h-[118px]">{children}</div>
    </div>
  );
}

function ArtDownload() {
  return (
    <Frame title="blockbench.net">
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div className="grid h-9 w-9 place-items-center bg-[#3e8bff] text-white">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M4 7l8-4 8 4v10l-8 4-8-4z" opacity=".5" />
            <path d="M12 3l8 4-8 4-8-4z" />
          </svg>
        </div>
        <div className="flex items-center gap-1.5 bg-[#3e8bff] px-2.5 py-1 text-[10px] font-semibold text-white">
          <Download size={11} /> Download
        </div>
      </div>
    </Frame>
  );
}

function ArtFile({ version }: { version: string | null }) {
  return (
    <div className="flex h-[143px] items-center justify-center gap-3 rounded-card bg-surface2">
      <div className="relative grid h-[84px] w-[66px] place-items-center rounded-xs bg-surface3">
        <span className="absolute right-0 top-0 h-3.5 w-3.5 bg-surface2" />
        <FileCode2 size={26} className="text-warn" />
        <span className="absolute bottom-1.5 font-mono text-[10px] text-text">vibey.js</span>
      </div>
      <div className="flex flex-col gap-1 text-[11px]">
        <span className="font-mono text-dim">Vibe Launcher</span>
        <span className="font-semibold text-text">{version ? `v${version}` : "—"}</span>
        <span className="text-ok">SHA-256 ✓</span>
      </div>
    </div>
  );
}

function ArtDrag() {
  return (
    <Frame>
      <div className="absolute inset-2 grid place-items-center border-2 border-dashed border-[#3e8bff]/70 bg-[#3e8bff]/10">
        <span className="text-[10px] font-semibold text-[#9cc2ff]">Plugin laden</span>
      </div>
      <div className="absolute bottom-3 right-6 flex items-end gap-0.5">
        <div className="relative grid h-11 w-9 rotate-[-8deg] place-items-center rounded-xs bg-surface3">
          <FileCode2 size={15} className="text-warn" />
          <span className="absolute bottom-0.5 font-mono text-[7px] text-text">vibey.js</span>
        </div>
        <MousePointerClick size={16} className="-ml-2 mb-[-4px] text-text" />
      </div>
    </Frame>
  );
}

function ArtConfirm() {
  return (
    <Frame>
      <div className="absolute left-2 top-2 flex gap-2 text-[9px] text-[#c8ccd6]">
        <span>File</span>
        <span>Edit</span>
        <span className="bg-[#8b6cff] px-1 font-semibold text-white">Vibey</span>
        <span>Help</span>
      </div>
      <div className="absolute left-1/2 top-1/2 w-[170px] -translate-x-1/2 -translate-y-[40%] rounded-ctl bg-[#2a2e37] p-2.5">
        <div className="text-[9px] leading-snug text-[#c8ccd6]">Plugin „vibey“ laden und ihm Zugriff auf deine Dateien erlauben?</div>
        <div className="mt-2 flex justify-end gap-1">
          <span className="bg-[#3e8bff] px-2 py-0.5 text-[9px] font-semibold text-white">OK</span>
          <span className="bg-[#3a3f4b] px-2 py-0.5 text-[9px] text-[#c8ccd6]">Abbrechen</span>
        </div>
      </div>
    </Frame>
  );
}

function ArtLive() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-ctl bg-[#1c1f26] p-2">
          <div className="text-[9px] font-semibold text-[#9cc2ff]">Blockbench</div>
          <div className="mt-1 flex items-center gap-1 text-[9px] text-ok">
            <span className="h-1.5 w-1.5 bg-ok" /> Vibey: connected
          </div>
          <div className="mt-1.5 bg-[#8b6cff] px-1.5 py-0.5 text-center text-[9px] font-semibold text-white">Push</div>
        </div>
        <div className="flex flex-col items-center text-muted">
          <span className="font-mono text-[9px]">127.0.0.1</span>
          <span className="text-[14px] leading-none">⇄</span>
        </div>
        <div className="flex-1 rounded-ctl bg-surface2 p-2">
          <div className="text-[9px] font-semibold text-text">Minecraft</div>
          <div className="mt-1 rounded-xs bg-surface3 px-1.5 py-1 text-[9px] text-text">Seal Hat updated</div>
          <div className="mt-1 text-[8px] text-warn">DEV</div>
        </div>
      </div>
      <div className="font-mono text-[10px] text-dim">vibeyclient/devlink.json</div>
    </div>
  );
}
