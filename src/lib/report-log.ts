import { create } from "zustand";
import { persist } from "zustand/middleware";
import { debtBlocks, portfolioNav, SKILL_NOTE } from "@/lib/signal";
import { indexLine, portfolioLine, type AideBook } from "@/lib/aide";
import type { Lot } from "@/lib/book";
import { fmtPct, fmtPrice } from "@/lib/format";
import type { IndexCard, PulseRow, Quote } from "@/lib/market";

export type NoteKind = "daily" | "anomaly" | "scenario" | "note";

export type ReportNote = {
  id: string;
  key: string;
  at: number;
  kind: NoteKind;
  title: string;
  body: string;
};

export type Skill = {
  note: string;
  coverIndex: boolean;
  coverBook: boolean;
  coverPulse: boolean;
  coverNews: boolean;
  stockPct: number;
  indexPct: number;
  anomalyLevels: boolean;
  anomalyRsi: boolean;
  slots: string[];
};

export type WhenKind = "stop" | "target" | "dayDown" | "dayUp" | "rsiLow" | "rsiHigh" | "belowMa" | "aboveMa" | "pullback" | "trendBreak";

export type Scenario = {
  id: string;
  name: string;
  side: "buy" | "sell";
  ticker: string;
  when: WhenKind;
  threshold: number;
};

export const DEFAULT_SKILL: Skill = {
  note: SKILL_NOTE,
  coverIndex: true,
  coverBook: true,
  coverPulse: true,
  coverNews: true,
  stockPct: 4,
  indexPct: 1.5,
  anomalyLevels: true,
  anomalyRsi: true,
  slots: ["09:05", "14:45"],
};

export const DEFAULT_SCENARIOS: Scenario[] = [
  { id: "cut", name: "Cắt lỗ", side: "sell", ticker: "", when: "stop", threshold: 0 },
  { id: "take", name: "Chốt lời", side: "sell", ticker: "", when: "target", threshold: 0 },
  { id: "dip", name: "Mua hồi MA20", side: "buy", ticker: "", when: "pullback", threshold: 0 },
  { id: "break", name: "Gãy MA50", side: "sell", ticker: "", when: "trendBreak", threshold: 0 },
];

type ReportState = {
  skill: Skill;
  scenarios: Scenario[];
  notes: ReportNote[];
  telegramToken: string;
  telegramChat: string;
  setSkill: (skill: Skill) => void;
  addScenario: (scenario: Scenario) => void;
  removeScenario: (id: string) => void;
  setTelegram: (token: string, chat: string) => void;
  add: (notes: ReportNote[]) => void;
};

export const useReportLog = create<ReportState>()(
  persist(
    (set) => ({
      skill: DEFAULT_SKILL,
      scenarios: DEFAULT_SCENARIOS,
      notes: [],
      telegramToken: "",
      telegramChat: "",
      setSkill: (skill) => set({ skill }),
      addScenario: (scenario) => set((state) => ({ scenarios: [...state.scenarios, scenario].slice(0, 12) })),
      removeScenario: (id) => set((state) => ({ scenarios: state.scenarios.filter((item) => item.id !== id) })),
      setTelegram: (token, chat) => set({ telegramToken: token.trim(), telegramChat: chat.trim() }),
      add: (incoming) =>
        set((state) => {
          const keys = new Set(state.notes.map((note) => note.key));
          const fresh = incoming.filter((note) => note.key && !keys.has(note.key));
          if (!fresh.length) return state;
          return { notes: [...fresh, ...state.notes].slice(0, 40) };
        }),
    }),
    {
      name: "so-von-report",
      skipHydration: true,
      partialize: (state) => ({
        skill: state.skill,
        scenarios: state.scenarios,
        notes: state.notes,
        telegramToken: state.telegramToken,
        telegramChat: state.telegramChat,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<ReportState> | undefined;
        const savedSkill = saved?.skill;
        const legacySlots = savedSkill?.slots?.join(",") === "09:15,11:30,14:45";
        const legacyNote =
          savedSkill?.note?.startsWith("Báo chỉ số") ||
          savedSkill?.note?.startsWith("Đầu phiên và cuối phiên") ||
          savedSkill?.note?.startsWith("Skill điểm mua bán.");
        const legacyScenarios =
          saved?.scenarios?.length === 3 && saved.scenarios.every((item) => item.id === "cut" || item.id === "take" || item.id === "dip") && saved.scenarios.some((item) => item.when === "dayDown");
        return {
          ...current,
          skill: {
            ...DEFAULT_SKILL,
            ...savedSkill,
            slots: !savedSkill?.slots || legacySlots ? DEFAULT_SKILL.slots : savedSkill.slots,
            note: !savedSkill?.note || legacyNote ? DEFAULT_SKILL.note : savedSkill.note,
          },
          scenarios: !saved?.scenarios?.length || legacyScenarios ? current.scenarios : saved.scenarios,
          notes: saved?.notes ?? [],
          telegramToken: saved?.telegramToken ?? "",
          telegramChat: saved?.telegramChat ?? "",
        };
      },
    },
  ),
);

export function saigon(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: Number(read("hour")) * 60 + Number(read("minute")),
    weekend: read("weekday") === "Sat" || read("weekday") === "Sun",
  };
}

