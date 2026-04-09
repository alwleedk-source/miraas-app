import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-surface-50">{children}</body>
    </html>
  );
}
