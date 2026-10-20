import { fmtPct, fmtPrice } from "./format.ts";
import { rsi, rsiSeries, sma, smaSeries, type Bar } from "./tech.ts";

export const SKILL_NOTE =
  "Mọi khuyến nghị mua phải qua đúng thứ tự: nợ margin, thị trường, ngành, thiết lập, rồi R:R sau phí. Nợ trên 10% vốn ròng thì không mua mới. Thị trường 0–5 điểm từ VN-Index: trên MA50, trên MA200, độ dốc MA20, thanh khoản, độ rộng. Điểm 0–1 không mua, 2–3 mua nửa, 4–5 mua đủ. Ngành chấm cùng cách trên rổ mẫu vì API không có VNFIN hay VNREAL. Mã nhận A phá vỡ nền, B hồi về hỗ trợ trong xu hướng tăng, C đảo chiều đã xác nhận, và D bắt đáy. D chỉ khi RSI từ 30 trở xuống và thanh khoản phiên đó cao hơn trung bình 10 phiên ít nhất 20%. Nếu VN-Index còn dưới MA50 hoặc MA20 đang dốc xuống thì bỏ đáy 1, chờ đáy 2: RSI lại quá bán, giá không thủng đáy 1 quá 3%, và thanh khoản tăng. Cắt lỗ tối đa 8%, R:R sau phí tối thiểu 2. Bán: cắt lỗ cứng, hòa vốn ở +1R, chốt một phần ở 2R và 3R, gãy hỗ trợ hoặc phân phối, ngành hoặc thị trường yếu, quá 15 phiên chưa đạt +1R. Không gửi lệnh lên sàn.";

const BUY_FEE = 0.0015;
const SELL_COST = 0.0025;
const DEBT_CAP = 0.1;
const MAX_STOP = 0.08;

export type Gate = "chặn" | "nửa" | "đủ";

export type LayerScore = {
  score: number;
  gate: Gate;
  factor: number;
  /** True when the index is still under MA50 or MA20 is falling. */
  falling?: boolean;
  lines: string[];
};

export type SetupId = "A" | "B" | "C" | "D";

export type Setup = {
  id: SetupId;
  entry: number;
  stop: number;
  invalid: string;
};

export type SignalCard = {
  ticker: string;
  stance: "mua" | "chờ" | "bỏ";
  setup: SetupId | null;
  price: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  r1: number | null;
  r3: number | null;
  riskPct: number | null;
  rr: number | null;
  shares: number;
  thesis: string;
};

export type ExitCard = {
  ticker: string;
  action: "bán" | "giảm" | "chốt một phần" | "dời cắt lỗ" | "giữ";
  reason: string;
};

export function debtRatio(margin: number, nav: number | null): number | null {
  if (nav == null || !(nav > 0)) return margin > 0 ? null : 0;
  return margin / nav;
}

export function portfolioNav(
  lots: { ticker: string; shares: number; avg: number }[],
  priceOf: (ticker: string) => number | null,
  cash: number | null,
  margin: number,
): number | null {
  if (!lots.length && cash == null) return null;
  let market = 0;
  for (const lot of lots) market += (priceOf(lot.ticker) ?? lot.avg) * lot.shares;
  return market + (cash ?? 0) - margin;
}

export function debtBlocks(margin: number, nav: number | null): boolean {
  const ratio = debtRatio(margin, nav);
  return ratio == null ? margin > 0 : ratio > DEBT_CAP;
}

export function scoreMarket(bars: Bar[], breadth: number | null): LayerScore {
  return scoreLayer(bars, breadth);
}

