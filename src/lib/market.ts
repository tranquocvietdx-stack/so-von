import { createServerFn } from "@tanstack/react-start";
import { cleanTicker, DIRECTORY, fold } from "@/lib/directory";
import { type Assessment } from "@/lib/assess";
import { signal, scoreMarket, scoreSector, exitPlan, type ExitCard, type LayerScore } from "@/lib/signal";
import { summarize, techNote, sma, type Bar, type Tech } from "@/lib/tech";

const ENTRADE = "https://services.entrade.com.vn/chart-api";
const SIMPLIZE = "https://api.simplize.vn/api";

export type RangeKey = "5D" | "3M" | "1Y" | "5Y";

export type Quote = {
  ticker: string;
  price: number;
  change: number;
  pct: number;
  volume: number;
  reference: number;
  floor: number;
  ceiling: number;
  bids: Level[];
  asks: Level[];
  asOf: number;
};

export type Level = { price: number; qty: number };

export type IndexCard = {
  id: string;
  label: string;
  price: number;
  pct: number;
  spark: number[];
  series: number[];
};

export type Profile = {
  name: string;
  exchange: string;
  industry: string;
  sector: string;
  marketCap: number | null;
  shares: number | null;
  website: string | null;
  blurb: string | null;
};

export type Metrics = {
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

export type Peer = {
  ticker: string;
  name: string;
  price: number;
  pct7d: number | null;
};

export type PulseRow = Tech & { ticker: string; note: string };

export type NewsItem = {
  id: string;
  title: string;
  summary: string;
  date: string;
  ago: string;
  tickers: string[];
  href: string;
};

export type Idea = {
  ticker: string;
  recommend: string | null;
  source: string | null;
  reportTitle: string | null;
  reportDate: string | null;
  target: number | null;
  mean: number | null;
  low: number | null;
  high: number | null;
  upside: number | null;
  analysts: number | null;
  pdf: string | null;
};

export type Filing = { title: string; href: string };

export type Quarter = { period: string; revenue: number | null; profit: number | null };

export type StatementPack = { ticker: string; quarters: Quarter[]; filings: Filing[] };

export type SearchHit = { ticker: string; name: string };

type CacheEntry = { exp: number; value: unknown };
const cache = new Map<string, CacheEntry>();

const INDEXES: { id: string; label: string }[] = [
  { id: "VNINDEX", label: "VN-Index" },
  { id: "VN30", label: "VN30" },
  { id: "HNX", label: "HNX" },
  { id: "UPCOM", label: "UPCOM" },
];

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { exp: Date.now() + ttl, value });
  return value;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "SoVon/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Không lấy được dữ liệu (${response.status})`);
  return response.json();
}

async function mapPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await task(items[index]!);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

type RawBars = {
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
};

function zipBars(raw: RawBars, scaleStock: boolean): Bar[] {
  const closes = raw.c ?? [];
  const last = [...closes].reverse().find((close) => typeof close === "number" && close > 0);
  const mul = scaleStock && last != null && last < 5000 ? 1000 : 1;
  const bars: Bar[] = [];
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    if (typeof close !== "number" || !(close > 0)) continue;
    const open = typeof raw.o?.[i] === "number" && raw.o[i]! > 0 ? raw.o[i]! : close;
    const high = typeof raw.h?.[i] === "number" && raw.h[i]! > 0 ? raw.h[i]! : Math.max(open, close);
    const low = typeof raw.l?.[i] === "number" && raw.l[i]! > 0 ? raw.l[i]! : Math.min(open, close);
    bars.push({
      t: (raw.t?.[i] ?? 0) * 1000,
      o: Math.round(open * mul),
      h: Math.round(Math.max(high, open, close) * mul),
      l: Math.round(Math.min(low, open, close) * mul),
      c: Math.round(close * mul),
      v: typeof raw.v?.[i] === "number" ? raw.v[i]! : 0,
    });
  }
  return bars;
}

async function fetchStockBars(ticker: string, resolution: string, days: number): Promise<Bar[]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;
  const url = `${ENTRADE}/v2/ohlcs/stock?symbol=${encodeURIComponent(ticker)}&resolution=${resolution}&from=${from}&to=${to}`;
  const raw = (await fetchJson(url)) as RawBars;
  return zipBars(raw, true);
}

