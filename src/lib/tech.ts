import { fmtPct } from "./format.ts";

export type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Tech = {
  price: number;
  rsi: number | null;
  ma20: number | null;
  ma50: number | null;
  /** Percent distance from the moving average. */
  ma20gap: number | null;
  ma50gap: number | null;
  pct5: number | null;
  pct20: number | null;
};

export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function rsiSeries(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i]! - values[i - 1]!;
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function sma(values: number[], period: number): number | null {
  const series = smaSeries(values, period);
  return series[series.length - 1] ?? null;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i]! - values[i - 1]!;
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function summarize(bars: Bar[]): Tech | null {
  const closes = bars.map((b) => b.c).filter((c) => c > 0);
  if (closes.length < 20) return null;
  const price = closes[closes.length - 1]!;
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const prev5 = closes.length > 5 ? closes[closes.length - 6]! : null;
  const prev20 = closes.length > 20 ? closes[closes.length - 21]! : null;
  const gap = (ma: number | null) => (ma ? ((price - ma) / ma) * 100 : null);
  return {
    price,
    rsi: rsi(closes),
    ma20,
    ma50,
    ma20gap: gap(ma20),
    ma50gap: gap(ma50),
    pct5: prev5 ? ((price - prev5) / prev5) * 100 : null,
    pct20: prev20 ? ((price - prev20) / prev20) * 100 : null,
  };
}

export function techNote(tech: Tech): string {
  const parts: string[] = [];
  if (tech.ma20gap != null) {
    parts.push(
      tech.ma20gap >= 0
        ? `Trên MA20 ${fmtPct(tech.ma20gap)}`
        : `Dưới MA20 ${fmtPct(Math.abs(tech.ma20gap))}`,
    );
  }
  if (tech.rsi != null) {
    const rounded = Math.round(tech.rsi);
    if (rounded >= 70) parts.push(`RSI ${rounded}, vùng căng`);
    else if (rounded <= 30) parts.push(`RSI ${rounded}, vùng yếu`);
    else parts.push(`RSI ${rounded}`);
  }
  if (tech.pct20 != null) parts.push(`20 phiên ${fmtPct(tech.pct20)}`);
  return parts.join(" · ");
}
