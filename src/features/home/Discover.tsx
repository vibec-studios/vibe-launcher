// Beliebte Modpacks (Modrinth) als ruhige Kartenreihe, und der Einstieg für neue Nutzer ohne Instanz.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Compass, Download, HardDriveDownload, Package, Plus } from "lucide-react";
import type { ProjectHit } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { Skeleton } from "@/components/ui";
import { openNewInstance } from "@/components/instance/actions";
import { openImport } from "@/features/import/ImportDialog";
import { useT } from "@/i18n";
import { useFitColumns, usePopularModpacks } from "./data";
import { MoreLink, SectionHead } from "./Recent";

export function PackIcon({ hit, size }: { hit: Pick<ProjectHit, "icon_url">; size: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-card bg-surface3" style={{ width: size, height: size }}>
      {hit.icon_url && !failed ? (
        <img src={hit.icon_url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <Package size={Math.round(size * 0.42)} className="text-dim" />
      )}
    </span>
  );
}

function PackCard({ hit }: { hit: ProjectHit }) {
  const nav = useNavigate();
  return (
    <button
      onClick={() => nav({ to: "/project/$source/$id", params: { source: hit.source, id: hit.id }, search: {} })}
      className="flex min-w-0 gap-3 rounded-panel bg-surface p-3 text-left transition-colors duration-100 hover:bg-surface2"
    >
      <PackIcon hit={hit} size={52} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-text">{hit.title}</span>
        <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted">{hit.description}</span>
        <span className="mt-1 flex items-center gap-1 text-caption tabular-nums text-dim">
          <Download size={11} />
          {formatCount(hit.downloads)}
        </span>
      </span>
    </button>
  );
}

/** Eine Reihe beliebter Modpacks; was nicht in eine Zeile passt, bleibt verborgen (kein halbes Raster). */
export function PopularPacks({ rows = 1 }: { rows?: number }) {
  const t = useT();
  const q = usePopularModpacks(8);
  const [ref, cols] = useFitColumns<HTMLDivElement>(250);
  if (q.isError) return null;
  return (
    <section>
      <SectionHead
        title={t("home.discover")}
        link={
          <MoreLink to="/discover" search={{ type: "modpack" }}>
            {t("home.discover.more")}
          </MoreLink>
        }
      />
      <div ref={ref} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {!q.data
          ? Array.from({ length: cols * rows }, (_, i) => <Skeleton key={i} className="h-[78px] rounded-panel" />)
          : q.data.slice(0, cols * rows).map((h) => <PackCard key={h.id} hit={h} />)}
      </div>
    </section>
  );
}

function StartCard({ icon, title, text, onClick, primary }: { icon: React.ReactNode; title: string; text: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="group flex min-w-0 flex-col gap-3 rounded-panel bg-surface2 p-4 text-left transition-colors duration-100 hover:bg-surface3"
    >
      <span
        className={
          primary
            ? "grid h-9 w-9 place-items-center rounded-card bg-brand text-[var(--ui-on-accent)]"
            : "grid h-9 w-9 place-items-center rounded-card bg-surface3 text-text transition-colors duration-100 group-hover:bg-white/[.1]"
        }
      >
        {icon}
      </span>
      <span>
        <span className="block text-[14px] font-semibold text-text">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{text}</span>
      </span>
    </button>
  );
}

/** Erster Start ohne Instanz: drei klare Wege statt einer leeren Seite. */
export function StartHere() {
  const t = useT();
  const nav = useNavigate();
  return (
    <section className="rounded-panel bg-surface p-5">
      <h2 className="text-hero text-text">{t("home.start.title")}</h2>
      <p className="mt-1.5 max-w-[620px] text-[13.5px] text-muted">{t("home.start.text")}</p>
      <div className="mt-5 grid grid-cols-3 gap-2 max-[900px]:grid-cols-1">
        <StartCard primary icon={<Plus size={18} />} title={t("home.start.new")} text={t("home.start.new_text")} onClick={openNewInstance} />
        <StartCard
          icon={<Compass size={17} />}
          title={t("home.start.pack")}
          text={t("home.start.pack_text")}
          onClick={() => nav({ to: "/discover", search: { type: "modpack" } })}
        />
        <StartCard
          icon={<HardDriveDownload size={17} />}
          title={t("home.start.import")}
          text={t("home.start.import_text")}
          onClick={() => openImport(null, "launcher")}
        />
      </div>
    </section>
  );
}
