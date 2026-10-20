import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spark } from "@/components/spark";
import { Frame, useReadyBook } from "@/components/shell";
import { useBook, type Lot, type Txn } from "@/lib/book";
import { shortName, cleanTicker } from "@/lib/directory";
import { fmtIndex, fmtPct, fmtPrice, fmtQty, fmtWhen, parseMoney, sessionLabel, toneClass } from "@/lib/format";
import { getIndices, getPulse, getQuotes, searchMarket, type Quote } from "@/lib/market";
import { BookSwitch } from "@/components/book-switch";
import { ManagePanel } from "@/components/manage-panel";
import { PicksPanel } from "@/components/picks-panel";
import { AidePanel } from "@/components/aide-panel";
import { useAideReporter } from "@/components/aide-report";
import { IdeasPanel, NewsPanel, ReportPanel } from "@/components/extra-panels";
import { cn } from "@/lib/cn";

type Tab = "manage" | "board" | "book" | "pulse" | "news" | "ideas" | "report" | "aide";

export function Desk() {
  const ready = useReadyBook();
  const watch = useBook((state) => state.watch);
  const lots = useBook((state) => state.lots);
  const cash = useBook((state) => state.cash);
  const margin = useBook((state) => state.margin);
  const realized = useBook((state) => state.realized);
  const txns = useBook((state) => state.txns);
  const [tab, setTab] = useState<Tab>("manage");
  const [indexId, setIndexId] = useState("VNINDEX");
  const [session, setSession] = useState("Bảng giá Việt Nam");
  const client = useQueryClient();

  useEffect(() => {
    setSession(sessionLabel());
  }, []);

  const tickers = useMemo(() => {
    const set = new Set<string>([...lots.map((lot) => lot.ticker), ...watch]);
    return [...set].slice(0, 24);
  }, [watch, lots]);

  const indices = useQuery({
    queryKey: ["indices"],
    queryFn: () => getIndices(),
    enabled: ready,
    staleTime: 60_000,
  });
  const quotes = useQuery({
    queryKey: ["quotes", tickers.join(",")],
    queryFn: () => getQuotes({ data: { tickers: tickers.join(",") } }),
    enabled: ready && tickers.length > 0,
    staleTime: 20_000,
  });
  const pulseTickers = useMemo(() => {
    const set = new Set<string>([...lots.map((lot) => lot.ticker), ...watch]);
    return [...set].slice(0, 16);
  }, [watch, lots]);
  const pulse = useQuery({
    queryKey: ["pulse", pulseTickers.join(",")],
    queryFn: () => getPulse({ data: { tickers: pulseTickers.join(",") } }),
    enabled: ready && (tab === "pulse" || tab === "manage") && pulseTickers.length > 0,
    staleTime: 5 * 60_000,
  });

  const ideaTickers = useMemo(() => {
    const set = new Set<string>([...lots.map((lot) => lot.ticker), ...watch]);
    return [...set].slice(0, 12);
  }, [lots, watch]);

  const byTicker = new Map((quotes.data?.quotes ?? []).map((quote) => [quote.ticker, quote]));
  const indexCards = indices.data?.indices ?? [];
  const chosen = indexCards.find((card) => card.id === indexId) ?? indexCards[0];
  const reportInput = {
    enabled: ready,
    session,
    indices: indexCards,
    quotes: byTicker,
    lots,
    watch,
    cash,
    margin,
    realized,
  };
  useAideReporter(reportInput);

  return (
    <Frame>
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl leading-none tracking-tight text-fg">Sổ Vốn</h1>
          <p className="mt-2 text-sm text-muted">{session}</p>
        </div>
        <Button
          variant="quiet"
          size="sm"
          aria-label="Cập nhật giá"
          onClick={() => {
            void client.invalidateQueries({ queryKey: ["indices"] });
            void client.invalidateQueries({ queryKey: ["quotes"] });
            void client.invalidateQueries({ queryKey: ["pulse"] });
          }}
        >
          <RefreshCw className="size-4" />
          Cập nhật
        </Button>
      </header>

      <div className="scroll-x -mx-4 mb-3 flex gap-3 px-4">
        {indexCards.map((index) => (
          <button
            key={index.id}
            type="button"
            onClick={() => setIndexId(index.id)}
            className={cn(
              "w-40 shrink-0 rounded-2xl border bg-surface p-3 text-left",
              chosen?.id === index.id ? "border-fg" : "border-line",
            )}
          >
            <p className="text-xs text-subtle">{index.label}</p>
            <p className="mt-1 font-display text-2xl leading-none tabular-nums">{fmtIndex(index.price)}</p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className={cn("text-sm font-medium tabular-nums", toneClass(index.pct))}>{fmtPct(index.pct)}</p>
              <Spark values={index.spark} className={toneClass(index.pct)} />
            </div>
          </button>
        ))}
        {indices.isLoading ? <IndexSkeleton /> : null}
        {indices.isError ? <p className="self-center text-sm text-muted">Chưa lấy được chỉ số.</p> : null}
      </div>
      {tab !== "manage" && chosen ? <IndexChart label={chosen.label} values={chosen.series.length ? chosen.series : chosen.spark} /> : null}

      <SearchBox />

      <button
        type="button"
        className={cn(
          "mt-4 flex h-11 w-full items-center justify-center rounded-2xl text-sm font-medium",
          tab === "aide" ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg",
        )}
        onClick={() => setTab("aide")}
      >
        Hỏi trợ lý
      </button>

      <div className="mt-4 space-y-2">
        <TabRow
          tab={tab}
          onChange={setTab}
          items={[
            ["manage", "Quản lý"],
            ["book", "Đang nắm"],
            ["board", "Bảng giá"],
          ]}
        />
        <TabRow
          tab={tab}
          onChange={setTab}
          items={[
            ["ideas", "Khuyến nghị"],
            ["news", "Tin"],
            ["report", "Báo cáo"],
          ]}
        />
      </div>

      <div className="fade-in mt-4">
        {tab === "manage" ? (
          <ManagePanel
            lots={lots}
            quotes={byTicker}
            indices={indexCards}
            cash={cash}
            margin={margin}
            watch={watch}
            pulses={pulse.data?.rows ?? []}
            txns={txns}
            loading={pulse.isLoading || pulse.isFetching}
            onOpenBook={() => setTab("book")}
            onOpenIdeas={() => setTab("ideas")}
            onOpenPulse={() => setTab("pulse")}
          />
        ) : null}
        {tab === "board" ? (
          <>
            <HoldingsPeek lots={lots} onOpen={() => setTab("book")} />
            <Board watch={watch} byTicker={byTicker} loading={quotes.isLoading || !ready} error={quotes.isError} />
          </>
        ) : null}
        {tab === "book" ? (
          <Book lots={lots} byTicker={byTicker} loading={quotes.isLoading || !ready} />
        ) : null}
        {tab === "pulse" ? (
          <Pulse
            loading={pulse.isLoading || pulse.isFetching}
            error={pulse.isError}
            rows={pulse.data?.rows ?? []}
            empty={watch.length === 0}
          />
        ) : null}
        {tab === "news" ? <NewsPanel enabled={ready} /> : null}
        {tab === "ideas" ? (
          <div className="space-y-6">
            <PicksPanel enabled={ready} quotes={byTicker} />
            <IdeasPanel enabled={ready} tickers={ideaTickers} />
          </div>
        ) : null}
        {tab === "report" ? (
          <ReportPanel enabled={ready && tab === "report"} input={reportInput} />
        ) : null}
        {tab === "aide" ? (
          <AidePanel
            ready={ready}
            session={session}
            indices={indexCards}
            quotes={byTicker}
            book={{ lots, cash, margin, realized, watch }}
          />
        ) : null}
      </div>

      <p className="mt-8 text-xs leading-relaxed text-subtle">
        Giá từ DNSE. Tin, khuyến nghị công ty chứng khoán và báo cáo tài chính từ Simplize, có thể trễ. Không phải lời khuyên của Sổ Vốn.
      </p>
    </Frame>
  );
}

