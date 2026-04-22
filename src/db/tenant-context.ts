/**
 * Tenant Context — AsyncLocalStorage layer لتمرير tenantId ضمنياً
 *
 * الهدف اليوم: لا شيء — الكود الحالي يعمل كما هو دون تغيير.
 *
 * الهدف غداً: عند الانتقال لـ db-per-tenant، نُغيّر `getDb()` فقط
 * ليقرأ tenantId من هذا الـ context ويُرجع connection مناسبة.
 *
 * الاستخدام:
 *   - ضع tenantId مرة في بداية request (في requireTenant مثلاً)
 *   - أي query لاحقة تستطيع قراءته بـ getCurrentTenantId()
 *   - لا حاجة لتمريره يدوياً عبر function chain
 *
 * الفلسفة: تعديل واحد الآن (10 سطور) يوفّر أسابيع refactoring لاحقاً.
 */

import { AsyncLocalStorage } from "async_hooks";

type TenantContext = {
  tenantId: string;
  userId: string;
  role: string;
};

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * يضع tenant context لكامل callbacks/promises داخل fn.
 * يُستدعى من requireTenant بعد resolve session.
 */
export function withTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * يقرأ tenant الحالي — null لو خارج context (مثلاً webhook public route).
 */
export function getCurrentTenantContext(): TenantContext | null {
  return storage.getStore() ?? null;
}

/**
 * shortcut للـ tenantId — null لو خارج context.
 */
export function getCurrentTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}
