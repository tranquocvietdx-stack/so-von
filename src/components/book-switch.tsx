import { useBook } from "@/lib/book";
import { cn } from "@/lib/cn";

export function BookSwitch() {
  const portfolios = useBook((state) => state.portfolios);
  const activeId = useBook((state) => state.activeId);
  const switchPortfolio = useBook((state) => state.switchPortfolio);
  const note = portfolios.find((portfolio) => portfolio.id === activeId)?.note;
  if (portfolios.length < 2) return null;
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto">
        {portfolios.map((portfolio) => (
          <button
            key={portfolio.id}
            type="button"
            onClick={() => switchPortfolio(portfolio.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm",
              portfolio.id === activeId ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted",
            )}
          >
            {portfolio.name}
          </button>
        ))}
      </div>
      {note ? <p className="mt-2 text-xs text-subtle">{note}</p> : null}
    </div>
  );
}
