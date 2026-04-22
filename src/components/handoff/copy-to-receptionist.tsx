"use client";

import { useState } from "react";
import { Copy, Check, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatBookingForReceptionist,
  buildReceptionistWhatsAppUrl,
  copyToClipboard,
  type BookingHandoff,
} from "@/lib/handoff";

type Props = {
  booking: BookingHandoff;
  /** رقم الرسبشن المحفوظ في tenant settings — لو موجود يظهر زر WhatsApp */
  receptionistPhone?: string | null;
  /** size compact للاستخدام داخل cards/rows صغيرة */
  variant?: "compact" | "full";
};

/**
 * زر "نسخ للرسبشن"
 *
 * يوفّر طريقتين:
 *   1. نسخ النص للـ clipboard → المنسقة تلصق في أي تطبيق
 *   2. فتح WhatsApp مع النص جاهز للإرسال للرسبشن (إن كان رقمها محفوظ)
 *
 * النص بصيغة منظّمة بـ emojis لقراءة سريعة.
 */
export function CopyToReceptionist({
  booking,
  receptionistPhone,
  variant = "full",
}: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = formatBookingForReceptionist(booking);
  const waUrl = receptionistPhone
    ? buildReceptionistWhatsAppUrl(receptionistPhone, text)
    : null;

  const handleCopy = async () => {
    setError(null);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } else {
      setError("فشل النسخ — جرب يدوياً");
    }
  };

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-surface-100 hover:bg-surface-200 text-surface-700 transition-colors"
          title="نسخ بيانات الحجز للرسبشن"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success-600" />
              نُسخ
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              نسخ
            </>
          )}
        </button>
        {waUrl && (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-[#25D366] hover:bg-[#1da851] text-white font-medium transition-colors"
            title="إرسال للرسبشن عبر واتساب"
          >
            <Send className="h-3 w-3" />
            للرسبشن
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleCopy} variant="outline" size="sm" className="gap-1.5">
          {copied ? (
            <>
              <Check className="h-4 w-4 text-success-600" />
              تم النسخ
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              نسخ للرسبشن
            </>
          )}
        </Button>

        {waUrl ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-[#25D366] hover:bg-[#1da851] text-white text-sm font-medium transition-colors"
          >
            <MessageCircle className="h-4 w-4" />
            أرسل عبر واتساب
          </a>
        ) : (
          <span className="text-xs text-surface-400">
            💡 احفظ رقم الرسبشن في الإعدادات لتفعيل زر الإرسال
          </span>
        )}
      </div>

      {/* preview نص المُولَّد */}
      <details className="text-xs">
        <summary className="cursor-pointer text-surface-500 hover:text-surface-700">
          معاينة النص
        </summary>
        <pre className="mt-2 p-3 bg-surface-50 border border-surface-200 rounded-lg whitespace-pre-wrap text-[12px] leading-relaxed font-sans">
          {text}
        </pre>
      </details>

      {error && <p className="text-xs text-danger-600">{error}</p>}
    </div>
  );
}
