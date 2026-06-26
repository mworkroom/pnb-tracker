import {
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
} from "./supabaseService.js";

const UNREGISTERED_VALUE = "__unregistered__";
const DEFAULT_UNREGISTERED_COLOR = "#8a8a8a";
const SLOW_REQUEST_MS = 4000;
const AUTH_TIMEOUT_MS = 45000;
const AUTH_RESTORE_ATTEMPTS = 10;
const AUTH_RESTORE_RETRY_MS = 500;

const state = {
  user: null,
  membership: null,
  data: createEmptyData(),
  adminCancelledPrepayments: [],
  adminCardStatus: "",
  openPrepaymentId: null,
  completedOpen: false,
  archiveOpen: false,
  archiveExpandedYear: null,
  archiveYears: [],
  archiveDataByYear: new Map(),
  searchQuery: "",
  searchResults: createEmptyData(),
  searchLoading: false,
  searchTimer: null,
  pendingCancelPrepaymentId: null,
  saving: false,
  realtimeUnsubscribe: null,
  realtimeRefreshTimer: null,
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
  archiveToggle: document.querySelector("#archiveToggle"),
  archiveSummary: document.querySelector("#archiveSummary"),
  archiveYearList: document.querySelector("#archiveYearList"),
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
  approvalAmount: document.querySelector("#approvalAmount"),
  prepaymentMemo: document.querySelector("#prepaymentMemo"),
  balanceTemplate: document.querySelector("#balanceTemplate"),
  cancelDialog: document.querySelector("#cancelDialog"),
  cancelDialogBack: document.querySelector("#cancelDialogBack"),
  cancelDialogConfirm: document.querySelector("#cancelDialogConfirm"),
  adminDialog: document.querySelector("#adminDialog"),
  adminCloseButton: document.querySelector("#adminCloseButton"),
  adminContent: document.querySelector("#adminContent"),
};

void init();

async function init() {
  bindEvents();
  els.approvalDate.value = todayInputValue();

  if (!isSupabaseConfigured) {
    renderSignedOut("Supabase URL과 publishable key를 설정하면 Google 로그인을 사용할 수 있습니다.", false);
    return;
  }

  onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT") {
      resetSignedOutState();
      return;
    }

    if (!session?.user) return;

    if (state.user?.id !== session.user.id) {
      await loadForUser(session.user);
    }
  });

  await restoreSession();
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
  els.adminDialog.addEventListener("click", (event) => {
    if (event.target === els.adminDialog) closeAdminDialog();
  });
  els.adminContent.addEventListener("click", handleAdminClick);
  els.adminContent.addEventListener("submit", handleAdminSubmit);

  els.completedToggle.addEventListener("click", () => {
    state.completedOpen = !state.completedOpen;
    render();
  });

  els.searchInput.addEventListener("input", handleSearchInput);
  els.searchClearButton.addEventListener("click", clearSearch);

  els.archiveToggle.addEventListener("click", () => {
    void toggleArchive();
  });

  els.cancelDialogBack.addEventListener("click", closeCancelDialog);
  els.cancelDialogConfirm.addEventListener("click", () => {
    void confirmCancelPrepayment();
  });
  els.cancelDialog.addEventListener("click", (event) => {
    if (event.target === els.cancelDialog) closeCancelDialog();
  });

  els.cardSelect.addEventListener("change", updateCardFields);
  els.unregisteredFirst4.addEventListener("input", handleDigitsInput);
  els.unregisteredLast4.addEventListener("input", handleDigitsInput);
  els.unregisteredFirst4.addEventListener("input", updateCardFields);
  els.unregisteredLast4.addEventListener("input", updateCardFields);
  els.unregisteredMemo.addEventListener("input", updateCardFields);
  els.approvalAmount.addEventListener("input", handleAmountInput);

  els.prepaymentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void addPrepayment();
  });

  els.activeList.addEventListener("click", handleBalanceListClick);
  els.completedList.addEventListener("click", handleBalanceListClick);
  els.searchList.addEventListener("click", handleBalanceListClick);
  els.archiveYearList.addEventListener("click", handleArchiveClick);
  els.archiveYearList.addEventListener("click", handleBalanceListClick);
  els.activeList.addEventListener("submit", handleUsageSubmit);
  els.completedList.addEventListener("submit", handleUsageSubmit);
  els.searchList.addEventListener("submit", handleUsageSubmit);
  els.archiveYearList.addEventListener("submit", handleUsageSubmit);

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-usage-amount]")) {
      handleAmountInput(event);
    }
  });
}

