import {
  canUseAuthStorage,
  getOAuthRedirectUrl,
  isSupabaseConfigured,
  resetSupabaseClient,
  supabase,
} from "./supabaseClient.js?v=20260710-auth-fix";

export { canUseAuthStorage, isSupabaseConfigured, resetSupabaseClient };

const CARD_SELECT = "id, workspace_id, name, first4, last4, color, active, created_at, updated_at";
const PREPAYMENT_SELECT =
  "id, workspace_id, card_id, card_type, card_name_snapshot, card_first4_snapshot, card_last4_snapshot, card_color_snapshot, unregistered_card_memo, approval_number, approval_date, approval_amount, memo, status, created_by, created_at, updated_at, last_activity_at";
const TRANSACTION_SELECT =
  "id, workspace_id, prepayment_id, amount, transaction_date, status, created_by, created_at, updated_at";
const CATALOGUE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000002";
const RECENT_COMPLETED_MONTHS = 12;
const RECENT_APPROVAL_DUPLICATE_MONTHS = 12;

export async function getCurrentSession() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return {
    session: data.session,
    user: data.session?.user ?? null,
  };
}

export async function signInWithGoogle() {
  if (!canUseAuthStorage()) {
    throw new Error("이 브라우저에서 로그인 저장소를 사용할 수 없습니다. 사이트 데이터/개인정보 보호 설정을 확인해주세요.");
  }

  const client = requireSupabase();
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getOAuthRedirectUrl(),
    },
  });
  if (error) throw error;
}

export async function signOut() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}

export async function getCurrentMembership(currentUser = null) {
  const client = requireSupabase();
  const user = currentUser ?? (await getAuthenticatedUser());
  const { data, error } = await client
    .from("workspace_members")
    .select("workspace_id, role, created_at")
    .eq("user_id", user.id)
    .neq("workspace_id", CATALOGUE_WORKSPACE_ID)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    workspaceId: data.workspace_id,
    role: data.role,
    createdAt: data.created_at,
    workspace: {
      id: data.workspace_id,
      name: "PayNowBiz",
      createdAt: null,
    },
    user,
  };
}

export async function loadWorkspaceData(workspaceId) {
  const client = requireSupabase();
  const [cardsResult, prepaymentsResult] = await Promise.all([
    client.from("cards").select(CARD_SELECT).eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
    client.rpc("paynowbiz_visible_prepayments", {
      target_workspace_id: workspaceId,
      recent_since: getRecentCutoffIso(),
    }),
  ]);

  throwIfError(cardsResult.error);
  throwIfError(prepaymentsResult.error);

  const prepayments = (prepaymentsResult.data ?? []).map(mapPrepayment);
  const transactions = await loadTransactionsForPrepayments(
    workspaceId,
    prepayments.map((prepayment) => prepayment.id),
  );

  return {
    cards: (cardsResult.data ?? []).map(mapCard),
    prepayments,
    transactions,
  };
}

export async function loadArchiveYears(membership) {
  requireMembership(membership);
  const client = requireSupabase();
  const { data, error } = await client.rpc("paynowbiz_archive_years", {
    target_workspace_id: membership.workspaceId,
    recent_since: getRecentCutoffIso(),
  });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    year: Number(row.approval_year),
    count: Number(row.record_count),
  }));
}

export async function loadArchiveYear(membership, year, options = {}) {
  requireMembership(membership);
  const client = requireSupabase();
  const { data, error } = await client.rpc("paynowbiz_archive_prepayments", {
    target_workspace_id: membership.workspaceId,
    archive_year: Number(year),
    recent_since: getRecentCutoffIso(),
    page_limit: options.limit ?? 100,
    page_offset: options.offset ?? 0,
  });

  if (error) throw error;
  const prepayments = (data ?? []).map(mapPrepayment);
  const transactions = await loadTransactionsForPrepayments(
    membership.workspaceId,
    prepayments.map((prepayment) => prepayment.id),
  );

  return { prepayments, transactions };
}

export async function searchPrepayments(membership, approvalQuery, options = {}) {
  requireMembership(membership);
  const query = String(approvalQuery || "").trim();
  if (!query) return { prepayments: [], transactions: [] };

  const client = requireSupabase();
  const { data, error } = await client.rpc("paynowbiz_search_prepayments", {
    target_workspace_id: membership.workspaceId,
    approval_query: query,
    page_limit: options.limit ?? 50,
  });

  if (error) throw error;
  const prepayments = (data ?? []).map(mapPrepayment);
  const transactions = await loadTransactionsForPrepayments(
    membership.workspaceId,
    prepayments.map((prepayment) => prepayment.id),
  );

  return { prepayments, transactions };
}

