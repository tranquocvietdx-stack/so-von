import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_WATCH = [
  "VNM",
  "FPT",
  "VCB",
  "HPG",
  "MWG",
  "VIC",
  "TCB",
  "GAS",
  "MSN",
  "SSI",
  "VHM",
  "MBB",
];

export const WATCH_CAP = 16;

export type Lot = {
  ticker: string;
  shares: number;
  avg: number;
  /** Stop-loss price. Empty when unset. */
  stop?: number | null;
  /** Take-profit price. Empty when unset. */
  target?: number | null;
};

export type Side = "buy" | "sell";

export type Txn = {
  id: string;
  ticker: string;
  side: Side;
  shares: number;
  price: number;
  at: number;
};

export type Portfolio = {
  id: string;
  name: string;
  note: string;
  lots: Lot[];
  cash: number | null;
  margin: number;
  txns: Txn[];
  realized: number;
};

type Book = {
  watch: string[];
  lots: Lot[];
  recent: string[];
  /** null means cash is not tracked yet. */
  cash: number | null;
  /** Outstanding margin loan. Portfolio may exceed own capital by this amount. */
  margin: number;
  txns: Txn[];
  realized: number;
  portfolios: Portfolio[];
  activeId: string;
  ready: boolean;
  setReady: (ready: boolean) => void;
  switchPortfolio: (id: string) => void;
  toggleWatch: (ticker: string) => "added" | "removed" | "full";
  addLot: (ticker: string, shares: number, avg: number) => void;
  buy: (ticker: string, shares: number, price: number, marks?: { stop?: number | null; target?: number | null }) => "ok" | "cash";
  sell: (ticker: string, shares: number, price: number) => "ok" | "over";
  setLevels: (ticker: string, stop: number | null, target: number | null) => void;
  setCash: (amount: number) => void;
  setMargin: (amount: number) => void;
  removeLot: (ticker: string) => void;
  remember: (ticker: string) => void;
};

const OPENED = Date.UTC(2026, 9, 20, 6, 34);

function lot(ticker: string, shares: number, avg: number): Lot {
  return { ticker, shares, avg, stop: null, target: null };
}

function opening(lots: Lot[]): Txn[] {
  return lots.map((item) => ({
    id: `open-${item.ticker}-${item.shares}`,
    ticker: item.ticker,
    side: "buy" as const,
    shares: item.shares,
    price: item.avg,
    at: OPENED,
  }));
}

export const IMPORTED_PORTFOLIOS: Portfolio[] = [
  {
    id: "co-so",
    name: "Cơ sở 0304",
    note: "Nhập từ ảnh 20/10. Tiền gồm số dư 475 và tiền bán chờ ứng 42.727.500. Nợ gồm gốc 250.471.989, lãi phí 2.144.826 và phí lưu ký 2.319. Quyền cổ phiếu thưởng 4.200.000 nằm trong tổng chứng khoán bên công ty, chưa tách được thành mã.",
    cash: 42_727_975,
    margin: 252_616_815,
    realized: 0,
    lots: [
      lot("FPT", 4000, 65396),
      lot("VPL", 2800, 81243),
      lot("BCM", 2000, 40521),
      lot("KDH", 300, 14224),
      lot("SHB", 200, 12891),
      lot("HPG", 200, 24063),
      lot("HAH", 1, 65806),
      lot("GEE", 1, 67580),
      lot("GVR", 1, 28972),
      lot("GEX", 1, 31103),
    ],
    txns: [],
  },
  {
    id: "tk3",
    name: "Tài khoản 3",
    note: "Nhập từ ảnh 20/10. LPB 2.000 cp đang chờ về, T1 1.000 và T2 1.000. Nợ gốc 58.133.548 cộng lãi phí 552.194. Ảnh không có số dư tiền mặt.",
    cash: null,
    margin: 58_685_742,
    realized: 0,
    lots: [lot("VHM", 2000, 59040), lot("LPB", 2000, 38107), lot("HHS", 7000, 8830)],
    txns: [],
  },
];

for (const portfolio of IMPORTED_PORTFOLIOS) portfolio.txns = opening(portfolio.lots);

const first = IMPORTED_PORTFOLIOS[0]!;