async function restoreSession() {
  renderSignedOut("로그인 상태를 확인하는 중입니다.", false);
  const slowTimer = window.setTimeout(() => {
    renderSignedOut("로그인 확인이 조금 오래 걸리고 있습니다. Supabase 응답을 기다리는 중입니다.", false);
  }, SLOW_REQUEST_MS);

  try {
    const { user } = await withTimeout(
      getRestoredSession(),
      AUTH_TIMEOUT_MS,
      "로그인 상태 확인 시간이 초과되었습니다. 새로고침 후 다시 시도해주세요.",
    );
    if (!user) {
      resetSignedOutState();
      return;
    }
    await loadForUser(user);
  } catch (error) {
    renderSignedOut(getErrorMessage(error), true);
  } finally {
    window.clearTimeout(slowTimer);
  }
}

async function getRestoredSession() {
  let lastResult = { session: null, user: null };

  for (let attempt = 0; attempt < AUTH_RESTORE_ATTEMPTS; attempt += 1) {
    lastResult = await getCurrentSession();
    if (lastResult.user) return lastResult;
    await delay(AUTH_RESTORE_RETRY_MS);
  }

  return lastResult;
}

async function loadForUser(user) {
  state.user = user;
  renderSignedOut("워크스페이스 권한을 확인하는 중입니다.", false, { canLogout: true });
  const slowTimer = window.setTimeout(() => {
    renderSignedOut("워크스페이스 권한 확인이 조금 오래 걸리고 있습니다. Supabase 응답을 기다리는 중입니다.", false, {
      canLogout: true,
    });
  }, SLOW_REQUEST_MS);

  try {
    const membership = await withTimeout(
      getCurrentMembership(user),
      AUTH_TIMEOUT_MS,
      "워크스페이스 권한 확인 시간이 초과되었습니다. 새로고침 후 다시 로그인해주세요.",
    );
    if (!membership) {
      state.membership = null;
      state.data = createEmptyData();
      showSetupMessage();
      return;
    }

    state.membership = membership;
    showAppShell();
    setupRealtime();
    await refreshWorkspaceData("불러옴", { silent: true });
  } catch (error) {
    renderSignedOut(getErrorMessage(error), true);
  } finally {
    window.clearTimeout(slowTimer);
  }
}

function resetSignedOutState() {
  teardownRealtime();
  state.user = null;
  state.membership = null;
  state.data = createEmptyData();
  state.adminCancelledPrepayments = [];
  state.adminCardStatus = "";
  state.openPrepaymentId = null;
  state.completedOpen = false;
  state.archiveOpen = false;
  state.archiveExpandedYear = null;
  state.archiveYears = [];
  state.archiveDataByYear = new Map();
  state.searchQuery = "";
  state.searchResults = createEmptyData();
  state.searchLoading = false;
  window.clearTimeout(state.searchTimer);
  renderSignedOut("공유 선불 잔액을 불러오려면 Google 계정으로 로그인하세요.", true);
}

function renderSignedOut(message, canLogin, options = {}) {
  els.authScreen.hidden = false;
  els.setupScreen.hidden = true;
  els.appShell.hidden = true;
  els.adminDialog.hidden = true;
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
  els.setupMessage.textContent = "이 계정은 아직 PayNowBiz Tracker에 등록되지 않았습니다.";
}

