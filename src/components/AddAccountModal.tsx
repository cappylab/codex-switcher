import { useState } from "react";
import {
  describeFileSource,
  isTauriRuntime,
  openExternalUrl,
  pickAuthJsonFile,
  type FileSource,
} from "../lib/platform";
import { CloseIcon } from "./Icons";

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportFile: (source: FileSource, name: string) => Promise<void>;
  onStartOAuth: (name: string) => Promise<{ auth_url: string }>;
  onCompleteOAuth: () => Promise<unknown>;
  onCancelOAuth: () => Promise<void>;
}

type Tab = "oauth" | "import";

export function AddAccountModal({
  isOpen,
  onClose,
  onImportFile,
  onStartOAuth,
  onCompleteOAuth,
  onCancelOAuth,
}: AddAccountModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("oauth");
  const [name, setName] = useState("");
  const [fileSource, setFileSource] = useState<FileSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const [authUrl, setAuthUrl] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const isPrimaryDisabled = loading || (activeTab === "oauth" && oauthPending);
  const tauriRuntime = isTauriRuntime();

  const resetForm = () => {
    setName("");
    setFileSource(null);
    setError(null);
    setLoading(false);
    setOauthPending(false);
    setAuthUrl("");
  };

  const handleClose = () => {
    if (oauthPending) {
      onCancelOAuth();
    }
    resetForm();
    onClose();
  };

  const handleOAuthLogin = async () => {
    if (!name.trim()) {
      setError("Please enter an account name");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const info = await onStartOAuth(name.trim());
      setAuthUrl(info.auth_url);
      setOauthPending(true);
      setLoading(false);

      // Wait for completion
      await onCompleteOAuth();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      setOauthPending(false);
    }
  };

  const handleSelectFile = async () => {
    try {
      const selected = await pickAuthJsonFile();
      if (selected) setFileSource(selected);
    } catch (err) {
      console.error("Failed to open file dialog:", err);
    }
  };

  const handleImportFile = async () => {
    if (!name.trim()) {
      setError("Please enter an account name");
      return;
    }
    if (!fileSource) {
      setError("Please select an auth.json file");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onImportFile(fileSource, name.trim());
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl dark:border-stone-800 dark:bg-stone-950">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-100 p-5 dark:border-stone-800">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Add Account</h2>
          <button
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-900 dark:hover:text-stone-200"
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-100 dark:border-stone-800">
          {(["oauth", "import"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                if (tab === "import" && oauthPending) {
                  void onCancelOAuth().catch((err) => {
                    console.error("Failed to cancel login:", err);
                  });
                  setOauthPending(false);
                  setLoading(false);
                }
                setActiveTab(tab);
                setError(null);
              }}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeTab === tab
                  ? "-mb-px border-b-2 border-stone-950 text-stone-950 dark:border-stone-100 dark:text-stone-100"
                  : "text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300"
                }`}
            >
              {tab === "oauth" ? "ChatGPT Login" : "Import File"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Account Name (always shown) */}
          <div>
            <label className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
              Account Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Work Account"
              className="w-full rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-stone-950 outline-none transition-colors placeholder-stone-400 focus:border-stone-400 focus:ring-2 focus:ring-stone-200 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-stone-600 dark:focus:ring-stone-800"
            />
          </div>

          {/* Tab-specific content */}
          {activeTab === "oauth" && (
            <div className="text-sm text-stone-500 dark:text-stone-400">
              {oauthPending ? (
                <div className="py-4 text-center">
                  <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-stone-950 border-t-transparent dark:border-stone-100 dark:border-t-transparent"></div>
                  <p className="mb-2 font-medium text-stone-700 dark:text-stone-300">Waiting for browser login...</p>
                  <p className="mb-4 text-xs text-stone-500 dark:text-stone-400">
                    Please open the following link in your browser to proceed:
                  </p>
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-900">
                    <input
                      type="text"
                      readOnly
                      value={authUrl}
                      className="flex-1 truncate border-none bg-transparent text-xs text-stone-600 outline-none focus:ring-0 dark:text-stone-300"
                    />
                    <button
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(authUrl)
                          .then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          })
                          .catch(() => {
                            setError("Clipboard unavailable. Copy the link manually.");
                          });
                      }}
                      className={`px-3 py-1.5 border rounded text-xs font-medium transition-colors shrink-0
                        ${copied
                          ? "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300"
                          : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900"
                        }`}
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={() => {
                        void openExternalUrl(authUrl);
                      }}
                      className="shrink-0 rounded border border-stone-950 bg-stone-950 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
                    >
                      Open
                    </button>
                  </div>
                  {!tauriRuntime && (
                    <p className="text-xs text-amber-600">
                      OAuth login must finish on the same host machine because the callback
                      redirects to `localhost`.
                    </p>
                  )}
                </div>
              ) : (
                <p>
                  Click the button below to generate a login link.
                  You will need to open it in your browser to authenticate.
                </p>
              )}
            </div>
          )}

          {activeTab === "import" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
                Select auth.json file
              </label>
              <div className="flex gap-2">
                <div className="flex-1 truncate rounded-lg border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
                  {describeFileSource(fileSource)}
                </div>
                <button
                  onClick={handleSelectFile}
                  className="whitespace-nowrap rounded-lg border border-stone-200 bg-stone-100 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  Browse...
                </button>
              </div>
              <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                Import credentials from an existing Codex auth.json file
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-red-600 dark:text-red-300 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-stone-100 p-5 dark:border-stone-800">
          <button
            onClick={handleClose}
            className="flex-1 rounded-md bg-stone-100 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            Cancel
          </button>
          <button
            onClick={activeTab === "oauth" ? handleOAuthLogin : handleImportFile}
            disabled={isPrimaryDisabled}
            className="flex-1 rounded-md bg-stone-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
          >
            {loading
              ? "Adding..."
              : activeTab === "oauth"
                ? "Generate Login Link"
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
