"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LogIn, Mail, Lock, Loader2, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError("البريد الإلكتروني أو كلمة المرور غير صحيحة");
      } else {
        window.location.href = "/";
      }
    } catch {
      setError("حدث خطأ. يرجى المحاولة مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* شعار للموبايل */}
      <div className="lg:hidden text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
          <span className="text-3xl font-bold text-white">م</span>
        </div>
        <h1 className="text-2xl font-bold text-surface-900">مِراس</h1>
        <p className="text-sm text-surface-500 mt-1">منصة إدارة العملاء الذكية</p>
      </div>

      <Card className="border-0 shadow-elevated">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl">مرحباً بعودتك</CardTitle>
          <CardDescription>سجّل دخولك للوصول إلى لوحة التحكم</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3 rounded-xl bg-danger-50 border border-danger-500/20 text-danger-600 text-sm animate-fade-in flex items-center gap-2">
                <span className="shrink-0">⚠️</span>
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <div className="relative">
                <Mail className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="email@example.com"
                  dir="ltr"
                  className="pe-10 text-left h-11"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <div className="relative">
                <Lock className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  dir="ltr"
                  className="pe-10 text-left h-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all duration-300"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <LogIn className="h-5 w-5" />
                  تسجيل الدخول
                </>
              )}
            </Button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-surface-500">
              ليس لديك حساب؟{" "}
              <Link
                href="/register"
                className="text-primary-600 font-semibold hover:text-primary-700 transition-colors inline-flex items-center gap-1"
              >
                أنشئ حسابك مجاناً
                <ArrowLeft className="h-3.5 w-3.5" />
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* مميزات سريعة — موبايل فقط */}
      <div className="lg:hidden mt-8 grid grid-cols-2 gap-3">
        {[
          { icon: "🎯", text: "خط أنابيب ذكي" },
          { icon: "⚡", text: "واتساب تلقائي" },
          { icon: "👥", text: "إدارة فريق" },
          { icon: "📊", text: "تحليلات لحظية" },
        ].map((f, i) => (
          <div key={i} className="flex items-center gap-2 p-3 rounded-xl bg-white shadow-sm border border-surface-100">
            <span className="text-lg">{f.icon}</span>
            <span className="text-xs font-medium text-surface-700">{f.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