async function loadDaily(ticker: string): Promise<Bar[]> {
  return cached(`daily:${ticker}`, 5 * 60_000, () => fetchStockBars(ticker, "1D", 430));
}

async function barsFor(ticker: string, range: RangeKey): Promise<Bar[]> {
  if (range === "5Y") {
    return cached(`week:${ticker}`, 30 * 60_000, () => fetchStockBars(ticker, "1W", 2100));
  }
  if (range === "5D") {
    const intra = await cached(`intra:${ticker}`, 60_000, () => fetchStockBars(ticker, "15", 8));
    if (intra.length >= 4) return intra;
  }
  const daily = await loadDaily(ticker);
  if (range === "3M" || range === "5D") return daily.slice(-66);
  return daily;
}

function levels(data: Record<string, unknown>, side: "Bid" | "Ask"): Level[] {
  const out: Level[] = [];
  for (let i = 1; i <= 3; i++) {
    const price = num(data[`price${side}${i}`]);
    const qty = num(data[`quantity${side}${i}`]);
    if (price && price > 0) out.push({ price, qty: qty ?? 0 });
  }
  return out;
}

async function loadQuote(ticker: string): Promise<Quote | null> {
  try {
    return await cached(`quote:${ticker}`, 20_000, async () => {
      const body = rec(await fetchJson(`${SIMPLIZE}/historical/quote/${ticker}`));
      const data = rec(body?.data);
      const price = data ? num(data.priceClose) : null;
      if (!data || !price) throw new Error("empty");
      const reference = num(data.priceReference) ?? price;
      const change = num(data.netChange) ?? price - reference;
      return {
        ticker,
        price,
        change,
        pct: num(data.pctChange) ?? (reference ? (change / reference) * 100 : 0),
        volume: num(data.totalVolume) ?? 0,
        reference,
        floor: num(data.priceFloor) ?? 0,
        ceiling: num(data.priceCeiling) ?? 0,
        bids: levels(data, "Bid"),
        asks: levels(data, "Ask"),
        asOf: (num(data.timestamp) ?? Math.floor(Date.now() / 1000)) * 1000,
      } satisfies Quote;
    });
  } catch {
    try {
      const bars = await loadDaily(ticker);
      const last = bars.at(-1);
      const prev = bars.at(-2) ?? last;
      if (!last || !prev) return null;
      const change = last.c - prev.c;
      return {
        ticker,
        price: last.c,
        change,
        pct: prev.c ? (change / prev.c) * 100 : 0,
        volume: last.v,
        reference: prev.c,
        floor: 0,
        ceiling: 0,
        bids: [],
        asks: [],
        asOf: last.t,
      };
    } catch {
      return null;
    }
  }
}

