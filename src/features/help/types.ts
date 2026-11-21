export type GuideId =
  | "first-instance"
  | "modpack"
  | "mods"
  | "import"
  | "autofix"
  | "backups"
  | "hosting"
  | "servers"
  | "skins"
  | "modsets"
  | "gallery"
  | "waitlist"
  | "bedrock"
  | "feedback"
  | "performance";

export type TourId = "intro" | Exclude<GuideId, "bedrock">;

export type TourAction = "settings:java" | "settings:game" | "settings:vibe" | "settings:about" | "import:launcher" | "instance-settings:perf";

export interface TourStepDef {
  targets: string[];
  route?: string;
  open?: TourAction;
  optional?: boolean;
}

export interface TourDef {
  id: TourId;
  guide?: GuideId;
  steps: TourStepDef[];
}

export interface GuideDef {
  id: GuideId;
  icon: string;
  tour?: TourId;
}

export interface StepText {
  title: string;
  text: string;
  variants?: Record<string, { title: string; text: string }>;
}

export interface GuideText {
  title: string;
  summary: string;
  steps: string[];
  tips?: string[];
  keywords?: string;
}

export interface TourText {
  title: string;
  steps: StepText[];
}

export interface HelpContent {
  guides: Record<GuideId, GuideText>;
  tours: Record<TourId, TourText>;
}
