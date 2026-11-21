import { useEffect, useState, type ComponentType } from "react";

export function DeferredMount({ active, load }: { active: boolean; load: () => Promise<ComponentType> }) {
  const [View, setView] = useState<ComponentType>();
  const [failure, setFailure] = useState<{ error: unknown }>();

  useEffect(() => {
    if (!active || View) return;
    let current = true;
    load().then(
      (view) => { if (current) setView(() => view); },
      (error: unknown) => { if (current) setFailure({ error }); },
    );
    return () => { current = false; };
  }, [active, load, View]);

  if (failure) throw failure.error;
  return View ? <View /> : null;
}
