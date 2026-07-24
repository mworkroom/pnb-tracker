export function getMonthlyCardPaymentTotal(prepayments, options = {}) {
  const cardName = String(options.cardName ?? "").trim();
  const now = options.now instanceof Date ? options.now : new Date(options.now);

  if (!cardName || Number.isNaN(now.getTime())) return 0;

  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const approvalMonthPrefix = `${year}-${month}-`;

  return prepayments
    .filter((prepayment) => prepayment.status !== "cancelled")
    .filter((prepayment) => prepayment.cardType !== "unregistered")
    .filter((prepayment) => String(prepayment.cardNameSnapshot ?? "").trim() === cardName)
    .filter((prepayment) => String(prepayment.approvalDate ?? "").startsWith(approvalMonthPrefix))
    .reduce((total, prepayment) => total + (Number(prepayment.approvalAmount) || 0), 0);
}
