import { api } from "@/lib/api";
import { waitForTask } from "@/lib/queries";
import type { DiagnosisAction, Instance, LoaderKind } from "@/lib/types";
import { toast } from "@/components/ui";
import { t as tt } from "@/i18n";
import { uploadCrash } from "./source";
import { openAutofix } from "@/features/content/autofixStore";

async function resolveDependency(inst: Instance, modId: string, name: string | null): Promise<{ id: string; title: string } | null> {
  try {
    const p = await api.contentProject("modrinth", modId);
    return { id: p.id, title: p.title };
  } catch {
    /* kein Slug – suchen */
  }
  const r = await api.contentSearch({
    source: "modrinth",
    query: name ?? modId,
    project_type: "mod",
    game_version: inst.mc_version,
    loader: inst.loader.kind === "vanilla" ? null : (inst.loader.kind as LoaderKind),
    categories: [],
    sort: "relevance",
    offset: 0,
    limit: 5,
  });
  const hit = r.hits.find((h) => h.slug === modId) ?? r.hits[0];
  return hit ? { id: hit.id, title: hit.title } : null;
}

export async function runAction(a: DiagnosisAction, inst: Instance, crashReport: string | null) {
  switch (a.kind) {
    case "disable_mod":
      await api.contentSetEnabled(inst.id, "mod", a.file, false);
      toast.success(tt("diag.done.disabled"), a.file);
      return;
    case "enable_mod":
      await api.contentSetEnabled(inst.id, "mod", a.file, true);
      toast.success(tt("diag.done.enabled"), a.name ?? a.file);
      return;
    case "install_dependency": {
      const p = await resolveDependency(inst, a.mod_id, a.name);
      if (!p) throw new Error(tt("diag.err.not_found", { mod: a.name ?? a.mod_id }));
      await api.contentInstall(inst.id, "modrinth", p.id, null);
      toast.info(tt("diag.done.installing"), p.title);
      return;
    }
    case "set_java": {
      let list = await api.javaList();
      let j = list.find((x) => x.major === a.major);
      if (!j) {
        toast.info(tt("diag.done.java_download", { major: a.major }));
        await waitForTask(await api.javaInstall(a.major));
        list = await api.javaList();
        j = list.find((x) => x.major === a.major);
      }
      if (!j) throw new Error(tt("diag.err.java", { major: a.major }));
      await api.instanceUpdate(inst.id, { java: { ...inst.java, path: j.path } });
      toast.success(tt("diag.done.java", { major: a.major }), j.path);
      return;
    }
    case "increase_ram":
      await api.instanceUpdate(inst.id, {
        java: { ...inst.java, max_memory_mb: a.suggest_mb, min_memory_mb: Math.min(inst.java.min_memory_mb ?? 512, a.suggest_mb) },
      });
      toast.success(tt("diag.done.ram", { mb: a.suggest_mb }));
      return;
    case "upload":
      await uploadCrash(inst.id, crashReport);
      return;
    case "update_mod":
    case "reset_config":
      // Tauschen/Zurücksetzen nur über „Probleme beheben“ (Vorschau, Sicherung, Rückgängig)
      openAutofix({ instanceId: inst.id, crashReport });
      return;
    case "update_drivers":
      return;
  }
}
