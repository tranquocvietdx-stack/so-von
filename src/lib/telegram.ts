import { createServerFn } from "@tanstack/react-start";

const TOKEN = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
const CHAT = /^-?\d{4,}$/;

function read(input: unknown): { token: string; chat: string; text: string } {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    token: typeof raw.token === "string" ? raw.token.trim() : "",
    chat: typeof raw.chat === "string" ? raw.chat.trim() : "",
    text: typeof raw.text === "string" ? raw.text.trim().slice(0, 3500) : "",
  };
}

function checkToken(token: string) {
  if (!TOKEN.test(token)) throw new Error("Token bot không đúng dạng số:mã.");
}

export const findTelegramChat = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const { token } = read(input);
    checkToken(token);
    return { token };
  })
  .handler(async ({ data }) => {
    const response = await fetch(`https://api.telegram.org/bot${data.token}/getUpdates`);
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: { message?: { chat?: { id?: number } } }[];
    } | null;
    if (!response.ok || !body?.ok) return { ok: false as const, error: body?.description || "Không đọc được bot." };
    const latest = [...(body.result ?? [])].reverse().find((item) => item.message?.chat?.id != null);
    if (!latest?.message?.chat?.id) return { ok: false as const, error: "Chưa thấy tin. Mở bot, gửi /start, rồi bấm lại." };
    return { ok: true as const, chat: String(latest.message.chat.id) };
  });

export const sendTelegram = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const next = read(input);
    checkToken(next.token);
    if (!CHAT.test(next.chat)) throw new Error("Chat id phải là số.");
    if (!next.text) throw new Error("Tin trống.");
    return next;
  })
  .handler(async ({ data }) => {
    const response = await fetch(`https://api.telegram.org/bot${data.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: data.chat, text: data.text, disable_web_page_preview: true }),
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!response.ok || !body?.ok) return { ok: false as const, error: body?.description || "Telegram từ chối tin." };
    return { ok: true as const };
  });
