import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Lot } from "@/lib/book";
import { fmtWhen } from "@/lib/format";
import { getNews, getPulse, type IndexCard, type Quote } from "@/lib/market";
import { findTelegramChat, sendTelegram } from "@/lib/telegram";
import {
  planNotes,
  saigon,
  slotMinutes,
  useReportLog,
  type NoteKind,
  type Scenario,
  type Skill,
  type WhenKind,
} from "@/lib/report-log";

export type AideReportInput = {
  enabled: boolean;
  session: string;
  indices: IndexCard[];
  quotes: Map<string, Quote>;
  lots: Lot[];
  watch: string[];
  cash: number | null;
  margin: number;
  realized: number;
};

export function useAideReporter(input: AideReportInput) {
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (!input.enabled) return;
    let stop = false;
    const tick = () => {
      if (!stop) void fileAideReports(latest.current, "clock");
    };
    const first = window.setTimeout(tick, 1200);
    const id = window.setInterval(tick, 60_000);
    return () => {
      stop = true;
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [input.enabled]);
}

export async function fileAideReports(input: AideReportInput, mode: "clock" | "manual") {
  const state = useReportLog.getState();
  const clock = saigon();
  const keys = new Set(state.notes.map((note) => note.key));
  const due =
    mode === "manual" ||
    (!clock.weekend &&
      state.skill.slots.some((slot) => {
        const minutes = slotMinutes(slot);
        return minutes != null && clock.minutes >= minutes && !keys.has(`daily:${clock.date}:${slot}`);
      }));
  const needsPulse =
    due && state.skill.coverPulse ||
    state.skill.anomalyRsi ||
    state.scenarios.some((item) => item.when === "rsiLow" || item.when === "rsiHigh" || item.when === "belowMa" || item.when === "aboveMa" || item.when === "pullback" || item.when === "trendBreak");
  const tickers = [...new Set([...input.lots.map((lot) => lot.ticker), ...input.watch])].slice(0, 16);
  let pulses: Awaited<ReturnType<typeof getPulse>>["rows"] = [];
  if (needsPulse && tickers.length) {
    pulses = (await getPulse({ data: { tickers: tickers.join(",") } }).catch(() => ({ rows: [] }))).rows;
  }
  let headlines: string[] = [];
  if (due && state.skill.coverNews) {
    headlines = (await getNews({ data: { ticker: "" } }).catch(() => ({ items: [] }))).items.slice(0, 3).map((item) => item.title);
  }
  const notes = planNotes({
    now: Date.now(),
    mode,
    session: input.session,
    skill: state.skill,
    scenarios: state.scenarios,
    indices: input.indices,
    quotes: input.quotes,
    lots: input.lots,
    watch: input.watch,
    cash: input.cash,
    margin: input.margin,
    realized: input.realized,
    pulses,
    headlines,
    keys,
  });
  useReportLog.getState().add(notes);
  const saved = useReportLog.getState();
  if (notes.length && saved.telegramToken && saved.telegramChat) {
    const text = notes.map((note) => `${note.title}\n${note.body}`).join("\n\n");
    await sendTelegram({ data: { token: saved.telegramToken, chat: saved.telegramChat, text } }).catch(() => null);
  }
  return notes;
}

const KIND: Record<NoteKind, string> = {
  daily: "Phiên",
  anomaly: "Trong phiên",
  scenario: "Đề xuất",
  note: "Ghi chú",
};

const SLOTS = [
  ["09:05", "Đầu phiên"],
  ["14:45", "Cuối phiên"],
] as const;

const WHENS: { id: WhenKind; label: string }[] = [
  { id: "stop", label: "Chạm cắt lỗ" },
  { id: "target", label: "Chạm chốt lời" },
  { id: "dayDown", label: "Giảm trong phiên" },
  { id: "dayUp", label: "Tăng trong phiên" },
  { id: "rsiLow", label: "RSI thấp" },
  { id: "rsiHigh", label: "RSI cao" },
  { id: "belowMa", label: "Dưới MA20" },
  { id: "aboveMa", label: "Trên MA20" },
  { id: "pullback", label: "Hồi MA20, còn trên MA50" },
  { id: "trendBreak", label: "Gãy MA50" },
];

