import {
  canUseAuthStorage,
  cancelPrepayment as cancelPrepaymentRecord,
  cancelTransaction,
  createCard,
  createPrepayment as createPrepaymentRecord,
  createTransaction,
  getCurrentMembership,
  getCurrentSession,
  isSupabaseConfigured,
  loadArchiveYear,
  loadArchiveYears,
  loadBackupData,
  loadCancelledPrepayments,
  loadWorkspaceData,
  onAuthStateChange,
  restorePrepayment as restorePrepaymentRecord,
  restoreTransaction,
  searchPrepayments,
  setCardActiveStatus,
  signInWithGoogle,
  signOut,
  subscribeToWorkspaceData,
  updateCard,
  updatePrepaymentMemo,
} from "./supabaseService.js";

const UNREGISTERED_VALUE = "__unregistered__";
const DEFAULT_UNREGISTERED_COLOR = "#8a8a8a";
const SLOW_REQUEST_MS = 4000;
const AUTH_TIMEOUT_MS = 20000;
const AUTH_STALLED_RELOAD_MS = 8000;
const AUTH_AUTO_RELOAD_KEY = "paynowbiz-auth-auto-reload";
const AUTH_STORAGE_KEY = "paynowbiz-auth";
const MEMBERSHIP_CACHE_KEY = "paynowbiz-membership";
const ADMIN_CANCELLED_PAGE_SIZE = 20;

const state = {
  user: null,
  membership: null,
  data: createEmptyData(),
  adminCancelledPrepayments: [],
  adminCardStatus: "",
  adminTab: "cards",
  adminOpenCardId: null,
  adminOpenCancelledId: null,
  adminCancelledVisibleCount: ADMIN_CANCELLED_PAGE_SIZE,
  openPrepaymentId: null,
  completedOpen: false,
  archiveOpen: false,
  archiveExpandedYear: null,
  archiveYears: [],
  archiveDataByYear: new Map(),
  archiveLoading: false,
  searchQuery: "",
  searchResults: createEmptyData(),
  searchLoading: false,
  searchTimer: null,
  pendingCancelPrepaymentId: null,
  pendingMemoPrepaymentId: null,
  cancelledTransactionVisibleIds: new Set(),
  saving: false,
  realtimeUnsubscribe: null,
  realtimeRefreshTimer: null,
  authRestorePromise: null,
  authInitUserId: null,
  authInitPromise: null,
};

const moneyFormat = new Intl.NumberFormat("ko-KR");

const els = {
  authScreen: document.querySelector("#authScreen"),
  authMessage: document.querySelector("#authMessage"),
  googleLoginButton: document.querySelector("#googleLoginButton"),
  authLogoutButton: document.querySelector("#authLogoutButton"),
  setupScreen: document.querySelector("#setupScreen"),
  setupMessage: document.querySelector("#setupMessage"),
  setupLogoutButton: document.querySelector("#setupLogoutButton"),
  appShell: document.querySelector("#appShell"),
  mainView: document.querySelector("#mainView"),
  userInfo: document.querySelector("#userInfo"),
  logoutButton: document.querySelector("#logoutButton"),
  adminButton: document.querySelector("#adminButton"),
  saveStatus: document.querySelector("#saveStatus"),
  activeList: document.querySelector("#activeList"),
  completedToggle: document.querySelector("#completedToggle"),
  completedSummary: document.querySelector("#completedSummary"),
  completedList: document.querySelector("#completedList"),
  searchInput: document.querySelector("#approvalSearchInput"),
  searchClearButton: document.querySelector("#approvalSearchClear"),
  searchSection: document.querySelector("#searchSection"),
  searchSummary: document.querySelector("#searchSummary"),
  searchList: document.querySelector("#searchList"),
  prepaymentForm: document.querySelector("#prepaymentForm"),
  prepaymentSubmit: document.querySelector("#prepaymentSubmit"),
  cardSelect: document.querySelector("#cardSelect"),
  registeredCardPreview: document.querySelector("#registeredCardPreview"),
  unregisteredFields: document.querySelector("#unregisteredFields"),
  unregisteredFirst4: document.querySelector("#unregisteredFirst4"),
  unregisteredLast4: document.querySelector("#unregisteredLast4"),
  unregisteredMemo: document.querySelector("#unregisteredMemo"),
  approvalNumber: document.querySelector("#approvalNumber"),
  approvalDate: document.querySelector("#approvalDate"),
  approvalDateDisplay: document.querySelector("#approvalDateDisplay"),
  approvalAmount: document.querySelector("#approvalAmount"),
  prepaymentMemo: document.querySelector("#prepaymentMemo"),
  balanceTemplate: document.querySelector("#balanceTemplate"),
  cancelDialog: document.querySelector("#cancelDialog"),
  cancelDialogBack: document.querySelector("#cancelDialogBack"),
  cancelDialogConfirm: document.querySelector("#cancelDialogConfirm"),
  memoDialog: document.querySelector("#memoDialog"),
  memoDialogForm: document.querySelector("#memoDialogForm"),
  memoDialogInput: document.querySelector("#memoDialogInput"),
  memoDialogBack: document.querySelector("#memoDialogBack"),
  memoDialogSave: document.querySelector("#memoDialogSave"),
  adminDialog: document.querySelector("#adminDialog"),
  adminCloseButton: document.querySelector("#adminCloseButton"),
  adminContent: document.querySelector("#adminContent"),
};

void init();

async function init() {
  bindEvents();
  els.approvalDate.value = todayInputValue();
  updateApprovalDateDisplay();

  if (!isSupabaseConfigured) {
    renderSignedOut("Supabase URL과 publishable key를 설정하면 Google 로그인을 사용할 수 있습니다.", false);
    return;
  }

  onAuthStateChange((event, session) => {
    logAuthDiagnostic("auth event", { event, session });

    if (event === "SIGNED_OUT") {
      resetSignedOutState();
      return;
    }

    if (!session?.user) return;

    scheduleAuthenticatedUserInit(session.user, event);
  });

  bindAuthLifecycleEvents();
  await restoreSession("startup");
}

function bindEvents() {
  els.googleLoginButton.addEventListener("click", () => {
    void handleGoogleLogin();
  });
  els.authLogoutButton.addEventListener("click", () => {
    void handleLogout();
  });
  els.logoutButton.addEventListener("click", () => {
    void handleLogout();
  });
  els.setupLogoutButton.addEventListener("click", () => {
    void handleLogout();
  });
  els.adminButton.addEventListener("click", openAdminDialog);
  els.adminCloseButton.addEventListener("click", closeAdminDialog);
  els.adminDialog.addEventListener("click", handleAdminClick);
  els.adminContent.addEventListener("submit", handleAdminSubmit);
  els.adminContent.addEventListener("submit", handleUsageSubmit);

  els.completedToggle.addEventListener("click", () => {
    state.completedOpen = !state.completedOpen;
    render();
  });

  els.searchInput.addEventListener("input", handleSearchInput);
  els.searchClearButton.addEventListener("click", clearSearch);

  els.cancelDialogBack.addEventListener("click", closeCancelDialog);
  els.cancelDialogConfirm.addEventListener("click", () => {
    void confirmCancelPrepayment();
  });
  els.cancelDialog.addEventListener("click", (event) => {
    if (event.target === els.cancelDialog) closeCancelDialog();
  });

  els.memoDialogBack.addEventListener("click", closeMemoDialog);
  els.memoDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePrepaymentMemo();
  });
  els.memoDialog.addEventListener("click", (event) => {
    if (event.target === els.memoDialog) closeMemoDialog();
  });

  els.cardSelect.addEventListener("change", updateCardFields);
  els.unregisteredFirst4.addEventListener("input", handleDigitsInput);
  els.unregisteredLast4.addEventListener("input", handleDigitsInput);
  els.unregisteredFirst4.addEventListener("input", updateCardFields);
  els.unregisteredLast4.addEventListener("input", updateCardFields);
  els.unregisteredMemo.addEventListener("input", updateCardFields);
  els.approvalDate.addEventListener("change", updateApprovalDateDisplay);
  els.approvalDate.addEventListener("input", updateApprovalDateDisplay);
  els.approvalAmount.addEventListener("input", handleAmountInput);

  els.prepaymentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addPrepayment();
  });

  els.activeList.addEventListener("click", handleBalanceListClick);
  els.completedList.addEventListener("click", handleBalanceListClick);
  els.searchList.addEventListener("click", handleBalanceListClick);
  els.activeList.addEventListener("submit", handleUsageSubmit);
  els.completedList.addEventListener("submit", handleUsageSubmit);
  els.searchList.addEventListener("submit", handleUsageSubmit);

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-usage-amount]")) {
      handleAmountInput(event);
    }
  });
}