export function scoreSector(name: string, bars: Bar[], index: Bar[] | null, breadth: number | null): LayerScore {
  const closes = bars.map((bar) => bar.c);
  const price = closes.at(-1);
  const lines: string[] = [];
  if (!price || closes.length < 50) {
    return { score: 0, gate: "chặn", factor: 0, lines: [`${name}: chưa đủ dữ liệu rổ mẫu.`] };
  }
  let score = 0;
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma20s = smaSeries(closes, 20);
  const previous = ma20s.length > 5 ? ma20s[ma20s.length - 6] : null;
  if (ma50 != null && price >= ma50) score += 1;
  lines.push(ma50 != null && price >= ma50 ? "trên MA50" : "dưới MA50");
  if (ma20 != null && previous != null && ma20 >= previous) score += 1;
  lines.push(ma20 != null && previous != null && ma20 >= previous ? "MA20 dốc lên" : "MA20 không dốc lên");
  const mine = ret(bars, 20);
  const bench = index ? ret(index, 20) : null;
  if (mine != null && bench != null && mine > bench) score += 1;
  lines.push(mine == null || bench == null ? "chưa so được với VN-Index" : mine > bench ? "mạnh hơn VN-Index" : "yếu hơn VN-Index");
  if (breadth != null && breadth >= 0.6) score += 1;
  lines.push(breadth == null ? "chưa có độ rộng rổ" : `độ rộng rổ ${fmtPct(breadth * 100).replace("+", "")}`);
  lines.push("chưa có tin cơ bản ngành");
  const gate: Gate = score <= 2 ? "chặn" : score === 3 ? "nửa" : "đủ";
  return { score, gate, factor: gate === "chặn" ? 0 : gate === "nửa" ? 0.5 : 1, lines: [`${name}: ${lines.join(", ")}`] };
}

export function signal(input: {
  ticker: string;
  bars: Bar[];
  market: LayerScore;
  sector: LayerScore;
  nav: number | null;
  margin: number;
}): SignalCard {
  const price = input.bars.at(-1)?.c ?? null;
  const falling = marketStillFalling(input.market);
  const bottom = readBottom(input.bars);
  const trend = breakout(input.bars) ?? pullback(input.bars) ?? reversal(input.bars);
  const setup = trend ?? (bottom.phase === "second" || (bottom.phase === "first" && !falling) ? bottom.setup : null);
  const blocked = debtBlocks(input.margin, input.nav);
  const ratio = debtRatio(input.margin, input.nav);
  const fails: string[] = [];
  if (blocked) {
    fails.push(
      ratio == null
        ? "Cổng nợ: chưa tính được vốn ròng, không mua mới."
        : `Cổng nợ: nợ/vốn ròng ${fmtPct(ratio * 100).replace("+", "")}, trên 10%. Không mua mới.`,
    );
  }
  if (input.market.factor === 0 && setup?.id !== "D") fails.push(`Cổng thị trường: ${input.market.score}/5, không mua mới.`);
  if (input.sector.factor === 0) fails.push(`Cổng ngành: ${input.sector.lines[0] ?? "chưa chấm được"}.`);
  if (!setup && bottom.phase === "first" && falling) {
    fails.push("Đáy 1, RSI quá bán. Thị trường còn khả năng giảm, bỏ đáy này và chờ đáy 2 khi RSI lại từ 30 trở xuống, giá không thủng đáy 1 quá 3%, và thanh khoản tăng.");
  } else if (!setup && bottom.phase === "second" && !bottom.volumeUp) {
    fails.push("Có hình đáy 2 nhưng thanh khoản chưa tăng so với 10 phiên trước, chưa mua.");
  } else if (!setup && bottom.phase === "first" && !bottom.volumeUp) {
    fails.push("RSI quá bán nhưng thanh khoản chưa tăng, chưa bắt đáy.");
  } else if (!setup) fails.push("Không khớp thiết lập A, B, C hoặc đáy 2. RSI thấp mà thanh khoản không tăng thì bỏ.");
  const levels = setup ? levelsOf(setup.entry, setup.stop) : null;
  if (setup && levels && (levels.rr == null || levels.rr < 2)) {
    fails.push(`Cổng R:R sau phí tới 2R là ${levels.rr == null ? "không tính được" : trim(levels.rr)}, dưới 2.`);
  }
  const sizedMarket = setup?.id === "D" && input.market.factor === 0 ? { ...input.market, factor: 0.5, gate: "nửa" as const } : input.market;
  const shares = setup && levels && levels.rr != null && levels.rr >= 2 && !blocked && sizedMarket.factor > 0 && input.sector.factor > 0
    ? sizeShares(input.nav, setup.entry, sizedMarket, input.sector)
    : 0;
  if (setup && levels && levels.rr != null && levels.rr >= 2 && shares < 100 && fails.length === 0) {
    fails.push("Khối lượng dưới một lô 100 cổ phiếu.");
  }
  const stance = fails.length === 0 && shares >= 100 ? "mua" : "bỏ";
  const head = stance === "mua"
    ? `${input.ticker}. Quan điểm mua theo thiết lập ${setup?.id}. Khối lượng ${shares} cổ phiếu.`
    : `${input.ticker}: trợ lý không đưa vào danh mục khuyến nghị.`;
  const detail = [
    head,
    fails.join(" "),
    setup
      ? `Thiết lập ${setup.id}. Điểm mua ${fmtPrice(setup.entry)}. Cắt lỗ ${fmtPrice(setup.stop)}, rủi ro ${fmtPct(((setup.entry - setup.stop) / setup.entry) * 100).replace("+", "")}. 1R ${fmtPrice(levels!.r1)}, 2R ${fmtPrice(levels!.r2)}, 3R ${fmtPrice(levels!.r3)}. ${setup.invalid}`
      : "",
    `Thị trường ${input.market.score}/5 (${input.market.gate}). ${input.market.lines.join(" ")}`,
    `Ngành ${input.sector.score}/5 (${input.sector.gate}). ${input.sector.lines.join(" ")}`,
    "Phí tính 0,15% mua và 0,25% bán gồm thuế. Không phải lệnh lên sàn.",
  ].filter(Boolean).join(" ");
  return {
    ticker: input.ticker,
    stance,
    setup: setup?.id ?? null,
    price,
    entry: setup?.entry ?? null,
    stop: setup?.stop ?? null,
    target: levels?.r2 ?? null,
    r1: levels?.r1 ?? null,
    r3: levels?.r3 ?? null,
    riskPct: setup ? ((setup.entry - setup.stop) / setup.entry) * 100 : null,
    rr: levels?.rr ?? null,
    shares: stance === "mua" ? shares : 0,
    thesis: detail,
  };
}

