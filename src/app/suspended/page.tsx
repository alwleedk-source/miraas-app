"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

/**
 * تُعرض عندما tenants.status = "SUSPENDED" — requireTenant يوجّه هنا.
 * خارج مجموعة (dashboard) عمداً حتى لا يحدث loop في التوجيه.
 */
export default function SuspendedPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface-50 p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-surface-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger-50 text-2xl">
          ⏸️
        </div>
        <h1 className="mb-2 text-xl font-bold text-surface-900">الحساب موقوف مؤقتاً</h1>
        <p className="mb-6 text-sm leading-6 text-surface-600">
          تم إيقاف حساب منشأتك. إن كنت تعتقد أن هذا خطأ أو لديك استفسار، تواصل مع الدعم.
        </p>
        <button
          onClick={async () => {
            await signOut();
            router.push("/login");
            router.refresh();
          }}
          className="h-10 w-full rounded-lg bg-primary-600 text-sm font-medium text-white transition-colors hover:bg-primary-700"
        >
          تسجيل الخروج
        </button>
      </div>
    </main>
  );
}