function TabRow({
  tab,
  onChange,
  items,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
  items: readonly (readonly [Tab, string])[];
}) {
  const index = items.findIndex(([id]) => id === tab);
  return (
    <div className="relative grid grid-cols-3 rounded-2xl bg-surface-2 p-1">
      {index >= 0 ? (
        <span
          className="pill absolute top-1 bottom-1 left-1 rounded-xl bg-surface"
          style={{ width: "calc((100% - 8px) / 3)", transform: `translateX(${index * 100}%)` }}
          aria-hidden="true"
        />
      ) : null}
      {items.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={cn("relative z-10 h-10 text-sm font-medium", tab === id ? "text-fg" : "text-muted")}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function IndexSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="skeleton h-28 w-40 shrink-0 rounded-2xl" />
      ))}
    </>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const remember = useBook((state) => state.remember);
  const recent = useBook((state) => state.recent);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 220);
    return () => window.clearTimeout(id);
  }, [q]);

  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchMarket({ data: { q: debounced } }),
    enabled: debounced.length >= 1,
    staleTime: 60_000,
  });

  function openTicker(ticker: string) {
    remember(ticker);
    setQ("");
    setOpen(false);
    void navigate({ to: "/m/$ticker", params: { ticker } });
  }

  const hits = search.data?.hits ?? [];
  const showRecent = open && q.trim().length === 0 && recent.length > 0;

  return (
    <form
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        const first = hits[0]?.ticker;
        if (first) openTicker(first);
      }}
    >
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
        <Input
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 160)}
          placeholder="Tìm mã hoặc tên, ví dụ Hòa Phát"
          aria-label="Tìm mã chứng khoán"
          className="pl-10"
          autoComplete="off"
        />
      </label>
      {open && (showRecent || debounced.length > 0) ? (
        <div className="absolute z-20 mt-2 w-full rounded-2xl border border-line bg-surface p-1">
          {showRecent
            ? recent.map((ticker) => (
                <ResultButton key={ticker} ticker={ticker} name={shortName(ticker)} hint="Vừa xem" onPick={openTicker} />
              ))
            : null}
          {!showRecent && search.isLoading ? <p className="px-3 py-3 text-sm text-muted">Đang tìm…</p> : null}
          {!showRecent && !search.isLoading && hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">Không thấy mã phù hợp.</p>
          ) : null}
          {!showRecent
            ? hits.map((hit) => (
                <ResultButton key={hit.ticker} ticker={hit.ticker} name={hit.name} onPick={openTicker} />
              ))
            : null}
        </div>
      ) : null}
    </form>
  );
}