function plain(html: unknown, max = 280): string | null {
  if (typeof html !== "string") return null;
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function ratioPair(node: unknown): { ratio: number | null; industry: number | null } {
  const data = rec(node);
  return {
    ratio: data ? num(data.ratio) : null,
    industry: data ? num(data.ratioMedian5yIndustry) : null,
  };
}

async function loadProfile(ticker: string): Promise<Profile | null> {
  return cached(`profile:${ticker}`, 6 * 60 * 60_000, async () => {
    const body = rec(await fetchJson(`${SIMPLIZE}/company/summary/${ticker}`));
    const data = rec(body?.data);
    if (!data || typeof data.nameVi !== "string") return null;
    const site = typeof data.website === "string" ? data.website : null;
    return {
      name: data.nameVi,
      exchange: typeof data.stockExchange === "string" ? data.stockExchange : "",
      industry: typeof data.industryActivity === "string" ? data.industryActivity : "",
      sector: typeof data.bcEconomicSectorName === "string" ? data.bcEconomicSectorName : "",
      marketCap: num(data.marketCap),
      shares: num(data.outstandingSharesValue),
      website: site && site.startsWith("http") ? site : null,
      blurb: plain(data.businessLine),
    };
  });
}

async function loadMetrics(ticker: string): Promise<Metrics | null> {
  return cached(`metrics:${ticker}`, 6 * 60 * 60_000, async () => {
    const body = rec(await fetchJson(`${SIMPLIZE}/company/analysis-metrics/${ticker}`));
    const data = rec(body?.data);
    if (!data) return null;
    const pe = ratioPair(data.peRatio);
    const pb = ratioPair(data.pbRatio);
    const ev = ratioPair(data.evEbitdaRatio);
    const peg = ratioPair(data.pegRatio);
    const intrinsic = rec(data.intrinsicValue);
    return {
      pe: pe.ratio,
      peIndustry: pe.industry,
      pb: pb.ratio,
      pbIndustry: pb.industry,
      evEbitda: ev.ratio,
      peg: peg.ratio,
      intrinsic: intrinsic ? num(intrinsic.intrinsicValue) : null,
      upside: intrinsic ? num(intrinsic.change) : null,
      downside: Boolean(intrinsic?.isDownside),
      updated: typeof data.updatedDate === "string" ? data.updatedDate : null,
    };
  });
}

async function loadPeers(ticker: string): Promise<Peer[]> {
  return cached(`peers:${ticker}`, 6 * 60 * 60_000, async () => {
    const body = rec(await fetchJson(`${SIMPLIZE}/company/company-related/${ticker}`));
    const list = Array.isArray(body?.data) ? body.data : [];
    return list.slice(0, 4).flatMap((item) => {
      const row = rec(item);
      const code = row && typeof row.ticker === "string" ? row.ticker : "";
      const price = row ? num(row.priceClose) : null;
      if (!code || !price) return [];
      return [
        {
          ticker: code,
          name: typeof row?.companyName === "string" ? row.companyName : code,
          price,
          pct7d: row ? num(row.pricePctChg7d) : null,
        },
      ];
    });
  });
}

async function symbolSet(): Promise<Set<string>> {
  const list = await cached("symbols", 12 * 60 * 60_000, async () => {
    const body = rec(await fetchJson(`${ENTRADE}/symbols?type=stock`));
    const symbols = Array.isArray(body?.symbols) ? body.symbols : [];
    return symbols.filter((item): item is string => typeof item === "string");
  });
  return new Set(list);
}

function parseTickers(input: unknown): string[] {
  const raw = rec(input);
  const text = typeof raw?.tickers === "string" ? raw.tickers : "";
  const unique = new Set<string>();
  for (const part of text.split(",")) {
    const ticker = cleanTicker(part);
    if (ticker.length >= 2) unique.add(ticker);
  }
  return [...unique].slice(0, 24);
}

export const getIndices = createServerFn({ method: "GET" }).handler(async () => {
  const cards = await mapPool(INDEXES, 4, async (index) => {
    try {
      return await cached(`index:${index.id}`, 60_000, async () => {
        const to = Math.floor(Date.now() / 1000);
        const from = to - 170 * 86400;
        const url = `${ENTRADE}/v2/ohlcs/index?symbol=${index.id}&resolution=1D&from=${from}&to=${to}`;
        const raw = (await fetchJson(url)) as RawBars;
        const closes = (raw.c ?? []).filter((close): close is number => typeof close === "number" && close > 0);
        const price = closes.at(-1);
        const prev = closes.at(-2) ?? price;
        if (price == null || prev == null) throw new Error("empty");
        return {
          id: index.id,
          label: index.label,
          price,
          pct: ((price - prev) / prev) * 100,
          spark: closes.slice(-42),
          series: closes.slice(-140),
        } satisfies IndexCard;
      });
    } catch {
      return null;
    }
  });
  return { indices: cards.filter((card): card is IndexCard => card != null) };
});

export const getQuotes = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ tickers: parseTickers(input) }))
  .handler(async ({ data }) => {
    if (!data.tickers.length) return { quotes: [] as Quote[] };
    const quotes = await mapPool(data.tickers, 6, (ticker) => loadQuote(ticker));
    return { quotes: quotes.filter((quote): quote is Quote => quote != null) };
  });

export const getPulse = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ tickers: parseTickers(input) }))
  .handler(async ({ data }) => {
    const rows = await mapPool(data.tickers, 4, async (ticker) => {
      try {
        const bars = await loadDaily(ticker);
        const tech = summarize(bars);
        if (!tech) return null;
        return { ticker, ...tech, note: techNote(tech) } satisfies PulseRow;
      } catch {
        return null;
      }
    });
    return { rows: rows.filter((row): row is PulseRow => row != null) };
  });

