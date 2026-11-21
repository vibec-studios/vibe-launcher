// OWNER: Content-Agent. Import-Dialog, Modus "Aus anderem Launcher": erkannte Launcher mit ihren Instanzen,
// Auswahl, eigener Ordner, Import je Instanz (`importExternal`) mit Fortschritt, danach `instanceInstall`.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, FolderOpen, Upload } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, EmptyState, Skeleton, Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useExpert } from "@/lib/simple-mode";
import type { ExtSettingKey, ExternalInstance, ExternalLauncher, LauncherKind } from "@/lib/types";
import { DEFAULT_KEYS, SETTING_KEYS, hasKey } from "./settingsFormat";
import { LauncherList } from "./external/LauncherList";
import { JobRow } from "./external/rows";
import { norm, pickDir, runImports, useJobs, type Pick } from "./external/jobs";

/** Inhalt + Fußzeile des Launcher-Imports. */
export function useExternalImport(active: boolean, folderOnly: boolean, onClose: () => void): { body: ReactNode; footer: ReactNode; progressView: boolean; busy: boolean } {
  const tech = useExpert("tech-details");
  const tr = useT();
  const detect = useQuery({ queryKey: ["launchers"], queryFn: api.launchersDetect, enabled: active && !folderOnly, staleTime: 0, retry: 0 });
  const [extra, setExtra] = useState<ExternalLauncher[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  /** Mitzunehmende Einstellungs-Bereiche (für alle gewählten Instanzen) */
  const [keys, setKeys] = useState<ExtSettingKey[]>(DEFAULT_KEYS);
  const { jobs, batch } = useJobs();
  const busy = batch.some((k) => jobs[k]?.status === "queued" || jobs[k]?.status === "running");
  const showProgress = batch.length > 0;

  const launchers = useMemo(() => {
    const all = folderOnly ? extra : [...(detect.data ?? []), ...extra];
    // Doppelte Instanzen (gleicher Pfad) nur einmal zeigen
    const seen = new Set<string>();
    return all
      .map((l) => ({ ...l, instances: l.instances.filter((i) => (seen.has(norm(i.source_path)) ? false : (seen.add(norm(i.source_path)), true))) }))
      .filter((l, i, arr) => arr.findIndex((x) => norm(x.path) === norm(l.path) && x.id === l.id) === i);
  }, [detect.data, extra, folderOnly]);

  const kindOf = useMemo(() => {
    const m = new Map<string, LauncherKind>();
    for (const l of launchers) for (const i of l.instances) m.set(i.source_path, l.id);
    return m;
  }, [launchers]);
  const allInstances = useMemo(() => launchers.flatMap((l) => l.instances), [launchers]);
  const q = query.trim().toLowerCase();
  const matches = (i: ExternalInstance) => !q || i.name.toLowerCase().includes(q) || i.mc_version.includes(q) || i.loader.kind.includes(q);
  const visible = allInstances.filter(matches);
  const needsVersion = (i: ExternalInstance) => !i.mc_version && !(versions[i.source_path] ?? "").trim();
  const chosen = allInstances.filter((i) => selected[i.source_path] && !needsVersion(i));
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected[i.source_path]);
  // Bereiche, die bei mindestens einer Instanz vorkommen (nur die werden zur Wahl gestellt)
  const offered = SETTING_KEYS.filter((k) =>
    (tech || k === "window" || k === "notes" || k === "group") && allInstances.some((i) => i.settings && hasKey(i.settings, k)),
  );
  const toggleKey = (k: ExtSettingKey) => setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  const someVisibleSelected = visible.some((i) => selected[i.source_path]);

  const toggle = (key: string, on?: boolean) => setSelected((s) => ({ ...s, [key]: on ?? !s[key] }));
  const toggleMany = (list: ExternalInstance[], on: boolean) => setSelected((s) => ({ ...s, ...Object.fromEntries(list.map((i) => [i.source_path, on])) }));

  const chooseDir = async () => {
    setScanError(null);
    try {
      const p = await pickDir(tr("ext.choose_dir_title"));
      if (!p) return;
      setScanning(true);
      const l = await api.launcherScanDir(p);
      setExtra((e) => [...e.filter((x) => norm(x.path) !== norm(l.path)), l]);
      // Neu gefundene, noch nicht importierte Instanzen vorauswählen
      toggleMany(l.instances.filter((i) => !i.imported_as), true);
    } catch (e) {
      setScanError(errorMessage(e));
    } finally {
      setScanning(false);
    }
  };

  const start = () => {
    const picks: Pick[] = chosen.map((i) => ({ launcher: kindOf.get(i.source_path) ?? "folder", inst: i, mcVersion: i.mc_version ? null : versions[i.source_path]?.trim() || null }));
    setSelected({});
    void runImports(picks, keys);
  };

  const chooseFolder = (
    <Button variant={allInstances.length ? "subtle" : "primary"} icon={scanning ? <Spinner /> : <FolderOpen size={16} />} onClick={chooseDir} disabled={scanning}>
      {tr("ext.choose_dir")}
    </Button>
  );

  // ---------------------------------------------------------------- Ansichten

  let body: ReactNode;
  if (showProgress) {
    body = (
      <div className="flex flex-col gap-1.5">
        {batch.map((k) => (
          <JobRow key={k} job={jobs[k]} />
        ))}
      </div>
    );
  } else if (!folderOnly && detect.isPending) {
    body = (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Spinner /> {tr("ext.scanning")}
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[52px]" />
        ))}
      </div>
    );
  } else if (allInstances.length === 0) {
    body = (
      <EmptyState
        icon="folder"
        title={tr(folderOnly ? (extra.length ? "ext.empty_group" : "import.folder.prompt") : "ext.none_title")}
        text={!folderOnly && detect.isError ? errorMessage(detect.error) : tr("ext.none_text")}
        action={chooseFolder}
        className="rounded-card border border-line bg-surface py-10"
      />
    );
  } else {
    body = (
      <LauncherList
        launchers={launchers}
        allInstances={allInstances}
        visible={visible}
        chosen={chosen}
        matches={matches}
        q={q}
        query={query}
        setQuery={setQuery}
        selected={selected}
        toggle={toggle}
        toggleMany={toggleMany}
        allVisibleSelected={allVisibleSelected}
        someVisibleSelected={someVisibleSelected}
        chooseFolder={chooseFolder}
        tech={tech}
        extra={extra}
        setExtra={setExtra}
        versions={versions}
        setVersions={setVersions}
        keys={keys}
        offered={offered}
        toggleKey={toggleKey}
      />
    );
  }

  const footer: ReactNode = showProgress ? (
    <>
      {busy ? (
        <Button variant="ghost" onClick={onClose}>
          {tr("install.background")}
        </Button>
      ) : (
        <>
          <Button variant="subtle" onClick={() => useJobs.setState({ batch: [] })}>
            {tr("ext.more")}
          </Button>
          <Button
            variant="primary"
            icon={<Check size={14} />}
            onClick={() => {
              useJobs.setState({ batch: [] });
              onClose();
            }}
          >
            {tr("ext.finish")}
          </Button>
        </>
      )}
    </>
  ) : allInstances.length > 0 ? (
    <div className="ml-auto">
      <Button variant="primary" icon={<Upload size={14} />} disabled={chosen.length === 0} onClick={start}>
        {chosen.length === 0 ? tr("import.start") : chosen.length === 1 ? tr("ext.import_1") : tr("ext.import_n", { n: chosen.length })}
      </Button>
    </div>
  ) : null;

  return {
    body: (
      <div className="flex flex-col gap-3">
        {scanError && !showProgress && (
          <div role="alert" className="flex items-start gap-2 rounded-card bg-danger/[.08] p-3 text-[14px] text-danger">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0 break-words">
              <div className="font-semibold">{tr("ext.scan_failed")}</div>
              <div className="selectable">{scanError}</div>
            </div>
          </div>
        )}
        {body}
      </div>
    ),
    footer,
    progressView: showProgress,
    busy,
  };
}