function bindAuthLifecycleEvents() {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && !state.user) {
      void restoreSession("pageshow");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !state.user) {
      void restoreSession("visible");
    }
  });
}

function restoreSession(source = "startup") {
  if (state.authRestorePromise) {
    return state.authRestorePromise;
  }

  state.authRestorePromise = restoreSessionOnce(source).finally(() => {
    state.authRestorePromise = null;
  });

  return state.authRestorePromise;
}

async function restoreSessionOnce(source) {
  if (!canUseAuthStorage()) {
    renderSignedOut("이 브라우저에서 로그인 저장소를 사용할 수 없습니다. 사이트 데이터/개인정보 보호 설정을 확인해주세요.", true);
    return;
  }

  renderSignedOut("로그인 상태를 확인하는 중입니다.", false);
  let reloadTimer = null;
  const slowTimer = window.setTimeout(() => {
    renderSignedOut("로그인 확인이 조금 오래 걸리고 있습니다. 자동으로 새로고침합니다.", false);
    reloadTimer = window.setTimeout(() => {
      if (!state.user && hasStoredAuthKeySafely()) {
        tryAuthAutoReload();
      }
    }, AUTH_STALLED_RELOAD_MS - SLOW_REQUEST_MS);
  }, SLOW_REQUEST_MS);

  try {
    const authResult = await withTimeout(
      getCurrentSession(),
      AUTH_TIMEOUT_MS,
      "로그인 상태 확인 시간이 초과되었습니다.",
    );
    const { session, user } = authResult;
    logAuthDiagnostic("auth bootstrap", { event: source, session, user });

    if (!user) {
      clearAuthAutoReloadFlag();
      resetSignedOutState(getMissingStoredSessionMessage());
      return;
    }

    clearAuthAutoReloadFlag();
    await initAuthenticatedUser(user, source);
  } catch (error) {
    logAuthDiagnostic("auth bootstrap error", { error });

    if (hasStoredAuthKeySafely() && tryAuthAutoReload()) {
      renderSignedOut("로그인 연결을 다시 시작합니다.", false);
      return;
    }

    renderSignedOut(`${getErrorMessage(error)} Google로 다시 로그인해주세요.`, true);
  } finally {
    window.clearTimeout(slowTimer);
    window.clearTimeout(reloadTimer);
  }
}

function hasStoredAuthKeySafely() {
  try {
    return hasStoredAuthKey();
  } catch {
    return false;
  }
}

function tryAuthAutoReload() {
  try {
    if (window.sessionStorage.getItem(AUTH_AUTO_RELOAD_KEY) === "1") {
      return false;
    }

    window.sessionStorage.setItem(AUTH_AUTO_RELOAD_KEY, "1");
    window.setTimeout(() => {
      window.location.reload();
    }, 250);
    return true;
  } catch {
    return false;
  }
}

function clearAuthAutoReloadFlag() {
  try {
    window.sessionStorage.removeItem(AUTH_AUTO_RELOAD_KEY);
  } catch {
    // sessionStorage를 사용할 수 없어도 앱 실행에는 영향이 없습니다.
  }
}

function getMissingStoredSessionMessage() {
  try {
    const hasAnySupabaseAuthKey = hasStoredAuthKey();
    if (!hasAnySupabaseAuthKey) {
      return "저장된 로그인 정보가 없습니다. Google로 다시 로그인해주세요.";
    }
  } catch {
    return "로그인 정보를 읽을 수 없습니다. 사이트 데이터/개인정보 보호 설정을 확인해주세요.";
  }

  return "로그인 세션을 복원하지 못했습니다. Google로 다시 로그인해주세요.";
}

function hasStoredAuthKey() {
  return Object.keys(window.localStorage).some((key) => key === AUTH_STORAGE_KEY || key.includes("auth-token") || key.includes(AUTH_STORAGE_KEY));
}

function logAuthDiagnostic(label, context = {}) {
  const session = context.session ?? null;
  const user = context.user ?? session?.user ?? null;
  const details = {
    event: context.event ?? null,
    hasSession: Boolean(session),
    userId: user?.id ?? state.user?.id ?? null,
    storedAuthKeyExists: false,
  };

  try {
    details.storedAuthKeyExists = hasStoredAuthKey();
  } catch (error) {
    details.storageReadError = getErrorMessage(error);
  }

  if ("membership" in context) {
    details.membershipFound = Boolean(context.membership);
    details.membershipRole = context.membership?.role ?? null;
  }

  if (context.error) {
    details.error = getErrorMessage(context.error);
  }

  console.debug(`[PayNowBiz auth] ${label}`, details);
}

function clearOAuthCallbackFromUrl() {
  const url = new URL(window.location.href);
  let changed = false;

  ["code", "state", "error", "error_code", "error_description"].forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });

  if (url.hash) {
    const hash = url.hash.slice(1);
    const authHashKeys = [
      "access_token",
      "expires_at",
      "expires_in",
      "provider_refresh_token",
      "provider_token",
      "refresh_token",
      "token_type",
      "type",
    ];
    const hasAuthHash = authHashKeys.some((key) => hash.includes(`${key}=`));
    if (hasAuthHash) {
      url.hash = "";
      changed = true;
    }
  }

  if (changed) {
    window.history.replaceState({}, document.title, url.toString());
  }
}

function scheduleAuthenticatedUserInit(user, source) {
  window.setTimeout(() => {
    void initAuthenticatedUser(user, source);
  }, 0);
}

function initAuthenticatedUser(user, source) {
  if (!user?.id) return Promise.resolve();

  if (state.user?.id === user.id && state.membership) {
    logAuthDiagnostic("auth init skipped", { event: source, user });
    clearOAuthCallbackFromUrl();
    return Promise.resolve();
  }

  if (state.authInitPromise && state.authInitUserId === user.id) {
    logAuthDiagnostic("auth init joined", { event: source, user });
    return state.authInitPromise;
  }

  logAuthDiagnostic("auth init start", { event: source, user });
  state.authInitUserId = user.id;
  state.authInitPromise = loadForUser(user).finally(() => {
    state.authInitUserId = null;
    state.authInitPromise = null;
  });

  return state.authInitPromise;
}

async function loadForUser(user) {
  state.user = user;
  clearOAuthCallbackFromUrl();
  const cachedMembership = readCachedMembership(user);
  let openedFromCache = false;
  let slowTimer = null;

  if (cachedMembership) {
    openedFromCache = true;
    state.membership = cachedMembership;
    showAppShell();
    setupRealtime();
    void refreshWorkspaceData("", { silent: true }).catch((error) => {
      logAuthDiagnostic("cached workspace refresh error", { user, error });
      showStatus(getErrorMessage(error));
    });
  } else {
    renderSignedOut("워크스페이스 권한을 확인하는 중입니다.", false, { canLogout: true });
    slowTimer = window.setTimeout(() => {
      renderSignedOut("워크스페이스 권한 확인이 조금 오래 걸리고 있습니다. Supabase 응답을 기다리는 중입니다.", false, {
        canLogout: true,
      });
    }, SLOW_REQUEST_MS);
  }

  try {
    logAuthDiagnostic("membership request start", { user });
    const membership = await withTimeout(
      getCurrentMembership(user),
      AUTH_TIMEOUT_MS,
      "워크스페이스 권한 확인 시간이 초과되었습니다. 새로고침 후 다시 로그인해주세요.",
    );
    logAuthDiagnostic("membership request success", { user, membership });
    if (state.user?.id !== user.id) return;
    if (!membership) {
      state.membership = null;
      state.data = createEmptyData();
      clearCachedMembership();
      showSetupMessage();
      return;
    }

    state.membership = membership;
    writeCachedMembership(user, membership);
    showAppShell();
    setupRealtime();
    await refreshWorkspaceData(openedFromCache ? "" : "Loading", { silent: true });
  } catch (error) {
    logAuthDiagnostic("membership request error", { user, error });
    if (state.user?.id !== user.id) return;
    if (openedFromCache) {
      showStatus("저장된 권한으로 앱을 열었습니다. 권한 확인은 다음 실행 때 다시 시도합니다.");
      return;
    }
    renderSignedOut(getErrorMessage(error), true);
  } finally {
    if (slowTimer) {
      window.clearTimeout(slowTimer);
    }
  }
}

function readCachedMembership(user) {
  try {
    const rawValue = window.localStorage.getItem(MEMBERSHIP_CACHE_KEY);
    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue);
    const membership = parsed?.membership;
    if (parsed?.userId !== user.id || !isCachedMembership(membership)) {
      return null;
    }

    return {
      workspaceId: membership.workspaceId,
      role: membership.role,
      createdAt: membership.createdAt,
      workspace: membership.workspace,
      user,
    };
  } catch {
    return null;
  }
}

