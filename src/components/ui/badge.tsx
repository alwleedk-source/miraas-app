import * as React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "outline" | "secondary";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants: Record<string, string> = {
    default: "bg-primary-100 text-primary-700 border-primary-200",
    success: "bg-success-50 text-success-600 border-success-500/20",
    warning: "bg-warning-50 text-warning-600 border-warning-500/20",
    danger: "bg-danger-50 text-danger-600 border-danger-500/20",
    outline: "bg-transparent text-surface-700 border-surface-300",
    secondary: "bg-surface-100 text-surface-700 border-surface-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
