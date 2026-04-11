"use server";

import { db } from "@/db";
import { services } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";

// =============================================
// جلب خدمات الشركة
// =============================================

export async function getServices() {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

  return db
    .select({
      id: services.id,
      name: services.name,
      isActive: services.isActive,
    })
    .from(services)
    .where(eq(services.tenantId, tenantId))
    .orderBy(services.createdAt);
}

// =============================================
// جلب الخدمات النشطة فقط (للاختيار في الحجز)
// =============================================

export async function getActiveServices() {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

  return db
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.isActive, true)))
    .orderBy(services.name);
}

// =============================================
// إضافة خدمة جديدة
// =============================================

export async function addService(name: string) {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

  const trimmed = name.trim();
  if (!trimmed) throw new Error("اسم الخدمة مطلوب");

  // Fix #5: منع التكرار
  const [existing] = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.name, trimmed)))
    .limit(1);

  if (existing) throw new Error("هذه الخدمة موجودة بالفعل");

  await db.insert(services).values({
    tenantId,
    name: trimmed,
  });

  revalidatePath("/settings");
}

// =============================================
// تعطيل/تفعيل خدمة
// =============================================

export async function toggleService(serviceId: string) {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

  const [existing] = await db
    .select({ isActive: services.isActive })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)));

  if (!existing) throw new Error("not found");

  await db
    .update(services)
    .set({ isActive: !existing.isActive })
    .where(eq(services.id, serviceId));

  revalidatePath("/settings");
}

// =============================================
// حذف خدمة
// =============================================

export async function deleteService(serviceId: string) {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

  await db
    .delete(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)));

  revalidatePath("/settings");
}
