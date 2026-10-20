import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bookmark, BookmarkCheck, ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { CandleChart } from "@/components/candle-chart";
import { Frame, useReadyBook } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBook, WATCH_CAP } from "@/lib/book";
import { cleanTicker, shortName } from "@/lib/directory";
import { fmtCap, fmtPct, fmtPrice, fmtQty, parseMoney, toneClass } from "@/lib/format";
import { getDetail, type RangeKey } from "@/lib/market";
import { cn } from "@/lib/cn";

const RANGES: { id: RangeKey; label: string }[] = [
  { id: "5D", label: "5 ngày" },
  { id: "3M", label: "3 tháng" },
  { id: "1Y", label: "1 năm" },
  { id: "5Y", label: "5 năm" },
];

export function DetailView({ ticker: raw }: { ticker: string }) {
  const ticker = cleanTicker(raw);
  const ready = useReadyBook();
  const [range, setRange] = useState<RangeKey>("3M");
  const remember = useBook((state) => state.remember);

  useEffect(() => {
    if (ticker) remember(ticker);
  }, [ticker, remember]);

  const detail = useQuery({
    queryKey: ["detail", ticker, range],
    queryFn: () => getDetail({ data: { ticker, range } }),
    enabled: ready && ticker.length >= 2,
    staleTime: 60_000,
    placeholderData: (previous) => (previous && previous.ticker === ticker ? previous : undefined),
  });

  const data = detail.data;
  const quote = data?.quote;
  const price = quote?.price ?? data?.bars.at(-1)?.c ?? null;

  return (
    <Frame>
      <Link to="/" className="press inline-flex h-11 items-center gap-1 text-sm text-muted">
        <ChevronLeft className="size-4" />
        Bảng giá
      </Link>

      <header className="mt-2 mb-5">
        <p className="text-xs text-subtle">
          {ticker}
          {data?.profile?.exchange ? ` · ${data.profile.exchange}` : ""}
          {data?.profile?.industry ? ` · ${data.profile.industry}` : ""}
        </p>
        <h1 className="mt-1 font-display text-3xl leading-tight tracking-tight">
          {data?.profile?.name ?? shortName(ticker)}
        </h1>
        {price != null ? (
          <div className="mt-3 flex items-end justify-between gap-3">
            <p className="font-display text-4xl leading-none tabular-nums">{fmtPrice(price)}</p>
            {quote ? (
              <p className={cn("pb-1 text-sm font-medium tabular-nums", toneClass(quote.pct))}>
                {fmtPrice(quote.change)} · {fmtPct(quote.pct)}
              </p>
            ) : null}
          </div>
        ) : detail.isLoading ? (
          <div className="skeleton mt-4 h-12 w-40 rounded-xl" />
        ) : null}
      </header>

      {detail.isError ? (
        <p className="rounded-3xl border border-line bg-surface px-4 py-8 text-sm text-muted">
          {detail.error instanceof Error ? detail.error.message : "Không mở được mã này."}
        </p>
      ) : null}

      {quote && quote.floor > 0 && quote.ceiling > 0 ? <Band floor={quote.floor} price={quote.price} ceiling={quote.ceiling} reference={quote.reference} /> : null}

      <section className="mt-4 rounded-3xl border border-line bg-surface p-4">
        <div className="mb-3 flex gap-1">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "h-10 flex-1 rounded-lg text-xs font-medium",
                range === item.id ? "bg-surface-2 text-fg" : "text-muted",
              )}
              onClick={() => setRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {data?.bars ? <CandleChart bars={data.bars} intraday={range === "5D"} /> : <div className="skeleton h-52 rounded-xl" />}
      </section>

      <Actions ticker={ticker} price={price} />
      {price != null ? <SizeDesk price={price} floor={quote?.floor ?? 0} /> : null}

      {quote && (quote.bids.length > 0 || quote.asks.length > 0) ? (
        <section className="mt-4 rounded-3xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">Sổ lệnh</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <BookSide title="Mua" levels={quote.bids} tone="text-up" />
            <BookSide title="Bán" levels={quote.asks} tone="text-down" />
          </div>
          <p className="mt-3 text-xs text-subtle tabular-nums">Khối lượng khớp {fmtQty(quote.volume)}</p>
        </section>
      ) : null}

      {data?.metrics ? <Valuation metrics={data.metrics} cap={data.profile?.marketCap ?? null} /> : null}

      {data?.tech && data.note ? (
        <section className="mt-4 rounded-3xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">Nhịp giá</h2>
          <p className="mt-2 text-sm text-fg">{data.note}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Mini label="MA20" value={data.tech.ma20 == null ? "—" : fmtPrice(data.tech.ma20)} />
            <Mini label="MA50" value={data.tech.ma50 == null ? "—" : fmtPrice(data.tech.ma50)} />
            <Mini label="RSI 14" value={data.tech.rsi == null ? "—" : data.tech.rsi.toFixed(0)} />
            <Mini label="5 phiên" value={data.tech.pct5 == null ? "—" : fmtPct(data.tech.pct5)} tone={data.tech.pct5} />
          </dl>
          <p className="mt-3 text-xs text-subtle">Đọc từ giá đóng cửa khoảng một năm. Không phải khuyến nghị.</p>
        </section>
      ) : null}

      {data?.profile?.blurb ? (
        <section className="mt-4 rounded-3xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">Doanh nghiệp</h2>
          {data.profile.sector ? <p className="mt-1 text-xs text-subtle">{data.profile.sector}</p> : null}
          <p className="mt-2 text-sm text-muted">{data.profile.blurb}</p>
          {data.profile.website ? (
            <a className="mt-3 inline-flex text-sm font-medium text-fg underline decoration-line underline-offset-4" href={data.profile.website} target="_blank" rel="noreferrer">
              Trang công ty
            </a>
          ) : null}
        </section>
      ) : null}

      {data?.peers && data.peers.length > 0 ? (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-medium">Cùng ngành</h2>
          <div className="flex flex-col gap-2">
            {data.peers.map((peer) => (
              <Link
                key={peer.ticker}
                to="/m/$ticker"
                params={{ ticker: peer.ticker }}
                className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3"
              >
                <span className="text-sm">
                  <span className="font-medium">{peer.ticker}</span>
                  <span className="text-muted"> · {peer.name}</span>
                </span>
                <span className="text-right">
                  <span className="block text-sm tabular-nums">{fmtPrice(peer.price)}</span>
                  {peer.pct7d != null ? (
                    <span className={cn("block text-xs tabular-nums", toneClass(peer.pct7d))}>7 ngày {fmtPct(peer.pct7d)}</span>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </Frame>
  );
}

function Band({
  floor,
  price,
  ceiling,
  reference,
}: {
  floor: number;
  price: number;
  ceiling: number;
  reference: number;
}) {
  const span = ceiling - floor || 1;
  const pos = Math.min(100, Math.max(0, ((price - floor) / span) * 100));
  return (
    <section className="rounded-3xl border border-line bg-surface p-4">
      <div className="relative h-1 rounded-full bg-surface-2">
        <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${pos}%` }} />
      </div>
      <div className="mt-3 flex justify-between text-xs text-muted tabular-nums">
        <span>Sàn {fmtPrice(floor)}</span>
        <span>TC {fmtPrice(reference)}</span>
        <span>Trần {fmtPrice(ceiling)}</span>
      </div>
    </section>
  );
}

function BookSide({ title, levels, tone }: { title: string; levels: { price: number; qty: number }[]; tone: string }) {
  return (
    <div>
      <p className={cn("text-xs font-medium", tone)}>{title}</p>
      <ul className="mt-2 space-y-2">
        {levels.map((level) => (
          <li key={level.price} className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
            <span>{fmtPrice(level.price)}</span>
            <span className="text-xs text-subtle">{fmtQty(level.qty)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Valuation({
  metrics,
  cap,
}: {
  metrics: {
    pe: number | null;
    peIndustry: number | null;
    pb: number | null;
    pbIndustry: number | null;
    evEbitda: number | null;
    peg: number | null;
    intrinsic: number | null;
    upside: number | null;
    downside: boolean;
    updated: string | null;
  };
  cap: number | null;
}) {
  return (
    <section className="mt-4 rounded-3xl border border-line bg-surface p-4">
      <h2 className="text-sm font-medium">Định giá</h2>
      {cap != null ? <p className="mt-1 text-xs text-subtle">Vốn hóa {fmtCap(cap)} đồng</p> : null}
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Mini label="P/E" value={metrics.pe == null ? "—" : metrics.pe.toFixed(2)} hint={metrics.peIndustry == null ? undefined : `ngành ${metrics.peIndustry.toFixed(1)}`} />
        <Mini label="P/B" value={metrics.pb == null ? "—" : metrics.pb.toFixed(2)} hint={metrics.pbIndustry == null ? undefined : `ngành ${metrics.pbIndustry.toFixed(1)}`} />
        <Mini label="EV/EBITDA" value={metrics.evEbitda == null ? "—" : metrics.evEbitda.toFixed(2)} />
        <Mini label="PEG" value={metrics.peg == null ? "—" : metrics.peg.toFixed(2)} />
      </dl>
      {metrics.intrinsic != null ? (
        <p className="mt-3 text-sm text-muted">
          Mô hình Simplize ước giá trị nội tại {fmtPrice(metrics.intrinsic)}
          {metrics.upside != null
            ? `, ${metrics.downside ? "thấp hơn giá" : "cao hơn giá"} khoảng ${Math.abs(metrics.upside).toFixed(0)}%`
            : ""}
          . Đây là mô hình, không phải mục tiêu giao dịch.
        </p>
      ) : null}
      {metrics.updated ? <p className="mt-2 text-xs text-subtle">Cập nhật định giá {metrics.updated}</p> : null}
    </section>
  );
}

function Mini({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: number | null }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className={cn("text-sm font-medium tabular-nums", tone == null ? "text-fg" : toneClass(tone))}>{value}</dd>
      {hint ? <p className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

function Actions({ ticker, price }: { ticker: string; price: number | null }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-2">
        <WatchButton ticker={ticker} />
        <Button variant="quiet" onClick={() => setOpen((value) => !value)}>
          Ghi sổ vốn
        </Button>
      </div>
      {open ? (
        <LotForm
          ticker={ticker}
          price={price}
          onDone={() => {
            setSaved(true);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {saved ? <p className="mt-2 text-xs text-subtle">Đã ghi vào sổ. Lô trùng mã lấy giá vốn bình quân.</p> : null}
    </div>
  );
}
function WatchButton({ ticker }: { ticker: string }) {
  const watching = useBook((state) => state.watch.includes(ticker));
  const count = useBook((state) => state.watch.length);
  const toggle = useBook((state) => state.toggleWatch);
  const [note, setNote] = useState<string | null>(null);
  const full = !watching && count >= WATCH_CAP;
  return (
    <div>
      <Button
        variant={watching ? "quiet" : "primary"}
        className="w-full"
        disabled={full}
        onClick={() => {
          const result = toggle(ticker);
          setNote(result === "full" ? "Bảng đã đủ 16 mã." : null);
        }}
      >
        {watching ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
        {watching ? "Đang theo dõi" : full ? "Đủ 16 mã" : "Theo dõi"}
      </Button>
      {note ? <p className="mt-1 text-xs text-subtle">{note}</p> : null}
    </div>
  );
}

function LotForm({
  ticker,
  price,
  onDone,
  onClose,
}: {
  ticker: string;
  price: number | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const addLot = useBook((state) => state.addLot);
  const [shares, setShares] = useState("");
  const [avg, setAvg] = useState(price != null ? String(Math.round(price)) : "");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-3 rounded-3xl border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const shareCount = parseMoney(shares);
        const average = parseMoney(avg);
        const stopPx = stop.trim() ? parseMoney(stop) : null;
        const targetPx = target.trim() ? parseMoney(target) : null;
        if (!(shareCount > 0) || !(average > 0)) return;
        if ((stopPx != null && !(stopPx > 0)) || (targetPx != null && !(targetPx > 0))) return;
        if (stopPx != null && targetPx != null && stopPx >= targetPx) {
          setError("Cắt lỗ phải thấp hơn chốt lời.");
          return;
        }
        addLot(ticker, shareCount, average);
        if (stopPx != null || targetPx != null) {
          useBook.getState().setLevels(ticker, stopPx, targetPx);
        }
        onDone();
      }}
    >
      <p className="mb-3 text-sm font-medium">Ghi lô {ticker}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-subtle">
          Số cổ phiếu
          <Input
            className="mt-1"
            inputMode="decimal"
            value={shares}
            onChange={(event) => setShares(event.target.value)}
            required
          />
        </label>
        <label className="block text-xs text-subtle">
          Giá vốn
          <Input className="mt-1" inputMode="decimal" value={avg} onChange={(event) => setAvg(event.target.value)} required />
        </label>
        <label className="block text-xs text-subtle">
          Cắt lỗ
          <Input className="mt-1" inputMode="numeric" value={stop} onChange={(event) => setStop(event.target.value)} placeholder="Không bắt buộc" />
        </label>
        <label className="block text-xs text-subtle">
          Chốt lời
          <Input className="mt-1" inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Không bắt buộc" />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="submit" className="flex-1">
          Lưu
        </Button>
        <Button variant="ghost" className="flex-1" onClick={onClose}>
          Đóng
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-down">{error}</p> : null}
    </form>
  );
}

function SizeDesk({ price, floor }: { price: number; floor: number }) {
  const [money, setMoney] = useState("100000000");
  const [risk, setRisk] = useState("1");
  const [stop, setStop] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!seeded && floor > 0) {
      setStop(String(Math.round(floor)));
      setSeeded(true);
    }
  }, [floor, seeded]);

  const cash = parseMoney(money);
  const riskPct = Number(risk.replace(",", "."));
  const stopPx = parseMoney(stop);
  const byCash = price > 0 ? Math.floor(cash / price) : 0;
  const spend = byCash * price;
  const riskPerShare = price - stopPx;
  const byRisk =
    riskPerShare > 0 && riskPct > 0 && cash > 0 ? Math.floor((cash * (riskPct / 100)) / riskPerShare) : null;

  return (
    <section className="mt-4 rounded-3xl border border-line bg-surface p-4">
      <h2 className="text-sm font-medium">Cỡ lệnh</h2>
      <p className="mt-1 text-xs text-subtle">Tính số cổ phiếu vừa túi tiền và mức cắt lỗ. Không phải khuyến nghị.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <label className="col-span-3 block text-xs text-subtle sm:col-span-1">
          Số tiền
          <Input className="mt-1" inputMode="numeric" value={money} onChange={(event) => setMoney(event.target.value)} />
        </label>
        <label className="block text-xs text-subtle">
          Rủi ro %
          <Input className="mt-1" inputMode="decimal" value={risk} onChange={(event) => setRisk(event.target.value)} />
        </label>
        <label className="col-span-2 block text-xs text-subtle">
          Giá cắt lỗ
          <Input className="mt-1" inputMode="numeric" value={stop} onChange={(event) => setStop(event.target.value)} />
        </label>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Mini label="Mua tối đa" value={byCash > 0 ? `${fmtQty(byCash)} cp` : "—"} hint={spend > 0 ? fmtPrice(spend) : undefined} />
        <Mini
          label="Theo rủi ro"
          value={byRisk != null && byRisk > 0 ? `${fmtQty(byRisk)} cp` : "—"}
          hint={riskPerShare > 0 ? `lỗ ${fmtPrice(riskPerShare)}/cp` : "cắt lỗ phải dưới giá"}
        />
      </dl>
    </section>
  );
}
