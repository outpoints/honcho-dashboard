import type { IconName } from "@/components/icons";
import type { LevelTab } from "@/lib/peerMemory";

/**
 * One label, icon and tone per conclusion level, shared by every view that
 * shows levels so a level reads the same on Peers and on Dreams. Deductive
 * uses a merge (premises joining into a conclusion) rather than an arrow,
 * which reads as "'s view of" next to peer names. Explicit stays neutral ink
 * so the accent keeps meaning "interactive".
 */
export const LEVEL_META: Record<LevelTab, { label: string; icon?: IconName; tone: string; noun: string }> = {
  all: { label: "ALL", tone: "text-text-muted", noun: "" },
  inductive: { label: "INDUCTIVE", icon: "trending-up", tone: "text-pink-400", noun: "inductive " },
  deductive: { label: "DEDUCTIVE", icon: "merge", tone: "text-blue-400", noun: "deductive " },
  explicit: { label: "EXPLICIT", icon: "eye", tone: "text-text-primary", noun: "explicit " },
};

export function levelMeta(level: string | null | undefined) {
  return LEVEL_META[(level ?? "") as LevelTab] ?? { label: (level ?? "unknown").toUpperCase(), tone: "text-purple-400", noun: "" };
}
