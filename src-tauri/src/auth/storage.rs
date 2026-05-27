//! Account storage module - manages reading and writing accounts.json

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};

use crate::types::{AccountsStore, AuthData, StoredAccount};

static ACCOUNTS_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn accounts_store_lock() -> &'static Mutex<()> {
    ACCOUNTS_STORE_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone)]
pub struct RemoveAccountResult {
    pub removed_was_active: bool,
    pub replacement_active_account: Option<StoredAccount>,
}

/// Get the path to the codex-switcher config directory
pub fn get_config_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Could not find home directory")?;
    Ok(home.join(".codex-switcher"))
}

/// Get the path to accounts.json
pub fn get_accounts_file() -> Result<PathBuf> {
    Ok(get_config_dir()?.join("accounts.json"))
}

/// Load the accounts store from disk
pub fn load_accounts() -> Result<AccountsStore> {
    let _guard = accounts_store_lock()
        .lock()
        .map_err(|_| anyhow::anyhow!("Accounts store lock was poisoned"))?;
    read_accounts_unlocked()
}

fn read_accounts_unlocked() -> Result<AccountsStore> {
    let path = get_accounts_file()?;

    if !path.exists() {
        return Ok(AccountsStore::default());
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read accounts file: {}", path.display()))?;

    let store: AccountsStore = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse accounts file: {}", path.display()))?;

    Ok(store)
}

/// Save the accounts store to disk
pub fn save_accounts(store: &AccountsStore) -> Result<()> {
    let _guard = accounts_store_lock()
        .lock()
        .map_err(|_| anyhow::anyhow!("Accounts store lock was poisoned"))?;
    write_accounts_unlocked(store)
}

fn write_accounts_unlocked(store: &AccountsStore) -> Result<()> {
    let path = get_accounts_file()?;

    // Ensure the config directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create config directory: {}", parent.display()))?;
    }

    let content =
        serde_json::to_string_pretty(store).context("Failed to serialize accounts store")?;

    write_file_securely(&path, &content)
        .with_context(|| format!("Failed to write accounts file: {}", path.display()))?;

    Ok(())
}

fn write_file_securely(path: &Path, content: &str) -> Result<()> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("Accounts file path has no file name")?;
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = path.with_file_name(format!(".{file_name}.{suffix}.tmp"));

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&temp_path)
            .with_context(|| format!("Failed to open temp file: {}", temp_path.display()))?;
        file.write_all(content.as_bytes())
            .with_context(|| format!("Failed to write temp file: {}", temp_path.display()))?;
        file.sync_all()
            .with_context(|| format!("Failed to sync temp file: {}", temp_path.display()))?;
    }

    #[cfg(not(unix))]
    {
        fs::write(&temp_path, content)
            .with_context(|| format!("Failed to write temp file: {}", temp_path.display()))?;
    }

    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path)
            .with_context(|| format!("Failed to replace accounts file: {}", path.display()))?;
    }

    fs::rename(&temp_path, path).with_context(|| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "Failed to replace accounts file: {} -> {}",
            temp_path.display(),
            path.display()
        )
    })?;

    // Set restrictive permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, perms)?;
    }

    Ok(())
}

pub fn mutate_accounts<T>(operation: impl FnOnce(&mut AccountsStore) -> Result<T>) -> Result<T> {
    let _guard = accounts_store_lock()
        .lock()
        .map_err(|_| anyhow::anyhow!("Accounts store lock was poisoned"))?;
    let mut store = read_accounts_unlocked()?;
    let result = operation(&mut store)?;
    write_accounts_unlocked(&store)?;
    Ok(result)
}

pub fn mutate_accounts_if_changed<T>(
    operation: impl FnOnce(&mut AccountsStore) -> Result<(T, bool)>,
) -> Result<T> {
    let _guard = accounts_store_lock()
        .lock()
        .map_err(|_| anyhow::anyhow!("Accounts store lock was poisoned"))?;
    let mut store = read_accounts_unlocked()?;
    let (result, changed) = operation(&mut store)?;
    if changed {
        write_accounts_unlocked(&store)?;
    }
    Ok(result)
}

pub fn remove_account_from_store(
    store: &mut AccountsStore,
    account_id: &str,
) -> Result<RemoveAccountResult> {
    let initial_len = store.accounts.len();
    let removed_was_active = store.active_account_id.as_deref() == Some(account_id);

    store.accounts.retain(|account| account.id != account_id);

    if store.accounts.len() == initial_len {
        anyhow::bail!("Account not found: {account_id}");
    }

    let replacement_active_account = if removed_was_active {
        let replacement = store.accounts.first().cloned();
        store.active_account_id = replacement.as_ref().map(|account| account.id.clone());
        replacement
    } else {
        None
    };

    Ok(RemoveAccountResult {
        removed_was_active,
        replacement_active_account,
    })
}

/// Add a new account to the store
pub fn add_account(account: StoredAccount) -> Result<StoredAccount> {
    mutate_accounts(|store| {
        // Check for duplicate names
        if store.accounts.iter().any(|a| a.name == account.name) {
            anyhow::bail!("An account with name '{}' already exists", account.name);
        }

        let account_clone = account.clone();
        store.accounts.push(account);

        // If this is the first account, make it active
        if store.accounts.len() == 1 {
            store.active_account_id = Some(account_clone.id.clone());
        }

        Ok(account_clone)
    })
}