export function exitPlan(input: {
  ticker: string;
  avg: number;
  price: number;
  stop: number | null;
  bars: Bar[];
  heldSessions: number | null;
  usingMargin: boolean;
  market: LayerScore;
  sector: LayerScore;
}): ExitCard {
  const { ticker, avg, price, stop, bars } = input;
  if (stop != null && stop > 0 && price <= stop) {
    const breach = (stop - price) / stop;
    const now = input.usingMargin && breach >= 0.02;
    return { ticker, action: "bán", reason: now ? `Giá thủng cắt lỗ hơn 2% khi đang vay. Bán ngay trong phiên.` : `Giá chạm cắt lỗ cứng ${fmtPrice(stop)}.` };
  }
  const closes = bars.map((bar) => bar.c);
  const ma50 = sma(closes, 50);
  if (ma50 != null && price < ma50) {
    return { ticker, action: "bán", reason: `Đóng cửa dưới MA50 ${fmtPrice(ma50)}. Hỗ trợ xu hướng đã gãy.` };
  }
  if (distribution(bars) || bearishDivergence(bars)) {
    return { ticker, action: "giảm", reason: distribution(bars) ? "Phiên phân phối: đóng cửa ở vùng thấp và khối lượng cao." : "Phân kỳ giảm: giá cao hơn nhưng RSI thấp hơn." };
  }
  const risk = stop != null && stop > 0 && stop < avg ? avg - stop : null;
  const multiple = risk ? (price - avg) / risk : null;
  if (multiple != null && multiple >= 3) {
    return { ticker, action: "chốt một phần", reason: `Đã đạt +3R. Chốt thêm một phần, giữ phần còn lại theo MA20.` };
  }
  if (multiple != null && multiple >= 2) {
    const ma20 = sma(closes, 20);
    return { ticker, action: "chốt một phần", reason: `Đã đạt +2R. Chốt một phần và dời cắt lỗ về ${ma20 ? `MA20 ${fmtPrice(ma20)}` : "đáy nhịp gần nhất"}.` };
  }
  if (multiple != null && multiple >= 1) {
    return { ticker, action: "dời cắt lỗ", reason: `Đã đạt +1R. Dời cắt lỗ về hòa vốn ${fmtPrice(avg)}.` };
  }
  if (input.heldSessions != null && input.heldSessions >= 15 && (multiple == null || multiple < 1)) {
    return { ticker, action: "giảm", reason: "Đã hơn 15 phiên mà chưa đạt +1R. Giảm hoặc thoát." };
  }
  if (input.sector.score <= 2) return { ticker, action: "giảm", reason: `Ngành ${input.sector.score}/5. Giảm vị thế.` };
  if (input.market.score <= 1) return { ticker, action: "giảm", reason: `Thị trường ${input.market.score}/5. Hạ tỷ trọng.` };
  return { ticker, action: "giữ", reason: "Chưa chạm cắt lỗ, chưa đủ 1R và chưa có tín hiệu hủy kèo." };
}

