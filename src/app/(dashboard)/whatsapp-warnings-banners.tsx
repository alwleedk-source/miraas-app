import Link from "next/link";
import { AlertTriangle, MessageCircle, Users } from "lucide-react";
import { getStuckLeadsCount, getMyWhatsappStatus } from "@/app/actions/whatsapp-warnings";

/**
 * Banner للمالك: عملاء انتظروا ترحيباً لأن المنسق المسؤول لم يربط رقمه.
 * يُظهَر فقط لو totalStuck > 0.
 */
export async function StuckLeadsOwnerBanner() {
  let stuck;
  try {
    stuck = await getStuckLeadsCount();
  } catch {
    return null; // PROVIDER أو COORDINATOR — لا تنبيه له
  }

  if (stuck.totalStuck === 0) return null;

  return (
    <div className="bg-gradient-to-l from-warning-600 to-warning-500 text-white px-4 py-3 rounded-xl shadow-lg flex items-start gap-3 animate-fade-in">
      <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">
          {stuck.totalStuck} عميل لم يستلم ترحيباً
        </p>
        <p className="text-xs opacity-90 mt-0.5 leading-relaxed">
          منسقون مسؤولون عنهم لم يربطوا أرقام WhatsApp بعد. لتجنّب inbox مختلط، النظام لا يُرسل من رقم العيادة.
        </p>
        {stuck.byCoordinator.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {stuck.byCoordinator.slice(0, 5).map((c) => (
              <span
                key={c.coordinatorId}
                className="text-[11px] bg-white/20 rounded-full px-2 py-0.5"
              >
                {c.coordinatorName}: {c.count}
              </span>
            ))}
          </div>
        )}
      </div>
      <Link
        href="/team"
        className="shrink-0 text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg font-medium self-center"
      >
        عرض الفريق ←
      </Link>
    </div>
  );
}

/**
 * Banner للمنسق: عندك حملات بدون ربط رقمك → عملاؤك لن يستلموا ترحيب.
 * يُظهَر فقط لو COORDINATOR + needsAction = true.
 */
export async function MyWhatsappBanner() {
  let status;
  try {
    status = await getMyWhatsappStatus();
  } catch {
    return null;
  }

  if (!status || !status.needsAction) return null;

  return (
    <div className="bg-gradient-to-l from-danger-600 to-danger-500 text-white px-4 py-3 rounded-xl shadow-lg flex items-start gap-3 animate-fade-in">
      <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
        <MessageCircle className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">
          ⚠️ اربط رقم WhatsApp الخاص بك
        </p>
        <p className="text-xs opacity-90 mt-0.5 leading-relaxed">
          أنت مسؤول عن{" "}
          <span className="font-bold">{status.webhookCount}</span> حملة، لكنك لم تربط رقم Meta بعد.
          {status.pendingWelcomesCount > 0 && (
            <>
              {" "}
              <span className="font-bold">{status.pendingWelcomesCount} عميل</span> ينتظرون ترحيباً منك الآن.
            </>
          )}
        </p>
      </div>
      <Link
        href="/account/whatsapp"
        className="shrink-0 text-xs bg-white text-danger-700 hover:bg-white/90 px-3 py-1.5 rounded-lg font-bold self-center"
      >
        اربط الآن ←
      </Link>
    </div>
  );
}

// suppress unused-import for future
void Users;
