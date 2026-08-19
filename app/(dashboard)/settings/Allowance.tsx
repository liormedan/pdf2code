"use client";

import { useTranslations } from "next-intl";
import { useActivity } from "@/src/lib/session-activity";

/**
 * What is left of this month.
 *
 * The number comes from the server, which is the only place it is written — a count the
 * browser kept for itself would be a count the browser could choose.
 */
export default function Allowance() {
  const t = useTranslations("settings");
  const { quota } = useActivity();

  if (!quota) return null;

  const used = Math.min(quota.used, quota.limit);
  const share = quota.limit > 0 ? used / quota.limit : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{t("allowance")}</p>
        <p className="tabular ms-auto font-mono text-xs text-muted-foreground">
          {t("allowanceCount", { used: quota.used, limit: quota.limit })}
        </p>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-label={t("allowance")}
      >
        <div
          className={quota.allowed ? "h-full bg-primary" : "h-full bg-destructive"}
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>

      <p className="max-w-[58ch] text-xs leading-relaxed text-muted-foreground">
        {t(quota.allowed ? "allowanceHint" : "allowanceSpent")}
      </p>
    </div>
  );
}