export const searchMarket = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = rec(input);
    const q = typeof raw?.q === "string" ? raw.q.trim().slice(0, 40) : "";
    return { q };
  })
  .handler(async ({ data }) => {
    const q = data.q;
    if (q.length < 1) return { hits: [] as SearchHit[] };
    const symbolQuery = /^[A-Za-z0-9.]{1,12}$/.test(q.trim());
    const code = symbolQuery ? cleanTicker(q) : "";
    const folded = fold(q);
    const symbols = await symbolSet().catch(() => new Set<string>());
    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    const push = (ticker: string, name: string) => {
      if (seen.has(ticker) || hits.length >= 8) return;
      seen.add(ticker);
      hits.push({ ticker, name });
    };

    if (code && (symbols.has(code) || DIRECTORY[code])) push(code, DIRECTORY[code] ?? "Mã niêm yết");

    for (const [ticker, name] of Object.entries(DIRECTORY)) {
      if (fold(name).includes(folded) || fold(ticker) === folded) push(ticker, name);
    }

    if (code.length >= 2) {
      for (const ticker of symbols) {
        if (hits.length >= 8) break;
        const plain = ticker.length === 3 && /^[A-Z]{3}$/.test(ticker);
        const explicit = ticker === code || (code.length >= 4 && ticker.startsWith(code));
        if ((plain && ticker.startsWith(code)) || explicit) push(ticker, DIRECTORY[ticker] ?? "Mã niêm yết");
      }
    }
    return { hits };
  });

export const getDetail = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = rec(input);
    const ticker = cleanTicker(typeof raw?.ticker === "string" ? raw.ticker : "");
    const range = raw?.range;
    const allowed: RangeKey[] = ["5D", "3M", "1Y", "5Y"];
    return {
      ticker,
      range: allowed.includes(range as RangeKey) ? (range as RangeKey) : ("3M" as RangeKey),
    };
  })
  .handler(async ({ data }) => {
    if (data.ticker.length < 2) throw new Error("Mã không hợp lệ");
    const [quote, profile, metrics, peers, bars, daily] = await Promise.all([
      loadQuote(data.ticker),
      loadProfile(data.ticker).catch(() => null),
      loadMetrics(data.ticker).catch(() => null),
      loadPeers(data.ticker).catch(() => [] as Peer[]),
      barsFor(data.ticker, data.range).catch(() => [] as Bar[]),
      data.range === "1Y" ? Promise.resolve(null) : loadDaily(data.ticker).catch(() => [] as Bar[]),
    ]);
    if (!quote && bars.length === 0 && !profile) throw new Error("Không tìm thấy mã này trên sàn.");
    const techBars = data.range === "1Y" ? bars : (daily ?? []);
    const tech = summarize(techBars);
    return {
      ticker: data.ticker,
      range: data.range,
      quote,
      profile,
      metrics,
      peers,
      bars,
      tech,
      note: tech ? techNote(tech) : null,
    };
  });

function httpsUrl(value: unknown): string | null {
  const url = plain(value);
  return url && url.startsWith("https://") ? url : null;
}

function newsHref(tickers: string[]): string {
  const ticker = tickers.find((item) => /^[A-Z0-9.]{2,8}$/.test(item));
  return ticker ? `https://simplize.vn/co-phieu/${ticker}/tin-tuc` : "https://simplize.vn/news";
}

async function loadNews(ticker: string): Promise<NewsItem[]> {
  const query = ticker ? `ticker=${encodeURIComponent(ticker)}&size=8` : "size=12";
  return cached(`news:${ticker || "all"}`, 3 * 60_000, async () => {
    const body = rec(await fetchJson(`${SIMPLIZE}/company/news-event/list-news?${query}`));
    const list = Array.isArray(body?.data) ? body.data : [];
    return list.flatMap((item) => {
      const row = rec(item);
      const title = row ? (plain(row.title) ?? "") : "";
      if (!row || !title) return [];
      const tickers = Array.isArray(row.tickers)
        ? row.tickers.filter((code): code is string => typeof code === "string").slice(0, 4)
        : [];
      return [
        {
          id: plain(row.id) ?? title,
          title,
          summary: plain(row.description, 220) ?? "",
          date: plain(row.createdDate) ?? "",
          ago: plain(row.createdDateTimeAgo) ?? "",
          tickers,
          href: newsHref(tickers),
        } satisfies NewsItem,
      ];
    });
  });
}

