import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnboarding } from "@/features/onboarding/store";
import { useLang } from "@/i18n";
import { tourById } from "../content/catalog";
import { useHelpContent } from "../content";
import type { TourAction, TourDef } from "../types";
import { closeAction, resolveRoute, runAction } from "./actions";
import { clipBox, place, type Box } from "./geometry";
import { bringIntoView, findTarget, hostFor, reducedMotion } from "./locate";
import { endTour, goToStep, useTours } from "./store";
import { TourBubble } from "./TourBubble";

const PAD = 6;
const W = 320;

export function TourHost() {
  const active = useTours((s) => s.active);
  const onboarding = useOnboarding((s) => s.open);
  const tour = active ? tourById(active.id) : undefined;
  if (!active || !tour || onboarding) return null;
  return <TourRun key={tour.id} tour={tour} index={Math.min(active.step, tour.steps.length - 1)} />;
}

type Found = { el: HTMLElement; id: string };

function sameLocation(href: string, current: { pathname: string; search: Record<string, unknown> }) {
  const url = new URL(href, "http://x");
  if (decodeURIComponent(url.pathname) !== decodeURIComponent(current.pathname)) return false;
  for (const [k, v] of url.searchParams) if (String(current.search[k] ?? "") !== v) return false;
  return true;
}

function TourRun({ tour, index }: { tour: TourDef; index: number }) {
  const content = useHelpContent().tours[tour.id];
  const nav = useNavigate();
  const location = useRouterState({ select: (s) => ({ pathname: s.location.pathname, search: s.location.search as Record<string, unknown> }) });
  const locRef = useRef(location);
  locRef.current = location;
  const step = tour.steps[index];
  const dir = useRef<1 | -1>(1);
  const skipped = useRef(new Set<number>());
  const opened = useRef<TourAction | undefined>(undefined);
  const restore = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [found, setFound] = useState<Found | null>(null);
  const [status, setStatus] = useState<"search" | "found" | "missing">("search");
  const [rect, setRect] = useState<Box | null>(null);
  const [bubbleH, setBubbleH] = useState(190);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const finish = (completed: boolean) => {
    if (opened.current) closeAction(opened.current);
    opened.current = undefined;
    endTour(completed);
    const back = restore.current;
    if (back?.isConnected) back.focus({ preventScroll: true });
  };

  const move = (d: 1 | -1) => {
    dir.current = d;
    const next = index + d;
    if (next >= tour.steps.length) return finish(true);
    goToStep(next < 0 ? Math.min(index + 1, tour.steps.length - 1) : next);
  };

  useEffect(() => {
    if (opened.current && opened.current !== step.open) closeAction(opened.current);
    opened.current = step.open;
    if (step.expert && useLang.getState().simple) {
      skipped.current.add(index);
      const next = index + dir.current;
      if (next >= tour.steps.length) finish(true);
      else goToStep(Math.max(0, next));
      return;
    }
    if (step.route) {
      const href = resolveRoute(step.route);
      if (href && !sameLocation(href, locRef.current)) nav({ href } as never);
    }
    if (step.open) runAction(step.open);
    setFound(null);
    setRect(null);
    setStatus("search");
    let tries = 0;
    let timer = 0;
    const limit = step.optional ? (step.route || step.open ? 10 : 4) : 24;
    const tick = () => {
      const f = findTarget(step.targets);
      if (f) {
        skipped.current.delete(index);
        bringIntoView(f.el);
        setFound(f);
        setStatus("found");
        return;
      }
      if (++tries > limit) {
        if (step.optional) {
          skipped.current.add(index);
          move(dir.current);
        }
        else setStatus("missing");
        return;
      }
      timer = window.setTimeout(tick, 125);
    };
    timer = window.setTimeout(tick, step.route || step.open ? 140 : 0);
    return () => window.clearTimeout(timer);
  }, [tour.id, index]);

  useLayoutEffect(() => {
    if (!found) return;
    let el = found.el;
    const update = () => {
      if (!el.isConnected) {
        const again = findTarget(step.targets);
        if (!again) return;
        el = again.el;
      }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height ? prev : { left: r.left, top: r.top, width: r.width, height: r.height },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const iv = window.setInterval(update, 400);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearInterval(iv);
    };
  }, [found]);

  useLayoutEffect(() => {
    const h = bubbleRef.current?.offsetHeight;
    if (h && h !== bubbleH) setBubbleH(h);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
      else if (e.key === "ArrowRight" && status !== "search") move(1);
      else if (e.key === "ArrowLeft" && status !== "search" && [...Array(index).keys()].some((i) => !skipped.current.has(i))) move(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => {
    return () => {
      if (opened.current && !useTours.getState().active) closeAction(opened.current);
    };
  }, []);

  if (!step || !content) return null;
  const host = hostFor(found?.el ?? null);
  const inDialog = host !== document.body;
  const hr = inDialog ? host.getBoundingClientRect() : null;
  const frame = { left: hr?.left ?? 0, top: hr?.top ?? 0, width: hr?.width ?? window.innerWidth, height: hr?.height ?? window.innerHeight };
  const hole =
    status === "found" && rect
      ? clipBox({ left: rect.left - frame.left - PAD, top: rect.top - frame.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }, frame)
      : null;
  const spot = hole && hole.width > 0 && hole.height > 0 ? hole : null;
  const placement = place(spot, frame, { w: Math.min(W, frame.width - 24), h: bubbleH });
  const text = content.steps[index] ?? { title: content.title, text: "" };
  const variant = found ? text.variants?.[found.id] : undefined;
  const motion = !reducedMotion();

  return createPortal(
    <div data-tour-ui="" className={inDialog ? "absolute inset-0 z-[70]" : "fixed inset-0 z-[70]"} onPointerDown={(e) => e.stopPropagation()}>
      {status === "search" ? null : spot ? (
        <div
          aria-hidden
          className="pointer-events-none absolute outline outline-2 outline-[var(--ui-accent)]"
          style={{
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.62)",
            borderRadius: "var(--r-card)",
            transition: motion ? "left .2s, top .2s, width .2s, height .2s" : undefined,
          }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/60" />
      )}
      {status !== "search" && (
        <TourBubble
          ref={bubbleRef}
          key={index}
          width={Math.min(W, frame.width - 24)}
          placement={placement}
          tourTitle={content.title}
          title={variant?.title ?? text.title}
          text={variant?.text ?? text.text}
          missing={status === "missing"}
          index={index}
          position={index - [...skipped.current].filter((i) => i < index).length}
          total={tour.steps.length - skipped.current.size}
          onNext={() => move(1)}
          onBack={() => move(-1)}
          onSkip={() => finish(false)}
        />
      )}
    </div>,
    host,
  );
}