export function slotMinutes(slot: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(slot);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export type PlanInput = {
  now: number;
  mode: "clock" | "manual";
  session: string;
  skill: Skill;
  scenarios: Scenario[];
  indices: IndexCard[];
  quotes: Map<string, Quote>;
  lots: Lot[];
  watch: string[];
  cash: number | null;
  margin: number;
  realized: number;
  pulses: PulseRow[];
  headlines: string[];
  keys: Set<string>;
};

export function planNotes(input: PlanInput): ReportNote[] {
  const clock = saigon(new Date(input.now));
  const notes: ReportNote[] = [];
  const seen = new Set(input.keys);
  const take = (note: ReportNote) => {
    if (seen.has(note.key)) return;
    seen.add(note.key);
    notes.push(note);
  };

  if (input.mode === "manual") {
    take(dailyNote(input, `manual:${input.now}`, "Trợ lý vừa cập nhật"));
  } else if (!clock.weekend) {
    for (const slot of input.skill.slots) {
      const minutes = slotMinutes(slot);
      if (minutes == null || clock.minutes < minutes) continue;
      take(dailyNote(input, `daily:${clock.date}:${slot}`, dutyLabel(slot)));
    }
  }

  for (const note of anomalyNotes(input, clock.date)) take(note);
  for (const note of scenarioNotes(input, clock.date)) take(note);
  return notes;
}

function dailyNote(input: PlanInput, key: string, title: string): ReportNote {
  const book: AideBook = { lots: input.lots, cash: input.cash, margin: input.margin, realized: input.realized, watch: input.watch };
  const proposals = scenarioNotes(input, "now");
  const lines = [
    input.session,
    `Việc trợ lý làm trong báo cáo này: ${input.skill.note}`,
  ];
  if (input.skill.coverIndex) lines.push(`Chỉ số. ${indexLine(input.indices)}`);
  const nav = portfolioNav(input.lots, (ticker) => input.quotes.get(ticker)?.price ?? null, input.cash, input.margin);
  const blocked = debtBlocks(input.margin, nav);
  if (blocked) lines.push("Cổng nợ đang chặn mọi mua mới vì nợ vượt 10% vốn ròng.");
  if (input.skill.coverBook) {
    lines.push(`Quản lý danh mục. ${portfolioLine(book, input.quotes)}`);
    lines.push(holdingPlan(input, proposals));
  }
  lines.push(`Mã tiềm năng. ${potentialLine([...input.quotes.values()], input.pulses)}`);
  if (input.skill.coverNews && input.headlines.length) lines.push(input.headlines.map((item) => `Tin: ${item}`).join("\n"));
  lines.push(
    proposals.length
      ? `Đề xuất mua bán theo kịch bản. ${proposals.map((note) => note.title).join("; ")}.`
      : "Đề xuất mua bán theo kịch bản. Chưa khớp kịch bản nào.",
  );
  lines.push("Trợ lý chỉ ghi đề xuất vào báo cáo, không gửi lệnh lên sàn.");
  return { id: key, key, at: input.now, kind: "daily", title, body: lines.join("\n") };
}

export function dutyLabel(slot: string): string {
  if (slot === "09:05" || slot === "09:15") return "Đầu phiên";
  if (slot === "13:00" || slot === "13:05") return "Đầu phiên chiều";
  if (slot === "11:30") return "Cuối phiên sáng";
  return slot === "14:45" || slot === "15:00" ? "Cuối phiên" : `Mốc ${slot}`;
}

export function potentialLine(quotes: Quote[], pulses: PulseRow[]): string {
  const pulseByTicker = new Map(pulses.map((row) => [row.ticker, row]));
  const picked = quotes.flatMap((quote) => {
    const pulse = pulseByTicker.get(quote.ticker);
    if (pulse?.rsi == null || pulse.ma20gap == null) return [];
    const trend = pulse.ma50gap == null || pulse.ma50gap >= 0;
    const pullback = pulse.ma20gap >= -3 && pulse.ma20gap <= 2 && pulse.rsi >= 45 && pulse.rsi < 70;
    if (trend && pullback) return [`${quote.ticker} ${fmtPct(quote.pct)} — hồi MA20, RSI ${Math.round(pulse.rsi)}, đúng vùng mua của skill`];
    return [];
  });
  if (picked.length) return picked.slice(0, 4).join("\n");
  const strong = [...quotes].sort((a, b) => b.pct - a.pct).slice(0, 3);
  if (!strong.length) return "Chưa đủ giá để tìm mã tiềm năng trong danh sách đang xem.";
  return `Chưa mã nào đúng vùng mua của skill. Đang mạnh hơn: ${strong.map((quote) => `${quote.ticker} ${fmtPct(quote.pct)}`).join(", ")}.`;
}

function holdingPlan(input: PlanInput, proposals: ReportNote[]): string {
  if (!input.lots.length) return "Danh mục đang nắm trống, chưa có mã để giữ hay bán.";
  return input.lots
    .map((lot) => {
      const sell = proposals.find((note) => note.title.includes(`Bán ${lot.ticker}`));
      return sell ? `${lot.ticker}: đề xuất bán` : `${lot.ticker}: giữ`;
    })
    .join(". ") + ".";
}

function anomalyNotes(input: PlanInput, date: string): ReportNote[] {
  const notes: ReportNote[] = [];
  if (input.skill.anomalyLevels) {
    for (const lot of input.lots) {
      const price = input.quotes.get(lot.ticker)?.price;
      if (!price) continue;
      if (lot.stop != null && lot.stop > 0 && price <= lot.stop) {
        notes.push(fact(input.now, `anomaly:${lot.ticker}:stop:${date}`, `Biến động trong phiên · ${lot.ticker} chạm cắt lỗ`, `${lot.ticker} giá ${fmtPrice(price)} đã xuống mốc cắt lỗ ${fmtPrice(lot.stop)}.`));
      }
      if (lot.target != null && lot.target > 0 && price >= lot.target) {
        notes.push(fact(input.now, `anomaly:${lot.ticker}:target:${date}`, `Biến động trong phiên · ${lot.ticker} chạm chốt lời`, `${lot.ticker} giá ${fmtPrice(price)} đã tới mốc chốt lời ${fmtPrice(lot.target)}.`));
      }
    }
  }
  for (const quote of input.quotes.values()) {
    if (Math.abs(quote.pct) < input.skill.stockPct) continue;
    notes.push(
      fact(
        input.now,
        `anomaly:${quote.ticker}:pct:${date}`,
        `Biến động trong phiên · ${quote.ticker} ${fmtPct(quote.pct)}`,
        `${quote.ticker} ${fmtPct(quote.pct)} trong phiên, vượt ngưỡng ${fmtPct(input.skill.stockPct).replace("+", "")}.`,
      ),
    );
  }
  for (const index of input.indices) {
    if (Math.abs(index.pct) < input.skill.indexPct) continue;
    notes.push(
      fact(
        input.now,
        `anomaly:${index.id}:pct:${date}`,
        `Biến động trong phiên · ${index.label} ${fmtPct(index.pct)}`,
        `${index.label} ${fmtPct(index.pct)}, vượt ngưỡng ${input.skill.indexPct}%.`,
      ),
    );
  }
  if (input.skill.anomalyRsi) {
    for (const row of input.pulses) {
      if (row.rsi == null) continue;
      if (row.rsi >= 70) notes.push(fact(input.now, `anomaly:${row.ticker}:rsi:${date}`, `Biến động trong phiên · ${row.ticker} RSI cao`, `${row.ticker} RSI ${Math.round(row.rsi)}, vùng căng.`));
      if (row.rsi <= 30) notes.push(fact(input.now, `anomaly:${row.ticker}:rsi:${date}`, `Biến động trong phiên · ${row.ticker} RSI thấp`, `${row.ticker} RSI ${Math.round(row.rsi)}, vùng yếu.`));
    }
  }
  return notes;
}

function scenarioNotes(input: PlanInput, date: string): ReportNote[] {
  const notes: ReportNote[] = [];
  const nav = portfolioNav(input.lots, (ticker) => input.quotes.get(ticker)?.price ?? null, input.cash, input.margin);
  const blocked = debtBlocks(input.margin, nav);
  for (const scenario of input.scenarios) {
    if (blocked && scenario.side === "buy") continue;
    for (const ticker of scope(scenario, input)) {
      const reason = matches(scenario, ticker, input);
      if (!reason) continue;
      const side = scenario.side === "buy" ? "Mua" : "Bán";
      notes.push({
        id: `scenario:${scenario.id}:${ticker}:${date}`,
        key: `scenario:${scenario.id}:${ticker}:${date}`,
        at: input.now,
        kind: "scenario",
        title: `Đề xuất ${side} ${ticker}`,
        body: `Đề xuất theo kịch bản "${scenario.name}": ${side} ${ticker}. ${reason} Dùng để quản lý danh mục, không gửi lệnh lên sàn.`,
      });
    }
  }
  return notes;
}

export function splitSignals(input: Pick<PlanInput, "scenarios" | "quotes" | "lots" | "watch" | "pulses">): {
  buy: ReportNote[];
  sell: ReportNote[];
} {
  const notes = scenarioNotes({ ...input, now: Date.now() } as PlanInput, "live");
  return {
    buy: notes.filter((note) => note.title.includes("Mua")),
    sell: notes.filter((note) => note.title.includes("Bán")),
  };
}

function scope(scenario: Scenario, input: PlanInput): string[] {
  if (scenario.ticker) return [scenario.ticker];
  if (scenario.side === "sell") return input.lots.map((lot) => lot.ticker);
  const held = new Set(input.lots.map((lot) => lot.ticker));
  return input.watch.filter((ticker) => !held.has(ticker)).slice(0, 12);
}

function matches(scenario: Scenario, ticker: string, input: PlanInput): string | null {
  const quote = input.quotes.get(ticker);
  const lot = input.lots.find((item) => item.ticker === ticker);
  const pulse = input.pulses.find((item) => item.ticker === ticker);
  const price = quote?.price;
  if (scenario.when === "stop") {
    if (price == null || lot?.stop == null || !(lot.stop > 0) || price > lot.stop) return null;
    return `Giá ${fmtPrice(price)} chạm cắt lỗ ${fmtPrice(lot.stop)}.`;
  }
  if (scenario.when === "target") {
    if (price == null || lot?.target == null || !(lot.target > 0) || price < lot.target) return null;
    return `Giá ${fmtPrice(price)} chạm chốt lời ${fmtPrice(lot.target)}.`;
  }
  if (scenario.when === "dayDown") {
    if (!quote || quote.pct > -Math.abs(scenario.threshold || 4)) return null;
    return `Giá phiên ${fmtPct(quote.pct)}, giảm từ ${Math.abs(scenario.threshold || 4)}%.`;
  }
  if (scenario.when === "dayUp") {
    if (!quote || quote.pct < Math.abs(scenario.threshold || 4)) return null;
    return `Giá phiên ${fmtPct(quote.pct)}, tăng từ ${Math.abs(scenario.threshold || 4)}%.`;
  }
  if (scenario.when === "rsiLow") {
    const line = scenario.threshold || 30;
    if (pulse?.rsi == null || pulse.rsi > line) return null;
    return `RSI ${Math.round(pulse.rsi)} không cao hơn ${line}.`;
  }
  if (scenario.when === "rsiHigh") {
    const line = scenario.threshold || 70;
    if (pulse?.rsi == null || pulse.rsi < line) return null;
    return `RSI ${Math.round(pulse.rsi)} không thấp hơn ${line}.`;
  }
  if (scenario.when === "belowMa") {
    if (pulse?.ma20gap == null || pulse.ma20gap > -Math.abs(scenario.threshold || 0)) return null;
    return `Giá dưới MA20 ${fmtPct(pulse.ma20gap)}.`;
  }
  if (scenario.when === "aboveMa") {
    if (pulse?.ma20gap == null || pulse.ma20gap < Math.abs(scenario.threshold || 0)) return null;
    return `Giá trên MA20 ${fmtPct(pulse.ma20gap)}.`;
  }
  if (scenario.when === "pullback") {
    if (pulse?.rsi == null || pulse.ma20gap == null) return null;
    const trend = pulse.ma50gap == null || pulse.ma50gap >= 0;
    if (!trend || pulse.ma20gap < -3 || pulse.ma20gap > 2 || pulse.rsi < 45 || pulse.rsi >= 70) return null;
    return `Hồi về MA20 ${fmtPct(pulse.ma20gap)}, RSI ${Math.round(pulse.rsi)}, giá còn trên MA50.`;
  }
  if (scenario.when === "trendBreak") {
    if (pulse?.ma50gap == null || pulse.ma50gap >= 0) return null;
    return `Giá dưới MA50 ${fmtPct(pulse.ma50gap)}. Xu hướng tăng đã gãy.`;
  }
  return null;
}

function fact(at: number, key: string, title: string, body: string): ReportNote {
  return { id: key, key, at, kind: "anomaly", title, body };
}
