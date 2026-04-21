import { headers } from "next/headers";
import { auth, type Session } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

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
  const { tenantId, id: userId } = getSessionUser(session);
  if (!tenantId) redirect("/register");

  // Fresh check من DB — يُبطل جلسات المُعطَّلين ويعكس role changes فوراً
  const [u] = await db
    .select({ isActive: users.isActive, role: users.role, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!u || !u.isActive) {
    try {
      await auth.api.signOut({ headers: await headers() });
    } catch {
      // ignore
    }
    redirect("/login");
  }

  // استخدم القيم الطازجة من DB لا من الـ cookie cache
  const freshTenantId = u.tenantId ?? tenantId;
  return { tenantId: freshTenantId, userId, role: u.role, session };
}
