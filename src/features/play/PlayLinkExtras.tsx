import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { PackagePlus, Settings2 } from "lucide-react";
import { api } from "@/lib/api";
import type { RunningSession } from "@/lib/types";
import { useVibe } from "@/lib/vibe";
import { qk, queryClient } from "@/lib/queries";
import type { CreatePlayLinkBody, PlayLinkInfo } from "@/lib/vibe-sdk";
import { Button, Tooltip, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { errText, requireClient, vibeClient } from "@/features/social/service";
import { vibePackOf } from "@/features/packsync/api";
import { openHostPanel } from "@/features/hostpanel/api";
import { useOwnHostFor } from "@/features/hostpanel/MyHosts";
import type { Instance } from "@/lib/types";

const useOverrides = create<Record<string, string>>(() => ({}));

export function useLinkOverride(instanceId: string | undefined, sessionUrl: string | null | undefined): string | null {
  const o = useOverrides((s) => (instanceId ? s[instanceId] : undefined));
  return o ?? sessionUrl ?? null;
}

const codeOf = (url: string) => url.split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";

async function packRef(instanceId: string): Promise<{ code: string; version_id?: string } | null> {
  const list = queryClient.getQueryData<Instance[]>(qk.instances) ?? [];
  const ref = vibePackOf(list.find((i) => i.id === instanceId));
  if (ref) return { code: ref.code, ...(ref.versionId ? { version_id: ref.versionId } : {}) };
  const shared = await api.vibePackLink(instanceId).catch(() => null);
  return shared?.code ? { code: shared.code } : null;
}

async function attach(instanceId: string, info: PlayLinkInfo) {
  const ref = await packRef(instanceId);
  if (!ref) throw new Error(tt("pjoin.attach.no_pack"));
  const body: CreatePlayLinkBody = {
    relay_host: info.relay_host,
    mc_version: info.mc_version,
    loader: info.loader,
    mods: info.mods.filter((m) => m.source === "modrinth" || m.source === "curseforge").slice(0, 500),
    client_pack: info.client_pack,
    world_name: info.world_name,
    max_players: info.max_players,
    vibe_pack: ref,
  };
  const created = await requireClient().playLinks.create(body);
  useOverrides.setState({ [instanceId]: created.url });
  queryClient.removeQueries({ queryKey: ["vibe", "play-link-info"] });
  return created;
}

export function PlayLinkExtras({ hosting, url, compact }: { hosting: RunningSession; url: string; compact?: boolean }) {
  const t = useT();
  const vibe = useVibe();
  const code = codeOf(url);
  const own = useOwnHostFor(hosting.session.world);
  const [busy, setBusy] = useState(false);
  const canPack = vibe.sharing && !!vibeClient();
  const ref = useQuery({ queryKey: ["vibe", "play-pack-ref", hosting.instance_id], queryFn: () => packRef(hosting.instance_id), enabled: canPack, staleTime: 60_000 });
  const info = useQuery({
    queryKey: ["vibe", "play-link-info", code],
    queryFn: () => requireClient().playLinks.get(code),
    enabled: canPack && !!code && !!ref.data,
    staleTime: 60_000,
    retry: 0,
  });
  const showAttach = canPack && !!ref.data && !!info.data && !info.data.vibe_pack;

  const run = async () => {
    if (!info.data) return;
    setBusy(true);
    try {
      await attach(hosting.instance_id, info.data);
      toast.success(t("pjoin.attach.done"), t("pjoin.attach.done_text"));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {showAttach && (
        <Tooltip content={t("pjoin.attach.hint")}>
          <Button size="sm" variant="subtle" icon={<PackagePlus size={13} />} loading={busy} onClick={() => void run()}>
            {compact ? t("pjoin.attach.short") : t("pjoin.attach.button")}
          </Button>
        </Tooltip>
      )}
      {vibe.hosting && own && (
        <Button size="sm" variant="subtle" icon={<Settings2 size={13} />} onClick={() => openHostPanel(own.id)}>
          {compact ? t("hpanel.manage_short") : t("hpanel.manage")}
        </Button>
      )}
    </>
  );
}