async function loadIdea(ticker: string): Promise<Idea | null> {
  return cached(`idea:${ticker}`, 30 * 60_000, async () => {
    const [sideRaw, reportRaw] = await Promise.all([
      fetchJson(`${SIMPLIZE}/company/analysis-sell-side/${ticker}`).catch(() => null),
      fetchJson(`${SIMPLIZE}/company/analysis-report/list?ticker=${ticker}&isWl=false&page=0&size=1`).catch(() => null),
    ]);
    const consensus = rec(rec(rec(sideRaw)?.data)?.consensusRecommendation);
    const reports = rec(reportRaw);
    const report = rec(Array.isArray(reports?.data) ? reports.data[0] : null);
    if (!consensus && !report) return null;
    const mean = consensus ? num(consensus.targetPriceMean) : null;
    const price = consensus ? num(consensus.priceClose) : null;
    return {
      ticker,
      recommend: report ? plain(report.recommend) || null : null,
      source: report ? plain(report.source) || null : null,
      reportTitle: report ? plain(report.title) || null : null,
      reportDate: report ? plain(report.issueDate) || null : null,
      target: report ? num(report.targetPrice) : null,
      mean,
      low: consensus ? num(consensus.targetPriceLow) : null,
      high: consensus ? num(consensus.targetPriceHigh) : null,
      upside:
        consensus?.changePercent != null
          ? num(consensus.changePercent)
          : mean && price
            ? ((mean - price) / price) * 100
            : null,
      analysts: consensus ? num(consensus.noOfRecommendations) : null,
      pdf: report ? httpsUrl(report.attachedLink) : null,
    } satisfies Idea;
  });
}

async function loadQuarters(ticker: string): Promise<Quarter[]> {
  return cached(`is:${ticker}`, 6 * 60 * 60_000, async () => {
    const body = rec(await fetchJson(`${SIMPLIZE}/company/fi/is/${ticker}?period=Q&size=4`));
    const items = Array.isArray(rec(body?.data)?.items) ? (rec(body?.data)?.items as unknown[]) : [];
    return items.flatMap((item) => {
      const row = rec(item);
      const period = row ? plain(row.periodDateName) : "";
      if (!row || !period) return [];
      return [{ period, revenue: num(row.is1), profit: num(row.is14) } satisfies Quarter];
    });
  });
}

async function loadFilings(ticker: string): Promise<Filing[]> {
  return cached(`docs:${ticker}`, 6 * 60 * 60_000, async () => {
    const body = rec(
      await fetchJson(`${SIMPLIZE}/company/documents/list?ticker=${ticker}&type=BCTC&page=0&size=3`),
    );
    const list = Array.isArray(body?.data) ? body.data : [];
    return list.flatMap((item) => {
      const row = rec(item);
      const title = row ? plain(row.title) : "";
      const href = row ? httpsUrl(row.attachedLink) : null;
      if (!title || !href) return [];
      return [{ title, href } satisfies Filing];
    });
  });
}

async function loadPack(ticker: string): Promise<StatementPack> {
  const [quarters, filings] = await Promise.all([
    loadQuarters(ticker).catch(() => [] as Quarter[]),
    loadFilings(ticker).catch(() => [] as Filing[]),
  ]);
  return { ticker, quarters, filings };
}

export const getNews = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = rec(input);
    const ticker = cleanTicker(typeof raw?.ticker === "string" ? raw.ticker : "");
    return { ticker: ticker.length >= 2 ? ticker : "" };
  })
  .handler(async ({ data }) => {
    try {
      return { items: await loadNews(data.ticker) };
    } catch {
      return { items: [] as NewsItem[] };
    }
  });

export const getIdeas = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ tickers: parseTickers(input).slice(0, 12) }))
  .handler(async ({ data }) => {
    const ideas = await mapPool(data.tickers, 4, async (ticker) => {
      try {
        return await loadIdea(ticker);
      } catch {
        return null;
      }
    });
    return { ideas: ideas.filter((idea): idea is Idea => idea != null) };
  });

export const getStatements = createServerFn({ method: "GET" })
  .validator((input: unknown) => ({ tickers: parseTickers(input).slice(0, 6) }))
  .handler(async ({ data }) => {
    const rows = await mapPool(data.tickers, 3, (ticker) => loadPack(ticker));
    return { rows };
  });

