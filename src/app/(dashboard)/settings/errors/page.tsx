import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, Hash } from "lucide-react";
import { getErrors } from "@/app/actions/errors";
import ErrorDetailsDialog from "./error-details-dialog";

export default async function ErrorsPage() {
  // layout /settings/layout.tsx يفرض OWNER/ADMIN بالفعل

  let errors: Awaited<ReturnType<typeof getErrors>> = [];
  try {
    errors = await getErrors({ limit: 100 });
  } catch {
    errors = [];
  }

  const totalCount = errors.reduce((s, e) => s + e.count, 0);

  return (
    <div className="space-y-6 max-w-4xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">سجل الأخطاء</h1>
        <p className="text-surface-500 mt-1">
          آخر 30 يوماً — مجمّعة حسب نوع الخطأ. مجموع الحوادث: {totalCount}
        </p>
      </div>

      {errors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-success-50 mb-3">
              <AlertTriangle className="h-6 w-6 text-success-600" />
            </div>
            <p className="text-surface-600 font-medium">لا أخطاء مسجّلة — 🎉</p>
            <p className="text-xs text-surface-400 mt-1">النظام يعمل بسلاسة</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-danger-500" />
              الأخطاء ({errors.length} نوع)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {errors.map((err) => (
              <ErrorDetailsDialog
                key={err.fingerprint ?? Math.random().toString()}
                summary={err}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
