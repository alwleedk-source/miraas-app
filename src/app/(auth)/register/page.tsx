"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth-client";
import { createTenantForUser } from "@/app/actions/tenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Building2, User, Mail, Lock, Loader2, Rocket } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    companyName: "",
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (formData.password !== formData.confirmPassword) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }

    if (formData.password.length < 8) {
      setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }

    setLoading(true);

    try {
      // 1. إنشاء حساب المستخدم
      const result = await signUp.email({
        email: formData.email,
        password: formData.password,
        name: formData.name,
      });

      if (result.error) {
        if (result.error.message?.includes("already exists")) {
          setError("هذا البريد الإلكتروني مسجل مسبقاً");
        } else {
          setError(result.error.message || "حدث خطأ أثناء التسجيل");
        }
        return;
      }

      // 2. إنشاء الشركة (Tenant) وربطها بالمستخدم
      if (result.data?.user?.id) {
        await createTenantForUser(result.data.user.id, formData.companyName);
      }

      // Full page redirect to ensure session cookies are properly sent
      window.location.href = "/";
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
        <div className="w-16 h-16 rounded-2xl bg-primary-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
          <span className="text-3xl font-bold text-white">م</span>
        </div>
        <h1 className="text-2xl font-bold text-surface-900">مِراس</h1>
      </div>

      <Card className="border-0 shadow-elevated">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl">إنشاء حساب جديد</CardTitle>
          <CardDescription>سجّل شركتك وابدأ إدارة عملائك باحترافية</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-danger-50 border border-danger-500/20 text-danger-600 text-sm animate-fade-in">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="companyName">اسم الشركة</Label>
              <div className="relative">
                <Building2 className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                <Input
                  id="companyName"
                  name="companyName"
                  placeholder="شركة التسويق الرقمي"
                  className="pe-10"
                  value={formData.companyName}
                  onChange={handleChange}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">اسمك الكامل</Label>
              <div className="relative">
                <User className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                <Input
                  id="name"
                  name="name"
                  placeholder="أحمد محمد"
                  className="pe-10"
                  value={formData.name}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <div className="relative">
                <Mail className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="email@example.com"
                  dir="ltr"
                  className="pe-10 text-left"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="password">كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="••••••••"
                    dir="ltr"
                    className="pe-10 text-left"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    minLength={8}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">تأكيد المرور</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  dir="ltr"
                  className="text-left"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                  minLength={8}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Rocket className="h-4 w-4" />
                  إنشاء الحساب
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-surface-500">
              لديك حساب بالفعل؟{" "}
              <Link
                href="/login"
                className="text-primary-600 font-medium hover:text-primary-700 transition-colors"
              >
                تسجيل الدخول
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
