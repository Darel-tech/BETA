import type { Metadata } from "next";
import RunMetricsPanel from "@/components/dashboard/RunMetricsPanel";

export const metadata: Metadata = {
  title: "Dashboard · BETA",
  description: "Live verification metrics from checks run in this browser.",
};

export default function DashboardPage() {
  return <RunMetricsPanel />;
}
