const STORAGE_KEY = "paynowbiz-tracker:v1";
const UNREGISTERED_VALUE = "__unregistered__";
const DEFAULT_UNREGISTERED_COLOR = "#8a8a8a";

const sampleCreatedAt = "2026-06-26T09:00:00.000+09:00";

const sampleCards = [
  {
    id: "card-raon",
    name: "라온카드",
    first4: "1234",
    last4: "5678",
    color: "#7c3aed",
    active: true,
    createdAt: sampleCreatedAt,
  },
  {
    id: "card-hana",
    name: "하나카드",
    first4: "1111",
    last4: "2222",
    color: "#2563eb",
    active: true,
    createdAt: sampleCreatedAt,
  },
];

const samplePrepayments = [
  {
    id: "prepay-raon-001",
    cardId: "card-raon",
    cardType: "registered",
    cardNameSnapshot: "라온카드",
    cardFirst4Snapshot: "1234",
    cardLast4Snapshot: "5678",
    cardColorSnapshot: "#7c3aed",
    unregisteredCardMemo: "",
    approvalNumber: "000123456789",
    approvalDate: "2026-06-15",
    approvalAmount: 100000,
    createdAt: sampleCreatedAt,
    updatedAt: sampleCreatedAt,
  },
  {
    id: "prepay-hana-001",
    cardId: "card-hana",
    cardType: "registered",
    cardNameSnapshot: "하나카드",
    cardFirst4Snapshot: "1111",
    cardLast4Snapshot: "2222",
    cardColorSnapshot: "#2563eb",
    unregisteredCardMemo: "",
    approvalNumber: "000555123400",
    approvalDate: "2026-06-10",
    approvalAmount: 50000,
    createdAt: sampleCreatedAt,
    updatedAt: sampleCreatedAt,
  },
  {
    id: "prepay-family-001",
    cardId: null,
    cardType: "unregistered",
    cardNameSnapshot: "등록되지 않은 카드",
    cardFirst4Snapshot: "9876",
    cardLast4Snapshot: "0001",
    cardColorSnapshot: DEFAULT_UNREGISTERED_COLOR,
    unregisteredCardMemo: "이모 카드",
    approvalNumber: "009900112233",
    approvalDate: "2026-06-18",
    approvalAmount: 30000,
    createdAt: sampleCreatedAt,
    updatedAt: sampleCreatedAt,
  },
];

const sampleTransactions = [
  {
    id: "tx-raon-001",
    prepaymentId: "prepay-raon-001",
    amount: 25000,
    transactionDate: "2026-06-16",
    status: "active",
    createdAt: "2026-06-16T12:00:00.000+09:00",
    updatedAt: "2026-06-16T12:00:00.000+09:00",
  },
  {
    id: "tx-raon-002",
    prepaymentId: "prepay-raon-001",
    amount: 30000,
    transactionDate: "2026-06-20",
    status: "active",
    createdAt: "2026-06-20T12:00:00.000+09:00",
    updatedAt: "2026-06-20T12:00:00.000+09:00",
  },
  {
    id: "tx-hana-001",
    prepaymentId: "prepay-hana-001",
    amount: 50000,
    transactionDate: "2026-06-11",
    status: "active",
    createdAt: "2026-06-11T12:00:00.000+09:00",
    updatedAt: "2026-06-11T12:00:00.000+09:00",
  },
  {
    id: "tx-family-001",
    prepaymentId: "prepay-family-001",
    amount: 12000,
    transactionDate: "2026-06-19",
    status: "active",
    createdAt: "2026-06-19T12:00:00.000+09:00",
    updatedAt: "2026-06-19T12:00:00.000+09:00",
  },
  {
    id: "tx-family-002",
    prepaymentId: "prepay-family-001",
    amount: 3000,
    transactionDate: "2026-06-21",
    status: "cancelled",
    createdAt: "2026-06-21T12:00:00.000+09:00",
    updatedAt: "2026-06-22T12:00:00.000+09:00",
  },
];

const storage = {
  load() {
    const fallback = createSampleData();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.cards) || !Array.isArray(parsed.prepayments) || !Array.isArray(parsed.transactions)) {
        return fallback;
      }

      return {
        version: 1,
        cards: parsed.cards.map(normalizeCard),
        prepayments: parsed.prepayments.map(normalizePrepayment),
        transactions: parsed.transactions.map(normalizeTransaction),
      };
    } catch {
      return fallback;
    }
  },
  save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },
};

const state = {
  data: storage.load(),
  openPrepaymentId: null,
  completedOpen: false,
};

const moneyFormat = new Intl.NumberFormat("ko-KR");