export function AideReport({ input }: { input: AideReportInput }) {
  const notes = useReportLog((state) => state.notes);
  const skill = useReportLog((state) => state.skill);
  const scenarios = useReportLog((state) => state.scenarios);
  const setSkill = useReportLog((state) => state.setSkill);
  const addScenario = useReportLog((state) => state.addScenario);
  const removeScenario = useReportLog((state) => state.removeScenario);
  const [draft, setDraft] = useState<Skill>(skill);
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState<Scenario>({
    id: "",
    name: "",
    side: "sell",
    ticker: "",
    when: "dayDown",
    threshold: 4,
  });

  useEffect(() => {
    setDraft(skill);
  }, [skill]);

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">Trợ lý ghi vào báo cáo</h2>
        <p className="mt-2 text-sm text-muted">
          Trợ lý tự ghi vào đây đầu phiên, cuối phiên, và khi có biến động trong phiên. Mỗi báo cáo gồm danh mục đang nắm, mã tiềm năng, và đề xuất mua bán theo kịch bản.
        </p>
        <Button
          className="mt-3"
          disabled={busy || !input.enabled}
          onClick={() => {
            setBusy(true);
            void fileAideReports(input, "manual").finally(() => setBusy(false));
          }}
        >
          {busy ? "Đang ghi…" : "Nhờ trợ lý cập nhật"}
        </Button>
      </section>

      {notes.length === 0 ? (
        <p className="rounded-3xl border border-line bg-surface px-4 py-8 text-sm text-muted">
          Trợ lý chưa ghi mục nào. Đầu phiên là 09:05, cuối phiên là 14:45. Biến động trong phiên được ghi khi giá vượt ngưỡng.
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.key} className="rounded-2xl border border-line bg-surface px-4 py-3">
              <p className="text-xs text-subtle">
                {KIND[note.kind]} · {fmtWhen(note.at, true)}
              </p>
              <h3 className="mt-1 text-sm font-medium">{note.title}</h3>
              <p className="mt-2 text-sm whitespace-pre-wrap text-muted">{note.body}</p>
            </li>
          ))}
        </ul>
      )}

      <TelegramBox />

      <details className="rounded-3xl border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">Skill và kịch bản trợ lý đang dùng</summary>
        <label className="mt-3 block text-xs text-subtle">
          Skill
          <textarea
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            className="mt-1 min-h-24 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <Toggle on={draft.coverIndex} label="Chỉ số" onClick={() => setDraft({ ...draft, coverIndex: !draft.coverIndex })} />
          <Toggle on={draft.coverBook} label="Danh mục" onClick={() => setDraft({ ...draft, coverBook: !draft.coverBook })} />
          <Toggle on={draft.coverPulse} label="Nhịp" onClick={() => setDraft({ ...draft, coverPulse: !draft.coverPulse })} />
          <Toggle on={draft.coverNews} label="Tin" onClick={() => setDraft({ ...draft, coverNews: !draft.coverNews })} />
          <Toggle on={draft.anomalyLevels} label="Chạm mốc" onClick={() => setDraft({ ...draft, anomalyLevels: !draft.anomalyLevels })} />
          <Toggle on={draft.anomalyRsi} label="RSI" onClick={() => setDraft({ ...draft, anomalyRsi: !draft.anomalyRsi })} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-subtle">
            Ngưỡng mã (%)
            <Input className="mt-1" inputMode="decimal" value={String(draft.stockPct)} onChange={(event) => setDraft({ ...draft, stockPct: numberOr(event.target.value, draft.stockPct) })} />
          </label>
          <label className="text-xs text-subtle">
            Ngưỡng chỉ số (%)
            <Input className="mt-1" inputMode="decimal" value={String(draft.indexPct)} onChange={(event) => setDraft({ ...draft, indexPct: numberOr(event.target.value, draft.indexPct) })} />
          </label>
        </div>
        <p className="mt-3 text-xs text-subtle">Lịch báo cáo</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SLOTS.map(([slot, label]) => (
            <Toggle
              key={slot}
              on={draft.slots.includes(slot)}
              label={`${label} ${slot}`}
              onClick={() =>
                setDraft({
                  ...draft,
                  slots: draft.slots.includes(slot) ? draft.slots.filter((item) => item !== slot) : [...draft.slots, slot],
                })
              }
            />
          ))}
        </div>
        <Button className="mt-3" onClick={() => setSkill(draft)}>
          Lưu skill
        </Button>

        <h3 className="mt-5 text-sm font-medium">Kịch bản mua bán</h3>
        <ul className="mt-2 divide-y divide-line">
          {scenarios.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {item.side === "buy" ? "Mua" : "Bán"} {item.ticker || "các mã phù hợp"} · {WHENS.find((when) => when.id === item.when)?.label}
                {item.threshold ? ` ${item.threshold}` : ""}
              </span>
              <button type="button" className="text-sm text-muted" onClick={() => removeScenario(item.id)}>
                Xóa
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 grid grid-cols-2 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = scenario.name.trim();
            if (!name) return;
            addScenario({ ...scenario, id: crypto.randomUUID(), name, ticker: scenario.ticker.trim().toUpperCase() });
            setScenario({ id: "", name: "", side: "sell", ticker: "", when: "dayDown", threshold: 4 });
          }}
        >
          <Input aria-label="Tên kịch bản" placeholder="Tên kịch bản" value={scenario.name} onChange={(event) => setScenario({ ...scenario, name: event.target.value })} />
          <Input aria-label="Mã, để trống nếu áp mọi mã" placeholder="Mã hoặc để trống" value={scenario.ticker} onChange={(event) => setScenario({ ...scenario, ticker: event.target.value.toUpperCase() })} />
          <select className="h-11 rounded-lg border border-line bg-surface px-3 text-sm" value={scenario.side} onChange={(event) => setScenario({ ...scenario, side: event.target.value as Scenario["side"] })}>
            <option value="sell">Bán</option>
            <option value="buy">Mua</option>
          </select>
          <select className="h-11 rounded-lg border border-line bg-surface px-3 text-sm" value={scenario.when} onChange={(event) => setScenario({ ...scenario, when: event.target.value as WhenKind })}>
            {WHENS.map((when) => (
              <option key={when.id} value={when.id}>
                {when.label}
              </option>
            ))}
          </select>
          <Input aria-label="Ngưỡng" inputMode="decimal" value={String(scenario.threshold)} onChange={(event) => setScenario({ ...scenario, threshold: numberOr(event.target.value, scenario.threshold) })} />
          <Button type="submit">Thêm kịch bản</Button>
        </form>
      </details>
    </div>
  );
}

