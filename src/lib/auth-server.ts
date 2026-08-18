import { headers } from "next/headers";
import { auth, type Session } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, tenants } from "@/db/schema";
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
  const { id: userId } = getSessionUser(session);

  // Fresh check من DB قبل أي قرار توجيه — يُبطل جلسات المُعطَّلين، يعكس role
  // changes فوراً، والأهم: يقرأ tenantId الطازج. الـ cookie cache (5 دقائق) قد
  // يحمل tenantId="" بعد التسجيل مباشرة، فالتحقق من الكاش كان يرتدّ المستخدم
  // الجديد إلى /register رغم أن شركته أُنشئت. لذا نقرأ DB أولاً ثم نقرّر.
  const [u] = await db
    .select({
      isActive: users.isActive,
      role: users.role,
      tenantId: users.tenantId,
      tenantStatus: tenants.status,
    })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
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

  if (!u.tenantId) redirect("/register");

  // شركة موقوفة (فوترة/إساءة): يُمنع دخول لوحة التحكم فقط — استقبال العملاء
  // عبر webhook يستمر عمداً حتى لا تضيع بيانات عملاء المنشأة أثناء الإيقاف.
  if (u.tenantStatus === "SUSPENDED") redirect("/suspended");

  return { tenantId: u.tenantId, userId, role: u.role, session };
}