function writeCachedMembership(user, membership) {
  try {
    window.localStorage.setItem(
      MEMBERSHIP_CACHE_KEY,
      JSON.stringify({
        userId: user.id,
        membership: {
          workspaceId: membership.workspaceId,
          role: membership.role,
          createdAt: membership.createdAt,
          workspace: membership.workspace,
        },
      }),
    );
  } catch {
    // 권한 캐시는 편의 기능이므로 저장에 실패해도 앱 실행을 막지 않습니다.
  }
}

function clearCachedMembership() {
  try {
    window.localStorage.removeItem(MEMBERSHIP_CACHE_KEY);
  } catch {
    // localStorage를 사용할 수 없는 환경에서는 지울 캐시도 없습니다.
  }
}

function isCachedMembership(membership) {
  return (
    membership &&
    typeof membership.workspaceId === "string" &&
    typeof membership.role === "string" &&
    "createdAt" in membership &&
    "workspace" in membership
  );
}

function resetSignedOutState(message = "선결제 잔액을 불러오려면 Google 계정으로 로그인하세요.") {
  teardownRealtime();
  clearCachedMembership();
  state.authRestorePromise = null;
  state.authInitUserId = null;
  state.authInitPromise = null;
  state.user = null;
  state.membership = null;
  state.data = createEmptyData();
  state.adminCancelledPrepayments = [];
  state.adminCardStatus = "";
  state.adminTab = "cards";
  state.adminOpenCardId = null;
  state.adminOpenCancelledId = null;
  state.adminCancelledVisibleCount = ADMIN_CANCELLED_PAGE_SIZE;
  state.openPrepaymentId = null;
  state.completedOpen = false;
  state.archiveOpen = false;
  state.archiveExpandedYear = null;
  state.archiveYears = [];
  state.archiveDataByYear = new Map();
  state.archiveLoading = false;
  state.searchQuery = "";
  state.searchResults = createEmptyData();
  state.searchLoading = false;
  state.pendingCancelPrepaymentId = null;
  state.pendingMemoPrepaymentId = null;
  els.cancelDialog.hidden = true;
  els.memoDialog.hidden = true;
  window.clearTimeout(state.searchTimer);
  renderSignedOut(message, true);
}

function renderSignedOut(message, canLogin, options = {}) {
  els.authScreen.hidden = false;
  els.setupScreen.hidden = true;
  els.appShell.hidden = true;
  els.adminDialog.hidden = true;
  els.mainView.hidden = false;
  els.authMessage.textContent = message;
  els.googleLoginButton.hidden = !canLogin;
  els.googleLoginButton.disabled = !canLogin;
  els.authLogoutButton.hidden = !options.canLogout;
  els.authLogoutButton.disabled = !options.canLogout;
}

function showSetupMessage() {
  teardownRealtime();
  els.authScreen.hidden = true;
  els.setupScreen.hidden = false;
  els.appShell.hidden = true;
  els.adminDialog.hidden = true;
  els.mainView.hidden = false;
  els.setupMessage.textContent = "이 계정은 아직 PayNowBiz Tracker에 등록되지 않았습니다.";
}

function showAppShell() {
  els.authScreen.hidden = true;
  els.setupScreen.hidden = true;
  els.appShell.hidden = false;
  if (els.adminDialog.hidden) {
    els.mainView.hidden = false;
  }
  els.userInfo.textContent = `${state.user?.email ?? ""} · ${state.membership?.role === "admin" ? "관리자" : "멤버"}`;
  els.adminButton.hidden = !isAdmin();
}

function setupRealtime() {
  teardownRealtime();
  if (!state.membership?.workspaceId) return;

  state.realtimeUnsubscribe = subscribeToWorkspaceData(state.membership.workspaceId, () => {
    window.clearTimeout(state.realtimeRefreshTimer);
    state.realtimeRefreshTimer = window.setTimeout(() => {
      void refreshWorkspaceData("", { silent: true });
    }, 300);
  });
}

function teardownRealtime() {
  window.clearTimeout(state.realtimeRefreshTimer);
  if (state.realtimeUnsubscribe) {
    state.realtimeUnsubscribe();
    state.realtimeUnsubscribe = null;
  }
}

async function refreshWorkspaceData(message = "", options = {}) {
  if (!state.membership?.workspaceId) return;
  if (!options.silent) showStatus("불러오는 중...");

  const data = await loadWorkspaceData(state.membership.workspaceId);
  state.data = data;
  renderCardOptions();
  if (isAdmin()) {
    await refreshAdminCancelled();
  }
  if (state.archiveOpen) {
    await refreshArchiveYears();
    if (state.archiveExpandedYear) {
      await loadArchiveYearIntoState(state.archiveExpandedYear, { force: true });
    }
  }
  if (state.searchQuery) {
    await performSearch({ silent: true });
  }
  render();
  renderAdmin();
  if (message) showStatus(message);
}

async function handleGoogleLogin() {
  if (state.saving) return;
  setSaving(true);
  try {
    await signInWithGoogle();
  } catch (error) {
    renderSignedOut(getErrorMessage(error), true);
  } finally {
    setSaving(false);
  }
}

async function handleLogout() {
  try {
    await signOut();
  } catch (error) {
    showStatus(getErrorMessage(error));
  }
}

function render() {
  if (!state.membership) return;
  const groups = getGroupedPrepayments();
  renderBalanceList(els.activeList, groups.active);
  renderCompleted(groups.completed);
  renderSearchResults();
  renderArchive();
  applyBusyState();
}

function getCardSortGroup(card) {
  const name = card.name.trim();

  if (name === "하나카드") return 0;
  if (name === "라온카드") return 1;
  if (name.startsWith("지영")) return 2;

  return 3;
}

function sortCards(a, b) {
  const groupDifference = getCardSortGroup(a) - getCardSortGroup(b);

  if (groupDifference !== 0) {
    return groupDifference;
  }

  return a.name.trim().localeCompare(b.name.trim(), "ko");
}

function getSortedCards(cards = state.data.cards) {
  return [...cards].sort(sortCards);
}