function TelegramBox() {
  const token = useReportLog((state) => state.telegramToken);
  const chat = useReportLog((state) => state.telegramChat);
  const setTelegram = useReportLog((state) => state.setTelegram);
  const [tokenDraft, setTokenDraft] = useState(token);
  const [chatDraft, setChatDraft] = useState(chat);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTokenDraft(token);
    setChatDraft(chat);
  }, [token, chat]);

  return (
    <section className="rounded-3xl border border-line bg-surface p-4">
      <h2 className="text-sm font-medium">Bắn tin Telegram</h2>
      <p className="mt-2 text-sm text-muted">
        Nhắn @BotFather, tạo bot, rồi mở bot đó và gửi /start. App gửi đầu phiên, cuối phiên, biến động và tín hiệu. Token chỉ lưu trên máy này.
      </p>
      <div className="mt-3 grid gap-2">
        <Input
          type="password"
          autoComplete="off"
          aria-label="Token bot Telegram"
          placeholder="Token bot"
          value={tokenDraft}
          onChange={(event) => setTokenDraft(event.target.value)}
        />
        <Input
          inputMode="numeric"
          aria-label="Chat id Telegram"
          placeholder="Chat id"
          value={chatDraft}
          onChange={(event) => setChatDraft(event.target.value)}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="quiet"
          disabled={busy || !tokenDraft.trim()}
          onClick={() => {
            setBusy(true);
            setNote("");
            void findTelegramChat({ data: { token: tokenDraft.trim(), chat: "", text: "" } })
              .then((result) => {
                if (!result.ok) {
                  setNote(result.error);
                  return;
                }
                setChatDraft(result.chat);
                setTelegram(tokenDraft, result.chat);
                setNote(`Đã lấy chat id ${result.chat}.`);
              })
              .catch((error: unknown) => setNote(error instanceof Error ? error.message : "Không lấy được chat id."))
              .finally(() => setBusy(false));
          }}
        >
          Lấy chat id
        </Button>
        <Button
          disabled={busy || !tokenDraft.trim() || !chatDraft.trim()}
          onClick={() => {
            setBusy(true);
            setNote("");
            const nextToken = tokenDraft.trim();
            const nextChat = chatDraft.trim();
            setTelegram(nextToken, nextChat);
            void sendTelegram({ data: { token: nextToken, chat: nextChat, text: "Sổ Vốn đã nối Telegram. Biến động và tín hiệu sẽ vào đây." } })
              .then((result) => setNote(result.ok ? "Đã gửi tin thử." : result.error))
              .catch((error: unknown) => setNote(error instanceof Error ? error.message : "Chưa gửi được."))
              .finally(() => setBusy(false));
          }}
        >
          Gửi thử
        </Button>
      </div>
      <p className="mt-2 text-xs text-subtle">{note || (token && chat ? "Đang bắn tin khi trợ lý ghi báo cáo." : "Chưa nối.")}</p>
    </section>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={on ? "h-10 rounded-full bg-accent px-3 text-sm text-accent-fg" : "h-10 rounded-full border border-line px-3 text-sm"}>
      {label}
    </button>
  );
}

function numberOr(value: string, fallback: number): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}