const els = {
  saveStatus: document.querySelector("#saveStatus"),
  activeList: document.querySelector("#activeList"),
  completedToggle: document.querySelector("#completedToggle"),
  completedSummary: document.querySelector("#completedSummary"),
  completedList: document.querySelector("#completedList"),
  prepaymentForm: document.querySelector("#prepaymentForm"),
  cardSelect: document.querySelector("#cardSelect"),
  registeredCardPreview: document.querySelector("#registeredCardPreview"),
  unregisteredFields: document.querySelector("#unregisteredFields"),
  unregisteredFirst4: document.querySelector("#unregisteredFirst4"),
  unregisteredLast4: document.querySelector("#unregisteredLast4"),
  unregisteredMemo: document.querySelector("#unregisteredMemo"),
  cardNumberView: document.querySelector("#cardNumberView"),
  approvalNumber: document.querySelector("#approvalNumber"),
  approvalDate: document.querySelector("#approvalDate"),
  approvalAmount: document.querySelector("#approvalAmount"),
  balanceTemplate: document.querySelector("#balanceTemplate"),
};

init();

function init() {
  renderCardOptions();
  els.approvalDate.value = todayInputValue();
  bindEvents();
  updateCardFields();
  render();
}

function bindEvents() {
  els.completedToggle.addEventListener("click", () => {
    state.completedOpen = !state.completedOpen;
    render();
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
    addPrepayment();
  });

  els.activeList.addEventListener("click", handleBalanceListClick);
  els.completedList.addEventListener("click", handleBalanceListClick);
  els.activeList.addEventListener("submit", handleUsageSubmit);
  els.completedList.addEventListener("submit", handleUsageSubmit);
}

function render() {
  const groups = getGroupedPrepayments();
  renderBalanceList(els.activeList, groups.active);
  renderCompleted(groups.completed);
}

