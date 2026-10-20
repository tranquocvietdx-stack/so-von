import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortName, cleanTicker } from "@/lib/directory";
import { fmtPct, fmtPrice, toneClass } from "@/lib/format";
import { assessTicker, type Quote } from "@/lib/market";
import { usePicks } from "@/lib/picks";
import { useBook } from "@/lib/book";
import { portfolioNav } from "@/lib/signal";
import { publishPick } from "@/lib/notify";
import { cn } from "@/lib/cn";

export function PicksPanel({ enabled, quotes }: { enabled: boolean; quotes: Map<string, Quote> }) {
  const picks = usePicks((state) => state.picks);
  const put = usePicks((state) => state.put);
  const remove = usePicks((state) => state.remove);
  const lots = useBook((state) => state.lots);
  const cash = useBook((state) => state.cash);
  const margin = useBook((state) => state.margin);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function review(raw: string) {
    const ticker = cleanTicker(raw);
    if (ticker.length < 2 || busy) return;
    setBusy(true);
    setNote("");
    try {
      const nav = portfolioNav(lots, (item) => quotes.get(item)?.price ?? null, cash, margin);
      const result = await assessTicker({ data: { ticker, nav, margin } });
      if (!put(result)) {
        setNote(result.thesis);
        return;
      }
      setDraft("");
      const sent = await publishPick(result);
      const tail = sent === "sent" ? " Đã bắn tin Telegram." : sent === "off" ? " Chưa nối Telegram." : " Đã ghi báo cáo, Telegram chưa nhận.";
      setNote(`${result.thesis}${tail}`);
    } catch {
      setNote("Trợ lý chưa đánh giá được. Thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Danh mục khuyến nghị</h2>
        <p className="mt-2 text-sm text-muted">
          Mã chỉ vào danh mục khi qua đủ cổng: nợ dưới 10% vốn ròng, thị trường, ngành, thiết lập A, B, C hoặc đáy 2, và R:R sau phí từ 2. Đáy 1 bị bỏ nếu thị trường còn giảm. Bản đạt chuẩn được ghi vào Báo cáo và bắn Telegram nếu đã nối bot.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void review(draft);
          }}
        >
          <Input
            aria-label="Mã cần trợ lý đánh giá"
            placeholder="Mã, ví dụ FPT"
            value={draft}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            disabled={!enabled || busy}
          />
          <Button type="submit" disabled={!enabled || busy || draft.trim().length < 2}>
            {busy ? "Đang chấm…" : "Nhờ đánh giá"}
          </Button>
        </form>
        {note ? <p className="mt-3 text-sm whitespace-pre-wrap text-muted">{note}</p> : null}
      </section>

      {picks.length === 0 ? (
        <p className="text-sm text-muted">Chưa có mã nào qua vòng đánh giá.</p>
      ) : (
        <ul className="space-y-2">
          {picks.map((pick) => {
            const live = quotes.get(pick.ticker)?.price ?? pick.price;
            const reached = live != null && live <= pick.entry * 1.01 && live > pick.stop;
            const broken = live != null && live <= pick.stop;
            return (
              <li key={pick.ticker} className="rounded-2xl border border-line bg-surface px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <Link to="/m/$ticker" params={{ ticker: pick.ticker }} className="text-sm font-medium">
                    {pick.ticker}
                    <span className="font-normal text-muted"> · {shortName(pick.ticker)}</span>
                  </Link>
                  <span className="text-sm">{pick.stance === "mua" ? "Được mua" : "Chờ vùng mua"}</span>
                </div>
                <p className="mt-2 text-sm tabular-nums">
                  Điểm mua {fmtPrice(pick.entry)} · dừng lỗ {fmtPrice(pick.stop)}
                  {pick.target != null ? ` · bán ${fmtPrice(pick.target)}` : ""}
                  <span className="text-muted"> · rủi ro {fmtPct(pick.riskPct).replace("+", "")}</span>
                </p>
                <p className={cn("mt-1 text-sm", toneClass(live != null && pick.entry ? ((pick.entry - live) / pick.entry) * 100 : null))}>
                  {live == null ? "Chưa có giá mới." : `Giá hiện tại ${fmtPrice(live)}. `}
                  {broken ? "Đã thủng dừng lỗ." : reached ? "Đang trong vùng mua." : live != null ? "Còn cao hơn điểm mua." : ""}
                </p>
                <p className="mt-2 text-sm text-muted">{pick.thesis}</p>
                <button type="button" className="mt-2 text-sm text-muted" onClick={() => remove(pick.ticker)}>
                  Bỏ khỏi danh mục
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
