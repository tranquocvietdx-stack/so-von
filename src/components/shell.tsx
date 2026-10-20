import { useEffect, type ReactNode } from "react";
import { useBook } from "@/lib/book";
import { usePicks } from "@/lib/picks";
import { useReportLog } from "@/lib/report-log";

export function useReadyBook() {
  const ready = useBook((state) => state.ready);
  const setReady = useBook((state) => state.setReady);
  useEffect(() => {
    let live = true;
    void Promise.all([
      Promise.resolve(useBook.persist.rehydrate()),
      Promise.resolve(useReportLog.persist.rehydrate()),
      Promise.resolve(usePicks.persist.rehydrate()),
    ]).finally(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [setReady]);
  return ready;
}

export function Frame({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-20">{children}</div>;
}