function renderCardOptions() {
  const activeCards = getSortedCards(state.data.cards.filter((card) => card.active));
  const currentValue = els.cardSelect.value;
  els.cardSelect.innerHTML = [
    ...activeCards.map((card) => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)}</option>`),
    `<option value="${UNREGISTERED_VALUE}">미등록 카드</option>`,
  ].join("");

  const availableValues = new Set([...activeCards.map((card) => card.id), UNREGISTERED_VALUE]);
  if (!availableValues.has(currentValue)) {
    els.cardSelect.value = activeCards[0]?.id ?? UNREGISTERED_VALUE;
  } else {
    els.cardSelect.value = currentValue;
  }

  updateCardFields();
}

function updateCardFields() {
  const selected = getSelectedCard();
  const isUnregistered = els.cardSelect.value === UNREGISTERED_VALUE;

  els.unregisteredFields.hidden = !isUnregistered;

  if (selected) {
    const cardNumber = maskCardNumber(selected.first4, selected.last4);
    els.registeredCardPreview.innerHTML = `<strong>${escapeHtml(selected.name)}</strong> ${escapeHtml(cardNumber)}`;
    return;
  }

  const first4 = onlyDigits(els.unregisteredFirst4.value).slice(0, 4);
  const last4 = onlyDigits(els.unregisteredLast4.value).slice(0, 4);
  const memo = els.unregisteredMemo.value.trim();
  els.registeredCardPreview.innerHTML = memo
    ? `<strong>${escapeHtml(memo)}</strong> 미등록 카드`
    : "카드 번호는 이 항목에만 기록됩니다";
}

async function addPrepayment() {
  const approvalNumber = els.approvalNumber.value.trim();
  const approvalDate = els.approvalDate.value;
  const approvalAmount = parsePositiveInteger(els.approvalAmount.value);
  const memo = els.prepaymentMemo.value.trim();
  const selected = getSelectedCard();

  if (!approvalNumber) {
    showStatus("승인번호 확인");
    els.approvalNumber.focus();
    return;
  }

  if (!approvalDate) {
    showStatus("승인일 확인");
    els.approvalDate.focus();
    return;
  }

  if (!approvalAmount) {
    showStatus("승인금액 확인");
    els.approvalAmount.focus();
    return;
  }

  let cardSnapshot;
  if (selected) {
    cardSnapshot = {
      cardId: selected.id,
      cardType: "registered",
      cardNameSnapshot: selected.name,
      cardFirst4Snapshot: selected.first4,
      cardLast4Snapshot: selected.last4,
      cardColorSnapshot: selected.color,
      unregisteredCardMemo: "",
    };
  } else {
    const first4 = onlyDigits(els.unregisteredFirst4.value);
    const last4 = onlyDigits(els.unregisteredLast4.value);
    if (!isFourDigits(first4)) {
      showStatus("앞 4자리 확인");
      els.unregisteredFirst4.focus();
      return;
    }
    if (!isFourDigits(last4)) {
      showStatus("뒤 4자리 확인");
      els.unregisteredLast4.focus();
      return;
    }
    cardSnapshot = {
      cardId: null,
      cardType: "unregistered",
      cardNameSnapshot: "미등록 카드",
      cardFirst4Snapshot: first4,
      cardLast4Snapshot: last4,
      cardColorSnapshot: DEFAULT_UNREGISTERED_COLOR,
      unregisteredCardMemo: els.unregisteredMemo.value.trim(),
    };
  }

  await runMutation(
    async () => {
      const prepayment = await createPrepaymentRecord(state.membership, {
        ...cardSnapshot,
        approvalNumber,
        approvalDate,
        approvalAmount,
        memo,
      });
      state.openPrepaymentId = prepayment.id;
      state.completedOpen = false;
      resetPrepaymentForm();
    },
    "저장됨",
    { alertOnError: true },
  );
}

function handleBalanceListClick(event) {
  const toggle = event.target.closest("[data-balance-toggle]");
  if (toggle) {
    const id = toggle.dataset.balanceToggle;
    state.openPrepaymentId = state.openPrepaymentId === id ? null : id;
    renderBalanceViews();
    return;
  }

  const prepaymentAction = event.target.closest("[data-prepayment-action]");
  if (prepaymentAction) {
    const id = prepaymentAction.dataset.prepaymentId;
    if (prepaymentAction.dataset.prepaymentAction === "editMemo") {
      openMemoDialog(id);
      return;
    }
    if (prepaymentAction.dataset.prepaymentAction === "requestCancel") {
      openCancelDialog(id);
      return;
    }
  }

  const cancelledToggle = event.target.closest("[data-cancelled-transactions-toggle]");
  if (cancelledToggle) {
    const prepaymentId = cancelledToggle.dataset.cancelledTransactionsToggle;
    if (state.cancelledTransactionVisibleIds.has(prepaymentId)) {
      state.cancelledTransactionVisibleIds.delete(prepaymentId);
    } else {
      state.cancelledTransactionVisibleIds.add(prepaymentId);
    }
    renderBalanceViews();
    return;
  }

  const action = event.target.closest("[data-transaction-action]");
  if (!action) return;

  void setTransactionStatus(action.dataset.transactionId, action.dataset.transactionAction);
}

function renderBalanceViews() {
  render();
  if (!els.adminDialog.hidden && state.adminTab === "archive") {
    renderAdmin();
  }
}

function handleUsageSubmit(event) {
  event.preventDefault();
  const form = event.target.closest("[data-usage-form]");
  if (!form || state.saving) return;

  const prepayment = findPrepayment(form.dataset.prepaymentId);
  const amountInput = form.querySelector("[data-usage-amount]");
  const amount = parsePositiveInteger(amountInput.value);
  if (!prepayment || !amount) {
    showStatus("사용금액 확인");
    amountInput.focus();
    return;
  }

  const remaining = getRemaining(prepayment.id);
  if (amount > remaining) {
    const ok = window.confirm(`현재 남은 금액은 ${formatMoney(remaining)}원입니다. 그래도 저장할까요?`);
    if (!ok) {
      amountInput.focus();
      return;
    }
  }

  void runMutation(async () => {
    await createTransaction(state.membership, {
      prepaymentId: prepayment.id,
      amount,
      transactionDate: todayInputValue(),
    });

    if (remaining - amount <= 0) {
      state.openPrepaymentId = null;
      state.completedOpen = false;
    } else {
      state.openPrepaymentId = prepayment.id;
    }
  }, remaining - amount <= 0 ? "완료됨" : "사용 저장됨");
}

async function setTransactionStatus(transactionId, action) {
  const transaction = getLoadedTransactions().find((item) => item.id === transactionId);
  if (!transaction) return;
  const prepayment = findPrepayment(transaction.prepaymentId);
  const currentRemaining = prepayment ? getRemaining(prepayment.id) : 0;
  const nextRemaining =
    action === "cancel"
      ? currentRemaining + transaction.amount
      : action === "restore"
        ? currentRemaining - transaction.amount
        : currentRemaining;

  await runMutation(async () => {
    if (action === "cancel" && transaction.status === "active") {
      await cancelTransaction(state.membership, transactionId);
    } else if (action === "restore" && transaction.status === "cancelled") {
      await restoreTransaction(state.membership, transactionId);
    } else {
      return;
    }

    if (prepayment && nextRemaining > 0) {
      state.openPrepaymentId = prepayment.id;
      state.completedOpen = false;
    }
  }, action === "cancel" ? "취소됨" : "복구됨");
}

function openMemoDialog(prepaymentId) {
  const prepayment = findPrepayment(prepaymentId);
  if (!prepayment) return;

  state.pendingMemoPrepaymentId = prepaymentId;
  els.memoDialogInput.value = prepayment.memo ?? "";
  els.memoDialog.hidden = false;
  window.setTimeout(() => {
    els.memoDialogInput.focus();
    els.memoDialogInput.select();
  }, 0);
}

function closeMemoDialog() {
  state.pendingMemoPrepaymentId = null;
  els.memoDialogInput.value = "";
  els.memoDialog.hidden = true;
}

async function savePrepaymentMemo() {
  const prepaymentId = state.pendingMemoPrepaymentId;
  if (!prepaymentId || state.saving) return;

  const memo = els.memoDialogInput.value.trim();
  await runMutation(async () => {
    await updatePrepaymentMemo(state.membership, prepaymentId, memo);
    state.openPrepaymentId = prepaymentId;
    closeMemoDialog();
  }, memo ? "실사용자 수정됨" : "실사용자 삭제됨");
}

function openCancelDialog(prepaymentId) {
  state.pendingCancelPrepaymentId = prepaymentId;
  els.cancelDialog.hidden = false;
}

function closeCancelDialog() {
  state.pendingCancelPrepaymentId = null;
  els.cancelDialog.hidden = true;
}

async function confirmCancelPrepayment() {
  const id = state.pendingCancelPrepaymentId;
  closeCancelDialog();
  if (!id) return;
  await cancelPrepaymentRegistration(id);
}

async function cancelPrepaymentRegistration(prepaymentId) {
  const prepayment = findPrepayment(prepaymentId);
  if (!prepayment) return;

  await runMutation(async () => {
    await cancelPrepaymentRecord(state.membership, prepaymentId);
    state.openPrepaymentId = null;
  }, "등록 취소됨");
}

async function restorePrepaymentRegistration(prepaymentId) {
  if (!isAdmin()) return;

  await runMutation(async () => {
    const prepayment = await restorePrepaymentRecord(state.membership, prepaymentId);
    state.openPrepaymentId = prepayment.id;
    state.adminOpenCancelledId = null;
  }, "등록 복구됨");
}

function renderCompleted(completed) {
  els.completedSummary.textContent = `${completed.length}건`;
  els.completedToggle.setAttribute("aria-expanded", String(state.completedOpen));
  els.completedToggle.querySelector(".toggle-mark").textContent = state.completedOpen ? "닫기" : "열기";
  els.completedList.hidden = !state.completedOpen;

  if (!state.completedOpen) {
    els.completedList.innerHTML = "";
    return;
  }

  renderBalanceList(els.completedList, completed, "완료된 잔액이 없습니다.");
}

function handleSearchInput() {
  state.searchQuery = els.searchInput.value.trim();
  window.clearTimeout(state.searchTimer);

  if (!state.searchQuery) {
    state.searchResults = createEmptyData();
    state.searchLoading = false;
    renderSearchResults();
    return;
  }

  state.searchLoading = true;
  renderSearchResults();
  state.searchTimer = window.setTimeout(() => {
    void performSearch();
  }, 350);
}

function clearSearch() {
  window.clearTimeout(state.searchTimer);
  state.searchQuery = "";
  state.searchResults = createEmptyData();
  state.searchLoading = false;
  els.searchInput.value = "";
  renderSearchResults();
}

async function performSearch(options = {}) {
  if (!state.membership || !state.searchQuery) return;
  const query = state.searchQuery;
  state.searchLoading = !options.silent;
  renderSearchResults();

  try {
    const results = await searchPrepayments(state.membership, query);
    if (query === state.searchQuery) {
      state.searchResults = results;
    }
  } catch (error) {
    if (query === state.searchQuery) {
      showStatus(getErrorMessage(error));
      state.searchResults = createEmptyData();
    }
  } finally {
    if (query === state.searchQuery) {
      state.searchLoading = false;
      renderSearchResults();
    }
  }
}

function renderSearchResults() {
  const hasQuery = Boolean(state.searchQuery);
  els.searchSection.hidden = !hasQuery;
  els.searchClearButton.hidden = !els.searchInput.value;

  if (!hasQuery) {
    els.searchSummary.textContent = "";
    els.searchList.innerHTML = "";
    return;
  }

  if (state.searchLoading) {
    els.searchSummary.textContent = "검색 중...";
    els.searchList.innerHTML = `<div class="empty-state">검색 중입니다.</div>`;
    return;
  }

  const count = state.searchResults.prepayments.length;
  els.searchSummary.textContent = `${count}건`;
  renderBalanceList(els.searchList, state.searchResults.prepayments, "검색 결과가 없습니다.");
}

async function refreshArchiveYears(options = {}) {
  if (!state.membership) return;
  state.archiveLoading = true;
  if (options.renderAfter) {
    renderAdmin();
  }
  try {
    state.archiveYears = await loadArchiveYears(state.membership);
  } catch (error) {
    showStatus(getErrorMessage(error));
    state.archiveYears = [];
  } finally {
    state.archiveLoading = false;
    if (options.renderAfter) {
      renderAdmin();
    }
  }
}

async function handleArchiveClick(event) {
  const yearButton = event.target.closest("[data-archive-year]");
  if (!yearButton) return;

  const year = Number(yearButton.dataset.archiveYear);
  state.archiveExpandedYear = state.archiveExpandedYear === year ? null : year;
  if (state.archiveExpandedYear) {
    await loadArchiveYearIntoState(year);
  }
  renderArchive();
}

async function loadArchiveYearIntoState(year, options = {}) {
  if (!state.membership) return;
  if (!options.force && state.archiveDataByYear.has(year)) return;

  state.archiveDataByYear.set(year, { loading: true, prepayments: [], transactions: [] });
  renderArchive();

  try {
    const data = await loadArchiveYear(state.membership, year);
    state.archiveDataByYear.set(year, { loading: false, ...data });
  } catch (error) {
    showStatus(getErrorMessage(error));
    state.archiveDataByYear.set(year, { loading: false, prepayments: [], transactions: [], error: getErrorMessage(error) });
  }
}

function renderArchive() {
  const archiveList = getArchiveListContainer();
  if (!archiveList) return;

  if (state.archiveLoading) {
    archiveList.innerHTML = `<div class="empty-state">이전 기록을 불러오는 중입니다.</div>`;
    return;
  }

  if (!state.archiveYears.length) {
    archiveList.innerHTML = `<div class="empty-state">이전 기록이 없습니다.</div>`;
    return;
  }

  archiveList.innerHTML = state.archiveYears
    .map((item) => {
      const expanded = state.archiveExpandedYear === item.year;
      return `
        <section class="archive-year-section">
          <button class="archive-year-toggle" type="button" data-archive-year="${item.year}" aria-expanded="${expanded}">
            <span>${item.year}년 기록 ${item.count}건</span>
            <span class="toggle-mark" aria-hidden="true">${expanded ? "닫기" : ">"}</span>
          </button>
          <div class="balance-list archive-year-list" data-archive-list-year="${item.year}" ${expanded ? "" : "hidden"}></div>
        </section>
      `;
    })
    .join("");

  if (!state.archiveExpandedYear) return;

  const container = archiveList.querySelector(`[data-archive-list-year="${state.archiveExpandedYear}"]`);
  const yearData = state.archiveDataByYear.get(state.archiveExpandedYear);
  if (!container) return;
  if (!yearData || yearData.loading) {
    container.innerHTML = `<div class="empty-state">불러오는 중입니다.</div>`;
    return;
  }
  if (yearData.error) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(yearData.error)}</div>`;
    return;
  }
  renderBalanceList(container, yearData.prepayments, "해당 연도 기록이 없습니다.");
}

