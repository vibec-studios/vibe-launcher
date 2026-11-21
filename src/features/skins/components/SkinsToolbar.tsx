import { Paintbrush } from "lucide-react";
import { Button, PageToolbar, Select, Tooltip } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { AddFileButton, ImportByName } from "./AddSkinControls";
import { useT } from "@/i18n";
import type { SkinsPageState } from "../hooks/useSkinsPage";

export function SkinsToolbar({ c }: { c: SkinsPageState }) {
  const t = useT();
  const { libraryTab, editShown, accounts, accountId, setChosen, account } = c;
  return (
    <div className="shrink-0 px-6 pb-4 pt-4">
      <PageToolbar
        actions={
          <>
            {libraryTab && (
              <>
                <ImportByName />
                <AddFileButton />
              </>
            )}
            <Tooltip content={t("skined.open_tip")}>
              <Button variant="ghost" icon={<Paintbrush size={15} />} onClick={editShown}>
                {t("skined.open")}
              </Button>
            </Tooltip>
          </>
        }
      >
        {accounts.length > 1 ? (
          <div className="w-[220px] min-w-[160px] shrink">
            <Select
              variant="ghost"
              value={accountId}
              onChange={(v) => setChosen(v)}
              options={accounts.map((a) => ({
                value: a.id,
                label: (
                  <span className="inline-flex items-center gap-2">
                    <PlayerHead uuid={a.uuid} name={a.username} size={18} />
                    {a.username}
                  </span>
                ),
              }))}
            />
          </div>
        ) : account ? (
          <span className="flex items-center gap-2 px-1 text-[13.5px] font-semibold text-text">
            <PlayerHead uuid={account.uuid} name={account.username} size={20} />
            {account.username}
          </span>
        ) : null}
      </PageToolbar>
    </div>
  );
}
