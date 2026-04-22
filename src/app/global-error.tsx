"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

/**
 * Global Error Boundary — Next.js App Router
 *
 * يمسك أي exception غير معالج في الصفحات ويعرض UI لطيف بدل الشاشة البيضاء.
 * الخطأ يُرسَل للـ console تلقائياً — Next.js يربط digest ID بالخطأ السيرفري.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("unhandled client error", error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0 }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "#f8fafc",
            fontFamily: "'IBM Plex Sans Arabic', -apple-system, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              textAlign: "center",
              background: "white",
              padding: 40,
              borderRadius: 16,
              boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 64,
                height: 64,
                borderRadius: 32,
                background: "#fee2e2",
                marginBottom: 16,
              }}
            >
              <AlertTriangle size={28} color="#dc2626" />
            </div>
            <h1 style={{ margin: 0, fontSize: 24, color: "#0f172a", fontWeight: 700 }}>
              حدث خطأ غير متوقع
            </h1>
            <p style={{ color: "#64748b", marginTop: 8, lineHeight: 1.7 }}>
              نعتذر عن الإزعاج. يمكنك إعادة المحاولة أو العودة للرئيسية.
              إذا استمر المشكلة، أبلغ المدير بالرمز أدناه.
            </p>
            {error.digest && (
              <code
                style={{
                  display: "inline-block",
                  marginTop: 12,
                  padding: "4px 10px",
                  background: "#f1f5f9",
                  color: "#475569",
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "monospace",
                  direction: "ltr",
                }}
              >
                {error.digest}
              </code>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 24, justifyContent: "center" }}>
              <button
                onClick={reset}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  background: "#2563eb",
                  color: "white",
                  border: 0,
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                <RefreshCw size={16} />
                إعادة المحاولة
              </button>
              {/* hard-reload to "/" — global-error replaces the whole document, so client nav can't recover */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  background: "white",
                  color: "#475569",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                <Home size={16} />
                الرئيسية
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
