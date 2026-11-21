import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Term } from "@/features/help/glossary/Term";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import { accentPalette, loaderNames } from "@/lib/format";
import { Button, ErrorState, Field, Input, Select, Skeleton, toast } from "@/components/ui";
import { isBlockIcon, randomBlockIcon } from "@/components/instance/blocks/catalog";
import { pickLoaderVersion, useLoaderVersions, type VersionValue } from "@/components/instance/VersionPicker";
import { installInstance } from "@/components/instance/actions";
import { useT } from "@/i18n";
import { ClientPackPicker, installPackAfterCreate } from "../settings/ClientPacks";
import { SetPicker, installSetsAfterCreate, useNewInstanceSets, useSetCheck } from "@/features/modsets/SetPicker";
import { useSets } from "@/features/modsets/api";
import { GroupField, suggestName } from "./fields";
import { IconPicker } from "./IconPicker";
import { LoaderCards } from "./LoaderCards";
import { VersionList } from "./VersionList";

// ------------------------------------------------------------------ Tab: Eigene

export function CustomTab({ onDone, onBusy }: { onDone: () => void; onBusy: (b: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const { data: instances = [] } = useInstances();
  const groups = useMemo(() => [...new Set(instances.map((i) => i.group).filter((g): g is string => !!g))].sort(), [instances]);

  const [step, setStep] = useState<"game" | "details">("game");
  const [ver, setVer] = useState<VersionValue>({ mc: null, loader: "fabric", loaderVersion: null });
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [accent, setAccent] = useState(() => accentPalette[Math.floor(Math.random() * accentPalette.length)]);
  const [group, setGroup] = useState("");
  const [icon, setIcon] = useState<string | null>(randomBlockIcon);
  const [pack, setPack] = useState<string | null>(null);
  // „Mit Mod-Sets starten“: nach dem Anlegen alles Passende aus diesen Sets installieren
  const { setIds, setSetIds, setsLoading } = useNewInstanceSets();
  const setCheck = useSetCheck(setIds, ver.mc, ver.loader);
  const setTotal = (useSets().data ?? []).filter((s) => setIds.includes(s.id)).reduce((n, s) => n + s.entries.length, 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!nameTouched) setName(suggestName(ver));
  }, [ver.mc, ver.loader, nameTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loader-Version: empfohlene (erste stabile) vorauswählen
  const lv = useLoaderVersions(ver.loader, ver.mc);
  useEffect(() => {
    if (ver.loader === "vanilla") return;
    const list = lv.data;
    if (!list) return;
    if (!ver.loaderVersion || !list.some((x) => x.version === ver.loaderVersion)) {
      const pick = pickLoaderVersion(list);
      if (pick !== ver.loaderVersion) setVer((v) => ({ ...v, loaderVersion: pick }));
    }
  }, [lv.data, ver.loader, ver.mc, ver.loaderVersion]);

  const needsLv = ver.loader !== "vanilla";
  const gameReady = !!ver.mc && (!needsLv || !!ver.loaderVersion);
  const valid = !setsLoading && gameReady && name.trim().length > 0;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    onBusy(true);
    try {
      const inst = await api.instanceCreate({
        name: name.trim(),
        mc_version: ver.mc!,
        loader: { kind: ver.loader, version: needsLv ? ver.loaderVersion : null },
        accent,
        icon: isBlockIcon(icon) ? icon : null,
        group: group.trim() || null,
      });
      if (icon && !isBlockIcon(icon)) await api.instanceSetIcon(inst.id, icon).catch((e) => toast.error(e, t("inst.icon.failed")));
      onDone();
      nav({ to: "/instances/$id", params: { id: inst.id }, search: { tab: "content" } });
      installInstance(inst.id);
      // Client-Pack (falls gewählt) parallel zur Spiel-Installation in mods/ legen
      void (async () => {
        if (pack && needsLv) await installPackAfterCreate(t, inst.id, pack);
        if (setIds.length) await installSetsAfterCreate(t, inst.id, setIds);
      })();
    } catch (e) {
      toast.error(e, t("newinst.failed"));
      setBusy(false);
      onBusy(false);
    }
  };

  const lvOptions = (lv.data ?? []).map((x) => ({ value: x.version, label: x.version, hint: x.stable ? t("newinst.stable") : t("newinst.beta") }));

  return (
    <>
      {step === "game" ? (
        <div className="scroll min-h-0 flex-1 px-6 py-4">
          <h2 className="text-[17px] font-semibold text-text">{t("newinst.step.game")}</h2>
          <p className="mt-1 text-[14px] text-muted">{t("newinst.step.game_desc")}</p>
          <div className="mt-4 grid grid-cols-[minmax(250px,0.8fr)_minmax(0,1.2fr)] gap-5 max-[680px]:grid-cols-1">
            <section className="min-w-0">
              <h3 className="mb-2 text-[14px] font-semibold text-text"><Term id="loader">{t("newinst.loader")}</Term></h3>
              <LoaderCards value={ver.loader} onChange={(loader) => loader !== ver.loader && setVer({ ...ver, loader, loaderVersion: null })} />
            </section>
            <section className="flex min-w-0 flex-col gap-2">
              <h3 className="text-[14px] font-semibold text-text">{t("newinst.version")}</h3>
              <div className="flex h-[230px] flex-col">
                <VersionList loader={ver.loader} value={ver.mc} onChange={(mc) => mc !== ver.mc && setVer({ ...ver, mc, loaderVersion: null })} />
              </div>
              {needsLv && (
                <details className="rounded-card border border-line bg-surface">
                  <summary className="cursor-pointer px-3 py-2 text-[14px] text-muted">{t("newinst.loader_version", { loader: loaderNames[ver.loader] })}</summary>
                  <div className="px-3 pb-3">
                    {ver.mc && lv.isLoading ? <Skeleton className="h-8" /> : (
                      <Select
                        value={ver.loaderVersion}
                        onChange={(x) => setVer({ ...ver, loaderVersion: x })}
                        options={lvOptions}
                        placeholder={!ver.mc ? t("newinst.pick_version_first") : lvOptions.length ? t("newinst.loader_version_pick") : t("newinst.loader_version_none")}
                        disabled={!lvOptions.length}
                      />
                    )}
                  </div>
                </details>
              )}
              {needsLv && ver.mc && lv.isSuccess && !lvOptions.length && <p role="status" className="text-[14px] text-warn">{t("newinst.loader_version_none")}</p>}
              {needsLv && lv.isError && <ErrorState error={lv.error} onRetry={() => lv.refetch()} />}
            </section>
          </div>
        </div>
      ) : (
        <div className="scroll flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
          <h2 className="text-[17px] font-semibold text-text">{t("newinst.step.details")}</h2>
          <div className="flex min-w-0 items-center gap-4 rounded-card border border-line bg-surface p-4">
            <IconPicker icon={icon} accent={accent} onIcon={setIcon} onAccent={setAccent} />
            <Field label={t("newinst.name")} className="min-w-0 flex-1">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                placeholder={t("newinst.name_placeholder")}
                maxLength={64}
                autoFocus
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
              />
            </Field>
          </div>
          <Field label={t("newinst.group")}>
            <GroupField value={group} onChange={setGroup} groups={groups} />
          </Field>
          {needsLv && (
            <Field label={t("cp.new.label")}>
              <ClientPackPicker mc={ver.mc} loader={ver.loader} value={pack} onChange={setPack} />
            </Field>
          )}
          <Field label={t("newinst.sets")}>
            <SetPicker mc={ver.mc} loader={ver.loader} value={setIds} onChange={setSetIds} />
          </Field>
        </div>
      )}
      <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-6 py-3">
        <div className="min-w-0 flex-1">
          {ver.mc && (
            <div className="text-[14px] font-semibold text-text">
              {needsLv ? t("newinst.summary_loader", { mc: ver.mc, loader: loaderNames[ver.loader], v: ver.loaderVersion ?? "?" }) : t("newinst.summary", { mc: ver.mc })}
            </div>
          )}
          {step === "details" && (
            <div className="text-[13px] text-muted">
              <p>{t("newinst.after")}</p>
              {pack && needsLv && <p>{t("cp.new.after", { name: t(`cp.${pack}.name`) })}</p>}
              {setIds.length > 0 && <p>{t("newinst.sets_after", { n: setCheck.data?.available ?? setTotal })}</p>}
            </div>
          )}
        </div>
        {step === "game" ? (
          <>
            <Button variant="subtle" onClick={onDone}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!gameReady} onClick={() => setStep("details")} icon={<ArrowRight size={16} />}>
              {t("newinst.next")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="subtle" onClick={() => setStep("game")} disabled={busy} icon={<ArrowLeft size={16} />}>{t("common.back")}</Button>
            <Button variant="primary" onClick={submit} disabled={!valid} loading={busy}>
              {t("newinst.create")}
            </Button>
          </>
        )}
      </footer>
    </>
  );
}