export function findSetup(bars: Bar[], marketFalling = false): Setup | null {
  const bottom = readBottom(bars);
  const fromBottom = bottom.phase === "second" || (bottom.phase === "first" && !marketFalling) ? bottom.setup : null;
  return breakout(bars) ?? pullback(bars) ?? reversal(bars) ?? fromBottom;
}

export function marketStillFalling(market: LayerScore): boolean {
  if (market.falling != null) return market.falling;
  const text = market.lines.join(" ");
  return text.includes("dưới MA50") || text.includes("MA20 không dốc lên") || market.factor === 0;
}

function scoreLayer(bars: Bar[], breadth: number | null): LayerScore {
  const closes = bars.map((bar) => bar.c);
  const price = closes.at(-1);
  const lines: string[] = [];
  let score = 0;
  if (!price || closes.length < 50) {
    lines.push("VN-Index: chưa đủ dữ liệu để chấm.");
    return { score: 0, gate: "chặn", factor: 0, lines };
  }
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const ma20s = smaSeries(closes, 20);
  const previous = ma20s.length > 5 ? ma20s[ma20s.length - 6] : null;
  if (ma50 != null && price >= ma50) score += 1;
  lines.push(ma50 != null && price >= ma50 ? "trên MA50" : "dưới MA50");
  if (ma200 != null && price >= ma200) score += 1;
  lines.push(ma200 == null ? "chưa đủ MA200" : price >= ma200 ? "trên MA200" : "dưới MA200");
  if (ma20 != null && previous != null && ma20 >= previous) score += 1;
  lines.push(ma20 != null && previous != null && ma20 >= previous ? "MA20 dốc lên" : "MA20 không dốc lên");
  const volumes = bars.map((bar) => bar.v).filter((volume) => volume > 0);
  const lastVolume = volumes.at(-1);
  const base = volumes.slice(-21, -1);
  if (lastVolume != null && base.length >= 10) {
    const avg = base.reduce((sum, volume) => sum + volume, 0) / base.length;
    if (lastVolume >= avg) score += 1;
    lines.push(lastVolume >= avg ? "thanh khoản đạt trung bình" : "thanh khoản dưới trung bình");
  } else lines.push("thiếu thanh khoản");
  if (breadth == null) lines.push("độ rộng nháp từ 10 mã lớn: chưa có");
  else {
    if (breadth >= 0.6) score += 1;
    lines.push(`độ rộng nháp từ 10 mã lớn ${fmtPct(breadth * 100).replace("+", "")}`);
  }
  const falling = (ma50 != null && price < ma50) || (previous != null && ma20 != null && ma20 < previous);
  const gate: Gate = score <= 1 ? "chặn" : score <= 3 ? "nửa" : "đủ";
  const factor = gate === "chặn" ? 0 : gate === "nửa" ? 0.5 : 1;
  return { score, gate, factor, falling, lines: [`VN-Index: ${lines.join(", ")}`] };
}

function ret(bars: Bar[], sessions: number): number | null {
  const closes = bars.map((bar) => bar.c);
  if (closes.length <= sessions) return null;
  const prev = closes[closes.length - 1 - sessions]!;
  const last = closes.at(-1)!;
  return prev > 0 ? ((last - prev) / prev) * 100 : null;
}

