import { useState } from "react";
import { fmtPct, fmtPrice, fmtVol, fmtWhen, toneClass } from "@/lib/format";
import { rsiSeries, smaSeries, type Bar } from "@/lib/tech";

export function CandleChart({ bars, intraday }: { bars: Bar[]; intraday: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  if (bars.length < 2) {
    return <p className="py-10 text-sm text-muted">Chưa đủ nến cho khung này.</p>;
  }

  const index = active == null ? bars.length - 1 : active;
  const bar = bars[index]!;
  const prev = bars[index - 1] ?? bar;
  const delta = prev.c ? ((bar.c - prev.c) / prev.c) * 100 : 0;
  const closes = bars.map((item) => item.c);
  const ma20 = smaSeries(closes, 20);
  const ma50 = smaSeries(closes, 50);
  const rsi = rsiSeries(closes);
  const maLabel = intraday ? "TB" : "MA";

  const width = 360;
  const height = 268;
  const top = 8;
  const plotH = 150;
  const volumeTop = top + plotH + 8;
  const volumeH = 28;
  const rsiTop = volumeTop + volumeH + 10;
  const rsiH = 46;
  const highs = bars.map((item) => item.h);
  const lows = bars.map((item) => item.l);
  const max = Math.max(...highs, ...ma20.filter((v): v is number => v != null), ...ma50.filter((v): v is number => v != null));
  const min = Math.min(...lows, ...ma20.filter((v): v is number => v != null), ...ma50.filter((v): v is number => v != null));
  const span = max - min || 1;
  const maxVol = Math.max(...bars.map((item) => item.v), 1);
  const slot = width / bars.length;

  const y = (value: number) => top + ((max - value) / span) * plotH;
  const x = (i: number) => i * slot + slot / 2;
  const yRsi = (value: number) => rsiTop + ((100 - value) / 100) * rsiH;
  const pick = (clientX: number, rect: DOMRect) => {
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(bars.length - 1, Math.max(0, Math.round(ratio * (bars.length - 1))));
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-xs text-subtle">{fmtWhen(bar.t, intraday)}</p>
        <p className={`text-sm font-medium tabular-nums ${toneClass(delta)}`}>{fmtPct(delta)}</p>
      </div>
      <p className="mb-2 text-xs tabular-nums text-muted">
        M {fmtPrice(bar.o)} · C {fmtPrice(bar.c)} · H {fmtPrice(bar.h)} · L {fmtPrice(bar.l)} · {fmtVol(bar.v)}
      </p>
      <p className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-subtle">
        <span>{maLabel}20 {ma20[index] == null ? "—" : fmtPrice(ma20[index])}</span>
        <span>{maLabel}50 {ma50[index] == null ? "—" : fmtPrice(ma50[index])}</span>
        <span>RSI {rsi[index] == null ? "—" : Math.round(rsi[index]).toString()}</span>
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-64 w-full touch-pan-y"
        role="img"
        aria-label="Biểu đồ nến với trung bình và RSI"
        onPointerMove={(event) => setActive(pick(event.clientX, event.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setActive(null)}
      >
        <line x1="0" x2={width} y1={yRsi(70)} y2={yRsi(70)} stroke="var(--color-line)" strokeWidth="1" />
        <line x1="0" x2={width} y1={yRsi(30)} y2={yRsi(30)} stroke="var(--color-line)" strokeWidth="1" />
        <text x="0" y={yRsi(70) - 2} fill="var(--color-subtle)" fontSize="9">70</text>
        <text x="0" y={yRsi(30) - 2} fill="var(--color-subtle)" fontSize="9">30</text>
        {bars.map((item, i) => {
          const cx = x(i);
          const up = item.c >= item.o;
          const color = up ? "var(--color-up)" : "var(--color-down)";
          const body = Math.max(1.2, Math.abs(y(item.o) - y(item.c)));
          const bodyY = y(Math.max(item.o, item.c));
          const volH = Math.max(1, (item.v / maxVol) * volumeH);
          const marked = i === index;
          return (
            <g key={item.t}>
              {marked ? <line x1={cx} x2={cx} y1={top} y2={rsiTop + rsiH} stroke="var(--color-line)" strokeWidth="1" /> : null}
              <line x1={cx} x2={cx} y1={y(item.h)} y2={y(item.l)} stroke={color} strokeWidth="1" />
              <rect x={cx - Math.max(0.8, slot * 0.28)} y={bodyY} width={Math.max(1.6, slot * 0.56)} height={body} fill={color} />
              <rect
                x={cx - Math.max(0.8, slot * 0.28)}
                y={volumeTop + volumeH - volH}
                width={Math.max(1.6, slot * 0.56)}
                height={volH}
                fill={color}
                opacity={marked ? 0.9 : 0.35}
              />
            </g>
          );
        })}
        <path d={linePath(ma20, x, y)} fill="none" stroke="var(--color-fg)" strokeWidth="1.25" />
        <path d={linePath(ma50, x, y)} fill="none" stroke="var(--color-accent)" strokeWidth="1.25" />
        <path d={linePath(rsi, x, yRsi)} fill="none" stroke="var(--color-fg)" strokeWidth="1.25" opacity="0.7" />
      </svg>
      <p className="mt-2 text-xs text-subtle">Nét đậm là {maLabel}20, nét xanh là {maLabel}50, dải dưới là RSI 14. Kéo để đọc từng nến.</p>
    </div>
  );
}

function linePath(values: (number | null)[], x: (i: number) => number, y: (value: number) => number): string {
  let path = "";
  let drawing = false;
  values.forEach((value, i) => {
    if (value == null || !Number.isFinite(value)) {
      drawing = false;
      return;
    }
    path += `${drawing ? "L" : "M"}${x(i).toFixed(1)} ${y(value).toFixed(1)}`;
    drawing = true;
  });
  return path;
}