function getArchiveListContainer() {
  if (els.adminDialog.hidden || state.adminTab !== "archive") return null;
  return els.adminContent.querySelector("[data-admin-archive-list]");
}

function renderBalanceList(container, prepayments, emptyMessage = "사용 중인 잔액이 없습니다.") {
  container.innerHTML = "";

  if (!prepayments.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  prepayments.forEach((prepayment) => {
    const node = els.balanceTemplate.content.firstElementChild.cloneNode(true);
    const isOpen = state.openPrepaymentId === prepayment.id;
    const remaining = getRemaining(prepayment.id);
    const used = getActiveUsed(prepayment.id);
    const displayStatus = getPrepaymentStatus(prepayment);
    const isCompleted = displayStatus === "completed";
    const statusText = displayStatus === "cancelled" ? "취소" : isCompleted ? "완료" : "사용중";

    node.classList.toggle("is-open", isOpen);
    node.querySelector(".accent").style.backgroundColor = prepayment.cardColorSnapshot || DEFAULT_UNREGISTERED_COLOR;
    node.querySelector(".balance-toggle").dataset.balanceToggle = prepayment.id;
    node.querySelector(".balance-toggle").setAttribute("aria-expanded", String(isOpen));
    node.querySelector(".top-card-name").innerHTML = renderCardNameBadge(prepayment);
    const topCardMemo = node.querySelector(".top-card-memo");
    topCardMemo.textContent = prepayment.memo?.trim() ?? "";
    topCardMemo.hidden = !topCardMemo.textContent;
    node.querySelector(".remaining-text").textContent = remainingText(remaining);
    node.querySelector(".status-badge").textContent = statusText;
    node.querySelector(".approval-number").textContent = prepayment.approvalNumber;
    node.querySelector(".approval-date").textContent = formatDate(prepayment.approvalDate);
    node.querySelector(".approval-amount").textContent = `${formatMoney(prepayment.approvalAmount)}원`;
    node.querySelector(".card-label").textContent = cardDigitsText(prepayment);

    if (isOpen) {
      node.querySelector(".balance-detail").innerHTML = renderBalanceDetail(prepayment, used);
    }

    container.append(node);
  });
}

function renderBalanceDetail(prepayment, used) {
  const allTransactions = getLoadedTransactions()
    .filter((transaction) => transaction.prepaymentId === prepayment.id)
    .sort(sortTransactions);
  const cancelledCount = allTransactions.filter((transaction) => transaction.status === "cancelled").length;
  const showCancelled = state.cancelledTransactionVisibleIds.has(prepayment.id);
  const transactions = showCancelled
    ? allTransactions
    : allTransactions.filter((transaction) => transaction.status !== "cancelled");
  const displayStatus = getPrepaymentStatus(prepayment);
  const canUse = displayStatus !== "cancelled";
  const disabled = state.saving ? "disabled" : "";
  const usageForm = canUse
    ? `
    <form class="usage-form" data-usage-form data-prepayment-id="${escapeHtml(prepayment.id)}" autocomplete="off">
      <label>
        <span>사용금액 추가</span>
        <div class="usage-row">
          <input
            class="amount-input"
            data-usage-amount
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            aria-label="사용금액"
            ${disabled}
          />
          <button class="secondary-button" type="submit" ${disabled}>추가</button>
        </div>
      </label>
    </form>
  `
    : "";
  const registrationAction = canUse
    ? `
      <button class="prepayment-memo-button" type="button" data-prepayment-id="${escapeHtml(prepayment.id)}" data-prepayment-action="editMemo" ${disabled}>실사용자 수정</button>
      <button class="prepayment-cancel-button" type="button" data-prepayment-id="${escapeHtml(prepayment.id)}" data-prepayment-action="requestCancel" ${disabled}>이 선결제 등록 취소</button>
    `
    : "";
  const cancelledToggle = cancelledCount
    ? `
      <button
        class="secondary-button"
        type="button"
        data-cancelled-transactions-toggle="${escapeHtml(prepayment.id)}"
        aria-pressed="${showCancelled}"
      >${showCancelled ? "취소 내역 숨기기" : `취소 내역 보기 (${cancelledCount})`}</button>
    `
    : "";

  return `
    ${usageForm}
    <div class="detail-row remaining-detail usage-total-detail"><span>누적 사용액</span><strong>${formatMoney(used)}원</strong></div>
    ${cancelledToggle}
    ${renderTransactions(transactions, displayStatus === "cancelled")}
    <div class="prepayment-actions">${registrationAction}</div>
  `;
}

function renderTransactions(transactions, actionsLocked = false) {
  if (!transactions.length) {
    return `<div class="empty-state">사용 내역이 없습니다.</div>`;
  }

  const disabled = state.saving ? "disabled" : "";
  const items = transactions
    .map((transaction) => {
      const isCancelled = transaction.status === "cancelled";
      const action = isCancelled ? "restore" : "cancel";
      const label = isCancelled ? "복구" : "취소";
      const statusLabel = isCancelled ? "취소됨" : "사용";
      const actionButton = actionsLocked
        ? ""
        : `
          <button
            class="transaction-action ${isCancelled ? "restore" : "cancel"}"
            type="button"
            data-transaction-id="${escapeHtml(transaction.id)}"
            data-transaction-action="${action}"
            ${disabled}
          >${label}</button>
        `;
      return `
        <article class="transaction-item ${isCancelled ? "is-cancelled" : ""}">
          <div class="transaction-main">
            <p class="transaction-line">
              <span class="transaction-date">${formatDate(transaction.transactionDate)}</span>
              <strong>${formatMoney(transaction.amount)}원</strong>
              <span>${statusLabel}</span>
            </p>
          </div>
          ${actionButton}
        </article>
      `;
    })
    .join("");

  return `<div class="transaction-list">${items}</div>`;
}

function openAdminDialog() {
  if (!isAdmin()) return;
  els.mainView.hidden = true;
  els.adminDialog.hidden = false;
  window.scrollTo(0, 0);
  renderAdmin();
  void refreshAdminCancelled({ renderAfter: true });
  if (state.adminTab === "archive" && !state.archiveYears.length) {
    state.archiveOpen = true;
    void refreshArchiveYears({ renderAfter: true });
  }
}

function closeAdminDialog() {
  els.adminDialog.hidden = true;
  els.mainView.hidden = false;
  window.scrollTo(0, 0);
}

async function refreshAdminCancelled(options = {}) {
  if (!isAdmin()) return;
  try {
    state.adminCancelledPrepayments = await loadCancelledPrepayments(state.membership);
  } catch (error) {
    showStatus(getErrorMessage(error));
    state.adminCancelledPrepayments = [];
  }

  if (options.renderAfter) {
    renderAdmin();
  }
}

function renderAdmin() {
  if (els.adminDialog.hidden || !isAdmin()) return;

  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    const isSelected = tab.dataset.adminTab === state.adminTab;
    tab.classList.toggle("is-active", isSelected);
    tab.setAttribute("aria-selected", String(isSelected));
  });

  if (state.adminTab === "cancelled") {
    renderAdminCancelledTab();
    return;
  }

  if (state.adminTab === "backup") {
    renderAdminBackupTab();
    return;
  }

  if (state.adminTab === "archive") {
    renderAdminArchiveTab();
    return;
  }

  renderAdminCardsTab();
  applyBusyState();
}

