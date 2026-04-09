"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, Loader2, Check } from "lucide-react";
import { updateTenantSettings } from "@/app/actions/settings";

interface Props {
  tenantName: string;
}

export default function SettingsForm({ tenantName }: Props) {
  const [name, setName] = useState(tenantName);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    startTransition(async () => {
      await updateTenantSettings({ name });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
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
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <>
              <Check className="h-4 w-4" />
              تم الحفظ
            </>
          ) : (
            "حفظ التغييرات"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
