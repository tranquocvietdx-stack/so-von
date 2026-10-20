import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookSwitch } from "@/components/book-switch";
import type { Lot, Txn } from "@/lib/book";
import { reviewExits } from "@/lib/market";
import { debtBlocks } from "@/lib/signal";
import { shortName } from "@/lib/directory";
import { fmtPct, fmtPrice, toneClass } from "@/lib/format";
import type { IndexCard, PulseRow, Quote } from "@/lib/market";
import { splitSignals, useReportLog } from "@/lib/report-log";
import { cn } from "@/lib/cn";

export function ManagePanel({
  lots,
  quotes,
  indices,
  cash,
  margin,
  watch,
  pulses,
  txns,
  loading,
  onOpenBook,
  onOpenIdeas,
  onOpenPulse,
}: {
  lots: Lot[];
  quotes: Map<string, Quote>;
  indices: IndexCard[];
  cash: number | null;
  margin: number;
  watch: string[];
  pulses: PulseRow[];
  txns: Txn[];
  loading: boolean;
  onOpenBook: () => void;
  onOpenIdeas: () => void;
  onOpenPulse: () => void;
}) {
  const scenarios = useReportLog((state) => state.scenarios);
  const signals = splitSignals({ scenarios, quotes, lots, watch, pulses });
  const rows = lots.map((lot) => {
    const quote = quotes.get(lot.ticker);
    const cost = lot.shares * lot.avg;
    const value = quote ? lot.shares * quote.price : null;
    const pnl = value == null ? null : value - cost;
    const pct = pnl == null || cost === 0 ? null : (pnl / cost) * 100;
    const day = quote ? lot.shares * quote.change : null;
    return { lot, quote, pnl, pct, day };
  });
  const valued = rows.filter((row) => row.pnl != null);
  const pnl = valued.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
  const market = valued.reduce((sum, row) => sum + (row.lot.shares * (row.quote?.price ?? 0)), 0);
  const day = rows.reduce((sum, row) => sum + (row.day ?? 0), 0);
  const dayKnown = rows.some((row) => row.day != null);
  const gross = market + (cash ?? 0);
  const nav = gross - margin;
  const moves = [...rows].filter((row) => row.quote).sort((a, b) => Math.abs(b.day ?? 0) - Math.abs(a.day ?? 0));
  const review = [...rows].sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0));
  const blocked = debtBlocks(margin, nav);
  const exits = useQuery({
    queryKey: ["exits", lots.map((lot) => `${lot.ticker}:${lot.shares}`).join(","), margin],
    enabled: lots.some((lot) => quotes.has(lot.ticker)),
    staleTime: 5 * 60_000,
    queryFn: () =>
      reviewExits({
        data: {
          margin,
          positions: lots.flatMap((lot) => {
            const price = quotes.get(lot.ticker)?.price;
            if (!price) return [];
            const openedAt = txns.filter((txn) => txn.ticker === lot.ticker).at(-1)?.at ?? null;
            return [{ ticker: lot.ticker, avg: lot.avg, price, stop: lot.stop ?? null, openedAt }];
          }),
        },
      }),
  });
  const index = indices.find((item) => item.id === "VNINDEX") ?? indices[0];
  const exitRows = exits.data?.exits.filter((item) => item.action !== "giữ") ?? [];

  return (
    <div className="space-y-4">
      <BookSwitch />
      <section className="rounded-3xl border border-line bg-surface p-4">
        <p className="text-xs text-subtle">NAV danh mục</p>
        <p className="mt-1 font-display text-4xl leading-none tabular-nums">{lots.length || cash != null || margin > 0 ? fmtPrice(nav) : "—"}</p>
        <p className="mt-2 text-xs text-subtle tabular-nums">Tổng danh mục {fmtPrice(gross)} = NAV + vay {fmtPrice(margin)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-subtle">Lãi lỗ chưa chốt</p>
            <p className={cn("mt-1 text-sm font-medium tabular-nums", toneClass(pnl))}>{valued.length ? fmtPrice(pnl) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-subtle">Hôm nay đụng sổ</p>
            <p className={cn("mt-1 text-sm font-medium tabular-nums", toneClass(dayKnown ? day : null))}>{dayKnown ? fmtPrice(day) : "—"}</p>
          </div>
        </div>
        {lots.length === 0 ? (
          <button type="button" className="mt-3 text-sm font-medium underline decoration-line underline-offset-4" onClick={onOpenBook}>
            Ghi mã đang nắm
          </button>
        ) : null}
      </section>

      <section>
        <h2 className="text-sm font-medium">Biến động ảnh hưởng danh mục</h2>
        {index && Math.abs(index.pct) >= 1 ? (
          <p className={cn("mt-2 text-sm", toneClass(index.pct))}>
            {index.label} {fmtPct(index.pct)} — cả sổ chịu chung nhịp này.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">{index ? `${index.label} ${fmtPct(index.pct)}, chưa phải phiên lệch mạnh.` : "Chưa có chỉ số."}</p>
        )}
        {moves.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Chưa có mã trong sổ để đo tác động.</p>
        ) : (
          <ul className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface">
            {moves.map((row) => (
              <li key={row.lot.ticker} className="border-b border-line last:border-b-0">
                <Link to="/m/$ticker" params={{ ticker: row.lot.ticker }} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <span className="text-sm font-medium">
                    {row.lot.ticker}
                    <span className="font-normal text-muted"> · {shortName(row.lot.ticker)}</span>
                  </span>
                  <span className="text-right text-sm tabular-nums">
                    <span className={toneClass(row.quote?.pct)}>{row.quote ? fmtPct(row.quote.pct) : "—"}</span>
                    <span className={cn("mt-0.5 block text-xs", toneClass(row.day))}>{row.day == null ? "" : fmtPrice(row.day)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium">Điểm bán theo skill</h2>
        {exits.isLoading && exitRows.length === 0 ? <p className="mt-2 text-sm text-muted">Đang xét điểm bán.</p> : null}
        {exits.data?.market ? <p className="mt-2 text-sm text-muted">{exits.data.market}</p> : null}
        {exitRows.length === 0 && !exits.isLoading ? (
          <p className="mt-2 text-sm text-muted">Chưa có mã nào chạm cắt lỗ, 1R hoặc tín hiệu hủy kèo.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {exitRows.map((item) => (
              <li key={item.ticker} className="rounded-2xl border border-line bg-surface px-4 py-3">
                <p className="text-sm font-medium">{item.ticker} · {item.action}</p>
                <p className="mt-1 text-sm text-muted">{item.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium">Tín hiệu bán trong danh mục</h2>
        <SignalList notes={signals.sell} empty="Chưa có kịch bản bán khớp. Mã đang nắm được giữ." />
      </section>

      <section>
        <h2 className="text-sm font-medium">Tín hiệu mua mã mới</h2>
        {blocked ? (
          <p className="mt-2 text-sm text-muted">Cổng nợ đang chặn. Nợ phải về dưới 10% vốn ròng thì mới xét mua mới.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-subtle">Chỉ mã đang theo dõi mà chưa có trong sổ, và vẫn phải qua đủ cổng skill.</p>
            {loading && pulses.length === 0 ? <p className="mt-2 text-sm text-muted">Đang đọc nhịp.</p> : null}
            <SignalList notes={signals.buy} empty="Chưa có kịch bản mua khớp." />
          </>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium">Lãi lỗ cần xem lại</h2>
        {review.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Ghi mã đang nắm để xem mã nào lãi, mã nào lỗ.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {review.map((row) => {
              const losing = (row.pnl ?? 0) < 0;
              return (
                <li key={row.lot.ticker}>
                  <Link to="/m/$ticker" params={{ ticker: row.lot.ticker }} className="block rounded-2xl border border-line bg-surface px-4 py-3">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{row.lot.ticker}</span>
                      <span className={cn("text-sm tabular-nums", toneClass(row.pnl))}>
                        {row.pnl == null ? "—" : fmtPrice(row.pnl)}
                        {row.pct == null ? "" : ` ${fmtPct(row.pct)}`}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm text-muted">{losing ? "Đang lỗ, nên xem lại." : "Đang lãi."}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="text-xs text-subtle">
        Tín hiệu theo kịch bản bạn đặt. Không phải lệnh lên sàn.{" "}
        <button type="button" className="underline decoration-line underline-offset-4" onClick={onOpenIdeas}>
          Khuyến nghị đã qua trợ lý
        </button>
        {" · "}
        <button type="button" className="underline decoration-line underline-offset-4" onClick={onOpenPulse}>
          Xem nhịp
        </button>
      </p>
    </div>
  );
}

function SignalList({ notes, empty }: { notes: { key: string; title: string; body: string }[]; empty: string }) {
  if (!notes.length) return <p className="mt-2 text-sm text-muted">{empty}</p>;
  return (
    <ul className="mt-2 space-y-2">
      {notes.map((note) => (
        <li key={note.key} className="rounded-2xl border border-line bg-surface px-4 py-3">
          <p className="text-sm font-medium">{note.title.replace("Đề xuất ", "")}</p>
          <p className="mt-1 text-sm text-muted">{note.body}</p>
        </li>
      ))}
    </ul>
  );
}
