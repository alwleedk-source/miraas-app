import { headers } from "next/headers";
import { auth, type Session } from "@/lib/auth";
import { redirect } from "next/navigation";

// =============================================
// Session helpers
// =============================================

export async function getSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session;
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireRole(roles: string[]) {
  const session = await requireAuth();
  const { role } = getSessionUser(session);
  if (!roles.includes(role)) {
    redirect("/");
  }
  return session;
}

// =============================================
// Fix #9: استخراج بيانات المستخدم — type-safe ومركزي
// بدلاً من تكرار (session.user as Record<string, unknown>)
// =============================================

export function getSessionUser(session: Session) {
  const user = session.user as Session["user"] & {
    tenantId?: string | null;
    role?: string;
    isActive?: boolean;
  };

  return {
    id: user.id,
    name: user.name,
    tenantId: (user.tenantId as string) || "",
    role: (user.role as string) || "COORDINATOR",
    isActive: user.isActive !== false,
  };
}

/**
 * يجلب الجلسة + يتحقق من الصلاحيات + يُرجع tenantId, userId, role
 * استخدام: const { tenantId, userId, role } = await requireTenant();
 */
export async function requireTenant() {
  const session = await requireAuth();
  const { tenantId, id: userId, role } = getSessionUser(session);
  if (!tenantId) throw new Error("unauthorized");
  return { tenantId, userId, role, session };
}
