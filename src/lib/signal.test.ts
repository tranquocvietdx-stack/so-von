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

test("thị trường dưới MA50 bị chặn mua", () => {
  const closes = Array.from({ length: 220 }, (_, i) => 1800 - i);
  const score = scoreMarket(bars(closes, 1_000_000), 0.2);
  assert.equal(score.factor, 0);
});
