import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getProviderDashboard } from "@/app/actions/provider";
import ProviderDashboardClient from "./provider-dashboard-client";

export default async function ProviderPage() {
  const { role } = await requireTenant();

  // فقط PROVIDER يمكنه الوصول
  if (role !== "PROVIDER") redirect("/");

  let dashboard;
  try {
    dashboard = await getProviderDashboard();
  } catch {
    redirect("/");
  }

  return <ProviderDashboardClient dashboard={dashboard} />;
}
