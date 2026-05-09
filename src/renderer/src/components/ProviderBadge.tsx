import type { ProviderId } from "@shared/providers";
import { PROVIDER_META } from "@shared/providers";

type Props = {
  provider: ProviderId;
  size?: "sm" | "md";
};

const TONE: Record<ProviderId, string> = {
  claude: "text-accent",
  codex: "text-ink-2",
  opencode: "text-ink-2",
};

export function ProviderBadge({ provider, size = "sm" }: Props) {
  const meta = PROVIDER_META[provider];
  const tone = TONE[provider];
  const cls = size === "md" ? "text-[12px]" : "text-[11px]";
  return (
    <span className={`inline-flex items-center font-mono ${tone} ${cls}`}>
      {meta.shortLabel}
    </span>
  );
}
