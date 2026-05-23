import type { Platform } from "./tauri";

export type PlatformMeta = {
  id: Platform;
  label: string;
  accent: string;
  charLimit: number | null;
  requiresImage: boolean;
  requiresVideo: boolean;
};

export const PLATFORMS: PlatformMeta[] = [
  {
    id: "facebook",
    label: "Facebook Page",
    accent: "#1877f2",
    charLimit: null,
    requiresImage: false,
    requiresVideo: false,
  },
  {
    id: "instagram",
    label: "Instagram",
    accent: "#e1306c",
    charLimit: 2200,
    requiresImage: true,
    requiresVideo: false,
  },
  {
    id: "threads",
    label: "Threads",
    accent: "#a855f7",
    charLimit: 500,
    requiresImage: false,
    requiresVideo: false,
  },
  {
    id: "youtube",
    label: "YouTube",
    accent: "#ff0000",
    charLimit: 5000,
    requiresImage: false,
    requiresVideo: true,
  },
  {
    id: "tiktok",
    label: "TikTok (未實作)",
    accent: "#25f4ee",
    charLimit: 2200,
    requiresImage: false,
    requiresVideo: true,
  },
];

export function platformAccent(id: Platform): string {
  return PLATFORMS.find((p) => p.id === id)?.accent ?? "#888";
}

export function platformLabel(id: Platform): string {
  return PLATFORMS.find((p) => p.id === id)?.label ?? id;
}