function renderAdminCardsTab() {
  els.adminContent.innerHTML = `
    <section class="admin-section">
      ${renderCreateCardForm()}
      <div class="admin-section-heading">
        <h3>등록된 카드</h3>
        <small>${state.data.cards.length}개</small>
      </div>
      <p class="metadata" data-admin-card-status aria-live="polite">${escapeHtml(state.adminCardStatus)}</p>
      <div class="admin-compact-list">
        ${state.data.cards.length ? getSortedCards().map(renderAdminCard).join("") : `<div class="empty-state">등록된 카드가 없습니다.</div>`}
      </div>
    </section>
  `;
  applyBusyState();
}

function renderAdminCancelledTab() {
  const cancelledPrepayments = state.adminCancelledPrepayments;
  const visibleCount = Math.min(state.adminCancelledVisibleCount, cancelledPrepayments.length);
  const visibleItems = cancelledPrepayments.slice(0, visibleCount);
  els.adminContent.innerHTML = `
    <section class="admin-section">
      <div class="admin-section-heading">
        <h3>취소 내역</h3>
        <small>${cancelledPrepayments.length}건</small>
      </div>
      <div class="admin-compact-list">
        ${
          visibleItems.length
            ? visibleItems.map(renderAdminCancelledPrepayment).join("")
            : `<div class="empty-state">취소된 선결제가 없습니다.</div>`
        }
      </div>
      ${
        visibleCount < cancelledPrepayments.length
          ? `<button class="secondary-button" type="button" data-admin-show-more-cancelled>더 보기</button>`
          : ""
      }
    </section>
  `;
  applyBusyState();
}

function renderAdminBackupTab() {
  els.adminContent.innerHTML = `
    <section class="admin-section">
      <div class="admin-section-heading">
        <h3>백업</h3>
        <small>CSV / JSON</small>
      </div>
      <div class="backup-grid">
        <button class="secondary-button" type="button" data-backup="json">Full JSON 다운로드</button>
        <button class="secondary-button" type="button" data-backup="cards">Cards CSV 다운로드</button>
        <button class="secondary-button" type="button" data-backup="prepayments">Prepayments CSV 다운로드</button>
        <button class="secondary-button" type="button" data-backup="transactions">Transactions CSV 다운로드</button>
      </div>
    </section>
  `;
  applyBusyState();
}

function renderAdminArchiveTab() {
  const summary = state.archiveYears.length ? `${state.archiveYears.length}개 연도` : "1년 경과 기록";
  els.adminContent.innerHTML = `
    <section class="admin-section admin-archive-section">
      <div class="admin-section-heading">
        <h3>이전 기록</h3>
        <small>${summary}</small>
      </div>
      <p class="metadata">1년이 지난 기록은 메인 화면에서 숨기고 관리자 모드에서만 확인합니다.</p>
      <div class="archive-year-list-wrap admin-archive-list" data-admin-archive-list></div>
    </section>
  `;
  renderArchive();
  applyBusyState();
}

function renderCreateCardForm() {
  const disabled = state.saving ? "disabled" : "";
  return `
    <form class="admin-form" data-card-create-form autocomplete="off" novalidate>
      <label>
        <span>카드 이름</span>
        <input name="name" type="text" maxlength="40" required ${disabled} />
      </label>
      <div class="field-grid">
        <label>
          <span>앞 4자리</span>
          <input name="first4" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]*" required ${disabled} />
        </label>
        <label>
          <span>뒤 4자리</span>
          <input name="last4" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]*" required ${disabled} />
        </label>
      </div>
      <label>
        <span>강조 색상</span>
        <input name="color" type="color" value="#6b7280" ${disabled} />
      </label>
      <button class="secondary-button" type="button" data-admin-create-card ${disabled}>카드 추가</button>
    </form>
  `;
}

function renderAdminCard(card) {
  const disabled = state.saving ? "disabled" : "";
  const isOpen = state.adminOpenCardId === card.id;
  return `
    <article class="admin-list-item">
      <button
        class="admin-row-button"
        type="button"
        data-admin-card-toggle="${escapeHtml(card.id)}"
        aria-expanded="${isOpen}"
      >
        <span>
          <strong>${escapeHtml(card.name)}</strong>
          <small>${escapeHtml(card.first4)}-${escapeHtml(card.last4)}</small>
        </span>
        <span class="admin-row-side">
          <span class="status-pill ${card.active ? "active" : "inactive"}">${card.active ? "활성" : "비활성"}</span>
        </span>
      </button>
      ${
        isOpen
          ? `<form class="admin-card-item" data-card-edit-form data-card-id="${escapeHtml(card.id)}" autocomplete="off" novalidate>
        <label>
          <span>카드 이름</span>
          <input name="name" type="text" maxlength="40" value="${escapeHtml(card.name)}" required ${disabled} />
        </label>
        <div class="field-grid">
        <label>
          <span>앞 4자리</span>
          <input name="first4" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]*" value="${escapeHtml(card.first4)}" required ${disabled} />
        </label>
        <label>
          <span>뒤 4자리</span>
          <input name="last4" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]*" value="${escapeHtml(card.last4)}" required ${disabled} />
        </label>
        </div>
        <label>
          <span>강조 색상</span>
          <input name="color" type="color" value="${escapeHtml(safeAccentColor(card.color))}" ${disabled} />
        </label>
        <p class="metadata">생성 ${formatDateTime(card.createdAt)} · 수정 ${formatDateTime(card.updatedAt)}</p>
        <div class="admin-actions">
          <button class="secondary-button" type="button" data-admin-update-card ${disabled}>수정 저장</button>
          <button class="secondary-button" type="button" data-card-active="${card.active ? "false" : "true"}" data-card-id="${escapeHtml(card.id)}" ${disabled}>
            ${card.active ? "비활성화" : "재활성화"}
          </button>
        </div>
      </form>`
          : ""
      }
    </article>
  `;
}

