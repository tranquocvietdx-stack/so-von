import { createFileRoute } from "@tanstack/react-router";
import { DetailView } from "@/components/detail-view";

export const Route = createFileRoute("/m/$ticker")({
  component: TickerPage,
});

function TickerPage() {
  const { ticker } = Route.useParams();
  return <DetailView ticker={ticker} />;
}
