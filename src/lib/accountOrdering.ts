import type { AccountWithUsage, UsageInfo } from "../types";

export type AccountSortMode =
  | "deadline_asc"
  | "deadline_desc"
  | "remaining_desc"
  | "remaining_asc"
  | "subscription_asc"
  | "subscription_desc";

const EXHAUSTED_USED_PERCENT = 99;

function isLimitError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("usage limit") ||
    normalized.includes("limit reached") ||
    normalized.includes("quota")
  );
}

export function isUsageExhausted(usage: UsageInfo | undefined): boolean {
  if (!usage) return false;

  if (usage.error && isLimitError(usage.error)) {
    return true;
  }

  if (usage.has_credits === false && usage.unlimited_credits !== true) {
    return true;
  }

  return (
    (usage.primary_used_percent ?? 0) >= EXHAUSTED_USED_PERCENT ||
    (usage.secondary_used_percent ?? 0) >= EXHAUSTED_USED_PERCENT
  );
}

function getAvailabilityRank(account: Pick<AccountWithUsage, "usage" | "usageLoading">): number {
  if (isUsageExhausted(account.usage)) return 2;
  if (!account.usage || account.usageLoading) return 1;
  return 0;
}

function getResetDeadline(resetAt: number | null | undefined): number {
  return resetAt ?? Number.POSITIVE_INFINITY;
}

function getSubscriptionDeadline(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const timestamp = new Date(expiresAt).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareOptionalNumber(
  aValue: number | null,
  bValue: number | null,
  direction: "asc" | "desc",
): number {
  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  return direction === "asc" ? aValue - bValue : bValue - aValue;
}

function getRemainingPercent(usedPercent: number | null | undefined): number {
  if (usedPercent === null || usedPercent === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.max(0, 100 - usedPercent);
}

function compareBySelectedSort(
  a: AccountWithUsage,
  b: AccountWithUsage,
  sortMode: AccountSortMode,
): number {
  if (sortMode === "subscription_asc" || sortMode === "subscription_desc") {
    const subscriptionDiff = compareOptionalNumber(
      getSubscriptionDeadline(a.subscription_expires_at),
      getSubscriptionDeadline(b.subscription_expires_at),
      sortMode === "subscription_asc" ? "asc" : "desc",
    );
    if (subscriptionDiff !== 0) return subscriptionDiff;
  }

  if (sortMode === "deadline_asc" || sortMode === "deadline_desc") {
    const deadlineDiff =
      getResetDeadline(a.usage?.primary_resets_at) -
      getResetDeadline(b.usage?.primary_resets_at);
    if (deadlineDiff !== 0) {
      return sortMode === "deadline_asc" ? deadlineDiff : -deadlineDiff;
    }
  }

  const remainingDiff =
    getRemainingPercent(b.usage?.primary_used_percent) -
    getRemainingPercent(a.usage?.primary_used_percent);
  if (sortMode === "remaining_desc" && remainingDiff !== 0) {
    return remainingDiff;
  }
  if (sortMode === "remaining_asc" && remainingDiff !== 0) {
    return -remainingDiff;
  }

  const fallbackDeadlineDiff =
    getResetDeadline(a.usage?.primary_resets_at) -
    getResetDeadline(b.usage?.primary_resets_at);
  if (fallbackDeadlineDiff !== 0) return fallbackDeadlineDiff;

  return a.name.localeCompare(b.name);
}

export function sortAccountsForDisplay(
  accounts: AccountWithUsage[],
  sortMode: AccountSortMode,
): AccountWithUsage[] {
  return [...accounts].sort((a, b) => {
    const availabilityDiff = getAvailabilityRank(a) - getAvailabilityRank(b);
    if (availabilityDiff !== 0) return availabilityDiff;

    if (a.is_active !== b.is_active) {
      return a.is_active ? -1 : 1;
    }

    return compareBySelectedSort(a, b, sortMode);
  });
}