function showAppShell() {
  els.authScreen.hidden = true;
  els.setupScreen.hidden = true;
  els.appShell.hidden = false;
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

function renderCardOptions() {
  const activeCards = state.data.cards.filter((card) => card.active);
  const currentValue = els.cardSelect.value;
  els.cardSelect.innerHTML = [
    ...activeCards.map((card) => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)}</option>`),
    `<option value="${UNREGISTERED_VALUE}">등록되지 않은 카드</option>`,
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
    ? `<strong>${escapeHtml(memo)}</strong> 등록되지 않은 카드`
    : "등록되지 않은 카드는 이 선불 기록에만 저장됩니다.";
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
      cardNameSnapshot: "등록되지 않은 카드",
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
    render();
    return;
  }

  const prepaymentAction = event.target.closest("[data-prepayment-action]");
  if (prepaymentAction) {
    const id = prepaymentAction.dataset.prepaymentId;
    if (prepaymentAction.dataset.prepaymentAction === "requestCancel") {
      openCancelDialog(id);
      return;
    }
  }

  const action = event.target.closest("[data-transaction-action]");
  if (!action) return;

  void setTransactionStatus(action.dataset.transactionId, action.dataset.transactionAction);
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

async function toggleArchive() {
  state.archiveOpen = !state.archiveOpen;
  if (state.archiveOpen && !state.archiveYears.length) {
    await refreshArchiveYears();
  }
  renderArchive();
}

async function refreshArchiveYears() {
  if (!state.membership) return;
  try {
    state.archiveYears = await loadArchiveYears(state.membership);
  } catch (error) {
    showStatus(getErrorMessage(error));
    state.archiveYears = [];
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
  els.archiveSummary.textContent = state.archiveYears.length ? `${state.archiveYears.length}개 연도` : "";
  els.archiveToggle.setAttribute("aria-expanded", String(state.archiveOpen));
  els.archiveToggle.querySelector(".toggle-mark").textContent = state.archiveOpen ? "닫기" : "열기";
  els.archiveYearList.hidden = !state.archiveOpen;

  if (!state.archiveOpen) {
    els.archiveYearList.innerHTML = "";
    return;
  }

  if (!state.archiveYears.length) {
    els.archiveYearList.innerHTML = `<div class="empty-state">이전 기록이 없습니다.</div>`;
    return;
  }

  els.archiveYearList.innerHTML = state.archiveYears
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

  const container = els.archiveYearList.querySelector(`[data-archive-list-year="${state.archiveExpandedYear}"]`);
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
    node.querySelector(".remaining-text").textContent = remainingText(remaining);
    node.querySelector(".status-badge").textContent = statusText;
    node.querySelector(".approval-number").textContent = prepayment.approvalNumber;
    node.querySelector(".approval-date").textContent = formatDate(prepayment.approvalDate);
    node.querySelector(".approval-amount").textContent = `${formatMoney(prepayment.approvalAmount)}원`;
    node.querySelector(".card-label").textContent = cardDigitsText(prepayment);

    if (isOpen) {
      node.querySelector(".balance-detail").innerHTML = renderBalanceDetail(prepayment, used, remaining);
    }

    container.append(node);
  });
}

function renderBalanceDetail(prepayment, used, remaining) {
  const transactions = state.data.transactions
    .filter((transaction) => transaction.prepaymentId === prepayment.id)
    .sort(sortTransactions);
  const memoRow = prepayment.memo
    ? `<div class="detail-row memo-detail"><span>메모</span><strong>${escapeHtml(prepayment.memo)}</strong></div>`
    : "";
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
    ? `<button class="prepayment-cancel-button" type="button" data-prepayment-id="${escapeHtml(prepayment.id)}" data-prepayment-action="requestCancel" ${disabled}>이 선결제 등록 취소</button>`
    : "";

  return `
    <div class="detail-info">
      <div class="detail-row"><span>카드번호</span><strong>${escapeHtml(maskCardNumber(prepayment.cardFirst4Snapshot, prepayment.cardLast4Snapshot))}</strong></div>
      <div class="detail-row"><span>승인번호</span><strong>${escapeHtml(prepayment.approvalNumber)}</strong></div>
      <div class="detail-row"><span>승인일</span><strong>${formatDate(prepayment.approvalDate)}</strong></div>
      <div class="detail-row"><span>승인금액</span><strong>${formatMoney(prepayment.approvalAmount)}원</strong></div>
      ${memoRow}
      <div class="detail-row"><span>사용합계</span><strong>${formatMoney(used)}원</strong></div>
      <div class="detail-row remaining-detail"><span>남은금액</span><strong>${escapeHtml(remainingText(remaining))}</strong></div>
    </div>
    ${usageForm}
    <h3 class="history-title">거래 내역</h3>
    ${renderTransactions(transactions, displayStatus === "cancelled")}
    <div class="prepayment-actions">${registrationAction}</div>
  `;
}

function renderTransactions(transactions, actionsLocked = false) {
  if (!transactions.length) {
    return `<div class="empty-state">거래 내역이 없습니다.</div>`;
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
  els.adminDialog.hidden = false;
  renderAdmin();
  void refreshAdminCancelled({ renderAfter: true });
}

function closeAdminDialog() {
  els.adminDialog.hidden = true;
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

  const cancelledPrepayments = state.adminCancelledPrepayments;
  els.adminContent.innerHTML = `
    <section class="admin-section">
      <h3>카드 관리</h3>
      ${renderCreateCardForm()}
      <p class="metadata" data-admin-card-status aria-live="polite">${escapeHtml(state.adminCardStatus)}</p>
      <div class="admin-card-list">
        ${state.data.cards.length ? state.data.cards.map(renderAdminCard).join("") : `<div class="empty-state">등록된 카드가 없습니다.</div>`}
      </div>
    </section>
    <section class="admin-section">
      <h3>취소된 선결제</h3>
      <div class="admin-record-list">
        ${
          cancelledPrepayments.length
            ? cancelledPrepayments.map(renderAdminCancelledPrepayment).join("")
            : `<div class="empty-state">취소된 선결제가 없습니다.</div>`
        }
      </div>
    </section>
    <section class="admin-section">
      <h3>백업</h3>
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
      <button class="secondary-button" type="submit" ${disabled}>카드 추가</button>
    </form>
  `;
}

function renderAdminCard(card) {
  const disabled = state.saving ? "disabled" : "";
  return `
    <form class="admin-card-item" data-card-edit-form data-card-id="${escapeHtml(card.id)}" autocomplete="off" novalidate>
      <div class="admin-card-title">
        <span>${escapeHtml(card.name)} · ${escapeHtml(card.first4)}-${escapeHtml(card.last4)}</span>
        <span class="status-pill ${card.active ? "active" : "inactive"}">${card.active ? "활성" : "비활성"}</span>
      </div>
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
        <button class="secondary-button" type="submit" ${disabled}>수정 저장</button>
        <button class="secondary-button" type="button" data-card-active="${card.active ? "false" : "true"}" data-card-id="${escapeHtml(card.id)}" ${disabled}>
          ${card.active ? "비활성화" : "재활성화"}
        </button>
      </div>
    </form>
  `;
}

function renderAdminCancelledPrepayment(prepayment) {
  const disabled = state.saving ? "disabled" : "";
  return `
    <article class="admin-record-item">
      <div class="admin-record-title">
        <span>${renderCardNameBadge(prepayment)} 승인번호 ${escapeHtml(prepayment.approvalNumber)}</span>
        <span class="status-pill inactive">취소</span>
      </div>
      <p class="metadata">
        승인일 ${formatDate(prepayment.approvalDate)} · 승인금액 ${formatMoney(prepayment.approvalAmount)}원 · 최근활동 ${formatDateTime(prepayment.lastActivityAt)} · 생성 ${formatDateTime(prepayment.createdAt)} · 수정 ${formatDateTime(prepayment.updatedAt)}
      </p>
      <div class="admin-actions">
        <button class="secondary-button" type="button" data-admin-restore-prepayment="${escapeHtml(prepayment.id)}" ${disabled}>복구</button>
      </div>
    </article>
  `;
}

function handleAdminSubmit(event) {
  const createForm = event.target.closest("[data-card-create-form]");
  const editForm = event.target.closest("[data-card-edit-form]");
  if (!createForm && !editForm) return;
  event.preventDefault();

  if (createForm) {
    void runMutation(async () => {
      showAdminCardStatus("카드 저장을 요청했습니다. Supabase 응답을 기다리는 중입니다...");
      await createCard(state.membership, getCardFormValues(createForm));
      createForm.reset();
    }, "카드 추가됨");
    return;
  }

  void runMutation(async () => {
    showAdminCardStatus("카드 수정을 요청했습니다. Supabase 응답을 기다리는 중입니다...");
    await updateCard(state.membership, editForm.dataset.cardId, getCardFormValues(editForm));
  }, "카드 수정됨");
}

function handleAdminClick(event) {
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

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
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
  els.approvalAmount.value = "";
  els.prepaymentMemo.value = "";
  els.unregisteredFirst4.value = "";
  els.unregisteredLast4.value = "";
  els.unregisteredMemo.value = "";
  if (state.data.cards.some((card) => card.active)) {
    els.cardSelect.value = state.data.cards.find((card) => card.active).id;
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
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return "권한이 없어 저장할 수 없습니다.";
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
