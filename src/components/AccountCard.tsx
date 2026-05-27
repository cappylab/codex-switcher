import { useEffect, useRef, useState } from "react";
import type { AccountWithUsage } from "../types";
import { isUsageExhausted } from "../lib/accountOrdering";
import {
  BoltIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshIcon,
  TrashIcon,
} from "./Icons";
import { UsageBar } from "./UsageBar";

interface AccountCardProps {
  account: AccountWithUsage;
  onSwitch: () => void;
  onWarmup: () => Promise<void>;
  onDelete: () => void;
  onRefresh: () => Promise<void>;
  onRename: (newName: string) => Promise<void>;
  switching?: boolean;
  liveSwitch?: boolean;
  warmingUp?: boolean;
  masked?: boolean;
  onToggleMask?: () => void;
}

function formatLastRefresh(date: Date | null): string {
  if (!date) return "Never";
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 5) return "Just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString();
}

function getSubscriptionStatus(timestamp: string | null | undefined): {
  label: string;
  className: string;
} {
  if (!timestamp) {
    return {
      label: "Expiry unavailable",
      className: "text-stone-400 dark:text-stone-500",
    };
  }

  const expiryDate = new Date(timestamp);
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(expiryDate);

  const remainingMs = expiryDate.getTime() - Date.now();
  if (remainingMs <= 0) {
    return {
      label: `Expired ${formattedDate}`,
      className: "text-red-600 dark:text-red-300",
    };
  }

  if (remainingMs <= 3 * 24 * 60 * 60 * 1000) {
    return {
      label: `Until ${formattedDate}`,
      className: "text-red-600 dark:text-red-300",
    };
  }

  if (remainingMs <= 7 * 24 * 60 * 60 * 1000) {
    return {
      label: `Until ${formattedDate}`,
      className: "text-amber-700 dark:text-amber-300",
    };
  }

  return {
    label: `Until ${formattedDate}`,
    className: "text-stone-500 dark:text-stone-400",
  };
}

function BlurredText({ children, blur }: { children: React.ReactNode; blur: boolean }) {
  return (
    <span
      className={`select-none transition-all duration-200 ${blur ? "blur-sm" : ""}`}
      style={blur ? { userSelect: "none" } : undefined}
    >
      {children}
    </span>
  );
}

export function AccountCard({
  account,
  onSwitch,
  onWarmup,
  onDelete,
  onRefresh,
  onRename,
  switching,
  liveSwitch,
  warmingUp,
  masked = false,
  onToggleMask,
}: AccountCardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(
    account.usage && !account.usage.error ? new Date() : null,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(account.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const exhausted = isUsageExhausted(account.usage);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
      setLastRefresh(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRename = async () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== account.name) {
      try {
        await onRename(trimmed);
      } catch {
        setEditName(account.name);
      }
    } else {
      setEditName(account.name);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      void handleRename();
    } else if (event.key === "Escape") {
      setEditName(account.name);
      setIsEditing(false);
    }
  };

  const planDisplay = account.plan_type
    ? account.plan_type.charAt(0).toUpperCase() + account.plan_type.slice(1)
    : account.auth_mode === "api_key"
      ? "API Key"
      : "Unknown";

  const planColors: Record<string, string> = {
    pro: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800",
    plus: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800",
    team: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800",
    enterprise:
      "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800",
    free: "bg-stone-100 text-stone-600 ring-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700",
    api_key:
      "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-800",
  };

  const planKey = account.plan_type?.toLowerCase() || "api_key";
  const planColorClass = planColors[planKey] || planColors.free;
  const showSubscriptionStatus = account.auth_mode === "chat_g_p_t";
  const subscriptionStatus = getSubscriptionStatus(account.subscription_expires_at);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border p-4 transition-colors duration-200 ${
        account.is_active
          ? "border-stone-300 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900"
          : "border-stone-200 bg-white/90 hover:border-stone-300 dark:border-stone-800 dark:bg-stone-950/70 dark:hover:border-stone-700"
      } ${exhausted ? "opacity-80" : ""}`}
    >
      {account.is_active && (
        <div className="absolute inset-y-0 left-0 w-1 bg-emerald-500 dark:bg-emerald-400" />
      )}

      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            {account.is_active && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-300" />
                Active
              </span>
            )}
            {exhausted && (
              <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-800">
                Limited
              </span>
            )}
          </div>

          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              onBlur={() => {
                void handleRename();
              }}
              onKeyDown={handleKeyDown}
              className="w-full rounded-md border border-stone-300 bg-stone-50 px-2 py-1 text-sm font-semibold text-stone-950 outline-none transition-colors focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-500"
            />
          ) : (
            <h3
              className="truncate text-base font-semibold text-stone-950 dark:text-stone-50"
              onClick={() => {
                if (masked) return;
                setEditName(account.name);
                setIsEditing(true);
              }}
              title={masked ? undefined : "Click to rename"}
            >
              <BlurredText blur={masked}>{account.name}</BlurredText>
            </h3>
          )}

          {account.email && (
            <p className="truncate text-sm text-stone-500 dark:text-stone-400">
              <BlurredText blur={masked}>{account.email}</BlurredText>
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {onToggleMask && (
            <button
              onClick={onToggleMask}
              className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              title={masked ? "Show info" : "Hide info"}
            >
              {masked ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${planColorClass}`}
          >
            {planDisplay}
          </span>
        </div>
      </div>

      <div className="mb-4">
        <UsageBar usage={account.usage} loading={isRefreshing || account.usageLoading} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-stone-400 dark:text-stone-500">
          Last updated: {formatLastRefresh(lastRefresh)}
        </div>
        {showSubscriptionStatus && (
          <div className={`text-right ${subscriptionStatus.className}`}>
            {subscriptionStatus.label}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {account.is_active ? (
          <button
            disabled
            className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-4 py-2 text-sm font-medium text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400"
          >
            <CheckIcon className="h-4 w-4" />
            Active
          </button>
        ) : (
          <button
            onClick={onSwitch}
            disabled={switching}
            className={`min-h-10 flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              liveSwitch
                ? "bg-amber-700 text-white hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500"
                : "bg-stone-950 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
            }`}
            title={liveSwitch ? "Switch without closing running Codex sessions" : undefined}
          >
            {switching ? "Switching..." : "Switch"}
          </button>
        )}
        <button
          onClick={() => {
            void onWarmup();
          }}
          disabled={warmingUp}
          className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
            warmingUp
              ? "bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300"
              : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
          }`}
          title={warmingUp ? "Sending warm-up request..." : "Send minimal warm-up request"}
        >
          <BoltIcon className={warmingUp ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
        </button>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex h-10 w-10 items-center justify-center rounded-md bg-stone-100 text-stone-600 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
          title="Refresh usage"
        >
          <RefreshIcon className={isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </button>
        <button
          onClick={onDelete}
          className="flex h-10 w-10 items-center justify-center rounded-md bg-red-50 text-red-600 transition-colors hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
          title="Remove account"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
