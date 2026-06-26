import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase.config.js";

export const SUPABASE_AUTH_STORAGE_KEY = "paynowbiz-auth";

export const isSupabaseConfigured =
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.includes("YOUR_SUPABASE_URL") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE_PUBLISHABLE_KEY");

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
        storageKey: SUPABASE_AUTH_STORAGE_KEY,
      },
    })
  : null;

export function getOAuthRedirectUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";

  if (url.pathname.endsWith("/index.html")) {
    url.pathname = url.pathname.slice(0, -"index.html".length);
  }

  return url.toString();
}

export function canUseAuthStorage() {
  try {
    const testKey = `${SUPABASE_AUTH_STORAGE_KEY}:test`;
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}
