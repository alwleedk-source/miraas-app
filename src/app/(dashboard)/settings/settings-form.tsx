"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, Loader2, Check, Phone, User } from "lucide-react";
import { updateTenantSettings } from "@/app/actions/settings";

interface Props {
  tenantName: string;
  receptionistPhone?: string;
  receptionistName?: string;
}

export default function SettingsForm({
  tenantName,
  receptionistPhone = "",
  receptionistName = "",
}: Props) {
  const [name, setName] = useState(tenantName);
  const [recpPhone, setRecpPhone] = useState(receptionistPhone);
  const [recpName, setRecpName] = useState(receptionistName);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateTenantSettings({
          name,
          settings: {
            receptionistPhone: recpPhone.trim(),
            receptionistName: recpName.trim(),
          },
        });
        if (!result.success) {
          setError(result.error);
          return;
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "فشل الحفظ");
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary-500" />
            معلومات الشركة
          </CardTitle>
          <CardDescription>البيانات الأساسية لشركتك</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>اسم الشركة</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="h-5 w-5 text-success-500" />
            موظف الاستقبال (الرسبشن)
          </CardTitle>
          <CardDescription>
            عند إدخال رقمه، يظهر زر &quot;أرسل للرسبشن عبر واتساب&quot; بجانب كل حجز —
            المنسقة تنقل بيانات العميل بنقرة واحدة لمن سيُدخلها في تطبيق العيادة الرسمي.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-surface-400" />
                اسم الموظف (اختياري)
              </Label>
              <Input
                value={recpName}
                onChange={(e) => setRecpName(e.target.value)}
                placeholder="مثال: نورة"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-surface-400" />
                رقم الجوال
              </Label>
              <Input
                value={recpPhone}
                onChange={(e) => setRecpPhone(e.target.value)}
                placeholder="0501234567"
                dir="ltr"
                className="text-left"
                maxLength={20}
              />
            </div>
          </div>
          <p className="text-xs text-surface-500 leading-relaxed">
            💡 الرقم يُستخدم فقط لفتح WhatsApp مع نص جاهز —
            <strong> Meras لا يُرسل شيئاً تلقائياً</strong>. أنت تتحكم في كل رسالة.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري الحفظ...
            </>
          ) : saved ? (
            <>
              <Check className="h-4 w-4" />
              تم الحفظ
            </>
          ) : (
            "حفظ التغييرات"
          )}
        </Button>
        {error && <span className="text-sm text-danger-600">{error}</span>}
      </div>
    </div>
  );
}
