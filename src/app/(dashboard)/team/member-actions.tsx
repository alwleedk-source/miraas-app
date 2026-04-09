"use client";

import { useTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Power, PowerOff, Shield, Loader2, ChevronDown, Check 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toggleTeamMember, updateMemberRole } from "@/app/actions/team";

interface Props {
  memberId: string;
  isActive: boolean;
  role: string;
  isOwner: boolean;
  isSelf: boolean;
}

export default function MemberActions({ memberId, isActive, role, isOwner, isSelf }: Props) {
  const [isPending, startTransition] = useTransition();
  const [showRoleMenu, setShowRoleMenu] = useState(false);

  // لا تظهر أزرار للمالك ولا للمستخدم الحالي (لا يستطيع تعطيل نفسه)
  if (isOwner) return (
    <div className="mt-3 pt-3 border-t border-surface-100">
      <Badge variant="outline" className="text-xs text-surface-400">مالك الحساب — لا يمكن التعديل</Badge>
    </div>
  );

  if (isSelf) return (
    <div className="mt-3 pt-3 border-t border-surface-100">
      <Badge variant="outline" className="text-xs text-surface-400">حسابك — لا يمكنك تعطيل نفسك</Badge>
    </div>
  );

  const handleToggle = () => {
    startTransition(async () => {
      await toggleTeamMember(memberId);
    });
  };

  const handleRoleChange = (newRole: "ADMIN" | "COORDINATOR") => {
    setShowRoleMenu(false);
    startTransition(async () => {
      await updateMemberRole(memberId, newRole);
    });
  };

  const roleLabels: Record<string, string> = {
    ADMIN: "مدير",
    COORDINATOR: "منسق",
  };

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-100">
      {/* تبديل تفعيل/تعطيل */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleToggle}
        disabled={isPending}
        className={cn(
          "text-xs",
          isActive 
            ? "text-danger-500 hover:text-danger-600 hover:bg-danger-50" 
            : "text-success-500 hover:text-success-600 hover:bg-success-50"
        )}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isActive ? (
          <><PowerOff className="h-3.5 w-3.5 me-1" /> تعطيل</>
        ) : (
          <><Power className="h-3.5 w-3.5 me-1" /> تفعيل</>
        )}
      </Button>

      {/* تغيير الصلاحية */}
      <div className="relative ms-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowRoleMenu(!showRoleMenu)}
          disabled={isPending}
          className="text-xs"
        >
          <Shield className="h-3.5 w-3.5 me-1" />
          {roleLabels[role] || role}
          <ChevronDown className="h-3 w-3 ms-1" />
        </Button>

        {showRoleMenu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setShowRoleMenu(false)} />
            <div className="absolute top-full mt-1 end-0 z-40 bg-white rounded-lg shadow-lg border border-surface-200 py-1 min-w-[130px]">
              {(["ADMIN", "COORDINATOR"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => handleRoleChange(r)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-50 transition-colors text-start",
                    role === r && "bg-surface-50 font-medium"
                  )}
                >
                  {roleLabels[r]}
                  {role === r && <Check className="h-3.5 w-3.5 ms-auto text-primary-600" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