function ResultButton({
  ticker,
  name,
  hint,
  onPick,
}: {
  ticker: string;
  name: string;
  hint?: string;
  onPick: (ticker: string) => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(ticker)}
    >
      <span className="text-sm">
        <span className="font-medium">{ticker}</span>
        <span className="text-muted"> · {name}</span>
      </span>
      {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
    </button>
  );
}

function Board({
  watch,
  byTicker,
  loading,
  error,
}: {
  watch: string[];
  byTicker: Map<string, Quote>;
  loading: boolean;
  error: boolean;
}) {
  const [byMove, setByMove] = useState(false);
  if (!watch.length) {
    return <p className="rounded-3xl border border-line bg-surface px-4 py-8 text-sm text-muted">Chưa có mã theo dõi. Tìm một cổ phiếu để ghim vào bảng.</p>;
  }
  if (loading && byTicker.size === 0) {
    return (
      <div className="space-y-2">
        {watch.slice(0, 6).map((ticker) => (
          <div key={ticker} className="skeleton h-16 rounded-2xl" />
        ))}
      </div>
    );
  }
  const ordered = byMove
    ? [...watch].sort((a, b) => (byTicker.get(b)?.pct ?? -1e9) - (byTicker.get(a)?.pct ?? -1e9))
    : watch;
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="flex gap-1 border-b border-line p-3">
        <button
          type="button"
          className={cn("h-10 flex-1 rounded-xl text-sm font-medium", byMove ? "text-muted" : "bg-surface-2 text-fg")}
          onClick={() => setByMove(false)}
        >
          Thứ tự theo dõi
        </button>
        <button
          type="button"
          className={cn("h-10 flex-1 rounded-xl text-sm font-medium", byMove ? "bg-surface-2 text-fg" : "text-muted")}
          onClick={() => setByMove(true)}
        >
          Mạnh nhất phiên
        </button>
      </div>
      {error ? <p className="px-4 pt-4 text-sm text-muted">Một phần giá chưa tải được.</p> : null}
      <ul>
        {ordered.map((ticker) => {
          const quote = byTicker.get(ticker);
          return (
            <li key={ticker} className="border-b border-line last:border-b-0">
              <Link to="/m/$ticker" params={{ ticker }} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block text-sm font-medium">{ticker}</span>
                  <span className="block text-xs text-muted">{shortName(ticker)}</span>
                </span>
                {quote ? (
                  <span className="text-right">
                    <span className="block text-sm font-medium tabular-nums">{fmtPrice(quote.price)}</span>
                    <span className={cn("block text-xs tabular-nums", toneClass(quote.pct))}>{fmtPct(quote.pct)}</span>
                  </span>
                ) : (
                  <span className="text-xs text-subtle">Chưa có giá</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Book({ lots, byTicker, loading }: { lots: Lot[]; byTicker: Map<string, Quote>; loading: boolean }) {
  const removeLot = useBook((state) => state.removeLot);
  const cash = useBook((state) => state.cash);
  const margin = useBook((state) => state.margin);
  const realized = useBook((state) => state.realized);
  const txns = useBook((state) => state.txns);
  const rows = lots.map((lot) => {
    const quote = byTicker.get(lot.ticker);
    const cost = lot.shares * lot.avg;
    const value = quote ? lot.shares * quote.price : null;
    const pnl = value == null ? null : value - cost;
    const pct = pnl == null || cost === 0 ? null : (pnl / cost) * 100;
    const day = quote ? lot.shares * quote.change : null;
    return { lot, quote, cost, value, pnl, pct, day };
  });
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const valued = rows.filter((row) => row.value != null);
  const market = valued.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const pnl = valued.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
  const day = rows.reduce((sum, row) => sum + (row.day ?? 0), 0);
  const dayKnown = rows.some((row) => row.day != null);
  const hit = rows.filter((row) => {
    const price = row.quote?.price;
    if (!price) return false;
    const stopHit = row.lot.stop != null && row.lot.stop > 0 && price <= row.lot.stop;
    const targetHit = row.lot.target != null && row.lot.target > 0 && price >= row.lot.target;
    return stopHit || targetHit;
  });

  const gross = market + (cash ?? 0);
  const nav = gross - margin;
  const showBooks = (lots.length && !loading) || cash != null || margin > 0;

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-line bg-surface p-4">
        <p className="text-xs text-subtle">NAV</p>
        <p className="mt-1 font-display text-4xl leading-none tabular-nums">{showBooks ? fmtPrice(nav) : "—"}</p>
        <p className="mt-2 text-xs text-subtle tabular-nums">
          Tổng danh mục {showBooks ? fmtPrice(gross) : "—"} = NAV + vay {fmtPrice(margin)}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Giá vốn" value={lots.length ? fmtPrice(cost) : "—"} />
          <Stat label="Lãi lỗ" value={lots.length && valued.length ? fmtPrice(pnl) : "—"} tone={pnl} />
          <Stat label="Hôm nay" value={lots.length && dayKnown ? fmtPrice(day) : "—"} tone={dayKnown ? day : null} />
        </div>
        <p className={cn("mt-3 text-xs tabular-nums", toneClass(realized))}>Đã chốt {fmtPrice(realized)}</p>
        {hit.length > 0 ? (
          <p className="mt-2 text-sm text-fg">{hit.map((row) => row.lot.ticker).join(", ")} đang chạm mốc cắt lỗ hoặc chốt lời.</p>
        ) : null}
        {cost > 0 ? (
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-surface-2">
            {rows.map((row) => (
              <span
                key={row.lot.ticker}
                className="h-full bg-accent"
                style={{ width: `${(row.cost / cost) * 100}%`, opacity: 0.35 + (row.cost / cost) * 0.65 }}
                title={row.lot.ticker}
              />
            ))}
          </div>
        ) : null}
      </section>

      <CashBox />

      <BookSwitch />

      <HoldForm />

      <section>
        <h2 className="text-sm font-medium">Danh mục đang nắm</h2>
        {lots.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Chưa có mã. Điền mã, số cổ phiếu và giá vốn ở ô phía trên.</p>
        ) : (
          <ul className="mt-3 overflow-hidden rounded-3xl border border-line bg-surface">
            {rows.map((row) => (
              <PositionRow key={row.lot.ticker} row={row} market={market} onRemove={() => removeLot(row.lot.ticker)} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Lịch sử lệnh</h2>
        {txns.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Lệnh mua hoặc bán mới sẽ hiện ở đây. Lô ghi trước đó vẫn giữ nguyên.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {txns.slice(0, 12).map((txn) => (
              <TxnLine key={txn.id} txn={txn} />
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-subtle">
        Thêm mã không bị chặn bởi tiền mặt. Vay margin nhập riêng. NAV = cổ phiếu + tiền mặt − vay. Bán trả vay trước, phần còn lại về tiền mặt.
      </p>
    </div>
  );
}

function HoldingsPeek({ lots, onOpen }: { lots: Lot[]; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="mb-4 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-left">
      <span className="text-xs text-subtle">Danh mục đang nắm</span>
      <span className="mt-1 block text-sm">
        {lots.length === 0
          ? "Chưa ghi mã nào. Bấm để thêm số cổ phiếu và giá vốn."
          : lots.map((lot) => `${lot.ticker} ${fmtQty(lot.shares)} cp`).join(" · ")}
      </span>
    </button>
  );
}

function HoldForm() {
  const addLot = useBook((state) => state.addLot);
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [avg, setAvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="rounded-3xl border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const code = cleanTicker(ticker);
        const shareCount = parseMoney(shares);
        const price = parseMoney(avg);
        if (code.length < 3) {
          setError("Nhập mã, ví dụ VNM.");
          return;
        }
        if (!(shareCount > 0) || !(price > 0)) {
          setError("Cần số cổ phiếu và giá vốn.");
          return;
        }
        addLot(code, shareCount, price);
        setTicker("");
        setShares("");
        setAvg("");
        setError(null);
      }}
    >
      <h2 className="text-sm font-medium">Thêm mã đang nắm</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Input
          aria-label="Mã chứng khoán"
          placeholder="Mã"
          value={ticker}
          autoCapitalize="characters"
          onChange={(event) => setTicker(event.target.value.toUpperCase())}
        />
        <Input
          aria-label="Số cổ phiếu"
          placeholder="Số cp"
          inputMode="decimal"
          value={shares}
          onChange={(event) => setShares(event.target.value)}
        />
        <Input
          aria-label="Giá vốn"
          placeholder="Giá vốn"
          inputMode="decimal"
          value={avg}
          onChange={(event) => setAvg(event.target.value)}
        />
      </div>
      <Button type="submit" className="mt-3 w-full">
        Thêm vào danh mục
      </Button>
      {error ? <p className="mt-2 text-xs text-down">{error}</p> : null}
    </form>
  );
}

function IndexChart({ label, values }: { label: string; values: number[] }) {
  if (values.length < 2) return null;
  const width = 360;
  const height = 132;
  const pad = 8;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (value: number) => pad + ((max - value) / span) * (height - pad * 2);
  const path = values.map((value, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const change = first ? ((last - first) / first) * 100 : 0;
  return (
    <section className="mb-5 rounded-3xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{label}</h2>
        <p className={cn("text-sm tabular-nums", toneClass(change))}>{fmtPct(change)} · {values.length} phiên</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-32 w-full" role="img" aria-label={`Biểu đồ ${label}`}>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className={toneClass(change)} />
      </svg>
      <p className="text-xs text-subtle tabular-nums">
        Thấp {fmtIndex(min)} · cao {fmtIndex(max)}
      </p>
    </section>
  );
}

function CashBox() {
  const cash = useBook((state) => state.cash);
  const margin = useBook((state) => state.margin);
  const setCash = useBook((state) => state.setCash);
  const setMargin = useBook((state) => state.setMargin);
  const [cashDraft, setCashDraft] = useState(cash == null ? "" : String(Math.round(cash)));
  const [marginDraft, setMarginDraft] = useState(String(Math.round(margin)));

  return (
    <section className="rounded-3xl border border-line bg-surface p-4">
      <h2 className="text-sm font-medium">NAV và vay margin</h2>
      <p className="mt-2 text-xs text-subtle">
        Tổng danh mục là cổ phiếu cộng tiền mặt. NAV là phần vốn tự có. Vay là dư nợ. Danh mục được lớn hơn tiền mặt: phần vượt cộng vào vay.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-subtle">Tiền mặt</p>
          <p className="mt-1 text-sm font-medium tabular-nums">{cash == null ? "Chưa theo dõi" : fmtPrice(cash)}</p>
        </div>
        <div>
          <p className="text-xs text-subtle">Vay margin</p>
          <p className="mt-1 text-sm font-medium tabular-nums">{fmtPrice(margin)}</p>
        </div>
      </div>
      <form
        className="mt-3 grid grid-cols-2 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const nextCash = parseMoney(cashDraft);
          const nextMargin = parseMoney(marginDraft);
          if (cashDraft.trim() && nextCash >= 0) setCash(nextCash);
          if (nextMargin >= 0) setMargin(nextMargin);
        }}
      >
        <Input
          inputMode="numeric"
          aria-label="Tiền mặt"
          placeholder="Tiền mặt"
          value={cashDraft}
          onChange={(event) => setCashDraft(event.target.value)}
        />
        <Input
          inputMode="numeric"
          aria-label="Vay margin"
          placeholder="Vay margin"
          value={marginDraft}
          onChange={(event) => setMarginDraft(event.target.value)}
        />
        <Button type="submit" className="col-span-2">
          Lưu tiền mặt và vay
        </Button>
      </form>
    </section>
  );
}

function PositionRow({
  row,
  market,
  onRemove,
}: {
  row: {
    lot: Lot;
    quote?: Quote;
    value: number | null;
    pnl: number | null;
    pct: number | null;
  };
  market: number;
  onRemove: () => void;
}) {
  const sell = useBook((state) => state.sell);
  const setLevels = useBook((state) => state.setLevels);
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState(false);
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState(row.quote ? String(Math.round(row.quote.price)) : "");
  const [stop, setStop] = useState(row.lot.stop ? String(Math.round(row.lot.stop)) : "");
  const [target, setTarget] = useState(row.lot.target ? String(Math.round(row.lot.target)) : "");
  const [error, setError] = useState<string | null>(null);
  const live = row.quote?.price;
  const stopHit = live != null && row.lot.stop != null && row.lot.stop > 0 && live <= row.lot.stop;
  const targetHit = live != null && row.lot.target != null && row.lot.target > 0 && live >= row.lot.target;

  return (
    <li className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <Link to="/m/$ticker" params={{ ticker: row.lot.ticker }} className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {row.lot.ticker}
            <span className="font-normal text-muted"> · {shortName(row.lot.ticker)}</span>
          </span>
          <span className="block text-xs text-subtle tabular-nums">
            {fmtQty(row.lot.shares)} cp · giá {row.quote ? fmtPrice(row.quote.price) : "—"} · vốn {fmtPrice(row.lot.avg)}
            {row.value != null && market > 0 ? ` · ${((row.value / market) * 100).toFixed(0)}%` : ""}
          </span>
        </Link>
        <span className="text-right">
          <span className="block text-sm font-medium tabular-nums">{row.value == null ? "—" : fmtPrice(row.value)}</span>
          <span className={cn("block text-xs tabular-nums", toneClass(row.pnl))}>
            {row.pnl == null ? "" : fmtPrice(row.pnl)}
            {row.pct == null ? "" : ` ${fmtPct(row.pct)}`}
          </span>
        </span>
        <button type="button" className="press h-11 rounded-lg px-2 text-sm text-muted" onClick={() => setOpen((value) => !value)}>
          Bán
        </button>
        <button
          type="button"
          className="press grid size-11 place-items-center rounded-lg text-muted"
          aria-label={`Xóa ${row.lot.ticker} khỏi sổ`}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-3 px-4 pb-3 text-xs tabular-nums">
        <span className={cn("min-w-0 flex-1", stopHit ? "text-down" : "text-subtle")}>
          Cắt lỗ {row.lot.stop ? fmtPrice(row.lot.stop) : "—"}
          {levelGap(live, row.lot.stop, "stop")}
        </span>
        <span className={cn("min-w-0 flex-1 text-right", targetHit ? "text-up" : "text-subtle")}>
          Chốt lời {row.lot.target ? fmtPrice(row.lot.target) : "—"}
          {levelGap(live, row.lot.target, "target")}
        </span>
        <button type="button" className="press h-10 shrink-0 rounded-lg px-2 text-sm text-muted" onClick={() => setMarks((value) => !value)}>
          {marks ? "Đóng" : "Sửa"}
        </button>
      </div>
      {marks ? (
        <form
          className="grid grid-cols-2 gap-2 px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            const stopPx = stop.trim() ? parseMoney(stop) : null;
            const targetPx = target.trim() ? parseMoney(target) : null;
            if ((stopPx != null && !(stopPx > 0)) || (targetPx != null && !(targetPx > 0))) return;
            if (stopPx != null && targetPx != null && stopPx >= targetPx) {
              setError("Cắt lỗ phải thấp hơn chốt lời.");
              return;
            }
            setLevels(row.lot.ticker, stopPx, targetPx);
            setError(null);
            setMarks(false);
          }}
        >
          <label className="block text-xs text-subtle">
            Cắt lỗ
            <Input className="mt-1" inputMode="numeric" value={stop} onChange={(event) => setStop(event.target.value)} placeholder="Để trống nếu bỏ" />
          </label>
          <label className="block text-xs text-subtle">
            Chốt lời
            <Input className="mt-1" inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Để trống nếu bỏ" />
          </label>
          <Button type="submit" className="col-span-2">
            Lưu mốc
          </Button>
          {error ? <p className="col-span-2 text-xs text-down">{error}</p> : null}
        </form>
      ) : null}
      {open ? (
        <form
          className="grid grid-cols-2 gap-2 px-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            const shareCount = parseMoney(shares);
            const fill = parseMoney(price);
            if (!(shareCount > 0) || !(fill > 0)) return;
            const result = sell(row.lot.ticker, shareCount, fill);
            if (result === "over") {
              setError("Không bán quá số đang nắm.");
              return;
            }
            setOpen(false);
            setError(null);
            setShares("");
          }}
        >
          <Input inputMode="decimal" aria-label="Số cổ phiếu bán" placeholder="Số cổ phiếu" value={shares} onChange={(event) => setShares(event.target.value)} />
          <Input inputMode="decimal" aria-label="Giá bán" value={price} onChange={(event) => setPrice(event.target.value)} />
          <Button type="submit" className="col-span-2">
            Ghi lệnh bán
          </Button>
          {error ? <p className="col-span-2 text-xs text-down">{error}</p> : null}
        </form>
      ) : null}
    </li>
  );
}

function levelGap(price: number | undefined, level: number | null | undefined, kind: "stop" | "target"): string {
  if (level == null || !(level > 0) || price == null || !(price > 0)) return "";
  if (kind === "stop" && price <= level) return " · đã chạm";
  if (kind === "target" && price >= level) return " · đã chạm";
  return ` · ${fmtPct(((level - price) / price) * 100)}`;
}

function TxnLine({ txn }: { txn: Txn }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <span>
        {txn.side === "buy" ? "Mua" : "Bán"} {fmtQty(txn.shares)} {txn.ticker}
      </span>
      <span className="text-xs text-subtle tabular-nums">
        {fmtPrice(txn.price)} · {fmtWhen(txn.at, false)}
      </span>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return (
    <div>
      <p className="text-xs text-subtle">{label}</p>
      <p className={cn("mt-1 text-sm font-medium tabular-nums", tone == null ? "text-fg" : toneClass(tone))}>{value}</p>
    </div>
  );
}

function Pulse({
  rows,
  loading,
  error,
  empty,
}: {
  rows: { ticker: string; note: string; pct5: number | null; rsi: number | null; ma20gap: number | null }[];
  loading: boolean;
  error: boolean;
  empty: boolean;
}) {
  if (empty) return <p className="text-sm text-muted">Thêm mã vào bảng giá để đọc nhịp.</p>;
  if (loading && rows.length === 0) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton h-20 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (error && rows.length === 0) return <p className="text-sm text-muted">Chưa đọc được chuỗi giá.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">So với trung bình 20 và 50 phiên. Đây là mô tả giá, không phải lệnh mua bán.</p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.ticker}>
            <Link to="/m/$ticker" params={{ ticker: row.ticker }} className="block rounded-2xl border border-line bg-surface px-4 py-3">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">
                  {row.ticker}
                  <span className="font-normal text-muted"> · {shortName(row.ticker)}</span>
                </span>
                <span className={cn("text-sm tabular-nums", toneClass(row.pct5))}>
                  {row.pct5 == null ? "—" : `5 phiên ${fmtPct(row.pct5)}`}
                </span>
              </span>
              <span className="mt-1 block text-sm text-muted">{row.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
