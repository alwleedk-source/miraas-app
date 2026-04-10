export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-row-reverse">
      {/* الجزء الأيمن — عرض الميزات */}
      <div className="hidden lg:flex lg:flex-1 relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900">
        {/* أشكال هندسية ديناميكية */}
        <div className="absolute inset-0">
          <div className="absolute top-[-10%] start-[-5%] w-96 h-96 rounded-full bg-white/[0.07] blur-3xl animate-pulse-soft" />
          <div className="absolute bottom-[-15%] end-[-10%] w-[500px] h-[500px] rounded-full bg-white/[0.05] blur-3xl" />
          <div className="absolute top-1/3 end-1/4 w-72 h-72 rounded-full bg-primary-400/20 blur-3xl" />
        </div>

        {/* خطوط زخرفية */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 40px,
              white 40px,
              white 41px
            )`,
          }}
        />

        <div className="relative z-10 flex flex-col items-center justify-center p-12 text-center w-full">
          {/* شعار */}
          <div className="w-24 h-24 rounded-3xl bg-white/15 backdrop-blur-xl flex items-center justify-center mb-10 shadow-2xl border border-white/20">
            <span className="text-5xl font-bold text-white">م</span>
          </div>
          
          <h1 className="text-5xl font-bold text-white mb-3 tracking-tight">مِراس</h1>
          <p className="text-lg text-primary-200 mb-12 max-w-sm leading-relaxed">
            أدر عملاءك ونسّق فريقك وأتمت تواصلك — من مكان واحد
          </p>
          
          {/* ميزات — بطاقات زجاجية */}
          <div className="grid gap-4 max-w-sm w-full">
            {[
              { 
                icon: "🎯", 
                title: "خط أنابيب ذكي",
                desc: "تابع كل عميل من أول تواصل حتى الإغلاق"
              },
              { 
                icon: "⚡", 
                title: "رسائل واتساب تلقائية",
                desc: "ترحيب فوري بكل عميل جديد عبر Meta API"
              },
              { 
                icon: "👥", 
                title: "إدارة فريق متكاملة",
                desc: "وزّع العملاء على منسقيك وتابع أداءهم"
              },
              { 
                icon: "📊", 
                title: "تحليلات لحظية",
                desc: "بيانات وتقارير تساعدك تتخذ قرارات أذكى"
              },
            ].map((feature, i) => (
              <div 
                key={i} 
                className="flex items-start gap-4 p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] text-start transition-all duration-300 hover:bg-white/[0.12] hover:border-white/[0.15] group"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <span className="text-2xl mt-0.5 group-hover:scale-110 transition-transform duration-300">{feature.icon}</span>
                <div>
                  <p className="text-white font-semibold text-sm mb-0.5">{feature.title}</p>
                  <p className="text-primary-200 text-xs leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* إحصائية */}
          <div className="mt-12 flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-white">0</p>
              <p className="text-xs text-primary-300">تكلفة إعداد</p>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-center">
              <p className="text-2xl font-bold text-white">∞</p>
              <p className="text-xs text-primary-300">عملاء</p>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-center">
              <p className="text-2xl font-bold text-white">24/7</p>
              <p className="text-xs text-primary-300">أتمتة</p>
            </div>
          </div>
        </div>
      </div>

      {/* الجزء الأيسر — Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-surface-50 relative">
        {/* زخرفة خفيفة */}
        <div className="absolute top-0 start-0 w-full h-1 bg-gradient-to-l from-primary-600 via-primary-400 to-transparent" />
        <div className="w-full max-w-md animate-fade-in">{children}</div>
      </div>
    </div>
  );
}
