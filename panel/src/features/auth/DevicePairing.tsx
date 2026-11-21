import { useEffect, useState } from "react";
import type { AccountApi } from "@/api/gateway";
import type { DeviceStart } from "@/api/types";
import { useT } from "@/i18n";
import { Button, Notice, Spinner } from "@/components/ui";

export function DevicePairing({ account, onSignedIn }: { account: AccountApi; onSignedIn: () => void }) {
  const t = useT();
  const [start, setStart] = useState<DeviceStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setStart(null);
    setError(null);
    setExpired(false);
    account.deviceStart().then(
      (s) => {
        if (!alive) return;
        setStart(s);
        const until = Date.now() + s.expiresIn * 1000;
        const poll = async () => {
          if (!alive) return;
          if (Date.now() > until) return setExpired(true);
          try {
            if ((await account.devicePoll(s.deviceToken)) === "authorized") return alive && onSignedIn();
          } catch (e) {
            if (!alive) return;
            return setError((e as Error).message);
          }
          timer = setTimeout(poll, Math.max(1, s.interval) * 1000);
        };
        timer = setTimeout(poll, s.interval * 1000);
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [account, attempt, onSignedIn]);

  if (error || expired) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone={expired ? "warn" : "danger"}>{expired ? t("device.expired") : error}</Notice>
        <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
          {t("device.retry")}
        </Button>
      </div>
    );
  }
  if (!start) {
    return (
      <div className="flex justify-center py-6 text-muted">
        <Spinner size={22} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 rounded-card bg-surface2 p-5">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] text-muted">
        <li>{t("device.step1")}</li>
        <li>{t("device.step2")}</li>
      </ol>
      <div className="rounded-card bg-field py-4 text-center font-mono text-[30px] font-bold tracking-[0.18em] select-all" aria-label={t("device.code")}>
        {start.code}
      </div>
      <div className="flex items-center justify-center gap-2 text-meta text-muted">
        <Spinner size={14} />
        {t("device.waiting")}
      </div>
    </div>
  );
}
