import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DecisionPanelTone = "positive" | "negative" | "warning" | "info";

const TONE_STYLES: Record<DecisionPanelTone, { border: string; iconColor: string }> = {
  positive: {
    border: "border-green-200 dark:border-green-900",
    iconColor: "text-green-600 dark:text-green-400",
  },
  negative: {
    border: "border-red-200 dark:border-red-900",
    iconColor: "text-red-600 dark:text-red-400",
  },
  warning: {
    border: "border-yellow-200 dark:border-yellow-900",
    iconColor: "text-yellow-600 dark:text-yellow-400",
  },
  info: {
    border: "border-blue-200 dark:border-blue-900",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
};

type Props = {
  title: string;
  items: string[];
  emptyText: string;
  tone: DecisionPanelTone;
  icon: LucideIcon;
  numbered?: boolean;
};

export function DecisionPanel({ title, items, emptyText, tone, icon: Icon, numbered = false }: Props) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <Card className={cn("h-full", toneStyle.border)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className={cn("h-4 w-4", toneStyle.iconColor)} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{emptyText}</p>
        ) : numbered ? (
          <ol className="list-decimal list-inside space-y-1 text-sm">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        ) : (
          <ul className="list-disc list-inside space-y-1 text-sm">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
