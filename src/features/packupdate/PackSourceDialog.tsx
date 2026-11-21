import { useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileArchive, FolderOpen, Globe, Info } from "lucide-react";
import { Button, Dialog, Input, cn, toast } from "@/components/ui";
import { Term } from "@/features/help/glossary/Term";
import { useT } from "@/i18n";
import { useExpert } from "@/lib/simple-mode";
import type { Instance } from "@/lib/types";
import { isHttpUrl, isPackwizInput, type PackInput } from "./api";

type Mode = "file" | "url";

function Choice({ active, icon, title, hint, onClick }: { active: boolean; icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 items-start gap-3 rounded-card border px-4 py-3 text-left transition-colors",
        active ? "border-accent/70 bg-accent/[.08]" : "border-line bg-surface hover:border-line2",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", active ? "text-accent" : "text-dim")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-text">{title}</span>
        <span className="block text-meta text-muted">{hint}</span>
      </span>
    </button>
  );
}

export function PackSourceDialog({ instance, onNext, onClose }: { instance: Instance; onNext: (input: PackInput) => void; onClose: () => void }) {
  const t = useT();
  const expert = useExpert("tech-details");
  const known = instance.source?.kind === "packwiz" ? (instance.source.project_id ?? "") : "";
  const [mode, setMode] = useState<Mode>(known ? "url" : "file");
  const [path, setPath] = useState<string | null>(null);
  const [url, setUrl] = useState(known);
  const urlOk = isHttpUrl(url);
  const packwiz = urlOk && isPackwizInput(url);
  const ready = mode === "file" ? !!path : urlOk;

  const pick = async () => {
    try {
      const r = await open({
        multiple: false,
        directory: false,
        title: t("packupd.pick_title"),
        filters: [
          { name: t("packupd.pick_filter"), extensions: ["mrpack", "zip", "vlpack"] },
          { name: "Packwiz (pack.toml)", extensions: ["toml"] },
        ],
      });
      if (typeof r === "string") setPath(r);
    } catch (e) {
      toast.error(e);
    }
  };

  const next = () => {
    if (!ready) return;
    onNext(mode === "file" ? { kind: "file", path: path! } : { kind: "url", url: url.trim() });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("packupd.title")}
      description={t("packupd.description", { name: instance.name })}
      size="lg"
      footer={
        <>
          <span className="mr-auto text-meta text-dim">{t("packupd.step1")}</span>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!ready} onClick={next}>
            {t("packupd.next")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted">
          {t("packupd.intro_a")} <Term id="modpack" /> {t("packupd.intro_b")} <Term id="snapshot">{t("packupd.intro_snapshot")}</Term>.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label={t("packupd.source")}>
          <Choice active={mode === "file"} icon={<FileArchive size={18} />} title={t("packupd.file")} hint={t("packupd.file_hint")} onClick={() => setMode("file")} />
          <Choice active={mode === "url"} icon={<Globe size={18} />} title={t("packupd.url")} hint={t(expert ? "packupd.url_hint_expert" : "packupd.url_hint")} onClick={() => setMode("url")} />
        </div>
        {mode === "file" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Button icon={<FolderOpen size={15} />} onClick={() => void pick()}>
                {t("packupd.pick")}
              </Button>
              <span className={cn("min-w-0 flex-1 truncate text-[13px]", path ? "text-text" : "text-dim")} title={path ?? undefined}>
                {path ?? t("packupd.none")}
              </span>
            </div>
          </div>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="label">{t("packupd.url_label")}</span>
            <Input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && next()}
              placeholder="https://…/pack.toml"
              invalid={url.trim() !== "" && !urlOk}
              spellCheck={false}
            />
            <span className={cn("text-meta", url.trim() && !urlOk ? "text-danger" : "text-dim")}>
              {url.trim() && !urlOk ? t("packupd.url_invalid") : packwiz ? t("packupd.url_packwiz") : t("packupd.url_download")}
            </span>
          </label>
        )}
        <div className="flex items-start gap-2.5 rounded-card bg-surface px-3.5 py-2.5 text-meta text-muted">
          <Info size={14} className="mt-0.5 shrink-0 text-dim" />
          <span>{t("packupd.keep_hint")}</span>
        </div>
      </div>
    </Dialog>
  );
}
