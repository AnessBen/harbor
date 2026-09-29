import { ArrowUpRight } from "lucide-react";
import elfLogo from "@/assets/elfhosted.svg";
import { useT } from "@/lib/i18n";
import { openUrl } from "@/lib/window";
import { elfProductFor, elfProductUrl } from "@/lib/addons-store/elfhosted";

export function ElfHostedAction({
  addonId,
  addonName,
  transportUrl,
}: {
  addonId?: string | null;
  addonName?: string | null;
  transportUrl?: string | null;
}) {
  const t = useT();
  const product = elfProductFor({ id: addonId, name: addonName, url: transportUrl });
  if (!product) return null;

  return (
    <div className="group/elf relative inline-flex">
      <button
        type="button"
        onClick={() => openUrl(elfProductUrl(product.slug))}
        className="flex h-11 items-center gap-2 rounded-full border border-edge ps-2 pe-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-elevated"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-canvas ring-1 ring-edge-soft">
          <img src={elfLogo} alt="" draggable={false} className="h-[18px] w-[18px] object-contain" />
        </span>
        {t("Hosted elsewhere")}
        <ArrowUpRight size={13} strokeWidth={2.2} className="opacity-70" />
      </button>

      <div
        role="tooltip"
        className="pointer-events-none absolute top-[calc(100%+10px)] z-40 w-[290px] translate-y-1 rounded-2xl border border-edge bg-elevated/95 p-3.5 opacity-0 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75)] backdrop-blur-xl transition-all duration-150 group-hover/elf:translate-y-0 group-hover/elf:opacity-100 start-0"
      >
        <div className="flex items-center gap-2">
          <img src={elfLogo} alt="" draggable={false} className="h-4 w-4 shrink-0 object-contain" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-subtle">
            {t("ElfHosted")}
          </span>
        </div>
        <p className="mt-2 text-[13px] font-semibold leading-snug text-ink">
          {t("{name} can run on a hosted instance", { name: product.label })}
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
          {t("A third party operates this. Harbor is not affiliated with them, does not resell it, and receives nothing if you sign up. Whatever it costs and whatever it includes is on their site.")}
        </p>
      </div>
    </div>
  );
}