function renderAdminCancelledPrepayment(prepayment) {
  const disabled = state.saving ? "disabled" : "";
  const isOpen = state.adminOpenCancelledId === prepayment.id;
  return `
    <article class="admin-list-item">
      <button
        class="admin-row-button"
        type="button"
        data-admin-cancelled-toggle="${escapeHtml(prepayment.id)}"
        aria-expanded="${isOpen}"
      >
        <span>
          <strong>${formatDate(prepayment.approvalDate)} · ${escapeHtml(cardSummaryName(prepayment))}</strong>
          <small>${formatMoney(prepayment.approvalAmount)}원 · 승인 ${escapeHtml(prepayment.approvalNumber)}</small>
        </span>
        <span class="admin-row-side">
          <span class="status-pill inactive">취소</span>
        </span>
      </button>
      ${
        isOpen
          ? `<div class="admin-record-item">
        <p class="metadata">
          카드 ${renderCardNameBadge(prepayment)} ${escapeHtml(cardDigitsText(prepayment))}<br />
          승인일 ${formatDate(prepayment.approvalDate)} · 승인금액 ${formatMoney(prepayment.approvalAmount)}원<br />
          최근활동 ${formatDateTime(prepayment.lastActivityAt)} · 생성 ${formatDateTime(prepayment.createdAt)} · 수정 ${formatDateTime(prepayment.updatedAt)}
        </p>
        <div class="admin-actions">
          <button class="secondary-button" type="button" data-admin-restore-prepayment="${escapeHtml(prepayment.id)}" ${disabled}>복구</button>
        </div>
      </div>`
          : ""
      }
    </article>
  `;
}

function handleAdminSubmit(event) {
  const createForm = event.target.closest("[data-card-create-form]");
  const editForm = event.target.closest("[data-card-edit-form]");
  if (!createForm && !editForm) return;
  event.preventDefault();

  if (createForm) {
    saveNewCard(createForm);
    return;
  }

  saveExistingCard(editForm);
}

function saveNewCard(createForm) {
  if (!createForm) return;

  let values;
  try {
    values = getCardFormValues(createForm);
  } catch (error) {
    const message = getErrorMessage(error);
    showStatus(message);
    showAdminCardStatus(message);
    return;
  }

  void runMutation(async () => {
    showAdminCardStatus("카드 저장을 요청했습니다. Supabase 응답을 기다리는 중입니다...");
    const card = await createCard(state.membership, values);
    state.adminOpenCardId = card.id;
    createForm.reset();
  }, "카드 추가됨");
}

function saveExistingCard(editForm) {
  if (!editForm) return;

  let values;
  try {
    values = getCardFormValues(editForm);
  } catch (error) {
    const message = getErrorMessage(error);
    showStatus(message);
    showAdminCardStatus(message);
    return;
  }

  const cardId = editForm.dataset.cardId;
  void runMutation(async () => {
    showAdminCardStatus("카드 수정을 요청했습니다. Supabase 응답을 기다리는 중입니다...");
    await updateCard(state.membership, cardId, values);
  }, "카드 수정됨");
}

function handleAdminClick(event) {
  const tabButton = event.target.closest("[data-admin-tab]");
  if (tabButton) {
    state.adminTab = tabButton.dataset.adminTab;
    if (state.adminTab === "archive") {
      state.archiveOpen = true;
    }
    renderAdmin();
    if (state.adminTab === "archive" && !state.archiveYears.length) {
      void refreshArchiveYears({ renderAfter: true });
    }
    return;
  }

  const archiveYearButton = event.target.closest("[data-archive-year]");
  if (archiveYearButton) {
    void handleArchiveClick(event);
    return;
  }

  const archiveBalanceControl = event.target.closest(
    "[data-balance-toggle], [data-prepayment-action], [data-cancelled-transactions-toggle], [data-transaction-action]",
  );
  if (archiveBalanceControl && state.adminTab === "archive") {
    handleBalanceListClick(event);
    return;
  }

  const cardToggle = event.target.closest("[data-admin-card-toggle]");
  if (cardToggle) {
    const cardId = cardToggle.dataset.adminCardToggle;
    state.adminOpenCardId = state.adminOpenCardId === cardId ? null : cardId;
    renderAdmin();
    return;
  }

  const cancelledToggle = event.target.closest("[data-admin-cancelled-toggle]");
  if (cancelledToggle) {
    const prepaymentId = cancelledToggle.dataset.adminCancelledToggle;
    state.adminOpenCancelledId = state.adminOpenCancelledId === prepaymentId ? null : prepaymentId;
    renderAdmin();
    return;
  }

  const showMoreCancelled = event.target.closest("[data-admin-show-more-cancelled]");
  if (showMoreCancelled) {
    state.adminCancelledVisibleCount += ADMIN_CANCELLED_PAGE_SIZE;
    renderAdmin();
    return;
  }

  const createCardButton = event.target.closest("[data-admin-create-card]");
  if (createCardButton) {
    saveNewCard(createCardButton.closest("[data-card-create-form]"));
    return;
  }

  const updateCardButton = event.target.closest("[data-admin-update-card]");
  if (updateCardButton) {
    saveExistingCard(updateCardButton.closest("[data-card-edit-form]"));
    return;
  }

  const activeButton = event.target.closest("[data-card-active]");
  if (activeButton) {
    const active = activeButton.dataset.cardActive === "true";
    const cardId = activeButton.dataset.cardId;
    void runMutation(async () => {
      await setCardActiveStatus(state.membership, cardId, active);
    }, active ? "카드 재활성화됨" : "카드 비활성화됨");
    return;
  }

  const restoreButton = event.target.closest("[data-admin-restore-prepayment]");
  if (restoreButton) {
    void restorePrepaymentRegistration(restoreButton.dataset.adminRestorePrepayment);
    return;
  }

  const backupButton = event.target.closest("[data-backup]");
  if (backupButton) {
    void downloadBackup(backupButton.dataset.backup);
    return;
  }

}

function getCardFormValues(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const first4 = onlyDigits(formData.get("first4")).slice(0, 4);
  const last4 = onlyDigits(formData.get("last4")).slice(0, 4);
  const color = safeAccentColor(formData.get("color"));

  if (!name) throw new Error("카드 이름 확인");
  if (!isFourDigits(first4)) throw new Error("앞 4자리 확인");
  if (!isFourDigits(last4)) throw new Error("뒤 4자리 확인");

  return { name, first4, last4, color };
}

async function runMutation(action, successMessage, options = {}) {
  if (state.saving) return;
  setSaving(true);
  showStatus("저장 중...");
  const slowTimer = window.setTimeout(() => {
    showStatus("Supabase 저장 응답을 기다리는 중입니다...");
  }, SLOW_REQUEST_MS);

  try {
    const dynamicMessage = await action();
    await refreshWorkspaceData(dynamicMessage || successMessage, { silent: true });
    if (successMessage) {
      showAdminCardStatus(dynamicMessage || successMessage);
    }
  } catch (error) {
    const message = getErrorMessage(error);
    showStatus(message);
    if (options.alertOnError) {
      window.alert(message);
    }
    showAdminCardStatus(message);
  } finally {
    window.clearTimeout(slowTimer);
    setSaving(false);
    render();
    renderAdmin();
  }
}

