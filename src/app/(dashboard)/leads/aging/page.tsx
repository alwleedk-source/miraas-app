import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getAgingLeads, type AgingLead } from "@/app/actions/leads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertOctagon, Clock, ArrowRight } from "lucide-react";
import Link from "next/link";
import AgingLeadsActions from "./aging-leads-actions";

export default async function AgingLeadsPage() {
  const { tenantId, role } = await requireTenant();
  if (!tenantId) redirect("/register");
  if (role === "PROVIDER") redirect("/provider");

  // صفحة قراءة — عند الفشل تُعرض القائمة الفارغة
  let leads: AgingLead[] = [];
  try {
    const res = await getAgingLeads(3);
    if (res.success) leads = res.leads;
  } catch {
    leads = [];
  }

  const critical = leads.filter((l) => l.severity === "critical");
  const warning = leads.filter((l) => l.severity === "warning");

  return (
    <div className="space-y-6 max-w-5xl animate-fade-in">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-2"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          العودة للوحة التحكم
        </Link>
        <h1 className="text-2xl font-bold text-surface-900">العملاء المُهمَلون</h1>
        <p className="text-surface-500 mt-1">
          عملاء لم يحدث لهم تواصل منذ 3 أيام أو أكثر — قبل أن تخسرهم تواصل معهم
        </p>
      </div>

      {leads.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-success-50 mb-3">
              <Clock className="h-6 w-6 text-success-600" />
            </div>
            <p className="text-surface-700 font-semibold text-lg">
              ممتاز — لا عملاء مُهمَلون 🎉
            </p>
            <p className="text-sm text-surface-500 mt-2 max-w-md mx-auto">
              كل عملائك تم التواصل معهم خلال آخر 3 أيام. استمر في الإنتاجية!
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats summary */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-danger-200 bg-danger-50/30">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-xl bg-danger-100">
                  <AlertOctagon className="h-5 w-5 text-danger-600" />
                </div>
                <div>
                  <p className="text-xs text-danger-600">حرج (+7 يوم)</p>
                  <p className="text-2xl font-bold text-danger-700">{critical.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-warning-200 bg-warning-50/30">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-xl bg-warning-100">
                  <AlertTriangle className="h-5 w-5 text-warning-600" />
                </div>
                <div>
                  <p className="text-xs text-warning-600">تحذير (3-6 يوم)</p>
                  <p className="text-2xl font-bold text-warning-700">{warning.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Critical first */}
          {critical.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertOctagon className="h-5 w-5 text-danger-500" />
                  متروكون أكثر من أسبوع
                  <Badge variant="danger" className="text-[10px]">
                    {critical.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {critical.map((lead) => (
                  <AgingLeadRow key={lead.id} lead={lead} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Warning */}
          {warning.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-warning-500" />
                  متروكون 3-6 أيام
                  <Badge variant="warning" className="text-[10px]">
                    {warning.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {warning.map((lead) => (
                  <AgingLeadRow key={lead.id} lead={lead} />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function AgingLeadRow({ lead }: { lead: AgingLead }) {
  const severityColor =
    lead.severity === "critical"
      ? "border-danger-200 bg-danger-50/30"
      : "border-warning-200 bg-warning-50/30";

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${severityColor}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <Link
            href={`/leads?search=${encodeURIComponent(lead.name)}`}
            className="font-semibold text-sm text-surface-900 hover:text-primary-600 hover:underline"
          >
            {lead.name}
          </Link>
          {lead.stageName && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: (lead.stageColor || "#6B7280") + "20",
                color: lead.stageColor || "#6B7280",
              }}
            >
              {lead.stageName}
            </span>
          )}
          {lead.sourceName && (
            <span className="text-[10px] text-primary-600 bg-primary-50 rounded px-1.5 py-0.5">
              📢 {lead.sourceName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-surface-500">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            بلا تواصل منذ {lead.daysSilent} يوم
          </span>
          {lead.assignedUserName && (
            <span>👩 {lead.assignedUserName}</span>
          )}
          {lead.phone && (
            <span dir="ltr" className="font-mono text-surface-400">
              {lead.phone}
            </span>
          )}
        </div>
      </div>
      <AgingLeadsActions
        leadId={lead.id}
        leadName={lead.name}
        phone={lead.phone}
      />
    </div>
  );
}
