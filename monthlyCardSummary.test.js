import test from "node:test";
import assert from "node:assert/strict";

import { getMonthlyCardPaymentTotal } from "./monthlyCardSummary.js";

test("현재 달 하나카드의 취소되지 않은 승인금액을 합산한다", () => {
  const prepayments = [
    createPrepayment({ approvalAmount: 500_000 }),
    createPrepayment({ approvalAmount: 300_000, approvalDate: "2026-07-23" }),
    createPrepayment({ approvalAmount: 100_000, cardNameSnapshot: "라온카드" }),
    createPrepayment({ approvalAmount: 200_000, approvalDate: "2026-06-30" }),
    createPrepayment({ approvalAmount: 400_000, status: "cancelled" }),
    createPrepayment({ approvalAmount: 600_000, cardType: "unregistered" }),
  ];

  assert.equal(
    getMonthlyCardPaymentTotal(prepayments, {
      cardName: "하나카드",
      now: new Date(2026, 6, 24),
    }),
    800_000,
  );
});

test("완료된 선결제도 원래 결제한 달의 합계에서 유지한다", () => {
  const prepayments = [
    createPrepayment({ approvalAmount: 800_000 }),
  ];

  assert.equal(
    getMonthlyCardPaymentTotal(prepayments, {
      cardName: "하나카드",
      now: new Date(2026, 6, 31),
    }),
    800_000,
  );
});

function createPrepayment(overrides = {}) {
  return {
    cardType: "registered",
    cardNameSnapshot: "하나카드",
    approvalDate: "2026-07-01",
    approvalAmount: 0,
    status: "active",
    ...overrides,
  };
}
