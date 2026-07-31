/**
 * Double-entry internal ledger — §10.4.
 * Accounts:
 *   rail_settlement_pending:<provider>  (asset — money at the PSP not yet ours)
 *   guest_deposits_held                 (liability — deposits we owe forward)
 *   host_payables                       (liability — host share awaiting payout)
 *   platform_revenue                    (income)
 *   refund_reserve                      (liability)
 *   guest_credit:<userId>               (liability — platform credit)
 * Every posting is a balanced set sharing one txId. Reconciliation checks
 * sum(debit) == sum(credit) per txId and account balances vs provider reports.
 */
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db, schema } from "../../db/client.js";

export interface LedgerLine {
  account: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export async function post(
  tx: TxLike,
  bookingId: string | null,
  lines: LedgerLine[],
): Promise<string> {
  const txId = randomUUID();
  const debits = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const credits = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (debits !== credits) {
    throw new Error(
      `Unbalanced ledger posting: debits=${debits} credits=${credits}`,
    );
  }
  if (debits === 0) throw new Error("Empty ledger posting");
  await (tx as typeof db).insert(schema.ledgerEntries).values(
    lines.map((l) => ({
      txId,
      account: l.account,
      bookingId,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      memo: l.memo,
    })),
  );
  return txId;
}

/** Standard postings */

export function depositCapturedLines(opts: {
  provider: string;
  amount: number;
  commission: number;
}): LedgerLine[] {
  // Money arrived at PSP settlement; we owe the full deposit forward.
  return [
    {
      account: `rail_settlement_pending:${opts.provider}`,
      debit: opts.amount,
      memo: "deposit captured at PSP",
    },
    {
      account: "guest_deposits_held",
      credit: opts.amount,
      memo: "deposit held (host share + commission)",
    },
  ];
}

export function depositAllocationLines(opts: {
  amount: number;
  commission: number;
}): LedgerLine[] {
  // On host confirmation: split held deposit into host payable + our revenue.
  return [
    { account: "guest_deposits_held", debit: opts.amount, memo: "deposit allocated" },
    {
      account: "host_payables",
      credit: opts.amount - opts.commission,
      memo: "host share of deposit",
    },
    { account: "platform_revenue", credit: opts.commission, memo: "commission (§9.1)" },
  ];
}

export function refundToCreditLines(opts: {
  userId: string;
  amount: number;
  bonus: number;
}): LedgerLine[] {
  const lines: LedgerLine[] = [
    { account: "guest_deposits_held", debit: opts.amount, memo: "refund to credit" },
    {
      account: `guest_credit:${opts.userId}`,
      credit: opts.amount + opts.bonus,
      memo: "platform credit issued (credit-first ladder §10.6)",
    },
  ];
  if (opts.bonus > 0) {
    lines.push({
      account: "platform_revenue",
      debit: opts.bonus,
      memo: "credit-first +5% bonus expense",
    });
  }
  return lines;
}

export function payoutReleasedLines(opts: { amount: number }): LedgerLine[] {
  return [
    { account: "host_payables", debit: opts.amount, memo: "payout released" },
    {
      account: "rail_settlement_pending:payout",
      credit: opts.amount,
      memo: "payout in flight to host bank app",
    },
  ];
}

export function noShowForfeitLines(opts: {
  amount: number;
  platformShare: number;
}): LedgerLine[] {
  return [
    { account: "guest_deposits_held", debit: opts.amount, memo: "no-show forfeit (§10.6)" },
    {
      account: "host_payables",
      credit: opts.amount - opts.platformShare,
      memo: "forfeit to host",
    },
    { account: "platform_revenue", credit: opts.platformShare, memo: "forfeit fee" },
  ];
}

/** Account balance (credit-positive for liability/income accounts). */
export async function balance(account: string): Promise<number> {
  const [row] = await db
    .select({
      bal: sql<string>`coalesce(sum(${schema.ledgerEntries.credit} - ${schema.ledgerEntries.debit}), 0)`,
    })
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.account, account));
  return Number(row?.bal ?? 0);
}
