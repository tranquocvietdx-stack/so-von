import type { Lot } from "@/lib/book";
import { DIRECTORY, fold, shortName } from "@/lib/directory";
import { fmtIndex, fmtPct, fmtPrice, fmtQty } from "@/lib/format";
import type { Idea, IndexCard, NewsItem, Quote } from "@/lib/market";
import type { Tech } from "@/lib/tech";
import { techNote } from "@/lib/tech";

export type AideBook = {
  lots: Lot[];
  cash: number | null;
  margin: number;
  realized: number;
  watch: string[];
};

const CODE = /(^|[^a-z0-9])([a-z]{3,5})(?=[^a-z0-9]|$)/g;

export function tickersIn(question: string): string[] {
  const folded = fold(question);
  const found: string[] = [];
  const push = (ticker: string) => {
    if (!found.includes(ticker)) found.push(ticker);
  };
  for (const match of folded.matchAll(CODE)) {
    const code = match[2]!.toUpperCase();
    if (DIRECTORY[code]) push(code);
  }
  for (const [ticker, name] of Object.entries(DIRECTORY)) {
    const foldedName = fold(name);
    if (foldedName.length >= 5 && folded.includes(foldedName)) push(ticker);
  }
  return found.slice(0, 3);
}

export function wants(question: string, words: string[]): boolean {
  const folded = fold(question);
  return words.some((word) => folded.includes(fold(word)));
}

export function brief(session: string, indices: IndexCard[], book: AideBook, quotes: Map<string, Quote>): string {
  const index = indices.find((item) => item.id === "VNINDEX") ?? indices[0];
  const lead = index ? `${index.label} ${fmtIndex(index.price)}, ${fmtPct(index.pct)}.` : "Chưa có chỉ số.";
  return `${session}. ${lead} ${portfolioLine(book, quotes)} Mình tự ghi báo cáo đầu phiên, cuối phiên và khi có biến động. Hỏi tiếp mã tiềm năng, danh mục hoặc một mã.`;
}

export function portfolioLine(book: AideBook, quotes: Map<string, Quote>): string {
  if (!book.lots.length) {
    const nav = (book.cash ?? 0) - (book.margin ?? 0);
    if (book.cash == null && !(book.margin > 0)) return "Sổ chưa có mã.";
    return `Sổ chưa có mã. NAV ${fmtPrice(nav)}. Vay margin ${fmtPrice(book.margin ?? 0)}.`;
  }
  let cost = 0;
  let market = 0;
  let day = 0;
  let valued = 0;
  const bits = book.lots.slice(0, 6).map((lot) => {
    const quote = quotes.get(lot.ticker);
    const spent = lot.shares * lot.avg;
    cost += spent;
    if (quote) {
      market += lot.shares * quote.price;
      day += lot.shares * quote.change;
      valued += 1;
    }
    const pnl = quote ? lot.shares * quote.price - spent : null;
    return `${lot.ticker} ${fmtQty(lot.shares)} cp, vốn ${fmtPrice(lot.avg)}${pnl == null ? "" : `, lãi lỗ ${fmtPrice(pnl)}`}`;
  });
  const pnl = valued ? market - cost : null;
  const gross = market + (book.cash ?? 0);
  const nav = gross - (book.margin ?? 0);
  const funding =
    book.margin > 0
      ? `Tổng danh mục ${fmtPrice(gross)} = NAV ${fmtPrice(nav)} + vay margin ${fmtPrice(book.margin)}.`
      : book.cash == null
        ? "Chưa vay margin."
        : `Tiền mặt ${fmtPrice(book.cash)}. Chưa vay margin. NAV ${fmtPrice(nav)}.`;
  return `Sổ: ${bits.join("; ")}. ${pnl == null ? "Chưa đủ giá để tính lãi lỗ." : `Lãi lỗ chưa chốt ${fmtPrice(pnl)}. Hôm nay ${fmtPrice(day)}.`} Đã chốt ${fmtPrice(book.realized)}. ${funding}`;
}

export function indexLine(indices: IndexCard[]): string {
  if (!indices.length) return "Chưa lấy được chỉ số.";
  return indices.map((item) => `${item.label} ${fmtIndex(item.price)} (${fmtPct(item.pct)})`).join(". ") + ".";
}

export function quoteLine(quote: Quote): string {
  return `${quote.ticker} · ${shortName(quote.ticker)} đang ${fmtPrice(quote.price)}, ${fmtPrice(quote.change)} (${fmtPct(quote.pct)}). Sàn ${fmtPrice(quote.floor)}, tham chiếu ${fmtPrice(quote.reference)}, trần ${fmtPrice(quote.ceiling)}. Khối lượng ${fmtQty(quote.volume)}.`;
}

export function pulseLine(ticker: string, tech: Tech, note: string): string {
  return `${ticker}: ${note || techNote(tech)}.`;
}

export function newsLine(items: NewsItem[]): string {
  if (!items.length) return "Chưa có tin mới cho câu này.";
  return items
    .slice(0, 4)
    .map((item) => `${item.title}${item.ago ? ` (${item.ago})` : ""}`)
    .join("\n");
}

export function ideaLine(ideas: Idea[]): string {
  if (!ideas.length) return "Chưa thấy khuyến nghị công bố cho các mã này.";
  const body = ideas
    .slice(0, 4)
    .map((idea) => {
      const stance = idea.recommend ?? "Chưa gắn nhãn";
      const target = idea.mean == null ? "" : `, mục tiêu bình quân ${fmtPrice(idea.mean)}`;
      const up = idea.upside == null ? "" : ` (${fmtPct(idea.upside)})`;
      return `${idea.ticker}: ${stance}${idea.source ? ` theo ${idea.source}` : ""}${target}${up}.`;
    })
    .join(" ");
  return `${body} Đây là khuyến nghị của công ty chứng khoán, không phải lệnh mua bán.`;
}

export function moverLine(quotes: Quote[]): string {
  const ranked = quotes.filter((quote) => Number.isFinite(quote.pct)).sort((a, b) => b.pct - a.pct);
  if (!ranked.length) return "Chưa có giá để so.";
  const top = ranked.slice(0, 3).map((quote) => `${quote.ticker} ${fmtPct(quote.pct)}`);
  const bottom = ranked.slice(-2).map((quote) => `${quote.ticker} ${fmtPct(quote.pct)}`);
  return `Mạnh hơn trong các mã đang xem: ${top.join(", ")}. Yếu hơn: ${bottom.join(", ")}.`;
}

export const AIDE_HELP =
  "Mình trả lời khi bạn hỏi và tự ghi báo cáo đầu phiên, cuối phiên, biến động trong phiên. Mua mới phải qua cổng nợ, thị trường, ngành, thiết lập A/B/C hoặc đáy 2, và R:R sau phí. Thị trường còn giảm thì bỏ đáy 1. Nợ trên 10% vốn ròng thì không mua. Hỏi đánh giá kèm mã để xem thẻ. Không gửi lệnh lên sàn.";
