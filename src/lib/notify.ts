import type { Assessment } from "@/lib/assess";
import { useReportLog } from "@/lib/report-log";
import { sendTelegram } from "@/lib/telegram";

export async function publishPick(assessment: Assessment): Promise<"sent" | "saved" | "off"> {
  const title = `Khuyến nghị ${assessment.ticker}`;
  useReportLog.getState().add([
    {
      id: `pick:${assessment.ticker}:${Date.now()}`,
      key: `pick:${assessment.ticker}:${Date.now()}`,
      at: Date.now(),
      kind: "note",
      title,
      body: assessment.thesis,
    },
  ]);
  const { telegramToken, telegramChat } = useReportLog.getState();
  if (!telegramToken || !telegramChat) return "off";
  const result = await sendTelegram({
    data: { token: telegramToken, chat: telegramChat, text: `${title}\n${assessment.thesis}` },
  }).catch(() => ({ ok: false as const, error: "Chưa gửi được." }));
  return result.ok ? "sent" : "saved";
}