function levelsOf(entry: number, stop: number): { r1: number; r2: number; r3: number; rr: number | null } {
  const risk = entry - stop;
  const r1 = roundTick(entry + risk);
  const r2 = roundTick(entry + risk * 2);
  const r3 = roundTick(entry + risk * 3);
  const netRisk = entry * (1 + BUY_FEE) - stop * (1 - SELL_COST);
  const netReward = r2 * (1 - SELL_COST) - entry * (1 + BUY_FEE);
  return { r1, r2, r3, rr: netRisk > 0 ? netReward / netRisk : null };
}

function sizeShares(nav: number | null, entry: number, market: LayerScore, sector: LayerScore): number {
  if (nav == null || !(nav > 0) || market.factor === 0 || sector.factor === 0) return 0;
  const base = market.factor === 1 && sector.factor === 1 ? 0.0075 : 0.005;
  const budget = nav * base * market.factor * sector.factor;
  return Math.floor(budget / entry / 100) * 100;
}

function breakout(bars: Bar[]): Setup | null {
  if (bars.length < 21) return null;
  const last = bars.at(-1)!;
  const prior = bars.slice(-31, -1);
  if (prior.length < 15) return null;
  const high = Math.max(...prior.map((bar) => bar.h));
  const low = Math.min(...prior.map((bar) => bar.l));
  if (!(last.c > high)) return null;
  if ((high - low) / ((high + low) / 2) > 0.2) return null;
  const volumes = prior.slice(-20).map((bar) => bar.v).filter((volume) => volume > 0);
  if (!volumes.length || last.v < (volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length) * 1.5) return null;
  const stop = stopFor(last.c, Math.min(low, last.l));
  if (stop == null) return null;
  return { id: "A", entry: roundTick(last.c), stop, invalid: `Hủy nếu đóng cửa trở lại dưới đỉnh nền ${fmtPrice(roundTick(high))}.` };
}

function pullback(bars: Bar[]): Setup | null {
  const closes = bars.map((bar) => bar.c);
  const price = closes.at(-1);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma50s = smaSeries(closes, 50);
  const prev50 = ma50s.length > 10 ? ma50s[ma50s.length - 11] : null;
  if (!price || !ma20 || !ma50 || price < ma50) return null;
  if (prev50 != null && ma50 < prev50) return null;
  const gap = (price - ma20) / ma20;
  if (gap < -0.03 || gap > 0.02) return null;
  const swing = Math.min(...bars.slice(-10).map((bar) => bar.l));
  const stop = stopFor(price, swing);
  if (stop == null) return null;
  return { id: "B", entry: roundTick(price), stop, invalid: `Hủy nếu đóng cửa dưới MA50 ${fmtPrice(roundTick(ma50))}.` };
}

function reversal(bars: Bar[]): Setup | null {
  const closes = bars.map((bar) => bar.c);
  const price = closes.at(-1);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const now = rsi(closes);
  if (!price || !ma20 || !ma50 || now == null || price <= ma20 || now < 45) return null;
  const past = closes.at(-15);
  if (past == null || past >= ma50) return null;
  const trough = Math.min(...bars.slice(-15, -1).map((bar) => bar.l));
  if (!(bars.at(-1)!.l > trough)) return null;
  const stop = stopFor(price, trough);
  if (stop == null) return null;
  return { id: "C", entry: roundTick(price), stop, invalid: `Hủy nếu đóng cửa dưới đáy đảo chiều ${fmtPrice(roundTick(trough))}.` };
}

