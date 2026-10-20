import { fmtPct, fmtPrice } from "@/lib/format";
import { rsi, sma, type Bar } from "@/lib/tech";

export { SKILL_NOTE } from "@/lib/signal";

export type Stance = "mua" | "chờ" | "bỏ";

export type Assessment = {
  ticker: string;
  stance: Stance;
  price: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskPct: number | null;
  thesis: string;
};

export type AssessFacts = {
  broker?: { recommend: string | null; mean: number | null; source: string | null } | null;
  pe?: number | null;
  peIndustry?: number | null;
  peg?: number | null;
  profits?: Array<number | null>;
  marketUp?: boolean | null;
};

export function assessEntry(ticker: string, bars: Bar[], facts: AssessFacts = {}): Assessment {
  const closes = bars.map((bar) => bar.c).filter((close) => close > 0);
  const price = closes.at(-1) ?? null;
  if (!price || bars.length < 20 || closes.length < 20) {
    return empty(ticker, price, "Chưa đủ chuỗi giá để chấm điểm mua, dừng lỗ và điểm bán.");
  }
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const rsiNow = rsi(closes);
  if (!ma20 || !ma50 || rsiNow == null) return empty(ticker, price, "Thiếu MA50 hoặc RSI.");
  const gap = ((price - ma20) / ma20) * 100;
  if (price < ma50) {
    return empty(ticker, price, `Giá dưới MA50 ${fmtPct(((price - ma50) / ma50) * 100)}. Xu hướng chưa tăng, không có điểm mua.`);
  }
  if (rsiNow <= 35 && gap < -2) {
    return empty(ticker, price, `RSI ${Math.round(rsiNow)} và giá dưới MA20. Vùng yếu, chưa có điểm mua chuẩn.`);
  }

  const extended = rsiNow >= 70 || gap > 6;
  const pullback = gap >= -3 && gap <= 2 && rsiNow >= 45 && rsiNow < 70;
  const entry = roundTick(pullback && gap <= 1.5 && !extended ? price : ma20, "near");
  const swing = Math.min(...bars.slice(-10).map((bar) => bar.l).filter((low) => low > 0));
  const range = atr(bars);
  const stop = stopUnder(entry, Number.isFinite(swing) ? swing : null, range);
  if (stop == null) return empty(ticker, price, "Không dựng được điểm dừng lỗ dưới điểm mua.");
  const riskPct = ((entry - stop) / entry) * 100;
  const target = roundTick(entry + 2 * (entry - stop), "near");
  const notes: string[] = [];
  if (facts.marketUp === false) notes.push("VN-Index đang dưới MA20, chưa mở mua mới.");
  if (facts.marketUp === true) notes.push("VN-Index còn trên MA20.");
  const volume = volumeNote(bars);
  if (volume) notes.push(volume);
  const finance = financeNote(facts);
  if (finance) notes.push(finance);
  const blocked = facts.marketUp === false || Boolean(volume) || financeBlocks(facts);
  const stance: Stance = pullback && !extended && !blocked ? "mua" : "chờ";
  const view =
    stance === "mua"
      ? `Quan điểm mua: giá trên MA50, hồi về MA20 (${fmtPct(gap)}), RSI ${Math.round(rsiNow)}.`
      : `Quan điểm mua: chưa mua ngay. ${extended ? `Giá đang căng, RSI ${Math.round(rsiNow)}, lệch MA20 ${fmtPct(gap)}.` : pullback ? "Điều kiện giá đủ, nhưng thị trường, thanh khoản hoặc định giá chưa cho mua." : "Giá chưa về sát MA20."}`;
  return {
    ticker,
    stance,
    price,
    entry,
    stop,
    target,
    riskPct,
    thesis: `${ticker}. ${view} Điểm mua chuẩn ${fmtPrice(entry)}. Điểm dừng lỗ ${fmtPrice(stop)}, rủi ro ${fmtPct(riskPct).replace("+", "")}. Điểm bán chuẩn ${fmtPrice(target)}, bằng 2 lần rủi ro.${notes.length ? ` ${notes.join(" ")}` : ""}${brokerBit(facts.broker)} Khung theo skill kỹ thuật và tài chính, không phải lệnh lên sàn.`,
  };
}