export const useBook = create<Book>()(
  persist(
    (set, get) => {
      const save = (partial: Partial<Pick<Book, "lots" | "cash" | "margin" | "txns" | "realized">>) => {
        const activeId = get().activeId;
        set({
          ...partial,
          portfolios: get().portfolios.map((portfolio) => (portfolio.id === activeId ? { ...portfolio, ...partial } : portfolio)),
        });
      };
      return {
      watch: DEFAULT_WATCH,
      lots: first.lots,
      recent: [],
      cash: first.cash,
      margin: first.margin,
      txns: first.txns,
      realized: 0,
      portfolios: IMPORTED_PORTFOLIOS,
      activeId: first.id,
      ready: false,
      setReady: (ready) => set({ ready }),
      switchPortfolio: (id) => {
        const current = get();
        const portfolios = current.portfolios.map((portfolio) =>
          portfolio.id === current.activeId
            ? { ...portfolio, lots: current.lots, cash: current.cash, margin: current.margin, txns: current.txns, realized: current.realized }
            : portfolio,
        );
        const next = portfolios.find((portfolio) => portfolio.id === id);
        if (!next) return;
        set({
          portfolios,
          activeId: id,
          lots: next.lots,
          cash: next.cash,
          margin: next.margin,
          txns: next.txns,
          realized: next.realized,
        });
      },
      toggleWatch: (ticker) => {
        const watch = get().watch;
        if (watch.includes(ticker)) {
          set({ watch: watch.filter((item) => item !== ticker) });
          return "removed";
        }
        if (watch.length >= WATCH_CAP) return "full";
        set({ watch: [ticker, ...watch] });
        return "added";
      },
      addLot: (ticker, shares, avg) => {
        save({ lots: mergeBuy(get().lots, ticker, shares, avg) });
      },
      buy: (ticker, shares, price, marks) => {
        const spend = shares * price;
        const cash = get().cash;
        let margin = get().margin;
        let nextCash = cash;
        if (cash != null) {
          const covered = Math.min(cash, spend);
          nextCash = cash - covered;
          const borrowed = spend - covered;
          if (borrowed > 1) margin += borrowed;
        }
        let lots = mergeBuy(get().lots, ticker, shares, price);
        if (marks) lots = applyLevels(lots, ticker, marks.stop, marks.target);
        save({
          lots,
          cash: nextCash,
          margin,
          txns: [makeTxn(ticker, "buy", shares, price), ...get().txns].slice(0, 80),
        });
        return "ok";
      },
      sell: (ticker, shares, price) => {
        const current = get().lots.find((item) => item.ticker === ticker);
        if (!current || shares > current.shares + 1e-6) return "over";
        const nextShares = current.shares - shares;
        const lots =
          nextShares <= 1e-6
            ? get().lots.filter((item) => item.ticker !== ticker)
            : get().lots.map((item) => (item.ticker === ticker ? { ...item, shares: nextShares } : item));
        let proceeds = shares * price;
        let margin = get().margin;
        const repay = Math.min(margin, proceeds);
        margin -= repay;
        proceeds -= repay;
        const cash = get().cash;
        save({
          lots,
          margin,
          cash: cash == null ? null : cash + proceeds,
          realized: get().realized + (price - current.avg) * shares,
          txns: [makeTxn(ticker, "sell", shares, price), ...get().txns].slice(0, 80),
        });
        return "ok";
      },
      setCash: (amount) => save({ cash: amount }),
      setMargin: (amount) => save({ margin: Math.max(0, amount) }),
      setLevels: (ticker, stop, target) => save({ lots: applyLevels(get().lots, ticker, stop, target) }),
      removeLot: (ticker) => save({ lots: get().lots.filter((item) => item.ticker !== ticker) }),
      remember: (ticker) => {
        const recent = [ticker, ...get().recent.filter((item) => item !== ticker)].slice(0, 6);
        set({ recent });
      },
    };
    },
    {
      name: "so-von",
      skipHydration: true,
      partialize: (state) => ({
        watch: state.watch,
        lots: state.lots,
        recent: state.recent,
        cash: state.cash,
        margin: state.margin,
        txns: state.txns,
        realized: state.realized,
        portfolios: state.portfolios,
        activeId: state.activeId,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<Book> | undefined;
        const savedPortfolios = Array.isArray(saved?.portfolios) ? saved.portfolios : [];
        const portfolios = IMPORTED_PORTFOLIOS.map((item) => savedPortfolios.find((portfolio) => portfolio.id === item.id) ?? item);
        for (const portfolio of savedPortfolios) {
          if (!portfolios.some((item) => item.id === portfolio.id)) portfolios.push(portfolio);
        }
        const hasLegacy = (saved?.lots?.length ?? 0) > 0 && savedPortfolios.length === 0;
        if (hasLegacy) {
          portfolios.unshift({
            id: "legacy",
            name: "Sổ cũ",
            note: "Danh mục có sẵn trên máy trước khi nhập hai tài khoản.",
            lots: saved?.lots ?? [],
            cash: saved?.cash ?? null,
            margin: saved?.margin ?? 0,
            txns: saved?.txns ?? [],
            realized: saved?.realized ?? 0,
          });
        }
        const requested = hasLegacy ? "legacy" : saved?.activeId;
        const active = portfolios.find((portfolio) => portfolio.id === requested) ?? portfolios[0] ?? current.portfolios[0]!;
        return {
          ...current,
          ...saved,
          portfolios,
          activeId: active.id,
          lots: active.lots,
          cash: active.cash,
          margin: active.margin,
          txns: active.txns,
          realized: active.realized,
          ready: false,
        };
      },
    },
  ),
);

function mergeBuy(lots: Lot[], ticker: string, shares: number, price: number): Lot[] {
  const current = lots.find((lot) => lot.ticker === ticker);
  if (!current) return [{ ticker, shares, avg: price, stop: null, target: null }, ...lots];
  const nextShares = current.shares + shares;
  const nextAvg = (current.shares * current.avg + shares * price) / nextShares;
  return lots.map((lot) => (lot.ticker === ticker ? { ...lot, shares: nextShares, avg: nextAvg } : lot));
}

function applyLevels(lots: Lot[], ticker: string, stop: number | null | undefined, target: number | null | undefined): Lot[] {
  return lots.map((lot) => {
    if (lot.ticker !== ticker) return lot;
    return {
      ...lot,
      stop: stop === undefined ? lot.stop : stop,
      target: target === undefined ? lot.target : target,
    };
  });
}

function makeTxn(ticker: string, side: Side, shares: number, price: number): Txn {
  return {
    id: crypto.randomUUID(),
    ticker,
    side,
    shares,
    price,
    at: Date.now(),
  };
}
