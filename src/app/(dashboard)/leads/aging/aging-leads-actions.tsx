"use client";

import { useState, useTransition } from "react";
import { Phone, MessageCircle, Check, Loader2 } from "lucide-react";
import { quickScheduleFollowUp } from "@/app/actions/followups";
import { toTelUrl, toWhatsappUrl } from "@/lib/utils";
import { useRouter } from "next/navigation";

type Props = {
  leadId: string;
  leadName: string;
  phone: string | null;
};

/**
 * أزرار سريعة بجانب كل aging lead:
 *   - اتصال (tel:)
 *   - واتساب (wa.me)
 *   - علّم "تم التواصل" → ينشئ follow-up مكتمل لإخراجه من قائمة aging
 */
export default function AgingLeadsActions({ leadId, leadName, phone }: Props) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  const handleMarkContacted = () => {
    startTransition(async () => {
      try {
        // ننشئ follow-up مكتمل (note فقط) — هذا يُعيد lastActivity ويُخرجه من القائمة
        await quickScheduleFollowUp({
          leadId,
          scheduledAt: new Date().toISOString(),
          notes: `تم التواصل من شاشة العملاء المُهمَلين`,
          type: "CALL",
        });
        setDone(true);
        // refresh الصفحة بعد ثانيتين
        setTimeout(() => router.refresh(), 1500);
      } catch {
        // ignore — show fail visually
      }
    });
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success-700 font-medium">
        <Check className="h-3.5 w-3.5" />
        تمّ
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {phone && (
        <>
          <a
            href={toTelUrl(phone) ?? "#"}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-success-500 hover:bg-success-600 text-white"
            title={`اتصل بـ ${leadName}`}
          >
            <Phone className="h-3.5 w-3.5" />
          </a>
          <a
            href={toWhatsappUrl(phone) ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-[#25D366] hover:bg-[#1da851] text-white"
            title={`واتساب ${leadName}`}
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </a>
        </>
      )}
      <button
        onClick={handleMarkContacted}
        disabled={isPending}
        className="inline-flex items-center gap-1 h-8 px-2 text-xs rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white font-medium"
        title="علّم: تواصلت معه"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Check className="h-3 w-3" />
        )}
        تواصلت
      </button>
    </div>
  );
}
