import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Dimension = "all" | "market_size" | "competition" | "feasibility" | "monetization" | "timeliness";

const DIMENSIONS: Array<{ key: Dimension; i18nKey: string }> = [
  { key: "all", i18nKey: "report.sources.dimensionChips.all" },
  { key: "market_size", i18nKey: "report.sources.dimensionChips.marketSize" },
  { key: "competition", i18nKey: "report.sources.dimensionChips.competition" },
  { key: "feasibility", i18nKey: "report.sources.dimensionChips.feasibility" },
  { key: "monetization", i18nKey: "report.sources.dimensionChips.monetization" },
  { key: "timeliness", i18nKey: "report.sources.dimensionChips.timeliness" },
];

type Props = {
  selected: Dimension;
  onSelect: (dim: Dimension) => void;
  disabled?: boolean;
};

export function DimensionChips({ selected, onSelect, disabled = false }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {DIMENSIONS.map(({ key, i18nKey }) => (
        <Badge
          key={key}
          variant={selected === key ? "default" : "outline"}
          className={cn(
            "cursor-pointer select-none",
            disabled && "opacity-50 cursor-not-allowed pointer-events-none",
          )}
          onClick={() => !disabled && onSelect(key)}
        >
          {t(i18nKey)}
        </Badge>
      ))}
    </div>
  );
}
