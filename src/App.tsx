import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAccounts } from "./hooks/useAccounts";
import { AccountCard, AddAccountModal, UpdateChecker } from "./components";
import type { CodexProcessInfo } from "./types";
import type { AccountSortMode } from "./lib/accountOrdering";
import { isUsageExhausted, sortAccountsForDisplay } from "./lib/accountOrdering";
import {
  exportFullBackupFile,
  importFullBackupFile,
  isTauriRuntime,
  invokeBackend,
} from "./lib/platform";
import {
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  MenuIcon,
  MoonIcon,
  RefreshIcon,
  SunIcon,
  UserIcon,
} from "./components/Icons";
import "./App.css";

const THEME_STORAGE_KEY = "codex-switcher-theme";
type ThemeMode = "light" | "dark";
const appWindow = isTauriRuntime() ? getCurrentWindow() : null;
const isMacOs =
  typeof navigator !== "undefined" &&
  /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);

function App() {
  const {
    accounts,
    loading,
    error,
    loadAccounts,
    refreshUsage,
    refreshSingleUsage,
    warmupAccount,
    warmupAllAccounts,
    switchAccount,
    autoSwitchAccountForUsage,
    deleteAccount,
    renameAccount,
    importFromFile,
    exportAccountsSlimText,
    importAccountsSlimText,
    startOAuthLogin,
    completeOAuthLogin,
    cancelOAuthLogin,
    loadMaskedAccountIds,
    saveMaskedAccountIds,
  } = useAccounts();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configModalMode, setConfigModalMode] = useState<"slim_export" | "slim_import">(
    "slim_export"
  );
  const [configPayload, setConfigPayload] = useState("");
  const [configModalError, setConfigModalError] = useState<string | null>(null);
  const [configCopied, setConfigCopied] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [processInfo, setProcessInfo] = useState<CodexProcessInfo | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExportingSlim, setIsExportingSlim] = useState(false);
  const [isImportingSlim, setIsImportingSlim] = useState(false);
  const [isExportingFull, setIsExportingFull] = useState(false);
  const [isImportingFull, setIsImportingFull] = useState(false);
  const [isWarmingAll, setIsWarmingAll] = useState(false);
  const [warmingUpId, setWarmingUpId] = useState<string | null>(null);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [warmupToast, setWarmupToast] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const [maskedAccounts, setMaskedAccounts] = useState<Set<string>>(new Set());
  const [accountSort, setAccountSort] = useState<AccountSortMode>("deadline_asc");
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const autoSwitchInFlightRef = useRef(false);
  const lastAutoSwitchKeyRef = useRef<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      return saved === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  const handleTitlebarDrag = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isTauriRuntime() || event.button !== 0) return;
      void appWindow?.startDragging();
    },
    []
  );

  const handleTitlebarDoubleClick = useCallback(() => {
    if (!isTauriRuntime()) return;
    void appWindow?.toggleMaximize();
  }, []);

  const toggleMask = (accountId: string) => {
    setMaskedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      void saveMaskedAccountIds(Array.from(next));
      return next;
    });
  };

  const allMasked =
    accounts.length > 0 && accounts.every((account) => maskedAccounts.has(account.id));

  const toggleMaskAll = () => {
    setMaskedAccounts((prev) => {
      const shouldMaskAll = !accounts.every((account) => prev.has(account.id));
      const next = shouldMaskAll ? new Set(accounts.map((account) => account.id)) : new Set<string>();
      void saveMaskedAccountIds(Array.from(next));
      return next;
    });
  };

  const checkProcesses = useCallback(async () => {
    try {
      const info = await invokeBackend<CodexProcessInfo>("check_codex_processes");
      setProcessInfo((prev) => {
        if (
          prev &&
          prev.can_switch === info.can_switch &&
          prev.count === info.count &&
          prev.background_count === info.background_count &&
          prev.pids.length === info.pids.length &&
          prev.pids.every((pid, index) => pid === info.pids[index])
        ) {
          return prev;
        }
        return info;
      });
      return info;
    } catch (err) {
      console.error("Failed to check processes:", err);
      return null;
    }
  }, []);

  // Check processes on mount and periodically
  useEffect(() => {
    checkProcesses();
    const interval = setInterval(checkProcesses, 5000);
    return () => clearInterval(interval);
  }, [checkProcesses]);

  // Load masked accounts from storage on mount
  useEffect(() => {
    loadMaskedAccountIds().then((ids) => {
      if (ids.length > 0) {
        setMaskedAccounts(new Set(ids));
      }
    });
  }, [loadMaskedAccountIds]);

  useEffect(() => {
    if (!isActionsMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!actionsMenuRef.current) return;
      if (!actionsMenuRef.current.contains(event.target as Node)) {
        setIsActionsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isActionsMenuOpen]);

  useEffect(() => {
    const isDark = themeMode === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Ignore storage errors; theme still works for current session.
    }
  }, [themeMode]);

  useEffect(() => {
    if (!isTauriRuntime() || isMacOs) return;

    let unlisten: (() => void) | undefined;

    const syncMaximizedState = async () => {
      try {
        setIsWindowMaximized((await appWindow?.isMaximized()) ?? false);
      } catch (err) {
        console.error("Failed to read window state:", err);
      }
    };

    void syncMaximizedState();

    appWindow
      ?.onResized(() => {
        void syncMaximizedState();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.error("Failed to watch window resize:", err);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  const handleSwitch = async (accountId: string) => {
    try {
      setSwitchingId(accountId);
      await switchAccount(accountId);
      await checkProcesses();
    } catch (err) {
      console.error("Failed to switch account:", err);
    } finally {
      setSwitchingId(null);
    }
  };

  const handleDelete = async (accountId: string) => {
    if (deleteConfirmId !== accountId) {
      setDeleteConfirmId(accountId);
      setTimeout(() => setDeleteConfirmId(null), 3000);
      return;
    }

    try {
      await deleteAccount(accountId);
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Failed to delete account:", err);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshSuccess(false);
    try {
      await refreshUsage(undefined, { refreshMetadata: true });
      setRefreshSuccess(true);
      setTimeout(() => setRefreshSuccess(false), 2000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const showWarmupToast = (message: string, isError = false) => {
    setWarmupToast({ message, isError });
    setTimeout(() => setWarmupToast(null), 2500);
  };

  useEffect(() => {
    if (accounts.length < 2 || autoSwitchInFlightRef.current) return;
    if (accounts.some((account) => account.usageLoading || !account.usage)) return;
    if (!accounts.some((account) => account.is_active)) return;

    const key = accounts
      .map((account) => {
        const usage = account.usage;
        return [
          account.id,
          account.is_active ? "active" : "other",
          usage?.primary_used_percent ?? "n",
          usage?.secondary_used_percent ?? "n",
          usage?.has_credits ?? "n",
          usage?.unlimited_credits ?? "n",
          usage?.error ?? "",
        ].join(":");
      })
      .join("|");

    if (lastAutoSwitchKeyRef.current === key) return;
    lastAutoSwitchKeyRef.current = key;
    autoSwitchInFlightRef.current = true;

    const usages = accounts.map((account) => account.usage!);
    autoSwitchAccountForUsage(usages)
      .then((switched) => {
        if (switched) {
          showWarmupToast(`Auto-switched to ${switched.name}`);
          void checkProcesses();
        }
      })
      .catch((err) => {
        console.error("Failed to auto-switch account:", err);
        lastAutoSwitchKeyRef.current = null;
      })
      .finally(() => {
        autoSwitchInFlightRef.current = false;
      });
  }, [accounts, autoSwitchAccountForUsage, checkProcesses]);

  const formatWarmupError = (err: unknown) => {
    if (!err) return "Unknown error";
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === "string") return err;
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown error";
    }
  };

  const handleWarmupAccount = async (accountId: string, accountName: string) => {
    try {
      setWarmingUpId(accountId);
      await warmupAccount(accountId);
      showWarmupToast(`Warm-up sent for ${accountName}`);
    } catch (err) {
      console.error("Failed to warm up account:", err);
      showWarmupToast(
        `Warm-up failed for ${accountName}: ${formatWarmupError(err)}`,
        true
      );
    } finally {
      setWarmingUpId(null);
    }
  };

  const handleWarmupAll = async () => {
    try {
      setIsWarmingAll(true);
      const summary = await warmupAllAccounts();
      if (summary.total_accounts === 0) {
        showWarmupToast("No accounts available for warm-up", true);
        return;
      }

      if (summary.failed_account_ids.length === 0) {
        showWarmupToast(
          `Warm-up sent for all ${summary.warmed_accounts} account${
            summary.warmed_accounts === 1 ? "" : "s"
          }`
        );
      } else {
        showWarmupToast(
          `Warmed ${summary.warmed_accounts}/${summary.total_accounts}. Failed: ${summary.failed_account_ids.length}`,
          true
        );
      }
    } catch (err) {
      console.error("Failed to warm up all accounts:", err);
      showWarmupToast(`Warm-up all failed: ${formatWarmupError(err)}`, true);
    } finally {
      setIsWarmingAll(false);
    }
  };

  const handleExportSlimText = async () => {
    setConfigModalMode("slim_export");
    setConfigModalError(null);
    setConfigPayload("");
    setConfigCopied(false);
    setIsConfigModalOpen(true);

    try {
      setIsExportingSlim(true);
      const payload = await exportAccountsSlimText();
      setConfigPayload(payload);
      showWarmupToast(`Slim text exported (${accounts.length} accounts).`);
    } catch (err) {
      console.error("Failed to export slim text:", err);
      const message = err instanceof Error ? err.message : String(err);
      setConfigModalError(message);
      showWarmupToast("Slim export failed", true);
    } finally {
      setIsExportingSlim(false);
    }
  };

  const openImportSlimTextModal = () => {
    setConfigModalMode("slim_import");
    setConfigModalError(null);
    setConfigPayload("");
    setConfigCopied(false);
    setIsConfigModalOpen(true);
  };

  const requestFullBackupPassphrase = (mode: "export" | "import") => {
    const promptText =
      mode === "export"
        ? "Enter a passphrase for this full backup. You will need it to import the file later. Minimum 12 characters."
        : "Enter the passphrase used for this full backup. Minimum 12 characters.";
    const passphrase = window.prompt(promptText);
    if (passphrase === null) return null;

    if (passphrase.trim().length < 12) {
      showWarmupToast("Passphrase must be at least 12 characters.", true);
      return null;
    }

    return passphrase;
  };

  const handleImportSlimText = async () => {
    if (!configPayload.trim()) {
      setConfigModalError("Please paste the slim text string first.");
      return;
    }

    try {
      setIsImportingSlim(true);
      setConfigModalError(null);
      const summary = await importAccountsSlimText(configPayload);
      setMaskedAccounts(new Set());
      setIsConfigModalOpen(false);
      showWarmupToast(
        `Imported ${summary.imported_count}, skipped ${summary.skipped_count} (total ${summary.total_in_payload})`
      );
    } catch (err) {
      console.error("Failed to import slim text:", err);
      const message = err instanceof Error ? err.message : String(err);
      setConfigModalError(message);
      showWarmupToast("Slim import failed", true);
    } finally {
      setIsImportingSlim(false);
    }
  };

  const handleExportFullFile = async () => {
    const passphrase = requestFullBackupPassphrase("export");
    if (!passphrase) return;

    try {
      setIsExportingFull(true);
      const exported = await exportFullBackupFile(passphrase);
      if (!exported) return;
      showWarmupToast("Full encrypted file exported.");
    } catch (err) {
      console.error("Failed to export full encrypted file:", err);
      showWarmupToast("Full export failed", true);
    } finally {
      setIsExportingFull(false);
    }
  };

  const handleImportFullFile = async () => {
    const passphrase = requestFullBackupPassphrase("import");
    if (!passphrase) return;

    try {
      setIsImportingFull(true);
      const summary = await importFullBackupFile(passphrase);
      if (!summary) return;
      const accountList = await loadAccounts();
      await refreshUsage(accountList);
      const maskedIds = await loadMaskedAccountIds();
      setMaskedAccounts(new Set(maskedIds));
      showWarmupToast(
        `Imported ${summary.imported_count}, skipped ${summary.skipped_count} (total ${summary.total_in_payload})`
      );
    } catch (err) {
      console.error("Failed to import full encrypted file:", err);
      showWarmupToast("Full import failed", true);
    } finally {
      setIsImportingFull(false);
    }
  };

  const hasRunningProcesses = processInfo && processInfo.count > 0;
  const sortedAccounts = useMemo(
    () => sortAccountsForDisplay(accounts, accountSort),
    [accounts, accountSort],
  );
  const availableAccounts = sortedAccounts.filter((account) => !isUsageExhausted(account.usage));
  const limitedAccounts = sortedAccounts.filter((account) => isUsageExhausted(account.usage));

  return (
    <div className="min-h-screen bg-stone-50 text-stone-950 dark:bg-[#151413] dark:text-stone-100">
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur dark:border-stone-800 dark:bg-[#151413]/90">
        {!isMacOs && (
          <div className="flex h-9 items-center px-3">
            <div
              onMouseDown={handleTitlebarDrag}
              onDoubleClick={handleTitlebarDoubleClick}
              className="mr-3 h-full flex-1 cursor-default select-none"
            />
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  void appWindow?.minimize();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                title="Minimize"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M5 12h14" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button
                onClick={() => {
                  void appWindow?.toggleMaximize();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                title={isWindowMaximized ? "Restore" : "Maximize"}
              >
                {isWindowMaximized ? (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M9 9h10v10H9z" strokeWidth="2" />
                    <path d="M5 15V5h10" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <rect x="5" y="5" width="14" height="14" strokeWidth="2" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => {
                  void appWindow?.close();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-red-500 hover:text-white dark:text-stone-400 dark:hover:bg-red-500 dark:hover:text-white"
                title="Close"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="mx-auto max-w-5xl px-6 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_max-content] md:items-center md:gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 bg-white text-sm font-semibold text-stone-900 shadow-sm dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100">
                CS
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">
                    Codex Switcher
                  </h1>
                  {processInfo && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs ring-1 ${
                        hasRunningProcesses
                          ? "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          hasRunningProcesses ? "bg-amber-500" : "bg-emerald-500"
                        }`}
                      />
                      {hasRunningProcesses
                        ? `${processInfo.count} Codex running`
                        : "0 Codex running"}
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Multi-account manager for Codex CLI
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
              <button
                onClick={toggleMaskAll}
                className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-stone-600 ring-1 ring-stone-200 transition-colors hover:bg-stone-100 dark:bg-stone-950 dark:text-stone-300 dark:ring-stone-800 dark:hover:bg-stone-900"
                title={allMasked ? "Show all account names and emails" : "Hide all account names and emails"}
              >
                {allMasked ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-stone-600 ring-1 ring-stone-200 transition-colors hover:bg-stone-100 disabled:opacity-50 dark:bg-stone-950 dark:text-stone-300 dark:ring-stone-800 dark:hover:bg-stone-900"
                title={isRefreshing ? "Refreshing all usage" : "Refresh all usage"}
              >
                <RefreshIcon className={isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              </button>
              <button
                onClick={handleWarmupAll}
                disabled={isWarmingAll || accounts.length === 0}
                className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-stone-600 ring-1 ring-stone-200 transition-colors hover:bg-stone-100 disabled:opacity-50 dark:bg-stone-950 dark:text-stone-300 dark:ring-stone-800 dark:hover:bg-stone-900"
                title="Send minimal traffic using all accounts"
              >
                <BoltIcon className={isWarmingAll ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
              </button>
              <button
                onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
                className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-stone-600 ring-1 ring-stone-200 transition-colors hover:bg-stone-100 dark:bg-stone-950 dark:text-stone-300 dark:ring-stone-800 dark:hover:bg-stone-900"
                title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {themeMode === "dark" ? <SunIcon /> : <MoonIcon />}
              </button>

              <div className="relative" ref={actionsMenuRef}>
                <button
                  onClick={() => setIsActionsMenuOpen((prev) => !prev)}
                  className="flex h-10 items-center gap-2 rounded-md bg-stone-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                >
                  <MenuIcon />
                  Account
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                </button>
                {isActionsMenuOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-60 rounded-lg border border-stone-200 bg-white p-2 text-stone-700 shadow-xl dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100">
                    <button
                      onClick={() => {
                        setIsActionsMenuOpen(false);
                        setIsAddModalOpen(true);
                      }}
                      className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-stone-100 dark:hover:bg-stone-900"
                    >
                      Add Account
                    </button>
                    <button
                      onClick={() => {
                        setIsActionsMenuOpen(false);
                        void handleExportSlimText();
                      }}
                      disabled={isExportingSlim}
                      className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-stone-900"
                    >
                      {isExportingSlim ? "Exporting..." : "Export Slim Text"}
                    </button>
                    <button
                      onClick={() => {
                        setIsActionsMenuOpen(false);
                        openImportSlimTextModal();
                      }}
                      disabled={isImportingSlim}
                      className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-stone-900"
                    >
                      {isImportingSlim ? "Importing..." : "Import Slim Text"}
                    </button>
                    <button
                      onClick={() => {
                        setIsActionsMenuOpen(false);
                        void handleExportFullFile();
                      }}
                      disabled={isExportingFull}
                      className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-stone-900"
                    >
                      {isExportingFull ? "Exporting..." : "Export Full Encrypted File"}
                    </button>
                    <button
                      onClick={() => {
                        setIsActionsMenuOpen(false);
                        void handleImportFullFile();
                      }}
                      disabled={isImportingFull}
                      className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-stone-900"
                    >
                      {isImportingFull ? "Importing..." : "Import Full Encrypted File"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {loading && accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-4 h-10 w-10 animate-spin rounded-full border-2 border-stone-900 border-t-transparent dark:border-stone-100 dark:border-t-transparent" />
            <p className="text-stone-500 dark:text-stone-400">Loading accounts...</p>
          </div>
        ) : error ? (
          <div className="py-20 text-center">
            <div className="mb-2 text-red-600 dark:text-red-300">Failed to load accounts</div>
            <p className="text-sm text-stone-500 dark:text-stone-400">{error}</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="py-20 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-500 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
              <UserIcon className="h-7 w-7" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-stone-950 dark:text-stone-50">
              No accounts yet
            </h2>
            <p className="mb-6 text-stone-500 dark:text-stone-400">
              Add your first Codex account to get started
            </p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="rounded-md bg-stone-950 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
            >
              Add Account
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-sm font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Available Accounts ({availableAccounts.length})
                  </h2>
                  <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                    Accounts with limit remaining stay above exhausted accounts.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="account-sort" className="text-xs text-stone-500 dark:text-stone-400">
                    Sort
                  </label>
                  <div className="relative">
                    <select
                      id="account-sort"
                      value={accountSort}
                      onChange={(event) => setAccountSort(event.target.value as AccountSortMode)}
                      className="appearance-none rounded-md border border-stone-300 bg-white py-2 pl-3 pr-9 text-sm font-medium text-stone-700 shadow-sm outline-none transition-colors hover:border-stone-400 focus:border-stone-500 focus:ring-2 focus:ring-stone-200 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:hover:border-stone-600 dark:focus:border-stone-500 dark:focus:ring-stone-800"
                    >
                      <option value="deadline_asc">Reset: earliest to latest</option>
                      <option value="deadline_desc">Reset: latest to earliest</option>
                      <option value="remaining_desc">Remaining: highest to lowest</option>
                      <option value="remaining_asc">Remaining: lowest to highest</option>
                      <option value="subscription_asc">Expiry: earliest to latest</option>
                      <option value="subscription_desc">Expiry: latest to earliest</option>
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-stone-500 dark:text-stone-400">
                      <ChevronDownIcon className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {availableAccounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    onSwitch={() => handleSwitch(account.id)}
                    onWarmup={() => handleWarmupAccount(account.id, account.name)}
                    onDelete={() => handleDelete(account.id)}
                    onRefresh={() => refreshSingleUsage(account.id, { refreshMetadata: true })}
                    onRename={(newName) => renameAccount(account.id, newName)}
                    switching={switchingId === account.id}
                    liveSwitch={hasRunningProcesses ?? false}
                    warmingUp={isWarmingAll || warmingUpId === account.id}
                    masked={maskedAccounts.has(account.id)}
                    onToggleMask={() => toggleMask(account.id)}
                  />
                ))}
              </div>
            </section>

            {limitedAccounts.length > 0 && (
              <section>
                <div className="mb-4">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Limited Accounts ({limitedAccounts.length})
                  </h2>
                  <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                    These accounts are kept at the bottom until their limits reset.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {limitedAccounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      onSwitch={() => handleSwitch(account.id)}
                      onWarmup={() => handleWarmupAccount(account.id, account.name)}
                      onDelete={() => handleDelete(account.id)}
                      onRefresh={() => refreshSingleUsage(account.id, { refreshMetadata: true })}
                      onRename={(newName) => renameAccount(account.id, newName)}
                      switching={switchingId === account.id}
                      liveSwitch={hasRunningProcesses ?? false}
                      warmingUp={isWarmingAll || warmingUpId === account.id}
                      masked={maskedAccounts.has(account.id)}
                      onToggleMask={() => toggleMask(account.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Refresh Success Toast */}
      {refreshSuccess && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-3 bg-green-600 text-white rounded-lg shadow-lg text-sm flex items-center gap-2">
          <CheckIcon className="h-4 w-4" /> Usage refreshed successfully
        </div>
      )}

      {/* Warm-up Toast */}
      {warmupToast && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-3 rounded-lg shadow-lg text-sm ${
            warmupToast.isError
              ? "bg-red-600 text-white"
              : "bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700"
          }`}
        >
          {warmupToast.message}
        </div>
      )}

      {/* Delete Confirmation Toast */}
      {deleteConfirmId && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-3 bg-red-600 text-white rounded-lg shadow-lg text-sm">
          Click delete again to confirm removal
        </div>
      )}

      {/* Add Account Modal */}
      <AddAccountModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onImportFile={importFromFile}
        onStartOAuth={startOAuthLogin}
        onCompleteOAuth={completeOAuthLogin}
        onCancelOAuth={cancelOAuthLogin}
      />

      {/* Import/Export Config Modal */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl dark:border-stone-800 dark:bg-stone-950">
            <div className="flex items-center justify-between border-b border-stone-100 p-5 dark:border-stone-800">
              <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">
                {configModalMode === "slim_export" ? "Export Slim Text" : "Import Slim Text"}
              </h2>
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-200"
                title="Close"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {configModalMode === "slim_import" ? (
                <p className="text-sm text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">
                  Existing accounts are kept. Only missing accounts are imported.
                </p>
              ) : (
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  This slim string contains account secrets. Keep it private.
                </p>
              )}
              <textarea
                value={configPayload}
                onChange={(e) => setConfigPayload(e.target.value)}
                readOnly={configModalMode === "slim_export"}
                placeholder={
                  configModalMode === "slim_export"
                    ? isExportingSlim
                      ? "Generating..."
                      : "Export string will appear here"
                    : "Paste config string here"
                }
                className="h-48 w-full rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 font-mono text-sm text-stone-800 outline-none transition-colors placeholder-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-200 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-stone-600 dark:focus:ring-stone-800"
              />
              {configModalError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-red-600 dark:text-red-300 text-sm">
                  {configModalError}
                </div>
              )}
            </div>
            <div className="flex gap-3 border-t border-stone-100 p-5 dark:border-stone-800">
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="rounded-md bg-stone-100 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
              >
                Close
              </button>
              {configModalMode === "slim_export" ? (
                <button
                  onClick={async () => {
                    if (!configPayload) return;
                    try {
                      await navigator.clipboard.writeText(configPayload);
                      setConfigCopied(true);
                      setTimeout(() => setConfigCopied(false), 1500);
                    } catch {
                      setConfigModalError("Clipboard unavailable. Please copy manually.");
                    }
                  }}
                  disabled={!configPayload || isExportingSlim}
                  className="rounded-md bg-stone-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                >
                  {configCopied ? "Copied" : "Copy String"}
                </button>
              ) : (
                <button
                  onClick={handleImportSlimText}
                  disabled={isImportingSlim}
                  className="rounded-md bg-stone-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                >
                  {isImportingSlim ? "Importing..." : "Import Missing Accounts"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <UpdateChecker />

    </div>
  );
}

export default App;