function renderCardOptions() {
  const activeCards = state.data.cards.filter((card) => card.active);
  els.cardSelect.innerHTML = [
    ...activeCards.map((card) => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)}</option>`),
    `<option value="${UNREGISTERED_VALUE}">등록되지 않은 카드</option>`,
  ].join("");
}

function updateCardFields() {
  const selected = getSelectedCard();
  const isUnregistered = els.cardSelect.value === UNREGISTERED_VALUE;

  els.unregisteredFields.hidden = !isUnregistered;

  if (selected) {
    const cardNumber = maskCardNumber(selected.first4, selected.last4);
    els.cardNumberView.value = cardNumber;
    els.registeredCardPreview.innerHTML = `<strong>${escapeHtml(selected.name)}</strong> ${escapeHtml(cardNumber)}`;
    return;
  }

  const first4 = onlyDigits(els.unregisteredFirst4.value).slice(0, 4);
  const last4 = onlyDigits(els.unregisteredLast4.value).slice(0, 4);
  const memo = els.unregisteredMemo.value.trim();
  els.cardNumberView.value = first4 && last4 ? maskCardNumber(first4, last4) : "앞 4자리와 뒤 4자리를 입력";
  els.registeredCardPreview.innerHTML = memo
    ? `<strong>${escapeHtml(memo)}</strong> 등록되지 않은 카드`
    : "등록되지 않은 카드는 이 선불 기록에만 저장됩니다.";
}

function addPrepayment() {
  const approvalNumber = els.approvalNumber.value.trim();
  const approvalDate = els.approvalDate.value;
  const approvalAmount = parsePositiveInteger(els.approvalAmount.value);
  const selected = getSelectedCard();
  const now = nowIso();

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

  const prepayment = {
    id: makeId("prepay"),
    ...cardSnapshot,
    approvalNumber,
    approvalDate,
    approvalAmount,
    createdAt: now,
    updatedAt: now,
  };

  state.data.prepayments.unshift(prepayment);
  state.openPrepaymentId = prepayment.id;
  state.completedOpen = false;
  persist("저장됨");
  resetPrepaymentForm();
  render();
}

function handleBalanceListClick(event) {
  const toggle = event.target.closest("[data-balance-toggle]");
  if (toggle) {
    const id = toggle.dataset.balanceToggle;
    state.openPrepaymentId = state.openPrepaymentId === id ? null : id;
    render();
    return;
  }

  const action = event.target.closest("[data-transaction-action]");
  if (!action) return;

  setTransactionStatus(action.dataset.transactionId, action.dataset.transactionAction);
}

function handleUsageSubmit(event) {
  event.preventDefault();
  const form = event.target.closest("[data-usage-form]");
  if (!form) return;

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

  const now = nowIso();
  state.data.transactions.unshift({
    id: makeId("tx"),
    prepaymentId: prepayment.id,
    amount,
    transactionDate: todayInputValue(),
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  prepayment.updatedAt = now;

  const afterRemaining = getRemaining(prepayment.id);
  if (afterRemaining <= 0) {
    state.openPrepaymentId = null;
    state.completedOpen = false;
    persist("완료됨");
  } else {
    persist("사용 저장됨");
  }

  render();
}

function setTransactionStatus(transactionId, action) {
  const transaction = state.data.transactions.find((item) => item.id === transactionId);
  if (!transaction) return;

  const prepayment = findPrepayment(transaction.prepaymentId);
  const now = nowIso();

  if (action === "cancel" && transaction.status === "active") {
    transaction.status = "cancelled";
  } else if (action === "restore" && transaction.status === "cancelled") {
    transaction.status = "active";
  } else {
    return;
  }

  transaction.updatedAt = now;
  if (prepayment) prepayment.updatedAt = now;

  if (prepayment && getRemaining(prepayment.id) > 0) {
    state.openPrepaymentId = prepayment.id;
    state.completedOpen = false;
  }

  persist(action === "cancel" ? "취소됨" : "복구됨");
  render();
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
    const isCompleted = remaining <= 0;
    const statusText = isCompleted ? "완료" : "사용 중";

    node.classList.toggle("is-open", isOpen);
    node.querySelector(".accent").style.backgroundColor = prepayment.cardColorSnapshot || DEFAULT_UNREGISTERED_COLOR;
    node.querySelector(".balance-toggle").dataset.balanceToggle = prepayment.id;
    node.querySelector(".balance-toggle").setAttribute("aria-expanded", String(isOpen));
    node.querySelector(".remaining-text").textContent = remainingText(remaining);
    node.querySelector(".status-badge").textContent = statusText;
    node.querySelector(".approval-number").textContent = prepayment.approvalNumber;
    node.querySelector(".approval-date").textContent = formatDate(prepayment.approvalDate);
    node.querySelector(".approval-amount").textContent = `${formatMoney(prepayment.approvalAmount)}원`;
    node.querySelector(".card-label").textContent = cardSummaryName(prepayment);

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

  return `
    <div class="detail-info">
      <div class="detail-row"><span>카드번호</span><strong>${escapeHtml(maskCardNumber(prepayment.cardFirst4Snapshot, prepayment.cardLast4Snapshot))}</strong></div>
      <div class="detail-row"><span>승인번호</span><strong>${escapeHtml(prepayment.approvalNumber)}</strong></div>
      <div class="detail-row"><span>승인일</span><strong>${formatDate(prepayment.approvalDate)}</strong></div>
      <div class="detail-row"><span>승인금액</span><strong>${formatMoney(prepayment.approvalAmount)}원</strong></div>
      <div class="detail-row"><span>사용합계</span><strong>${formatMoney(used)}원</strong></div>
      <div class="detail-row remaining-detail"><span>남은금액</span><strong>${escapeHtml(remainingText(remaining))}</strong></div>
    </div>
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
          />
          <button class="secondary-button" type="submit">추가</button>
        </div>
      </label>
    </form>
    <h3 class="history-title">거래 내역</h3>
    ${renderTransactions(transactions)}
  `;
}

function renderTransactions(transactions) {
  if (!transactions.length) {
    return `<div class="empty-state">거래 내역이 없습니다.</div>`;
  }

  const items = transactions
    .map((transaction) => {
      const isCancelled = transaction.status === "cancelled";
      const action = isCancelled ? "restore" : "cancel";
      const label = isCancelled ? "복구" : "취소";
      const statusLabel = isCancelled ? "취소됨" : "사용";
      return `
        <article class="transaction-item ${isCancelled ? "is-cancelled" : ""}">
          <div class="transaction-main">
            <p class="transaction-line">
              <span class="transaction-date">${formatDate(transaction.transactionDate)}</span>
              <strong>${formatMoney(transaction.amount)}원</strong>
              <span>${statusLabel}</span>
            </p>
          </div>
          <button
            class="transaction-action ${isCancelled ? "restore" : "cancel"}"
            type="button"
            data-transaction-id="${escapeHtml(transaction.id)}"
            data-transaction-action="${action}"
          >${label}</button>
        </article>
      `;
    })
    .join("");

  return `<div class="transaction-list">${items}</div>`;
}

function getGroupedPrepayments() {
  const sorted = [...state.data.prepayments].sort((a, b) => {
    const dateSort = a.approvalDate.localeCompare(b.approvalDate);
    if (dateSort !== 0) return dateSort;
    return a.createdAt.localeCompare(b.createdAt);
  });

  return {
    active: sorted.filter((prepayment) => getRemaining(prepayment.id) > 0),
    completed: sorted.filter((prepayment) => getRemaining(prepayment.id) <= 0),
  };
}

function getRemaining(prepaymentId) {
  const prepayment = findPrepayment(prepaymentId);
  if (!prepayment) return 0;
  return prepayment.approvalAmount - getActiveUsed(prepaymentId);
}

function getActiveUsed(prepaymentId) {
  return state.data.transactions
    .filter((transaction) => transaction.prepaymentId === prepaymentId)
    .filter((transaction) => transaction.status === "active")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

function findPrepayment(id) {
  return state.data.prepayments.find((prepayment) => prepayment.id === id);
}

function getSelectedCard() {
  if (els.cardSelect.value === UNREGISTERED_VALUE) return null;
  return state.data.cards.find((card) => card.id === els.cardSelect.value) || null;
}

function persist(message) {
  storage.save(state.data);
  showStatus(message);
}

function showStatus(message) {
  els.saveStatus.textContent = message;
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 1800);
}

function resetPrepaymentForm() {
  els.approvalNumber.value = "";
  els.approvalDate.value = todayInputValue();
  els.approvalAmount.value = "";
  els.unregisteredFirst4.value = "";
  els.unregisteredLast4.value = "";
  els.unregisteredMemo.value = "";
  if (state.data.cards.some((card) => card.active)) {
    els.cardSelect.value = state.data.cards.find((card) => card.active).id;
  }
  updateCardFields();
}

function handleDigitsInput(event) {
  event.target.value = onlyDigits(event.target.value).slice(0, 4);
}

function handleAmountInput(event) {
  event.target.value = onlyDigits(event.target.value);
}

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-usage-amount]")) {
    handleAmountInput(event);
  }
});

function createSampleData() {
  return {
    version: 1,
    cards: sampleCards.map((item) => ({ ...item })),
    prepayments: samplePrepayments.map((item) => ({ ...item })),
    transactions: sampleTransactions.map((item) => ({ ...item })),
  };
}

function normalizeCard(card) {
  return {
    id: String(card.id || makeId("card")),
    name: String(card.name || "카드"),
    first4: onlyDigits(String(card.first4 || "")).slice(0, 4),
    last4: onlyDigits(String(card.last4 || "")).slice(0, 4),
    color: String(card.color || DEFAULT_UNREGISTERED_COLOR),
    active: card.active !== false,
    createdAt: String(card.createdAt || nowIso()),
  };
}

function normalizePrepayment(prepayment) {
  return {
    id: String(prepayment.id || makeId("prepay")),
    cardId: prepayment.cardId ? String(prepayment.cardId) : null,
    cardType: prepayment.cardType === "unregistered" ? "unregistered" : "registered",
    cardNameSnapshot: String(prepayment.cardNameSnapshot || "카드"),
    cardFirst4Snapshot: onlyDigits(String(prepayment.cardFirst4Snapshot || "")).slice(0, 4),
    cardLast4Snapshot: onlyDigits(String(prepayment.cardLast4Snapshot || "")).slice(0, 4),
    cardColorSnapshot: String(prepayment.cardColorSnapshot || DEFAULT_UNREGISTERED_COLOR),
    unregisteredCardMemo: String(prepayment.unregisteredCardMemo || ""),
    approvalNumber: String(prepayment.approvalNumber || ""),
    approvalDate: String(prepayment.approvalDate || todayInputValue()),
    approvalAmount: Number(prepayment.approvalAmount) || 0,
    createdAt: String(prepayment.createdAt || nowIso()),
    updatedAt: String(prepayment.updatedAt || nowIso()),
  };
}

function normalizeTransaction(transaction) {
  return {
    id: String(transaction.id || makeId("tx")),
    prepaymentId: String(transaction.prepaymentId || ""),
    amount: Number(transaction.amount) || 0,
    transactionDate: String(transaction.transactionDate || todayInputValue()),
    status: transaction.status === "cancelled" ? "cancelled" : "active",
    createdAt: String(transaction.createdAt || nowIso()),
    updatedAt: String(transaction.updatedAt || nowIso()),
  };
}

function cardSummaryName(prepayment) {
  const name =
    prepayment.cardType === "unregistered" && prepayment.unregisteredCardMemo
      ? prepayment.unregisteredCardMemo
      : prepayment.cardNameSnapshot;
  return `${name} · ${prepayment.cardFirst4Snapshot || "----"} / ${prepayment.cardLast4Snapshot || "----"}`;
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

function todayInputValue() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
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

function makeId(prefix) {
  if (window.crypto && window.crypto.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
