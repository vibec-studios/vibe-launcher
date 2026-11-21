import {
  Archive,
  Boxes,
  Box,
  Cloud,
  Gauge,
  Globe2,
  Images,
  Layers,
  MessageSquareWarning,
  Package,
  PackageOpen,
  Plus,
  Server,
  Shirt,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  plus: Plus,
  package: Package,
  boxes: Boxes,
  import: PackageOpen,
  wrench: Wrench,
  archive: Archive,
  globe: Globe2,
  server: Server,
  shirt: Shirt,
  layers: Layers,
  images: Images,
  cloud: Cloud,
  cube: Box,
  message: MessageSquareWarning,
  gauge: Gauge,
  sparkles: Sparkles,
};

export function GuideIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Sparkles;
  return <Icon size={size} />;
}
