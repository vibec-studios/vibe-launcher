import type { LoaderKind } from "./instances";

export interface CustomLoaderRemote {
  name: string;
  url: string;
  size: number;
}

export interface CustomLoaderPreview {
  id: string;
  name: string;
  loader_version: string;
  description: string | null;
  author: string | null;
  homepage: string | null;
  icon: string | null;
  minecraft: string[];
  mods: LoaderKind;
  main_class: string;
  jvm_args: string[];
  game_args: string[];
  library_count: number;
  local_count: number;
  library_bytes: number;
  remote: CustomLoaderRemote[];
  exists: boolean;
  installed_versions: string[];
}

export interface CustomLoaderIssue {
  code: string;
  message: string;
  params: Record<string, string>;
}

export type CustomLoaderInspect = { status: "ok"; preview: CustomLoaderPreview } | { status: "error"; issue: CustomLoaderIssue };

export interface CustomLoaderPack {
  id: string;
  name: string;
  loader_version: string;
  description: string | null;
  author: string | null;
  homepage: string | null;
  minecraft: string[];
  mods: LoaderKind;
  main_class: string;
  icon_path: string | null;
  library_count: number;
  size_bytes: number;
  instances: number;
}