const BREADTH = ["VCB", "VHM", "HPG", "FPT", "VNM", "GAS", "TCB", "MSN", "VIC", "MWG"];
const BASKETS: { name: string; match: string[]; tickers: string[] }[] = [
  { name: "Ngân hàng", match: ["ngân hàng"], tickers: ["VCB", "CTG", "BID", "TCB"] },
  { name: "Bất động sản", match: ["bất động sản"], tickers: ["VHM", "VIC", "KDH", "NLG"] },
  { name: "Công nghệ", match: ["công nghệ", "phần mềm"], tickers: ["FPT", "CMG", "ELC", "FOX"] },
  { name: "Nguyên vật liệu", match: ["nguyên vật liệu", "thép", "hóa chất"], tickers: ["HPG", "HSG", "DPM", "DCM"] },
  { name: "Năng lượng", match: ["năng lượng", "dầu khí"], tickers: ["GAS", "PLX", "PVS", "PVD"] },
  { name: "Y tế", match: ["y tế", "dược"], tickers: ["DHG", "IMP", "DMC", "DBD"] },
  { name: "Tiêu dùng", match: ["tiêu dùng", "bán lẻ", "thực phẩm"], tickers: ["MWG", "VNM", "MSN", "PNJ"] },
  { name: "Chứng khoán", match: ["chứng khoán"], tickers: ["SSI", "VCI", "VND", "HCM"] },
  { name: "Vận tải", match: ["vận tải", "hàng hải", "cảng"], tickers: ["HAH", "GMD", "PVT", "VSC"] },
  { name: "Cao su", match: ["cao su"], tickers: ["GVR", "PHR", "DRC", "DPR"] },
  { name: "Công nghiệp", match: ["công nghiệp", "xây dựng"], tickers: ["GEX", "REE", "CTR", "PC1"] },
];

function basketFor(sector: string, industry: string): { name: string; tickers: string[] } | null {
  const text = `${sector} ${industry}`.toLowerCase();
  return BASKETS.find((item) => item.match.some((part) => text.includes(part))) ?? null;
}

async function loadIndexBars(): Promise<Bar[]> {
  return cached("skill-index", 5 * 60_000, async () => {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 460 * 86400;
    const raw = (await fetchJson(`${ENTRADE}/v2/ohlcs/index?symbol=VNINDEX&resolution=1D&from=${from}&to=${to}`)) as RawBars;
    return zipBars(raw, false);
  });
}

function equalWeight(series: Bar[][]): Bar[] {
  const lists = series.filter((bars) => bars.length > 60).map((bars) => bars.slice(-220));
  if (lists.length < 3) return [];
  const length = Math.min(...lists.map((bars) => bars.length));
  const aligned = lists.map((bars) => bars.slice(-length));
  let level = 100;
  return aligned[0]!.map((bar, index) => {
    if (index > 0) {
      let change = 0;
      let count = 0;
      for (const bars of aligned) {
        const prev = bars[index - 1]!.c;
        if (prev > 0) {
          change += bars[index]!.c / prev - 1;
          count += 1;
        }
      }
      level *= 1 + (count ? change / count : 0);
    }
    return { t: bar.t, o: level, h: level, l: level, c: level, v: aligned.reduce((sum, bars) => sum + bars[index]!.v, 0) };
  });
}

function memberBreadth(series: Bar[][]): number | null {
  const usable = series.filter((bars) => bars.length >= 20);
  if (!usable.length) return null;
  const above = usable.filter((bars) => {
    const closes = bars.map((bar) => bar.c);
    const ma = sma(closes, 20);
    const price = closes.at(-1);
    return ma != null && price != null && price >= ma;
  }).length;
  return above / usable.length;
}

async function skillContext(): Promise<{ index: Bar[]; market: LayerScore }> {
  return cached("skill-context", 5 * 60_000, async () => {
    const index = await loadIndexBars();
    const series = await Promise.all(BREADTH.map((ticker) => loadDaily(ticker).catch(() => [] as Bar[])));
    return { index, market: scoreMarket(index, memberBreadth(series)) };
  });
}

