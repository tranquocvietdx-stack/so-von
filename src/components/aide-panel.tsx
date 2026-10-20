import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AIDE_HELP,
  brief,
  ideaLine,
  indexLine,
  moverLine,
  newsLine,
  portfolioLine,
  pulseLine,
  quoteLine,
  tickersIn,
  wants,
  type AideBook,
} from "@/lib/aide";
import { fmtQty } from "@/lib/format";
import { assessTicker, getIdeas, getNews, getPulse, getQuotes, type IndexCard, type Quote } from "@/lib/market";
import { usePicks } from "@/lib/picks";
import { portfolioNav } from "@/lib/signal";
import { publishPick } from "@/lib/notify";
import { fileAideReports } from "@/components/aide-report";
import { potentialLine, useReportLog } from "@/lib/report-log";

type Message = { role: "user" | "aide"; text: string; ticker?: string };

const CHIPS = ["Cập nhật báo cáo", "Mã tiềm năng", "Danh mục hôm nay", "Tin mới"];

export function AidePanel({
  ready,
  session,
  indices,
  quotes,
  book,
}: {
  ready: boolean;
  session: string;
  indices: IndexCard[];
  quotes: Map<string, Quote>;
  book: AideBook;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(raw: string) {
    const question = raw.trim();
    if (!question || busy) return;
    setDraft("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", text: question }]);
    try {
      const answer = await respond(question, { session, indices, quotes, book });
      setMessages((current) => [...current, answer]);
    } catch {
      setMessages((current) => [...current, { role: "aide", text: "Chưa đọc được số liệu. Thử lại sau một nhịp." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        <li className="mr-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          {ready ? brief(session, indices, book, quotes) : "Đang mở sổ giá."}
        </li>
        {messages.map((message, index) => (
          <li
            key={`${message.role}-${index}`}
            className={
              message.role === "user"
                ? "ml-8 rounded-2xl bg-surface-2 px-4 py-3 text-sm"
                : "mr-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm whitespace-pre-wrap"
            }
          >
            {message.text}
            {message.role === "aide" ? (
              <button
                type="button"
                className="mt-2 block text-sm text-muted underline decoration-line underline-offset-4"
                onClick={() =>
                  useReportLog.getState().add([
                    {
                      id: crypto.randomUUID(),
                      key: `chat:${Date.now()}`,
                      at: Date.now(),
                      kind: "note",
                      title: "Trợ lý ghi chú",
                      body: message.text,
                    },
                  ])
                }
              >
                Ghi vào báo cáo
              </button>
            ) : null}
            {message.ticker ? (
              <Link
                to="/m/$ticker"
                params={{ ticker: message.ticker }}
                className="mt-2 block text-sm font-medium underline decoration-line underline-offset-4"
              >
                Mở {message.ticker}
              </Link>
            ) : null}
          </li>
        ))}
        {busy ? <li className="text-sm text-muted">Đang đọc số liệu…</li> : null}
      </ul>
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="h-10 rounded-full border border-line bg-surface px-3 text-sm"
            onClick={() => void ask(chip)}
          >
            {chip}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Hỏi về mã, sổ, tin"
          aria-label="Câu hỏi cho trợ lý"
        />
        <Button type="submit" disabled={busy || !draft.trim()}>
          Gửi
        </Button>
      </form>
      <p className="text-xs text-subtle">
        Ngoài câu trả lời, trợ lý ghi báo cáo đầu phiên, cuối phiên, biến động trong phiên, mã tiềm năng và đề xuất theo kịch bản. Không gửi lệnh lên sàn.
      </p>
    </div>
  );
}

async function respond(
  question: string,
  ctx: { session: string; indices: IndexCard[]; quotes: Map<string, Quote>; book: AideBook },
): Promise<Message> {
  const codes = tickersIn(question);
  const advice = wants(question, ["nen mua", "nên mua", "nen ban", "nên bán", "co nen", "có nên", "mua duoc khong", "vao lenh"]);
  if (wants(question, ["cập nhật báo cáo", "cap nhat bao cao", "ghi báo cáo", "ghi bao cao", "ghi vào báo cáo"])) {
    const notes = await fileAideReports(
      {
        enabled: true,
        session: ctx.session,
        indices: ctx.indices,
        quotes: ctx.quotes,
        lots: ctx.book.lots,
        watch: ctx.book.watch,
        cash: ctx.book.cash,
        margin: ctx.book.margin,
        realized: ctx.book.realized,
      },
      "manual",
    );
    const text = notes.length
      ? `Mình đã ghi ${notes.length} mục vào Báo cáo.\n${notes.map((note) => note.title).join("\n")}`
      : "Báo cáo đã có các mục này. Mở tab Báo cáo để đọc.";
    return { role: "aide", text };
  }
  if (wants(question, ["đánh giá", "danh gia", "điểm mua", "diem mua", "dừng lỗ", "dung lo", "đưa vào khuyến nghị", "dua vao khuyen nghi"])) {
    const ticker = codes[0];
    if (!ticker) return { role: "aide", text: "Cho mình một mã. Ví dụ: đánh giá FPT." };
    const nav = portfolioNav(ctx.book.lots, (ticker) => ctx.quotes.get(ticker)?.price ?? null, ctx.book.cash, ctx.book.margin);
    const result = await assessTicker({ data: { ticker, nav, margin: ctx.book.margin } });
    const kept = usePicks.getState().put(result);
    if (!kept) return { role: "aide", text: result.thesis, ticker };
    const sent = await publishPick(result);
    const tail = sent === "sent" ? "Đã bắn tin Telegram." : sent === "off" ? "Chưa nối Telegram." : "Đã ghi báo cáo, Telegram chưa nhận.";
    return { role: "aide", text: `Đã đưa vào danh mục khuyến nghị. ${tail}\n${result.thesis}`, ticker };
  }
  if (wants(question, ["tiềm năng", "tiem nang", "tìm năng", "tim nang", "mã mạnh", "ma manh"])) {
    const tickers = [...new Set([...ctx.book.watch, ...ctx.book.lots.map((lot) => lot.ticker)])].slice(0, 12);
    const pulses = tickers.length ? (await getPulse({ data: { tickers: tickers.join(",") } })).rows : [];
    return {
      role: "aide",
      text: `${potentialLine([...ctx.quotes.values()], pulses)}\nĐây là lọc trong mã đang xem, chưa phải lệnh mua.`,
    };
  }
  if (wants(question, ["cach dung", "cách dùng", "giup", "giúp", "tro ly lam gi", "trợ lý"])) {
    return { role: "aide", text: AIDE_HELP };
  }
  if (wants(question, ["tin", "bản tin", "ban tin", "news"])) {
    const items = (await getNews({ data: { ticker: codes[0] ?? "" } })).items;
    return { role: "aide", text: newsLine(items), ticker: codes[0] };
  }
  if (wants(question, ["khuyen nghi", "khuyến nghị", "goi y", "gợi ý", "muc tieu", "mục tiêu"])) {
    const tickers = codes.length ? codes : ctx.book.watch.slice(0, 8);
    const ideas = (await getIdeas({ data: { tickers: tickers.join(",") } })).ideas;
    return { role: "aide", text: ideaLine(ideas), ticker: codes[0] };
  }
  if (wants(question, ["rsi", "nhịp", "nhip", "ma20", "ma50", "trung bình", "trung binh"])) {
    const tickers = codes.length ? codes : ctx.book.watch.slice(0, 6);
    const rows = (await getPulse({ data: { tickers: tickers.join(",") } })).rows;
    if (!rows.length) return { role: "aide", text: "Chưa đủ chuỗi giá để đọc nhịp." };
    return { role: "aide", text: rows.map((row) => pulseLine(row.ticker, row, row.note)).join("\n"), ticker: codes[0] };
  }
  if (wants(question, ["danh mục", "danh muc", "sổ", "so von", "sổ vốn", "lãi", "lai", "lỗ"])) {
    return { role: "aide", text: portfolioLine(ctx.book, ctx.quotes) };
  }
  if (wants(question, ["hôm nay", "hom nay", "phiên", "phien", "chỉ số", "chi so", "vn-index", "vnindex", "vn30"])) {
    const bookBit = ctx.book.lots.length ? ` ${portfolioLine(ctx.book, ctx.quotes)}` : "";
    return { role: "aide", text: `${ctx.session}. ${indexLine(ctx.indices)}${bookBit}` };
  }
  if (wants(question, ["mạnh", "manh", "yếu", "yeu", "tăng", "tang", "giảm", "giam"])) {
    return { role: "aide", text: moverLine([...ctx.quotes.values()]) };
  }
  if (codes.length) {
    const fetched = await getQuotes({ data: { tickers: codes.join(",") } });
    const map = new Map(ctx.quotes);
    for (const quote of fetched.quotes) map.set(quote.ticker, quote);
    const lines = codes.map((ticker) => {
      const quote = map.get(ticker);
      return quote ? quoteLine(quote) : `${ticker}: chưa có giá.`;
    });
    const held = ctx.book.lots.filter((lot) => codes.includes(lot.ticker));
    const holding = held.length ? ` Trong sổ: ${held.map((lot) => `${lot.ticker} ${fmtQty(lot.shares)} cp`).join(", ")}.` : "";
    const caution = advice ? "Mình không nói nên mua hay bán. " : "";
    return { role: "aide", text: `${caution}${lines.join(" ")}${holding}`, ticker: codes[0] };
  }
  if (advice) return { role: "aide", text: `Mình không ra lệnh mua bán. ${AIDE_HELP}` };
  return { role: "aide", text: AIDE_HELP };
}