/// Remove an account by ID
pub fn remove_account(account_id: &str) -> Result<RemoveAccountResult> {
    mutate_accounts(|store| remove_account_from_store(store, account_id))
}

/// Update the active account ID
pub fn set_active_account(account_id: &str) -> Result<()> {
    mutate_accounts(|store| {
        // Verify the account exists
        if !store.accounts.iter().any(|a| a.id == account_id) {
            anyhow::bail!("Account not found: {account_id}");
        }

        store.active_account_id = Some(account_id.to_string());
        Ok(())
    })
}

/// Get an account by ID
pub fn get_account(account_id: &str) -> Result<Option<StoredAccount>> {
    let store = load_accounts()?;
    Ok(store.accounts.into_iter().find(|a| a.id == account_id))
}

/// Get the currently active account
pub fn get_active_account() -> Result<Option<StoredAccount>> {
    let store = load_accounts()?;
    let active_id = match &store.active_account_id {
        Some(id) => id,
        None => return Ok(None),
    };
    Ok(store.accounts.into_iter().find(|a| a.id == *active_id))
}

/// Update an account's last_used_at timestamp
pub fn touch_account(account_id: &str) -> Result<()> {
    mutate_accounts_if_changed(|store| {
        let Some(account) = store.accounts.iter_mut().find(|a| a.id == account_id) else {
            return Ok(((), false));
        };

        account.last_used_at = Some(chrono::Utc::now());
        Ok(((), true))
    })
}

/// Update an account's metadata (name, email, plan_type, subscription expiry)
pub fn update_account_metadata(
    account_id: &str,
    name: Option<String>,
    email: Option<String>,
    plan_type: Option<String>,
    subscription_expires_at: Option<Option<DateTime<Utc>>>,
) -> Result<StoredAccount> {
    mutate_accounts(|store| {
        // Check for duplicate names first (if renaming)
        if let Some(ref new_name) = name {
            if store
                .accounts
                .iter()
                .any(|a| a.id != account_id && a.name == *new_name)
            {
                anyhow::bail!("An account with name '{new_name}' already exists");
            }
        }

        // Now find and update the account
        let account = store
            .accounts
            .iter_mut()
            .find(|a| a.id == account_id)
            .context("Account not found")?;

        if let Some(new_name) = name {
            account.name = new_name;
        }

        if email.is_some() {
            account.email = email;
        }

        if plan_type.is_some() {
            account.plan_type = plan_type;
        }

        if let Some(subscription_expires_at) = subscription_expires_at {
            account.subscription_expires_at = subscription_expires_at;
        }

        Ok(account.clone())
    })
}

/// Update ChatGPT OAuth tokens for an account and return the updated account.
#[allow(clippy::too_many_arguments)]
pub fn update_account_chatgpt_tokens(
    account_id: &str,
    id_token: String,
    access_token: String,
    refresh_token: String,
    chatgpt_account_id: Option<String>,
    email: Option<String>,
    plan_type: Option<String>,
    subscription_expires_at: Option<DateTime<Utc>>,
) -> Result<StoredAccount> {
    mutate_accounts(|store| {
        let account = store
            .accounts
            .iter_mut()
            .find(|a| a.id == account_id)
            .context("Account not found")?;

        match &mut account.auth_data {
            AuthData::ChatGPT {
                id_token: stored_id_token,
                access_token: stored_access_token,
                refresh_token: stored_refresh_token,
                account_id: stored_account_id,
            } => {
                *stored_id_token = id_token;
                *stored_access_token = access_token;
                *stored_refresh_token = refresh_token;
                if let Some(new_account_id) = chatgpt_account_id {
                    *stored_account_id = Some(new_account_id);
                }
            }
            AuthData::ApiKey { .. } => {
                anyhow::bail!("Cannot update OAuth tokens for an API key account");
            }
        }

        if let Some(new_email) = email {
            account.email = Some(new_email);
        }

        if let Some(new_plan_type) = plan_type {
            account.plan_type = Some(new_plan_type);
        }

        if let Some(subscription_expires_at) = subscription_expires_at {
            account.subscription_expires_at = Some(subscription_expires_at);
        }

        Ok(account.clone())
    })
}

/// Get the list of masked account IDs
pub fn get_masked_account_ids() -> Result<Vec<String>> {
    let store = load_accounts()?;
    Ok(store.masked_account_ids.clone())
}

/// Set the list of masked account IDs
pub fn set_masked_account_ids(ids: Vec<String>) -> Result<()> {
    mutate_accounts(|store| {
        store.masked_account_ids = ids;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::remove_account_from_store;
    use crate::types::{AccountsStore, StoredAccount};

    fn account(name: &str) -> StoredAccount {
        StoredAccount::new_api_key(name.to_string(), format!("{name}-key"))
    }

    #[test]
    fn removing_active_account_returns_replacement_active_account() {
        let active = account("active");
        let replacement = account("replacement");
        let replacement_id = replacement.id.clone();
        let mut store = AccountsStore {
            version: 1,
            accounts: vec![active.clone(), replacement],
            active_account_id: Some(active.id.clone()),
            masked_account_ids: Vec::new(),
        };

        let result = remove_account_from_store(&mut store, &active.id).expect("removal succeeds");

        assert!(result.removed_was_active);
        assert_eq!(
            store.active_account_id.as_deref(),
            Some(replacement_id.as_str())
        );
        assert_eq!(
            result
                .replacement_active_account
                .as_ref()
                .map(|account| account.id.as_str()),
            Some(replacement_id.as_str())
        );
    }
}
