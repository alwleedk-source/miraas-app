"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, X, Loader2, Check, AlertTriangle } from "lucide-react";
import { inviteTeamMember } from "@/app/actions/team";

export default function TeamActions() {
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleInvite = async (formData: FormData) => {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const role = formData.get("role") as "ADMIN" | "COORDINATOR";

    if (!name || !email || !password) return;

    setError("");
    startTransition(async () => {
      try {
        await inviteTeamMember({ name, email, password, role });
        setSuccess(true);
        setTimeout(() => {
          setShowForm(false);
          setSuccess(false);
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "حدث خطأ");
      }
    });
  };

  if (!showForm) {
    return (
      <Button onClick={() => setShowForm(true)}>
        <Plus className="h-4 w-4 me-2" />
        إضافة منسق
      </Button>
    );
  }

  return (
    <Card className="w-full border-primary-200 bg-primary-50/30 animate-fade-in">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-surface-900">دعوة عضو جديد</h3>
          <button onClick={() => setShowForm(false)} className="p-1 hover:bg-surface-100 rounded">
            <X className="h-4 w-4 text-surface-500" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg bg-danger-50 text-danger-600 text-sm border border-danger-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg bg-success-50 text-success-600 text-sm border border-success-200">
            <Check className="h-4 w-4 shrink-0" />
            تمت الدعوة بنجاح! سيتم تحديث القائمة.
          </div>
        )}

        <form action={handleInvite} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="member-name">الاسم</Label>
            <Input id="member-name" name="name" placeholder="اسم العضو" required autoFocus maxLength={50} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-email">البريد الإلكتروني</Label>
            <Input id="member-email" name="email" type="email" placeholder="email@example.com" dir="ltr" className="text-left" required maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-password">كلمة المرور</Label>
            <Input id="member-password" name="password" type="password" placeholder="••••••••" dir="ltr" className="text-left" required minLength={8} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-role">الصلاحية</Label>
            <select
              id="member-role"
              name="role"
              className="w-full h-9 px-3 rounded-lg border border-surface-200 bg-white text-sm text-surface-900"
              defaultValue="COORDINATOR"
            >
              <option value="COORDINATOR">منسق</option>
              <option value="ADMIN">مدير</option>
            </select>
          </div>
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <Button type="submit" disabled={isPending || success}>
              {isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin me-1" /> جاري الإنشاء...</>
              ) : (
                <><Plus className="h-4 w-4 me-1" /> دعوة العضو</>
              )}
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)} type="button">
              إلغاء
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