function empty(ticker: string, price: number | null, why: string): Assessment {
  return {
    ticker,
    stance: "bỏ",
    price,
    entry: null,
    stop: null,
    target: null,
    riskPct: null,
    thesis: `${ticker}: trợ lý không đưa vào danh mục khuyến nghị. ${why}`,
  };
}

function financeNote(facts: AssessFacts): string {
  const bits: string[] = [];
  if (facts.pe != null && facts.peIndustry != null && facts.peIndustry > 0) {
    bits.push(`PE ${trim(facts.pe)} so với ngành ${trim(facts.peIndustry)}.`);
  }
  if (facts.peg != null && facts.peg > 2) bits.push(`PEG ${trim(facts.peg)} cao so với tăng trưởng.`);
  const profits = (facts.profits ?? []).filter((item): item is number => item != null);
  if (profits.length >= 3 && profits[0]! < profits[1]! && profits[1]! < profits[2]!) {
    bits.push("Lợi nhuận hai kỳ gần nhất giảm liên tiếp.");
  }
  return bits.join(" ");
}

function financeBlocks(facts: AssessFacts): boolean {
  const expensive = facts.pe != null && facts.peIndustry != null && facts.peIndustry > 0 && facts.pe > facts.peIndustry * 1.5;
  const profits = (facts.profits ?? []).filter((item): item is number => item != null);
  const falling = profits.length >= 3 && profits[0]! < profits[1]! && profits[1]! < profits[2]!;
  return expensive || falling || (facts.peg != null && facts.peg > 2);
}

function volumeNote(bars: Bar[]): string {
  const vols = bars.slice(-21).map((bar) => bar.v).filter((volume) => volume > 0);
  if (vols.length < 10) return "";
  const last = vols.at(-1)!;
  const base = vols.slice(0, -1);
  const avg = base.reduce((sum, volume) => sum + volume, 0) / base.length;
  if (avg > 0 && last < avg * 0.6) return "Thanh khoản phiên gần nhất thấp hơn 60% trung bình 20 phiên.";
  return "";
}

function brokerBit(broker: AssessFacts["broker"]): string {
  if (!broker || (!broker.recommend && broker.mean == null)) return "";
  const target = broker.mean == null ? "" : `, mục tiêu bình quân ${fmtPrice(broker.mean)}`;
  return ` Tham khảo CTCK: ${broker.recommend ?? "chưa gắn nhãn"}${broker.source ? ` (${broker.source})` : ""}${target}.`;
}

function atr(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const ranges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.c;
    const bar = bars[i]!;
    ranges.push(Math.max(bar.h - bar.l, Math.abs(bar.h - prev), Math.abs(bar.l - prev)));
  }
  const slice = ranges.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function tick(price: number): number {
  if (price < 10_000) return 10;
  if (price < 50_000) return 50;
  return 100;
}

function roundTick(price: number, dir: "down" | "near"): number {
  const step = tick(price);
  const next = dir === "down" ? Math.floor(price / step) * step : Math.round(price / step) * step;
  return next > 0 ? next : step;
}

function stopUnder(entry: number, swing: number | null, range: number | null): number | null {
  const wide = roundTick(entry * 0.92, "down");
  const tight = roundTick(entry * 0.97, "down");
  const fromSwing = swing != null ? roundTick(Math.min(swing, entry * 0.995), "down") : wide;
  const fromAtr = range != null ? roundTick(entry - range * 1.5, "down") : fromSwing;
  let stop = Math.min(fromSwing, fromAtr);
  if (!(stop < entry)) stop = wide;
  const risk = (entry - stop) / entry;
  if (risk > 0.08) stop = wide;
  if ((entry - stop) / entry < 0.03) stop = tight;
  const step = tick(entry);
  if (entry - stop < step) stop = entry - step;
  return stop > 0 && stop < entry ? stop : null;
}

function trim(value: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
}
