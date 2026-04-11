import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Users,
  Phone,
  TrendingUp,
  Star,
  Inbox,
} from "lucide-react";
import { getInitials } from "@/lib/utils";
import { getTeamMembers } from "@/app/actions/team";
import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import TeamActions from "./team-actions";
import MemberActions from "./member-actions";

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "سوبر أدمن",
  OWNER: "مالك",
  ADMIN: "مدير",
  COORDINATOR: "منسق",
};

export default async function TeamPage() {
  const { tenantId, userId: currentUserId } = await requireTenant();
  if (!tenantId) redirect("/register");

  let members: Awaited<ReturnType<typeof getTeamMembers>> = [];
  try {
    members = await getTeamMembers();
  } catch {
    // ignore
  }

  const activeCount = members.filter((m) => m.isActive).length;
  const totalLeads = members.reduce((s, m) => s + m.leadsCount, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* العنوان */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">الفريق</h1>
          <p className="text-surface-500 mt-1">
            إدارة المنسقين ومتابعة أدائهم
          </p>
        </div>
        <TeamActions />
      </div>

      {/* إحصائيات الفريق */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary-50">
              <Users className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{activeCount}</p>
              <p className="text-sm text-surface-500">أعضاء نشطين</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-success-50">
              <Phone className="h-6 w-6 text-success-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{totalLeads}</p>
              <p className="text-sm text-surface-500">إجمالي العملاء المسؤولين</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-warning-50">
              <TrendingUp className="h-6 w-6 text-warning-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{members.length}</p>
              <p className="text-sm text-surface-500">إجمالي الأعضاء</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* بطاقات الأعضاء */}
      {members.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((member, index) => (
            <Card
              key={member.id}
              className={!member.isActive ? "opacity-60" : ""}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback className="text-sm">
                          {getInitials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span
                        className={`absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                          member.isActive ? "bg-success-500" : "bg-surface-300"
                        }`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-surface-900">
                          {member.name}
                        </p>
                        {index === 0 && (
                          <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        )}
                      </div>
                      <p className="text-xs text-surface-400">{member.email}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <Badge variant={member.isActive ? "default" : "outline"}>
                    {roleLabels[member.role] || member.role}
                  </Badge>
                  {!member.isActive && (
                    <Badge variant="danger">معطّل</Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 p-3 bg-surface-50 rounded-lg">
                  <div className="text-center">
                    <p className="text-lg font-bold text-surface-900">
                      {member.leadsCount}
                    </p>
                    <p className="text-xs text-surface-400">عملاء</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-surface-400 mt-2">
                      انضم {new Date(member.createdAt).toLocaleDateString("ar-SA")}
                    </p>
                  </div>
                </div>

                <MemberActions
                  memberId={member.id}
                  isActive={member.isActive}
                  role={member.role}
                  isOwner={member.role === "OWNER"}
                  isSelf={member.id === currentUserId}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <Inbox className="h-12 w-12 mx-auto mb-4 text-surface-300" />
            <h3 className="text-lg font-semibold text-surface-700 mb-2">
              لا يوجد أعضاء بعد
            </h3>
            <p className="text-surface-500 text-sm">
              أضف أول منسق لبدء توزيع العملاء
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
