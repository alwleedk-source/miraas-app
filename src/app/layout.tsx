import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-arabic",
});

export const metadata: Metadata = {
  title: "مِراس — منصة إدارة العملاء لشركات التسويق",
  description:
    "نظام CRM احترافي متعدد المستأجرين مصمم خصيصاً لشركات التسويق الرقمي. متابعة عملاء، منسقين، تكامل واتساب وقوقل شيت.",
  keywords: ["CRM", "إدارة عملاء", "تسويق", "واتساب", "منسقين", "مِراس"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={arabic.variable}>
      <body className={`min-h-full bg-surface-50 ${arabic.className}`}>{children}</body>
    </html>
  );
}
