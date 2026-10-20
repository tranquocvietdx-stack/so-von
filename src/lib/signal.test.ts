import assert from "node:assert/strict";
import test from "node:test";
import { debtBlocks, exitPlan, findSetup, scoreMarket, signal, type LayerScore } from "./signal.ts";
import type { Bar } from "./tech.ts";

function bars(closes: number[], volume = 1000): Bar[] {
  return closes.map((close, index) => ({ t: index, o: close, h: close + 200, l: close - 200, c: close, v: volume }));
}

const open: LayerScore = { score: 5, gate: "đủ", factor: 1, lines: ["đủ"] };
const shut: LayerScore = { score: 0, gate: "chặn", factor: 0, lines: ["chặn"] };

test("cổng nợ chặn mua mới dù thiết lập đúng", () => {
  const rising = Array.from({ length: 80 }, (_, i) => 40000 + i * 30);
  const card = signal({ ticker: "FPT", bars: bars(rising), market: open, sector: open, nav: 330_000_000, margin: 250_000_000 });
  assert.equal(debtBlocks(250_000_000, 330_000_000), true);
  assert.equal(card.stance, "bỏ");
  assert.equal(card.shares, 0);
  assert.match(card.thesis, /Cổng nợ/);
});

test("phá vỡ nền được nhận, bắt đáy RSI thấp thì không", () => {
  const base = Array.from({ length: 25 }, () => 22000);
  const last = bars([...base, 22300], 1000);
  last[last.length - 1] = { ...last[last.length - 1]!, h: 22400, l: 22100, c: 22300, v: 4000 };
  const setup = findSetup(last);
  assert.equal(setup?.id, "A");
  const weak = bars(Array.from({ length: 40 }, (_, i) => 30000 - i * 200));
  assert.equal(findSetup(weak), null);
});

test("điểm bán cắt lỗ khi đang vay và thủng hơn 2%", () => {
  const card = exitPlan({
    ticker: "FPT",
    avg: 65000,
    price: 60000,
    stop: 63000,
    bars: bars(Array.from({ length: 60 }, () => 65000)),
    heldSessions: 4,
    usingMargin: true,
    market: open,
    sector: shut,
  });
  assert.equal(card.action, "bán");
  assert.match(card.reason, /2%/);
});

test("bỏ đáy 1 khi thị trường còn giảm, nhận đáy 2 khi RSI quá bán và thanh khoản tăng", () => {
  const first = wave(25000, 21000, 8);
  const bounce = wave(21000, 22500, 6).slice(1);
  const second = wave(22500, 21100, 6).slice(1);
  const flat = Array.from({ length: 24 }, () => 25000);
  const closes = [...flat, ...first, ...bounce, ...second];
  const series = bars(closes, 1000);
  const mark = (index: number) => {
    const bar = series[index]!;
    series[index] = { ...bar, l: bar.c * 0.96, v: index === series.length - 1 ? 4000 : bar.v };
  };
  mark(flat.length + first.length - 1);
  mark(series.length - 1);
  const falling: LayerScore = { score: 1, gate: "chặn", factor: 0, falling: true, lines: ["dưới MA50"] };
  const onlyFirst = series.slice(0, flat.length + first.length);
  onlyFirst[onlyFirst.length - 1] = { ...onlyFirst[onlyFirst.length - 1]!, v: 4000 };
  const skipped = signal({ ticker: "HPG", bars: onlyFirst, market: falling, sector: open, nav: 400_000_000, margin: 0 });
  assert.match(skipped.thesis, /Đáy 1/);
  assert.equal(skipped.stance, "bỏ");
  const setup = findSetup(series, true);
  assert.equal(setup?.id, "D");
  assert.match(setup?.invalid ?? "", /Đáy 2/);
});

function wave(from: number, to: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, index) => from + ((to - from) * (index + 1)) / steps);
}

test("thị trường dưới MA50 bị chặn mua", () => {
  const closes = Array.from({ length: 220 }, (_, i) => 1800 - i);
  const score = scoreMarket(bars(closes, 1_000_000), 0.2);
  assert.equal(score.factor, 0);
});
