import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.2/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase.config.js?v=20260710-auth-fix";

export const SUPABASE_AUTH_STORAGE_KEY = "paynowbiz-auth";

const NETWORK_TIMEOUT_MS = 20000;

export const isSupabaseConfigured =
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.includes("YOUR_SUPABASE_URL") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE_PUBLISHABLE_KEY");

function createSupabaseClient() {
  if (!isSupabaseConfigured) return null;

  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
      // A suspended iOS web app can leave an auth lock waiting indefinitely.
      // A bounded wait lets the app rebuild the client and retry instead.
      lockAcquireTimeout: 5000,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });
}

export let supabase = createSupabaseClient();

export function resetSupabaseClient() {
  try {
    supabase?.auth.stopAutoRefresh();
  } catch {
    // The old client may already be suspended or partially initialized.
  }

  supabase = createSupabaseClient();
  return supabase;
}

async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
  }

  try {
    return await window.fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      throw new Error("Supabase 서버 응답 시간이 초과되었습니다.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

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
