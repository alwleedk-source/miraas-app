export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-row-reverse">
      {/* الجزء الأيمن — الديكور (في RTL يظهر على اليمين) */}
      <div className="hidden lg:flex lg:flex-1 relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900">
        {/* أشكال هندسية خلفية */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 start-20 w-72 h-72 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-20 end-20 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-white/15 blur-2xl" />
        </div>

        <div className="relative z-10 flex flex-col items-center justify-center p-12 text-center w-full">
          {/* شعار */}
          <div className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-8 shadow-lg">
            <span className="text-4xl font-bold text-white">م</span>
          </div>
          
          <h1 className="text-4xl font-bold text-white mb-4">مِراس</h1>
          <p className="text-xl text-primary-100 mb-8 max-w-md leading-relaxed">
            منصة إدارة العملاء المتكاملة لشركات التسويق الرقمي
          </p>
          
          {/* ميزات */}
          <div className="space-y-4 max-w-sm w-full">
            {[
              { icon: "📊", text: "إدارة عملاء احترافية مع خط أنابيب مرن" },
              { icon: "👥", text: "نظام منسقين متعددين مع تتبع الأداء" },
              { icon: "📱", text: "تكامل واتساب ورسائل ترحيب تلقائية" },
              { icon: "📋", text: "ربط مباشر مع Google Sheets" },
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3 text-white/90">
                <span className="text-2xl">{feature.icon}</span>
                <span className="text-sm">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* الجزء الأيسر — Form (في RTL يظهر على اليسار) */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-surface-50">
        <div className="w-full max-w-md animate-fade-in">{children}</div>
      </div>
    </div>
  );
}
