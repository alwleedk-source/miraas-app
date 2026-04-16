"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import QuickBookingModal from "./quick-booking-modal";

type Service = { id: string; name: string };

export default function BookingsHeader({ services }: { services: Service[] }) {
  const [showQuickBooking, setShowQuickBooking] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">إدارة الحجوزات</h1>
          <p className="text-surface-500 mt-1">تتبع مواعيد العملاء وحالاتهم</p>
        </div>
        <Button
          onClick={() => setShowQuickBooking(true)}
          className="gap-2 bg-primary-600 hover:bg-primary-700"
        >
          <CalendarPlus className="h-4 w-4" />
          موعد سريع
        </Button>
      </div>

      <QuickBookingModal
        open={showQuickBooking}
        onClose={() => setShowQuickBooking(false)}
        services={services}
      />
    </>
  );
}