function readBottom(bars: Bar[]): { phase: "none" | "first" | "second"; volumeUp: boolean; setup: Setup | null } {
  const troughs = oversoldTroughs(bars);
  if (!troughs.length) return { phase: "none", volumeUp: false, setup: null };
  const latest = troughs[troughs.length - 1]!;
  if (bars.length - 1 - latest.index > 2) return { phase: "none", volumeUp: false, setup: null };
  const volumeUp = volumeRising(bars, latest.index) || volumeRising(bars, bars.length - 1);
  const earlier = troughs.filter((item) => latest.index - item.index >= 5);
  const prior = earlier[earlier.length - 1];
  const price = bars[bars.length - 1]!.c;
  if (prior && latest.low >= prior.low * 0.97 && latest.low <= prior.low * 1.08) {
    const stop = volumeUp ? stopFor(price, Math.min(prior.low, latest.low)) : null;
    return {
      phase: "second",
      volumeUp,
      setup: stop
        ? { id: "D", entry: roundTick(price), stop, invalid: `Đáy 2 sau đáy 1 ${fmtPrice(roundTick(prior.low))}. Hủy nếu đóng cửa thủng đáy 1 quá 3%.` }
        : null,
    };
  }
  const stop = volumeUp ? stopFor(price, latest.low) : null;
  return {
    phase: "first",
    volumeUp,
    setup: stop
      ? { id: "D", entry: roundTick(price), stop, invalid: "Đáy 1, chỉ xét vì thị trường không còn đà giảm. Hủy nếu đóng cửa dưới đáy này." }
      : null,
  };
}

function oversoldTroughs(bars: Bar[]): { index: number; low: number }[] {
  const series = rsiSeries(bars.map((bar) => bar.c));
  const raw: { index: number; low: number }[] = [];
  for (let index = 2; index < bars.length; index++) {
    const value = series[index];
    if (value == null || value > 30) continue;
    const low = bars[index]!.l;
    const before = low <= bars[index - 1]!.l && low <= bars[index - 2]!.l;
    const after = index >= bars.length - 2 || (low <= bars[index + 1]!.l && (index + 2 >= bars.length || low <= bars[index + 2]!.l));
    if (before && after) raw.push({ index, low });
  }
  const merged: { index: number; low: number }[] = [];
  for (const item of raw) {
    const prev = merged[merged.length - 1];
    if (prev && item.index - prev.index < 5) {
      if (item.low < prev.low) merged[merged.length - 1] = item;
      continue;
    }
    merged.push(item);
  }
  return merged;
}

function volumeRising(bars: Bar[], index: number): boolean {
  const prior = bars.slice(Math.max(0, index - 10), index).map((bar) => bar.v).filter((volume) => volume > 0);
  if (prior.length < 5) return false;
  const avg = prior.reduce((sum, volume) => sum + volume, 0) / prior.length;
  return bars[index]!.v >= avg * 1.2;
}

function stopFor(entry: number, structure: number): number | null {
  const stop = roundTick(Math.min(structure, entry * 0.995), "down");
  if (!(stop < entry)) return null;
  if ((entry - stop) / entry > MAX_STOP) return null;
  if ((entry - stop) / entry < 0.02) return null;
  return stop;
}

function distribution(bars: Bar[]): boolean {
  const last = bars.at(-1);
  if (!last) return false;
  const range = last.h - last.l;
  if (!(range > 0) || (last.c - last.l) / range > 0.25) return false;
  const volumes = bars.slice(-21, -1).map((bar) => bar.v).filter((volume) => volume > 0);
  if (volumes.length < 10) return false;
  const avg = volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length;
  return last.v >= avg * 1.5;
}

function bearishDivergence(bars: Bar[]): boolean {
  const closes = bars.map((bar) => bar.c);
  const series = rsiSeries(closes);
  if (closes.length < 20) return false;
  const recent = closes.slice(-10);
  const prior = closes.slice(-20, -10);
  const recentHigh = Math.max(...recent);
  const priorHigh = Math.max(...prior);
  if (!(recentHigh > priorHigh)) return false;
  const recentRsi = series.slice(-10)[recent.indexOf(recentHigh)];
  const priorRsi = series.slice(-20, -10)[prior.indexOf(priorHigh)];
  return recentRsi != null && priorRsi != null && recentRsi < priorRsi;
}

function tick(price: number): number {
  if (price < 10_000) return 10;
  if (price < 50_000) return 50;
  return 100;
}

function roundTick(price: number, dir: "down" | "near" = "near"): number {
  const step = tick(price);
  const next = dir === "down" ? Math.floor(price / step) * step : Math.round(price / step) * step;
  return next > 0 ? next : step;
}

function trim(value: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
}