export async function loadCancelledPrepayments(membership) {
  requireAdmin(membership);
  const client = requireSupabase();
  const { data, error } = await client
    .from("prepayments")
    .select(PREPAYMENT_SELECT)
    .eq("workspace_id", membership.workspaceId)
    .eq("status", "cancelled")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapPrepayment);
}

export async function loadBackupData(membership) {
  requireAdmin(membership);
  const client = requireSupabase();
  const [cardsResult, prepaymentsResult, transactionsResult] = await Promise.all([
    client.from("cards").select(CARD_SELECT).eq("workspace_id", membership.workspaceId).order("created_at", { ascending: true }),
    client
      .from("prepayments")
      .select(PREPAYMENT_SELECT)
      .eq("workspace_id", membership.workspaceId)
      .order("approval_date", { ascending: true })
      .order("created_at", { ascending: true }),
    client
      .from("transactions")
      .select(TRANSACTION_SELECT)
      .eq("workspace_id", membership.workspaceId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  throwIfError(cardsResult.error);
  throwIfError(prepaymentsResult.error);
  throwIfError(transactionsResult.error);

  return {
    cards: (cardsResult.data ?? []).map(mapCard),
    prepayments: (prepaymentsResult.data ?? []).map(mapPrepayment),
    transactions: (transactionsResult.data ?? []).map(mapTransaction),
  };
}

export async function createPrepayment(membership, input) {
  requireMembership(membership);
  const client = requireSupabase();
  const user = await getAuthenticatedUser();
  await ensureNoRecentApprovalDuplicate(client, membership.workspaceId, input.approvalNumber);
  const row = {
    workspace_id: membership.workspaceId,
    card_id: input.cardId,
    card_type: input.cardType,
    card_name_snapshot: input.cardNameSnapshot,
    card_first4_snapshot: input.cardFirst4Snapshot,
    card_last4_snapshot: input.cardLast4Snapshot,
    card_color_snapshot: input.cardColorSnapshot,
    unregistered_card_memo: input.unregisteredCardMemo || null,
    approval_number: input.approvalNumber,
    approval_date: input.approvalDate,
    approval_amount: input.approvalAmount,
    memo: input.memo || null,
    status: "active",
    created_by: user.id,
  };
  const { data, error } = await client.from("prepayments").insert(row).select(PREPAYMENT_SELECT).single();
  if (error) throw error;
  return mapPrepayment(data);
}

export async function updatePrepaymentMemo(membership, prepaymentId, memo) {
  requireMembership(membership);
  const client = requireSupabase();
  const normalizedMemo = String(memo ?? "").trim();
  const { data, error } = await client
    .from("prepayments")
    .update({ memo: normalizedMemo || null })
    .eq("workspace_id", membership.workspaceId)
    .eq("id", prepaymentId)
    .select(PREPAYMENT_SELECT)
    .single();

  if (error) throw error;
  return mapPrepayment(data);
}

export async function cancelPrepayment(membership, prepaymentId) {
  requireMembership(membership);
  const client = requireSupabase();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("prepayments")
    .update({ status: "cancelled", updated_at: now, last_activity_at: now })
    .eq("workspace_id", membership.workspaceId)
    .eq("id", prepaymentId)
    .select(PREPAYMENT_SELECT)
    .single();

  if (error) throw error;
  return mapPrepayment(data);
}

export async function restorePrepayment(membership, prepaymentId) {
  requireAdmin(membership);
  const client = requireSupabase();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("prepayments")
    .update({ status: "active", updated_at: now, last_activity_at: now })
    .eq("workspace_id", membership.workspaceId)
    .eq("id", prepaymentId)
    .select(PREPAYMENT_SELECT)
    .single();

  if (error) throw error;
  return mapPrepayment(data);
}

export async function createTransaction(membership, input) {
  requireMembership(membership);
  const client = requireSupabase();
  const user = await getAuthenticatedUser();
  const row = {
    workspace_id: membership.workspaceId,
    prepayment_id: input.prepaymentId,
    amount: input.amount,
    transaction_date: input.transactionDate,
    status: "active",
    created_by: user.id,
  };
  const { data, error } = await client.from("transactions").insert(row).select(TRANSACTION_SELECT).single();
  if (error) throw error;
  return mapTransaction(data);
}

export async function cancelTransaction(membership, transactionId) {
  return setTransactionStatus(membership, transactionId, "cancelled");
}

export async function restoreTransaction(membership, transactionId) {
  return setTransactionStatus(membership, transactionId, "active");
}

export async function createCard(membership, input) {
  requireAdmin(membership);
  const client = requireSupabase();
  const row = {
    workspace_id: membership.workspaceId,
    name: input.name,
    first4: input.first4,
    last4: input.last4,
    color: input.color || "#6b7280",
    active: input.active !== false,
  };
  const { data, error } = await client.from("cards").insert(row).select(CARD_SELECT).single();
  if (error) throw error;
  return mapCard(data);
}

export async function updateCard(membership, cardId, input) {
  requireAdmin(membership);
  const client = requireSupabase();
  const row = {
    name: input.name,
    first4: input.first4,
    last4: input.last4,
    color: input.color || "#6b7280",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("cards")
    .update(row)
    .eq("workspace_id", membership.workspaceId)
    .eq("id", cardId)
    .select(CARD_SELECT)
    .single();

  if (error) throw error;
  return mapCard(data);
}

export async function setCardActiveStatus(membership, cardId, active) {
  requireAdmin(membership);
  const client = requireSupabase();
  const { data, error } = await client
    .from("cards")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("workspace_id", membership.workspaceId)
    .eq("id", cardId)
    .select(CARD_SELECT)
    .single();

  if (error) throw error;
  return mapCard(data);
}

export function subscribeToWorkspaceData(workspaceId, onChange) {
  if (!supabase || !workspaceId) return () => {};

  const channel = supabase
    .channel(`paynowbiz-workspace-${workspaceId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cards", filter: `workspace_id=eq.${workspaceId}` },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "prepayments", filter: `workspace_id=eq.${workspaceId}` },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "transactions", filter: `workspace_id=eq.${workspaceId}` },
      onChange,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

async function setTransactionStatus(membership, transactionId, status) {
  requireMembership(membership);
  const client = requireSupabase();
  const { data, error } = await client
    .from("transactions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("workspace_id", membership.workspaceId)
    .eq("id", transactionId)
    .select(TRANSACTION_SELECT)
    .single();

  if (error) throw error;
  return mapTransaction(data);
}

async function getAuthenticatedUser() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("로그인이 필요합니다.");
  return data.user;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase URL과 publishable key를 먼저 설정해야 합니다.");
  }
  return supabase;
}

function requireMembership(membership) {
  if (!membership?.workspaceId) {
    throw new Error("워크스페이스 멤버십이 필요합니다.");
  }
}

function requireAdmin(membership) {
  requireMembership(membership);
  if (membership.role !== "admin") {
    throw new Error("관리자 권한이 필요합니다.");
  }
}

async function ensureNoRecentApprovalDuplicate(client, workspaceId, approvalNumber) {
  const recentSince = getRecentApprovalDuplicateCutoff();
  const { data, error } = await client
    .from("prepayments")
    .select("approval_number, approval_date, approval_amount, card_name_snapshot, card_first4_snapshot, card_last4_snapshot, status")
    .eq("workspace_id", workspaceId)
    .eq("approval_number", approvalNumber)
    .gte("approval_date", recentSince)
    .order("approval_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  const duplicate = data?.[0];
  if (!duplicate) return;

  const cardLabel = `${duplicate.card_name_snapshot} ${duplicate.card_first4_snapshot}-${duplicate.card_last4_snapshot}`;
  const amount = Number(duplicate.approval_amount).toLocaleString("ko-KR");
  throw new Error(
    `최근 12개월 안에 같은 승인번호가 이미 있습니다. 기존 내역: ${cardLabel}, ${duplicate.approval_date}, ${amount}원${
      duplicate.status === "cancelled" ? " (등록 취소됨)" : ""
    }`,
  );
}

function throwIfError(error) {
  if (error) throw error;
}

async function loadTransactionsForPrepayments(workspaceId, prepaymentIds) {
  const ids = [...new Set(prepaymentIds.filter(Boolean))];
  if (!ids.length) return [];

  const client = requireSupabase();
  const { data, error } = await client
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .eq("workspace_id", workspaceId)
    .in("prepayment_id", ids)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapTransaction);
}

function mapCard(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    first4: row.first4,
    last4: row.last4,
    color: row.color,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrepayment(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    cardId: row.card_id,
    cardType: row.card_type,
    cardNameSnapshot: row.card_name_snapshot,
    cardFirst4Snapshot: row.card_first4_snapshot,
    cardLast4Snapshot: row.card_last4_snapshot,
    cardColorSnapshot: row.card_color_snapshot,
    unregisteredCardMemo: row.unregistered_card_memo ?? "",
    approvalNumber: row.approval_number,
    approvalDate: row.approval_date,
    approvalAmount: Number(row.approval_amount),
    memo: row.memo ?? "",
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at ?? row.updated_at ?? row.created_at,
  };
}

function mapTransaction(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    prepaymentId: row.prepayment_id,
    amount: Number(row.amount),
    transactionDate: row.transaction_date,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRecentCutoffIso() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RECENT_COMPLETED_MONTHS);
  return cutoff.toISOString();
}

function getRecentApprovalDuplicateCutoff() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RECENT_APPROVAL_DUPLICATE_MONTHS);
  return cutoff.toISOString().slice(0, 10);
}
