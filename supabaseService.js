import { getOAuthRedirectUrl, isSupabaseConfigured, supabase } from "./supabaseClient.js";

export { isSupabaseConfigured };

const CARD_SELECT = "id, workspace_id, name, first4, last4, color, active, created_at, updated_at";
const PREPAYMENT_SELECT =
  "id, workspace_id, card_id, card_type, card_name_snapshot, card_first4_snapshot, card_last4_snapshot, card_color_snapshot, unregistered_card_memo, approval_number, approval_date, approval_amount, memo, status, created_by, created_at, updated_at, last_activity_at";
const TRANSACTION_SELECT =
  "id, workspace_id, prepayment_id, amount, transaction_date, status, created_by, created_at, updated_at";
const RECENT_COMPLETED_MONTHS = 12;

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
    .select("workspace_id, role, created_at, workspace:workspaces(id, name, created_at)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    workspaceId: data.workspace_id,
    role: data.role,
    createdAt: data.created_at,
    workspace: data.workspace
      ? {
          id: data.workspace.id,
          name: data.workspace.name,
          createdAt: data.workspace.created_at,
        }
      : null,
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

export async function importLegacyData(membership, legacyData) {
  requireAdmin(membership);
  const client = requireSupabase();
  const user = await getAuthenticatedUser();
  const legacyCards = normalizeLegacyCards(legacyData.cards);
  const legacyPrepayments = normalizeLegacyPrepayments(legacyData.prepayments);
  const legacyTransactions = normalizeLegacyTransactions(legacyData.transactions);
  applyLegacyActivityDates(legacyPrepayments, legacyTransactions);

  const approvalNumbers = legacyPrepayments.map((item) => item.approvalNumber);
  const uniqueApprovalNumbers = new Set(approvalNumbers);
  if (uniqueApprovalNumbers.size !== approvalNumbers.length) {
    throw new Error("기존 localStorage 데이터 안에 중복 승인번호가 있습니다.");
  }

  if (approvalNumbers.length) {
    const { data: duplicates, error } = await client
      .from("prepayments")
      .select("approval_number")
      .eq("workspace_id", membership.workspaceId)
      .in("approval_number", approvalNumbers);

    if (error) throw error;
    if ((duplicates ?? []).length) {
      throw new Error("이미 Supabase에 있는 승인번호가 있어 가져오기를 중단했습니다.");
    }
  }

  const cardIdMap = new Map();
  for (const card of legacyCards) {
    const row = withLegacyTimestamps(
      {
        workspace_id: membership.workspaceId,
        name: card.name,
        first4: card.first4,
        last4: card.last4,
        color: card.color,
        active: card.active,
      },
      card,
    );
    const { data, error } = await client.from("cards").insert(row).select("id").single();
    if (error) throw error;
    cardIdMap.set(card.legacyId, data.id);
  }

  const prepaymentIdMap = new Map();
  for (const prepayment of legacyPrepayments) {
    const row = withLegacyTimestamps(
      {
        workspace_id: membership.workspaceId,
        card_id: prepayment.cardId ? cardIdMap.get(prepayment.cardId) ?? null : null,
        card_type: prepayment.cardType,
        card_name_snapshot: prepayment.cardNameSnapshot,
        card_first4_snapshot: prepayment.cardFirst4Snapshot,
        card_last4_snapshot: prepayment.cardLast4Snapshot,
        card_color_snapshot: prepayment.cardColorSnapshot,
        unregistered_card_memo: prepayment.unregisteredCardMemo || null,
        approval_number: prepayment.approvalNumber,
        approval_date: prepayment.approvalDate,
        approval_amount: prepayment.approvalAmount,
        memo: prepayment.memo || null,
        status: prepayment.status,
        created_by: user.id,
        last_activity_at: prepayment.lastActivityAt,
      },
      prepayment,
    );
    const { data, error } = await client.from("prepayments").insert(row).select("id").single();
    if (error) throw error;
    prepaymentIdMap.set(prepayment.legacyId, data.id);
  }

  for (const transaction of legacyTransactions) {
    const prepaymentId = prepaymentIdMap.get(transaction.prepaymentId);
    if (!prepaymentId) {
      throw new Error("연결된 선결제 기록이 없는 거래가 있어 가져오기를 중단했습니다.");
    }

    const row = withLegacyTimestamps(
      {
        workspace_id: membership.workspaceId,
        prepayment_id: prepaymentId,
        amount: transaction.amount,
        transaction_date: transaction.transactionDate,
        status: transaction.status,
        created_by: user.id,
      },
      transaction,
    );
    const { error } = await client.from("transactions").insert(row);
    if (error) throw error;
  }

  for (const prepayment of legacyPrepayments) {
    const importedId = prepaymentIdMap.get(prepayment.legacyId);
    if (!importedId) continue;

    const { error } = await client
      .from("prepayments")
      .update({ last_activity_at: prepayment.lastActivityAt })
      .eq("workspace_id", membership.workspaceId)
      .eq("id", importedId);

    if (error) throw error;
  }

  return {
    cards: legacyCards.length,
    prepayments: legacyPrepayments.length,
    transactions: legacyTransactions.length,
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

function normalizeLegacyCards(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => {
    const first4 = onlyDigits(card.first4).slice(0, 4);
    const last4 = onlyDigits(card.last4).slice(0, 4);
    if (!isFourDigits(first4) || !isFourDigits(last4)) {
      throw new Error("기존 카드 데이터에 올바르지 않은 카드 번호가 있습니다.");
    }

    return {
      legacyId: String(card.id || crypto.randomUUID()),
      name: String(card.name || "카드"),
      first4,
      last4,
      color: safeAccentColor(card.color),
      active: card.active !== false,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  });
}

function normalizeLegacyPrepayments(prepayments) {
  if (!Array.isArray(prepayments)) return [];
  return prepayments.map((prepayment) => {
    const approvalAmount = Number(prepayment.approvalAmount);
    const first4 = onlyDigits(prepayment.cardFirst4Snapshot).slice(0, 4);
    const last4 = onlyDigits(prepayment.cardLast4Snapshot).slice(0, 4);

    if (!prepayment.approvalNumber || !prepayment.approvalDate || !Number.isSafeInteger(approvalAmount) || approvalAmount <= 0) {
      throw new Error("기존 선결제 데이터에 승인번호, 승인일, 금액이 빠진 기록이 있습니다.");
    }

    if (!isFourDigits(first4) || !isFourDigits(last4)) {
      throw new Error("기존 선결제 데이터에 올바르지 않은 카드 번호가 있습니다.");
    }

    return {
      legacyId: String(prepayment.id || crypto.randomUUID()),
      cardId: prepayment.cardId ? String(prepayment.cardId) : null,
      cardType: prepayment.cardType === "unregistered" ? "unregistered" : "registered",
      cardNameSnapshot: String(prepayment.cardNameSnapshot || "카드"),
      cardFirst4Snapshot: first4,
      cardLast4Snapshot: last4,
      cardColorSnapshot: safeAccentColor(prepayment.cardColorSnapshot),
      unregisteredCardMemo: String(prepayment.unregisteredCardMemo || ""),
      approvalNumber: String(prepayment.approvalNumber),
      approvalDate: String(prepayment.approvalDate),
      approvalAmount,
      memo: String(prepayment.memo || ""),
      status: prepayment.status === "cancelled" ? "cancelled" : "active",
      createdAt: prepayment.createdAt,
      updatedAt: prepayment.updatedAt,
    };
  });
}

function normalizeLegacyTransactions(transactions) {
  if (!Array.isArray(transactions)) return [];
  return transactions.map((transaction) => {
    const amount = Number(transaction.amount);
    if (!transaction.prepaymentId || !Number.isSafeInteger(amount) || amount <= 0 || !transaction.transactionDate) {
      throw new Error("기존 거래 데이터에 선결제 연결, 금액, 날짜가 빠진 기록이 있습니다.");
    }

    return {
      legacyId: String(transaction.id || crypto.randomUUID()),
      prepaymentId: String(transaction.prepaymentId),
      amount,
      transactionDate: String(transaction.transactionDate),
      status: transaction.status === "cancelled" ? "cancelled" : "active",
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  });
}

function withLegacyTimestamps(row, legacyItem) {
  if (isValidDateTime(legacyItem.createdAt)) row.created_at = legacyItem.createdAt;
  if (isValidDateTime(legacyItem.updatedAt)) row.updated_at = legacyItem.updatedAt;
  return row;
}

function applyLegacyActivityDates(prepayments, transactions) {
  const latestTransactionByPrepayment = new Map();

  transactions.forEach((transaction) => {
    const current = latestTransactionByPrepayment.get(transaction.prepaymentId);
    const candidate = latestIso(transaction.updatedAt, transaction.createdAt);
    if (!candidate) return;
    if (!current || Date.parse(candidate) > Date.parse(current)) {
      latestTransactionByPrepayment.set(transaction.prepaymentId, candidate);
    }
  });

  prepayments.forEach((prepayment) => {
    prepayment.lastActivityAt =
      latestIso(
        latestTransactionByPrepayment.get(prepayment.legacyId),
        prepayment.updatedAt,
        prepayment.createdAt,
        new Date().toISOString(),
      ) ?? new Date().toISOString();
  });
}

function latestIso(...values) {
  const dates = values
    .filter(isValidDateTime)
    .map((value) => new Date(value).toISOString())
    .sort();
  return dates.at(-1) ?? null;
}

function getRecentCutoffIso() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RECENT_COMPLETED_MONTHS);
  return cutoff.toISOString();
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isFourDigits(value) {
  return /^\d{4}$/.test(value);
}

function safeAccentColor(value) {
  const color = String(value || "");
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) return color;
  return "#6b7280";
}

function isValidDateTime(value) {
  if (!value) return false;
  return !Number.isNaN(Date.parse(value));
}
