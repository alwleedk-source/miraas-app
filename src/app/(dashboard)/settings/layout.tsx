import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role } = await requireTenant();

  // PROVIDER يذهب لبوابته
  if (role === "PROVIDER") redirect("/provider");
  // COORDINATOR يُردّ للصفحة الرئيسية
  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) redirect("/");

  return <>{children}</>;
}
