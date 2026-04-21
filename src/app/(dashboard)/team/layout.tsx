import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export default async function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role } = await requireTenant();

  if (role === "PROVIDER") redirect("/provider");
  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) redirect("/");

  return <>{children}</>;
}
