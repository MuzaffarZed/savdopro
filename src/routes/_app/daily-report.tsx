import { createFileRoute } from "@tanstack/react-router";
import { DailyReport } from "@/components/reports/DailyReport";

export const Route = createFileRoute("/_app/daily-report")({
  component: DailyReportPage,
});

function DailyReportPage() {
  return <DailyReport />;
}
