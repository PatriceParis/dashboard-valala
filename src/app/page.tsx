import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { loadDashboardData } from "@/lib/data-loader";

export const dynamic = "force-static";

export default function HomePage() {
  const data = loadDashboardData();
  return <DashboardShell data={data} />;
}
