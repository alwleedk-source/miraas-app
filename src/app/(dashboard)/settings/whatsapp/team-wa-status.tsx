"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, CheckCircle2, XCircle, MinusCircle, Loader2 } from "lucide-react";
import { getTeamWhatsappStatus } from "@/app/actions/settings";

type Row = Awaited<ReturnType<typeof getTeamWhatsappStatus>>[number];

/**
 * نظرة OWNER/ADMIN على حالة WhatsApp لكل عضو في الفريق.
 * يظهر: من ربط رقمه؟ من فعّل؟ آخر اختبار ناجح أم لا؟
 *
 * لا يكشف السر — فقط حالة العرض. كل منسق يدير اعتماداته من /account/whatsapp.
 */
export default function TeamWhatsappStatus() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTeamWhatsappStatus()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-surface-300" />
        </CardContent>
      </Card>
    );
  }

  const coordinators = rows.filter((r) => r.userRole === "COORDINATOR");
  const owners = rows.filter((r) => r.userRole === "OWNER" || r.userRole === "ADMIN");
  const allMembers = [...owners, ...coordinators];

  const activated = allMembers.filter((r) => r.whatsappActive).length;
  const total = allMembers.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-5 w-5 text-primary-500" />
              حالة واتساب الفريق
            </CardTitle>
            <CardDescription className="mt-1">
              مَن من فريقك ربط رقمه الخاص؟ كل منسق يستطيع تعديل اعتماداته من &quot;واتسابي&quot;.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            {activated} / {total} مفعّل
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {allMembers.length === 0 ? (
          <div className="text-center py-6 text-sm text-surface-400">
            لا أعضاء بعد — أضف فريق العمل من{" "}
            <a href="/team" className="text-primary-600 underline">
              صفحة الفريق
            </a>
          </div>
        ) : (
          <div className="space-y-2">
            {allMembers.map((m) => {
              const status: "active" | "inactive" | "none" = m.whatsappActive
                ? "active"
                : m.hasCredentials
                ? "inactive"
                : "none";

              return (
                <div
                  key={m.userId}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface-50 border border-surface-100"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-surface-200 flex items-center justify-center text-surface-600 text-xs font-bold">
                      {m.userName.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-surface-900 truncate">
                        {m.userName}
                      </p>
                      <p className="text-[11px] text-surface-500">
                        {m.userRole === "OWNER" ? "مالك" : m.userRole === "ADMIN" ? "مدير" : "منسق"}
                        {m.phoneNumberId && (
                          <span className="ms-2 font-mono" dir="ltr">
                            ID: {m.phoneNumberId.slice(0, 8)}…
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {m.lastTestedAt && (
                      <span
                        className={`text-[10px] ${
                          m.lastTestSuccess ? "text-success-600" : "text-danger-600"
                        }`}
                        title={`آخر اختبار: ${new Date(m.lastTestedAt).toLocaleString("ar-SA-u-ca-gregory", { timeZone: "Asia/Riyadh" })}`}
                      >
                        {m.lastTestSuccess ? "✓ آخر اختبار" : "✗ آخر اختبار"}
                      </span>
                    )}
                    {status === "active" && (
                      <Badge variant="success" className="text-[10px]">
                        <CheckCircle2 className="h-2.5 w-2.5 me-1" />
                        مفعّل
                      </Badge>
                    )}
                    {status === "inactive" && (
                      <Badge variant="outline" className="text-[10px] text-warning-700 border-warning-300 bg-warning-50">
                        <XCircle className="h-2.5 w-2.5 me-1" />
                        متوقّف
                      </Badge>
                    )}
                    {status === "none" && (
                      <Badge variant="outline" className="text-[10px] text-surface-400">
                        <MinusCircle className="h-2.5 w-2.5 me-1" />
                        لم يربط
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 p-3 rounded-lg bg-primary-50 border border-primary-100 text-[11px] text-primary-700 leading-relaxed">
          💡 <strong>كيف تُرسَل الرسائل:</strong> الترحيب بالعملاء الجدد يُرسَل من رقم المنسق المسؤول فقط —
          لو لم يربط المنسق رقمه، <strong>يتوقّف الترحيب</strong> عن عملائه حتى يربطه (لا يُرسَل من رقم العيادة،
          حتى لا يردّ العميل على رقم لا يتابعه المنسق).
          أما <strong>تذكيرات المواعيد</strong> فتُرسَل دائماً — من رقم المنسق إن ربطه، وإلا من رقم العيادة الموحّد
          (وقد يردّ العميل عليه).
        </div>
      </CardContent>
    </Card>
  );
}
