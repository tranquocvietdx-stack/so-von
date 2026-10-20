import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Assessment } from "@/lib/assess";

export type Pick = Assessment & { stance: "mua" | "chờ"; entry: number; stop: number; riskPct: number; at: number };

type PickState = {
  picks: Pick[];
  put: (assessment: Assessment) => boolean;
  remove: (ticker: string) => void;
};

export const usePicks = create<PickState>()(
  persist(
    (set, get) => ({
      picks: [],
      put: (assessment) => {
        if (assessment.stance === "bỏ" || assessment.entry == null || assessment.stop == null || assessment.riskPct == null) return false;
        const next: Pick = {
          ...assessment,
          stance: assessment.stance,
          entry: assessment.entry,
          stop: assessment.stop,
          riskPct: assessment.riskPct,
          at: Date.now(),
        };
        const rest = get().picks.filter((pick) => pick.ticker !== next.ticker);
        set({ picks: [next, ...rest].slice(0, 12) });
        return true;
      },
      remove: (ticker) => set({ picks: get().picks.filter((pick) => pick.ticker !== ticker) }),
    }),
    { name: "so-von-picks", skipHydration: true, partialize: (state) => ({ picks: state.picks }) },
  ),
);
