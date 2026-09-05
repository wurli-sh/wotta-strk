import { Minus, TrendingDown, TrendingUp } from "lucide-react";

export type ApyMovementData = {
  direction: "up" | "down" | "flat";
  percentagePoints: number;
  relativePercent: number | null;
};

export function calculateApyMovement(
  currentApy: number,
  previousApy: number,
): ApyMovementData {
  const percentagePoints = currentApy - previousApy;
  return {
    direction:
      Math.abs(percentagePoints) < 0.005
        ? "flat"
        : percentagePoints > 0
          ? "up"
          : "down",
    percentagePoints,
    relativePercent:
      previousApy === 0
        ? null
        : (percentagePoints / Math.abs(previousApy)) * 100,
  };
}

function signed(value: number, digits: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

export function ApyMovement({
  apy,
  previousApy,
  utilization,
}: {
  apy: number | null;
  previousApy: number | null;
  utilization: number | null;
}) {
  if (apy === null) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Live rate unavailable
      </p>
    );
  }

  const utilizationLabel =
    utilization === null ? null : `${utilization.toFixed(0)}% utilized`;

  if (previousApy === null) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {utilizationLabel ?? "Waiting for the next market snapshot"}
      </p>
    );
  }

  const movement = calculateApyMovement(apy, previousApy);
  const Icon =
    movement.direction === "up"
      ? TrendingUp
      : movement.direction === "down"
        ? TrendingDown
        : Minus;
  const color =
    movement.direction === "up"
      ? "text-success"
      : movement.direction === "down"
        ? "text-destructive"
        : "text-muted-foreground";
  const relative =
    movement.relativePercent === null
      ? ""
      : ` (${signed(movement.relativePercent, 2)}%)`;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span
        className={`inline-flex items-center gap-1 font-mono font-semibold tabular-nums ${color}`}
        aria-label={`Supply APY is ${movement.direction} ${Math.abs(movement.percentagePoints).toFixed(2)} percentage points since the previous market update`}
      >
        <Icon className="size-3.5" aria-hidden />
        {signed(movement.percentagePoints, 2)} pp{relative}
      </span>
      <span className="text-muted-foreground">
        Since prior update{utilizationLabel ? ` · ${utilizationLabel}` : ""}
      </span>
    </div>
  );
}
