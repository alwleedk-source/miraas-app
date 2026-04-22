import { createAuthClient } from "better-auth/react";

/**
 * يحدّد baseURL حسب البيئة:
 *   - في المتصفح: window.location.origin (دائماً صحيح، لا يعتمد على build env)
 *   - SSR: NEXT_PUBLIC_APP_URL إن موجود، وإلا fallback
 *
 * هذا يحلّ مشكلة Coolify عندما NEXT_PUBLIC_APP_URL غير مُحقن في build time
 * فيُترك كـ "http://localhost:3000" في bundle.
 */
function resolveBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export const authClient = createAuthClient({
  baseURL: resolveBaseUrl(),
});

export const { signIn, signUp, signOut, useSession } = authClient;
