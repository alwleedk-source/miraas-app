import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import {
  getFunnelData,
  getCoordinatorLeaderboard,
  getCampaignROI,
  getFunnelChanges,
  type FunnelPeriod,
} from "@/app/actions/analytics-funnel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TrendingUp, Users, Megaphone, ArrowRight, BarChart3 } from "lucide-react";
import Link from "next/link";
import ConversionFunnel from "@/components/analytics/conversion-funnel";
import CoordinatorLeaderboard from "@/components/analytics/coordinator-leaderboard";
import CampaignROI from "@/components/analytics/campaign-roi";

const PERIOD_OPTIONS: Array<{ value: FunnelPeriod; label: string }> = [
  { value: "today", label: "اليوم" },
  { value: "7d", label: "7 أيام" },
  { value: "30d", label: "30 يوم" },
  { value: "90d", label: "90 يوم" },
  { value: "all", label: "كل الوقت" },
];

const PERIOD_LABELS: Record<FunnelPeriod, string> = {
  today: "اليوم",
  "7d": "آخر 7 أيام",
  "30d": "آخر 30 يوم",
  "90d": "آخر 90 يوم",
  all: "كل الوقت",
};

type SearchParams = Promise<{ period?: string }>;

function isValidPeriod(p: string | undefined): p is FunnelPeriod {
  return p === "today" || p === "7d" || p === "30d" || p === "90d" || p === "all";
}

export default async function FunnelPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenantId, role } = await requireTenant();
  if (!tenantId) redirect("/register");
  if (role === "PROVIDER") redirect("/provider");
  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) redirect("/");

  const params = await searchParams;
  const period: FunnelPeriod = isValidPeriod(params.period) ? params.period : "30d";

  // Parallel fetch — all 4 datasets at once
  const [funnelData, leaderboard, campaignData, changes] = await Promise.all([
    getFunnelData(period).catch(() => null),
    getCoordinatorLeaderboard(period).catch(() => []),
    getCampaignROI(period).catch(() => []),
    getFunnelChanges(period).catch(() => null),
  ]);

  if (!funnelData) {
    return (
      <div className="max-w-4xl mx-auto py-16 text-center">
        <BarChart3 className="h-12 w-12 mx-auto mb-3 text-surface-300" />
        <p className="text-surface-700 font-medium">تعذر تحميل البيانات</p>
        <p className="text-sm text-surface-500 mt-1">جرّب لاحقاً</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl animate-fade-in">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-2"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          العودة للوحة التحكم
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-primary-500" />
              قمع التحويل
            </h1>
            <p className="text-surface-500 mt-1 text-sm">
              تتبّع كيف يتحوّل العملاء من &quot;استفسار&quot; إلى &quot;صفقة&quot; — وأين تخسرهم
            </p>
          </div>

          {/* Period selector — pill group */}
          <div className="inline-flex bg-surface-100 rounded-xl p-1 shadow-sm">
            {PERIOD_OPTIONS.map((opt) => {
              const isActive = period === opt.value;
              return (
                <Link
                  key={opt.value}
                  href={`/analytics/funnel?period=${opt.value}`}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    isActive
                      ? "bg-white shadow text-surface-900"
                      : "text-surface-500 hover:text-surface-700"
                  }`}
                >
                  {opt.label}
                </Link>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-surface-400 mt-2">
          📅 الفترة المعروضة: {PERIOD_LABELS[period]}
        </p>
      </div>

      {/* MAIN — Funnel */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-4 border-b border-surface-100">
          <CardTitle className="text-base">المراحل الست للتحويل</CardTitle>
          <CardDescription>
            من تسجيل الـ lead إلى إتمام الصفقة — تحدّد كل مرحلة من تسرّب
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <ConversionFunnel
            data={funnelData}
            changes={
              changes
                ? {
                    totalChange: changes.totalChange,
                    convertedChange: changes.convertedChange,
                    conversionRateChange: changes.conversionRateChange,
                  }
                : undefined
            }
          />
        </CardContent>
      </Card>

      {/* Two-column: Leaderboard + Campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 border-b border-surface-100">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary-500" />
              ترتيب المنسقات
            </CardTitle>
            <CardDescription>الأداء بحسب معدل التحويل</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <CoordinatorLeaderboard data={leaderboard} />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-3 border-b border-surface-100">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-purple-500" />
              أداء الحملات الإعلانية
            </CardTitle>
            <CardDescription>أيّ مصدر يجلب أفضل عملاء</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <CampaignROI data={campaignData} />
          </CardContent>
        </Card>
      </div>

      {/* Footer note */}
      <Card className="bg-surface-50/60 border-dashed">
        <CardContent className="p-4">
          <p className="text-xs text-surface-500 leading-relaxed">
            💡 <strong className="text-surface-700">كيف تُحسَب البيانات؟</strong>
            <br />
            • <strong>تم التواصل</strong> = أي lead عليه follow-up واحد على الأقل
            <br />
            • <strong>ردّوا</strong> = follow-up بدون كلمة &quot;لم يرد&quot;
            <br />
            • <strong>وافقوا</strong> = lead عليه bookingStatus
            <br />
            • <strong>حضروا</strong> = bookingStatus = COMPLETED أو ATTENDED_NOT_SUITABLE
            <br />
            • <strong>أتمّوا الصفقة</strong> = bookingStatus = COMPLETED
            <br />
            • العملاء المؤرشَفون والمحذوفون مستثنون من جميع الإحصائيات.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
