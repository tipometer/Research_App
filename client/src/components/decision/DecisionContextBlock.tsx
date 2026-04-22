import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertTriangle, HelpCircle, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { DecisionPanel } from "./DecisionPanel";

type Props = { researchId: number };

export function DecisionContextBlock({ researchId }: Props) {
  const { t } = useTranslation();
  const query = trpc.validation.getSnapshot.useQuery(
    { researchId },
    {
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  // Fallback 1: pre-PR #13 research → NOT_FOUND → render nothing
  if (query.error?.data?.code === "NOT_FOUND") {
    return null;
  }

  // Loading: 4 skeleton tiles in 2×2 grid
  if (query.isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  // Other errors: silent fallback (dev-only console.error)
  if (query.error || !query.data) {
    if (import.meta.env.DEV && query.error) {
      // eslint-disable-next-line no-console
      console.error("DecisionContextBlock error:", query.error);
    }
    return null;
  }

  const snapshot = query.data;
  // Drizzle infers json() columns as `unknown`; the DB contract guarantees string[] | null.
  const positiveDrivers = (snapshot.positiveDrivers as string[] | null) ?? [];
  const negativeDrivers = (snapshot.negativeDrivers as string[] | null) ?? [];
  const missingEvidence = (snapshot.missingEvidence as string[] | null) ?? [];
  const nextActions = (snapshot.nextActions as string[] | null) ?? [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <DecisionPanel
        title={t("report.decision.positiveDrivers.title")}
        items={positiveDrivers}
        emptyText={t("report.decision.positiveDrivers.empty")}
        tone="positive"
        icon={CheckCircle2}
      />
      <DecisionPanel
        title={t("report.decision.negativeDrivers.title")}
        items={negativeDrivers}
        emptyText={t("report.decision.negativeDrivers.empty")}
        tone="negative"
        icon={AlertTriangle}
      />
      <DecisionPanel
        title={t("report.decision.missingEvidence.title")}
        items={missingEvidence}
        emptyText={t("report.decision.missingEvidence.empty")}
        tone="warning"
        icon={HelpCircle}
      />
      <DecisionPanel
        title={t("report.decision.nextActions.title")}
        items={nextActions}
        emptyText={t("report.decision.nextActions.empty")}
        tone="info"
        icon={ArrowRight}
        numbered
      />
    </div>
  );
}
