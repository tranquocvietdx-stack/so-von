export function fmtPrice(n: number): string {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n);
}

export function fmtIndex(n: number): string {
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** `n` is a percent number: 0.52 means +0.52%. */
export function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return (
    sign +
    new Intl.NumberFormat("vi-VN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n) +
    "%"
  );
}

export function fmtVol(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return trimNum(n / 1e9) + " tỷ";
  if (abs >= 1e6) return trimNum(n / 1e6) + " tr";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);
}

export function fmtCap(n: number): string {
  if (n >= 1e12) return trimNum(n / 1e12) + " nghìn tỷ";
  if (n >= 1e9) return trimNum(n / 1e9) + " tỷ";
  if (n >= 1e6) return trimNum(n / 1e6) + " triệu";
  return fmtPrice(n);
}

export function parseMoney(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed.replace(/\./g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

export function fmtQty(n: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(n);
}

function trimNum(n: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}

export function toneClass(n: number | null | undefined): string {
  if (n == null || Math.abs(n) < 0.005) return "text-flat";
  return n > 0 ? "text-up" : "text-down";
}

export function fmtWhen(ts: number, withTime: boolean): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: withTime ? undefined : "numeric",
    hour: withTime ? "2-digit" : undefined,
    minute: withTime ? "2-digit" : undefined,
    hourCycle: "h23",
  }).format(new Date(ts));
}

export function sessionLabel(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (wd === "Sat" || wd === "Sun") return "Cuối tuần — sàn đóng cửa";
  const mins = hour * 60 + minute;
  if (mins >= 9 * 60 && mins < 11 * 60 + 30) return "Phiên sáng";
  if (mins >= 13 * 60 && mins < 14 * 60 + 30) return "Phiên chiều";
  if (mins >= 14 * 60 + 30 && mins < 15 * 60) return "Khớp lệnh ATC";
  return "Ngoài giờ giao dịch";
}

export function todayLabel(now = new Date()): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(now);
}
