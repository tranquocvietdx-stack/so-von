import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { shortName } from "@/lib/directory";
import { fmtCap, fmtPct, fmtPrice, toneClass } from "@/lib/format";
import { getIdeas, getNews, getStatements, type Idea } from "@/lib/market";
import { AideReport, type AideReportInput } from "@/components/aide-report";
import { cn } from "@/lib/cn";

export function NewsPanel({ enabled }: { enabled: boolean }) {
  const [ticker, setTicker] = useState("");
  const code = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const queryTicker = code.length >= 2 ? code : "";
  const news = useQuery({
    queryKey: ["news", queryTicker],
    queryFn: () => getNews({ data: { ticker: queryTicker } }),
    enabled,
    staleTime: 3 * 60_000,
  });
  const items = news.data?.items ?? [];

  return (
    <div className="space-y-3">
      <label className="block text-xs text-subtle">
        Lọc theo mã
        <input
          value={ticker}
          onChange={(event) => setTicker(event.target.value)}
          placeholder="VNM"
          className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none"
        />
      </label>
      {news.isLoading && items.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
      ) : null}
      {news.isError && items.length === 0 ? <p className="text-sm text-muted">Chưa lấy được tin.</p> : null}
      {!news.isLoading && items.length === 0 ? <p className="text-sm text-muted">Không có tin cho mã này.</p> : null}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="block rounded-2xl border border-line bg-surface px-4 py-3"
            >
              <span className="block text-xs text-subtle">
                {[item.ago || item.date, item.tickers.join(" · ")].filter(Boolean).join(" · ")}
              </span>
              <span className="mt-1 block text-sm font-medium">{item.title}</span>
              {item.summary ? <span className="mt-1 block text-sm text-muted">{item.summary}</span> : null}
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-subtle">Tin từ Simplize. Bấm để mở trang tin của mã.</p>
    </div>
  );
}

export function IdeasPanel({ enabled, tickers }: { enabled: boolean; tickers: string[] }) {
  const ideas = useQuery({
    queryKey: ["ideas", tickers.join(",")],
    queryFn: () => getIdeas({ data: { tickers: tickers.join(",") } }),
    enabled: enabled && tickers.length > 0,
    staleTime: 10 * 60_000,
  });
  const rows = [...(ideas.data?.ideas ?? [])].sort((a, b) => (b.upside ?? -999) - (a.upside ?? -999));

  if (!tickers.length) return <p className="text-sm text-muted">Theo dõi hoặc ghi một mã để xem khuyến nghị đã công bố.</p>;
  if (ideas.isLoading && rows.length === 0) {
    return (
      <div className="space-y-2">
        {tickers.slice(0, 4).map((ticker) => (
          <div key={ticker} className="skeleton h-28 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (ideas.isError && rows.length === 0) return <p className="text-sm text-muted">Chưa lấy được khuyến nghị.</p>;
  if (!ideas.isLoading && rows.length === 0) return <p className="text-sm text-muted">Các mã này chưa có khuyến nghị công bố.</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Khuyến nghị và giá mục tiêu do công ty chứng khoán công bố, Simplize tổng hợp. Không phải lời khuyên của Sổ Vốn.</p>
      <ul className="space-y-2">
        {rows.map((idea) => (
          <li key={idea.ticker}>
            <IdeaCard idea={idea} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  return (
    <article className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <Link to="/m/$ticker" params={{ ticker: idea.ticker }} className="text-sm font-medium">
          {idea.ticker}
          <span className="font-normal text-muted"> · {shortName(idea.ticker)}</span>
        </Link>
        <span className={cn("text-sm font-medium", stanceClass(idea.recommend))}>{idea.recommend || "Chưa gắn nhãn"}</span>
      </div>
      <p className="mt-1 text-xs text-subtle">
        {[idea.source, idea.reportDate, idea.analysts ? `${idea.analysts} báo cáo` : ""].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-2 text-sm tabular-nums">
        Bình quân {idea.mean == null ? "—" : fmtPrice(idea.mean)}
        {idea.upside == null ? "" : <span className={cn("ml-2", toneClass(idea.upside))}>{fmtPct(idea.upside)}</span>}
      </p>
      {idea.low != null && idea.high != null ? (
        <p className="text-xs text-subtle tabular-nums">
          Khoảng {fmtPrice(idea.low)} – {fmtPrice(idea.high)}
          {idea.target != null ? ` · mục tiêu báo cáo ${fmtPrice(idea.target)}` : ""}
        </p>
      ) : null}
      {idea.reportTitle ? <p className="mt-2 text-sm text-muted">{idea.reportTitle}</p> : null}
      {idea.pdf ? (
        <a className="mt-2 inline-flex text-sm font-medium underline decoration-line underline-offset-4" href={idea.pdf} target="_blank" rel="noreferrer">
          Tải báo cáo
        </a>
      ) : null}
    </article>
  );
}

function stanceClass(label: string | null): string {
  if (!label) return "text-muted";
  if (label.includes("BÁN")) return "text-down";
  if (label.includes("MUA")) return "text-up";
  return "text-flat";
}

export function ReportPanel({ enabled, input }: { enabled: boolean; input: AideReportInput }) {
  const tickers = input.lots.map((lot) => lot.ticker).slice(0, 6);
  const statements = useQuery({
    queryKey: ["statements", tickers.join(",")],
    queryFn: () => getStatements({ data: { tickers: tickers.join(",") } }),
    enabled: enabled && tickers.length > 0,
    staleTime: 30 * 60_000,
  });

  return (
    <div className="space-y-4">
      <AideReport input={input} />
      {tickers.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Báo cáo tài chính</h2>
          <p className="text-xs text-subtle">Doanh thu hoặc thu nhập (dòng đầu) và lợi nhuận quý, theo số Simplize công bố. Đơn vị đồng.</p>
          {statements.isLoading && !statements.data ? <div className="skeleton h-28 rounded-2xl" /> : null}
          {(statements.data?.rows ?? []).map((pack) => (
            <article key={pack.ticker} className="rounded-2xl border border-line bg-surface px-4 py-3">
              <Link to="/m/$ticker" params={{ ticker: pack.ticker }} className="text-sm font-medium">
                {pack.ticker}
                <span className="font-normal text-muted"> · {shortName(pack.ticker)}</span>
              </Link>
              {pack.quarters.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Chưa có số quý.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {pack.quarters.map((quarter) => (
                    <li key={quarter.period} className="flex justify-between gap-3 text-sm tabular-nums">
                      <span>{quarter.period}</span>
                      <span className="text-muted">
                        {quarter.revenue == null ? "—" : fmtCap(quarter.revenue)}
                        {" · "}
                        <span className={toneClass(quarter.profit)}>{quarter.profit == null ? "—" : fmtCap(quarter.profit)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {pack.filings[0] ? (
                <a className="mt-2 inline-flex text-sm font-medium underline decoration-line underline-offset-4" href={pack.filings[0].href} target="_blank" rel="noreferrer">
                  {pack.filings[0].title}
                </a>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