export const assessTicker = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = rec(input);
    const nav = num(raw?.nav);
    const margin = num(raw?.margin);
    return {
      ticker: cleanTicker(typeof raw?.ticker === "string" ? raw.ticker : ""),
      nav,
      margin: margin ?? 0,
    };
  })
  .handler(async ({ data }): Promise<Assessment> => {
    if (data.ticker.length < 2) {
      return { ticker: data.ticker, stance: "bỏ", price: null, entry: null, stop: null, target: null, riskPct: null, thesis: "Nhập mã để trợ lý đánh giá." };
    }
    try {
      const [bars, profile, context] = await Promise.all([
        loadDaily(data.ticker),
        loadProfile(data.ticker).catch(() => null),
        skillContext(),
      ]);
      const basket = basketFor(profile?.sector ?? "", profile?.industry ?? "");
      let sector: LayerScore = { score: 0, gate: "chặn", factor: 0, lines: ["Chưa gắn được rổ ngành."] };
      if (basket) {
        const series = await Promise.all(basket.tickers.map((ticker) => loadDaily(ticker).catch(() => [] as Bar[])));
        sector = scoreSector(basket.name, equalWeight(series), context.index, memberBreadth(series));
      }
      const card = signal({ ticker: data.ticker, bars, market: context.market, sector, nav: data.nav, margin: data.margin });
      return {
        ticker: card.ticker,
        stance: card.stance,
        price: card.price,
        entry: card.entry,
        stop: card.stop,
        target: card.target,
        riskPct: card.riskPct,
        thesis: card.thesis,
      };
    } catch {
      return { ticker: data.ticker, stance: "bỏ", price: null, entry: null, stop: null, target: null, riskPct: null, thesis: `${data.ticker}: chưa đọc được giá để chấm điểm mua.` };
    }
  });

export const reviewExits = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = rec(input);
    const rows = Array.isArray(raw?.positions) ? raw.positions : [];
    const positions = rows.slice(0, 12).flatMap((item) => {
      const row = rec(item);
      const ticker = cleanTicker(typeof row?.ticker === "string" ? row.ticker : "");
      const avg = num(row?.avg);
      const price = num(row?.price);
      if (!ticker || !avg || !price) return [];
      return [{ ticker, avg, price, stop: num(row?.stop), openedAt: num(row?.openedAt) }];
    });
    return { positions, margin: num(raw?.margin) ?? 0 };
  })
  .handler(async ({ data }) => {
    const context = await skillContext().catch(() => null);
    const market: LayerScore = context?.market ?? { score: 0, gate: "chặn", factor: 0, lines: ["Chưa chấm được thị trường."] };
    const exits: ExitCard[] = [];
    for (const position of data.positions) {
      try {
        const bars = await loadDaily(position.ticker);
        const profile = await loadProfile(position.ticker).catch(() => null);
        const basket = basketFor(profile?.sector ?? "", profile?.industry ?? "");
        let sector: LayerScore = { score: 0, gate: "chặn", factor: 0, lines: ["Chưa gắn được rổ ngành."] };
        if (basket && context) {
          const series = await Promise.all(basket.tickers.map((ticker) => loadDaily(ticker).catch(() => [] as Bar[])));
          sector = scoreSector(basket.name, equalWeight(series), context.index, memberBreadth(series));
        }
        const held = position.openedAt ? bars.filter((bar) => bar.t >= position.openedAt!).length : null;
        exits.push(exitPlan({
          ticker: position.ticker,
          avg: position.avg,
          price: position.price,
          stop: position.stop,
          bars,
          heldSessions: held,
          usingMargin: data.margin > 0,
          market,
          sector,
        }));
      } catch {
        exits.push({ ticker: position.ticker, action: "giữ", reason: "Chưa đọc được giá để xét điểm bán." });
      }
    }
    return { market: market.lines[0] ?? "", exits };
  });

async function vnindexAboveMa20(): Promise<boolean | null> {
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 120 * 86400;
    const raw = (await fetchJson(`${ENTRADE}/v2/ohlcs/index?symbol=VNINDEX&resolution=1D&from=${from}&to=${to}`)) as RawBars;
    const closes = (raw.c ?? []).filter((close): close is number => typeof close === "number" && close > 0);
    const ma = sma(closes, 20);
    const price = closes.at(-1);
    if (!ma || price == null) return null;
    return price >= ma;
  } catch {
    return null;
  }
}

export const getBrief = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = rec(input);
    return { ticker: cleanTicker(typeof raw?.ticker === "string" ? raw.ticker : "") };
  })
  .handler(async ({ data }) => {
    if (data.ticker.length < 2) return { idea: null, news: [] as NewsItem[], quarters: [] as Quarter[], filings: [] as Filing[] };
    const [idea, news, pack] = await Promise.all([
      loadIdea(data.ticker).catch(() => null),
      loadNews(data.ticker).catch(() => [] as NewsItem[]),
      loadPack(data.ticker),
    ]);
    return { idea, news: news.slice(0, 4), quarters: pack.quarters, filings: pack.filings };
  });