function showAdminCardStatus(message) {
  state.adminCardStatus = message;
  const status = document.querySelector("[data-admin-card-status]");
  if (status) {
    status.textContent = message;
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function setSaving(saving) {
  state.saving = saving;
  applyBusyState();
}

function applyBusyState() {
  const controls = document.querySelectorAll("button, input, select, textarea");
  controls.forEach((control) => {
    const staysEnabled =
      control.id === "logoutButton" ||
      control.id === "setupLogoutButton" ||
      control.id === "adminCloseButton" ||
      control.id === "cancelDialogBack";
    control.disabled = state.saving && !staysEnabled;
  });
}

async function downloadBackup(type) {
  if (!isAdmin()) return;
  setSaving(true);
  showStatus("백업 준비 중...");
  let backupData;
  try {
    backupData = await loadBackupData(state.membership);
  } catch (error) {
    showStatus(getErrorMessage(error));
    setSaving(false);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const workspace = state.membership?.workspace ?? null;

  if (type === "json") {
    downloadFile(
      `paynowbiz-backup-${stamp}.json`,
      JSON.stringify({ workspace, exportedAt: new Date().toISOString(), ...backupData }, null, 2),
      "application/json;charset=utf-8",
    );
    showStatus("백업 다운로드됨");
    setSaving(false);
    return;
  }

  if (type === "cards") {
    downloadCsv(`paynowbiz-cards-${stamp}.csv`, backupData.cards, [
      ["id", (row) => row.id],
      ["카드명", (row) => row.name],
      ["앞4자리", (row) => row.first4],
      ["뒤4자리", (row) => row.last4],
      ["색상", (row) => row.color],
      ["활성", (row) => (row.active ? "active" : "inactive")],
      ["생성일", (row) => row.createdAt],
      ["수정일", (row) => row.updatedAt],
    ]);
    showStatus("백업 다운로드됨");
    setSaving(false);
    return;
  }

  if (type === "prepayments") {
    downloadCsv(`paynowbiz-prepayments-${stamp}.csv`, backupData.prepayments, [
      ["id", (row) => row.id],
      ["card_id", (row) => row.cardId ?? ""],
      ["카드유형", (row) => row.cardType],
      ["카드명스냅샷", (row) => row.cardNameSnapshot],
      ["앞4자리", (row) => row.cardFirst4Snapshot],
      ["뒤4자리", (row) => row.cardLast4Snapshot],
      ["승인번호", (row) => row.approvalNumber],
      ["승인일", (row) => row.approvalDate],
      ["승인금액", (row) => row.approvalAmount],
      ["상태", (row) => row.status],
      ["메모", (row) => row.memo],
      ["생성일", (row) => row.createdAt],
      ["수정일", (row) => row.updatedAt],
      ["최근활동일", (row) => row.lastActivityAt],
    ]);
    showStatus("백업 다운로드됨");
    setSaving(false);
    return;
  }

  downloadCsv(`paynowbiz-transactions-${stamp}.csv`, backupData.transactions, [
    ["id", (row) => row.id],
    ["prepayment_id", (row) => row.prepaymentId],
    ["사용금액", (row) => row.amount],
    ["사용일", (row) => row.transactionDate],
    ["상태", (row) => row.status],
    ["생성일", (row) => row.createdAt],
    ["수정일", (row) => row.updatedAt],
  ]);
  showStatus("백업 다운로드됨");
  setSaving(false);
}

function downloadCsv(filename, rows, columns) {
  const csv = [
    columns.map(([label]) => csvEscape(label)).join(","),
    ...rows.map((row) => columns.map(([, getter]) => csvEscape(getter(row))).join(",")),
  ].join("\r\n");
  downloadFile(filename, `\ufeff${csv}`, "text/csv;charset=utf-8");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function getGroupedPrepayments() {
  const sorted = [...state.data.prepayments].sort((a, b) => {
    const dateSort = a.approvalDate.localeCompare(b.approvalDate);
    if (dateSort !== 0) return dateSort;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return {
    active: sorted.filter((prepayment) => getPrepaymentStatus(prepayment) === "active"),
    completed: sorted.filter((prepayment) => getPrepaymentStatus(prepayment) === "completed"),
    cancelled: sorted.filter((prepayment) => getPrepaymentStatus(prepayment) === "cancelled"),
  };
}

function getPrepaymentStatus(prepayment) {
  if (prepayment.status === "cancelled") return "cancelled";
  return getRemaining(prepayment.id) <= 0 ? "completed" : "active";
}

function getRemaining(prepaymentId) {
  const prepayment = findPrepayment(prepaymentId);
  if (!prepayment) return 0;
  return prepayment.approvalAmount - getActiveUsed(prepaymentId);
}

function getActiveUsed(prepaymentId) {
  return getLoadedTransactions()
    .filter((transaction) => transaction.prepaymentId === prepaymentId)
    .filter((transaction) => transaction.status === "active")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

function findPrepayment(id) {
  return getLoadedPrepayments().find((prepayment) => prepayment.id === id);
}

function getLoadedPrepayments() {
  const merged = new Map();
  state.data.prepayments.forEach((prepayment) => merged.set(prepayment.id, prepayment));
  state.searchResults.prepayments.forEach((prepayment) => merged.set(prepayment.id, prepayment));
  state.archiveDataByYear.forEach((yearData) => {
    (yearData.prepayments ?? []).forEach((prepayment) => merged.set(prepayment.id, prepayment));
  });
  state.adminCancelledPrepayments.forEach((prepayment) => merged.set(prepayment.id, prepayment));
  return [...merged.values()];
}

function getLoadedTransactions() {
  const merged = new Map();
  state.data.transactions.forEach((transaction) => merged.set(transaction.id, transaction));
  state.searchResults.transactions.forEach((transaction) => merged.set(transaction.id, transaction));
  state.archiveDataByYear.forEach((yearData) => {
    (yearData.transactions ?? []).forEach((transaction) => merged.set(transaction.id, transaction));
  });
  return [...merged.values()];
}

function getSelectedCard() {
  if (els.cardSelect.value === UNREGISTERED_VALUE) return null;
  return state.data.cards.find((card) => card.id === els.cardSelect.value) || null;
}

function showStatus(message) {
  els.saveStatus.textContent = message;
  window.clearTimeout(showStatus.timer);
  if (!message) return;
  showStatus.timer = window.setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 2600);
}

function resetPrepaymentForm() {
  els.approvalNumber.value = "";
  els.approvalDate.value = todayInputValue();
  updateApprovalDateDisplay();
  els.approvalAmount.value = "";
  els.prepaymentMemo.value = "";
  els.unregisteredFirst4.value = "";
  els.unregisteredLast4.value = "";
  els.unregisteredMemo.value = "";
  const firstActiveCard = getSortedCards(state.data.cards.filter((card) => card.active))[0];
  if (firstActiveCard) {
    els.cardSelect.value = firstActiveCard.id;
  } else {
    els.cardSelect.value = UNREGISTERED_VALUE;
  }
  updateCardFields();
}

function handleDigitsInput(event) {
  event.target.value = onlyDigits(event.target.value).slice(0, 4);
}

function handleAmountInput(event) {
  event.target.value = onlyDigits(event.target.value);
}

function createEmptyData() {
  return {
    cards: [],
    prepayments: [],
    transactions: [],
  };
}

function cardSummaryName(prepayment) {
  const name =
    prepayment.cardType === "unregistered" && prepayment.unregisteredCardMemo
      ? prepayment.unregisteredCardMemo
      : prepayment.cardNameSnapshot;
  return name;
}

function renderCardNameBadge(prepayment) {
  const name = cardSummaryName(prepayment);
  const color = safeAccentColor(prepayment.cardColorSnapshot);

  return `<span class="card-name-badge" style="background-color: ${color}">${escapeHtml(name)}</span>`;
}

function cardDigitsText(prepayment) {
  return `${prepayment.cardFirst4Snapshot || "----"} - ${prepayment.cardLast4Snapshot || "----"}`;
}

function safeAccentColor(value) {
  const color = String(value || "");
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) return color;
  return DEFAULT_UNREGISTERED_COLOR;
}

function maskCardNumber(first4, last4) {
  const first = first4 || "----";
  const last = last4 || "----";
  return `${first} **** **** ${last}`;
}

function remainingText(remaining) {
  if (remaining < 0) return `${formatMoney(Math.abs(remaining))}원 초과`;
  return `${formatMoney(remaining)}원 남음`;
}

function formatMoney(value) {
  return moneyFormat.format(Math.round(Number(value) || 0));
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${year}.${month}.${day}`;
}

function formatDateForInputDisplay(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일`;
}

function updateApprovalDateDisplay() {
  els.approvalDateDisplay.textContent = formatDateForInputDisplay(els.approvalDate.value);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function todayInputValue() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function parsePositiveInteger(value) {
  const digits = onlyDigits(value);
  const parsed = Number(digits);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 0;
  return parsed;
}

function isFourDigits(value) {
  return /^\d{4}$/.test(value);
}

function sortTransactions(a, b) {
  const dateSort = b.transactionDate.localeCompare(a.transactionDate);
  if (dateSort !== 0) return dateSort;
  return b.createdAt.localeCompare(a.createdAt);
}

function isAdmin() {
  return state.membership?.role === "admin";
}

function getErrorMessage(error) {
  const message = String(error?.message || error || "");
  if (error?.code === "23505" || message.includes("duplicate key")) {
    return "이미 같은 카드, 승인번호, 승인일자, 금액의 선결제가 등록되어 있습니다.";
  }
  if (
    message.includes("member users can only soft-cancel prepayments") ||
    message.includes("member users can only change transaction status")
  ) {
    return "Supabase SQL 업데이트가 필요합니다. supabase/migrations/005_repair_write_policies.sql을 실행해주세요.";
  }
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return "권한이 없어 저장할 수 없습니다. 카드/사용내역 저장이면 005 SQL 업데이트가 필요할 수 있습니다.";
  }
  if (message) return message;
  return "요청을 처리하지 못했습니다.";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
