import { Component, type ReactNode } from "react";
import { t } from "@/i18n";
import { PixelIcon } from "@/components/ui/pixel/PixelIcon";

/** Fängt Render-Fehler einer Ansicht ab, damit nie die ganze App weiß/leer wird. */
export class ErrorBoundary extends Component<{ children: ReactNode; compact?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("Ansicht abgestürzt", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <PixelIcon name="error" className="text-muted" />
        <div className="text-title text-text">{t("error.boundary.title")}</div>
        <p className="text-[13px] text-muted">{t("error.boundary.text")}</p>
        <pre className="selectable mt-2 max-h-40 max-w-[640px] overflow-auto rounded-card bg-surface p-3 text-left font-mono text-[11px] text-dim">
          {String(this.state.error?.stack ?? this.state.error)}
        </pre>
        <button
          className="mt-2 inline-flex h-8 items-center rounded-ctl bg-surface2 px-3 text-[13px] font-semibold text-text transition-colors hover:bg-surface3"
          onClick={() => this.setState({ error: null })}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }
}
