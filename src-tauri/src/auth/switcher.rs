//! Account switching logic - writes credentials to ~/.codex/auth.json

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use chrono::Utc;

use super::storage::mutate_accounts_if_changed;
use crate::types::{
    parse_chatgpt_id_token_claims, AccountsStore, AuthData, AuthDotJson, StoredAccount, TokenData,
};

/// Get the official Codex home directory
pub fn get_codex_home() -> Result<PathBuf> {
    // Check for CODEX_HOME environment variable first
    if let Ok(codex_home) = std::env::var("CODEX_HOME") {
        return Ok(PathBuf::from(codex_home));
    }

    let home = dirs::home_dir().context("Could not find home directory")?;
    Ok(home.join(".codex"))
}

/// Get the path to the official auth.json file
pub fn get_codex_auth_file() -> Result<PathBuf> {
    Ok(get_codex_home()?.join("auth.json"))
}

/// Switch to a specific account by writing its credentials to ~/.codex/auth.json
pub fn switch_to_account(account: &StoredAccount) -> Result<()> {
    let codex_home = get_codex_home()?;

    // Ensure the codex home directory exists
    fs::create_dir_all(&codex_home)
        .with_context(|| format!("Failed to create codex home: {}", codex_home.display()))?;

    let auth_json = create_auth_json(account)?;

    let auth_path = codex_home.join("auth.json");
    let content =
        serde_json::to_string_pretty(&auth_json).context("Failed to serialize auth.json")?;

    write_auth_file_securely(&auth_path, &content)
        .with_context(|| format!("Failed to write auth.json: {}", auth_path.display()))?;

    Ok(())
}

pub fn clear_codex_auth_file() -> Result<()> {
    let auth_path = get_codex_auth_file()?;
    if !auth_path.exists() {
        return Ok(());
    }

    fs::remove_file(&auth_path)
        .with_context(|| format!("Failed to remove auth.json: {}", auth_path.display()))
}

fn write_auth_file_securely(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create codex home: {}", parent.display()))?;
    }

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("auth.json path has no file name")?;
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
            .with_context(|| format!("Failed to open temp auth file: {}", temp_path.display()))?;
        file.write_all(content.as_bytes())
            .with_context(|| format!("Failed to write temp auth file: {}", temp_path.display()))?;
        file.sync_all()
            .with_context(|| format!("Failed to sync temp auth file: {}", temp_path.display()))?;
    }

    #[cfg(not(unix))]
    {
        fs::write(&temp_path, content)
            .with_context(|| format!("Failed to write temp auth file: {}", temp_path.display()))?;
    }

    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path)
            .with_context(|| format!("Failed to replace auth.json: {}", path.display()))?;
    }

    fs::rename(&temp_path, path).with_context(|| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "Failed to replace auth.json: {} -> {}",
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

/// Create an AuthDotJson structure from a StoredAccount
fn create_auth_json(account: &StoredAccount) -> Result<AuthDotJson> {
    match &account.auth_data {
        AuthData::ApiKey { key } => Ok(AuthDotJson {
            openai_api_key: Some(key.clone()),
            tokens: None,
            last_refresh: None,
        }),
        AuthData::ChatGPT {
            id_token,
            access_token,
            refresh_token,
            account_id,
        } => Ok(AuthDotJson {
            openai_api_key: None,
            tokens: Some(TokenData {
                id_token: id_token.clone(),
                access_token: access_token.clone(),
                refresh_token: refresh_token.clone(),
                account_id: account_id.clone(),
            }),
            last_refresh: Some(Utc::now()),
        }),
    }
}

/// Import an account from an existing auth.json file
pub fn import_from_auth_json(path: &str, account_name: String) -> Result<StoredAccount> {
    let content =
        fs::read_to_string(path).with_context(|| format!("Failed to read auth.json: {path}"))?;

    import_from_auth_json_contents(&content, account_name)
        .with_context(|| format!("Failed to parse auth.json: {path}"))
}

/// Import an account from auth.json file contents.
pub fn import_from_auth_json_contents(
    content: &str,
    account_name: String,
) -> Result<StoredAccount> {
    let auth: AuthDotJson =
        serde_json::from_str(content).context("Failed to parse auth.json contents")?;

    // Determine auth mode and create account
    if let Some(api_key) = auth.openai_api_key {
        Ok(StoredAccount::new_api_key(account_name, api_key))
    } else if let Some(tokens) = auth.tokens {
        let claims = parse_chatgpt_id_token_claims(&tokens.id_token);

        Ok(StoredAccount::new_chatgpt(
            account_name,
            claims.email,
            claims.plan_type,
            claims.subscription_expires_at,
            tokens.id_token,
            tokens.access_token,
            tokens.refresh_token,
            claims.account_id.or(tokens.account_id),
        ))
    } else {
        anyhow::bail!("auth.json contains neither API key nor tokens");
    }
}

/// Read the current auth.json file if it exists
pub fn read_current_auth() -> Result<Option<AuthDotJson>> {
    let path = get_codex_auth_file()?;

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read auth.json: {}", path.display()))?;

    let auth: AuthDotJson = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse auth.json: {}", path.display()))?;

    Ok(Some(auth))
}

/// Check if there is an active Codex login
pub fn has_active_login() -> Result<bool> {
    match read_current_auth()? {
        Some(auth) => Ok(auth.openai_api_key.is_some() || auth.tokens.is_some()),
        None => Ok(false),
    }
}

/// Find the stored account that matches the current Codex auth.json.
pub fn find_account_matching_auth<'a>(
    store: &'a AccountsStore,
    auth: &AuthDotJson,
) -> Option<&'a StoredAccount> {
    if let Some(api_key) = auth.openai_api_key.as_deref() {
        return store.accounts.iter().find(|account| {
            matches!(
                &account.auth_data,
                AuthData::ApiKey { key } if key == api_key
            )
        });
    }

    let current_tokens = auth.tokens.as_ref()?;
    let current_claims = parse_chatgpt_id_token_claims(&current_tokens.id_token);
    let current_account_id = current_tokens
        .account_id
        .as_deref()
        .or(current_claims.account_id.as_deref());

    if let Some(account_id) = current_account_id {
        if let Some(account) = store.accounts.iter().find(|account| {
            matches!(
                &account.auth_data,
                AuthData::ChatGPT {
                    account_id: Some(stored_account_id),
                    ..
                } if stored_account_id == account_id
            )
        }) {
            return Some(account);
        }
    }

    if let Some(account) = store.accounts.iter().find(|account| {
        matches!(
            &account.auth_data,
            AuthData::ChatGPT { refresh_token, .. }
                if refresh_token == &current_tokens.refresh_token
        )
    }) {
        return Some(account);
    }

    if let Some(account) = store.accounts.iter().find(|account| {
        matches!(
            &account.auth_data,
            AuthData::ChatGPT { id_token, .. }
                if id_token == &current_tokens.id_token
        )
    }) {
        return Some(account);
    }

    let current_email = current_claims.email.as_deref()?;
    let mut matches = store.accounts.iter().filter(|account| {
        matches!(account.auth_data, AuthData::ChatGPT { .. })
            && account.email.as_deref() == Some(current_email)
    });
    let first = matches.next()?;
    if matches.next().is_none() {
        Some(first)
    } else {
        None
    }
}

/// Resolve the active account from the actual Codex auth.json contents.
pub fn resolve_active_account_id_from_auth(
    store: &AccountsStore,
    auth: Option<&AuthDotJson>,
) -> Option<String> {
    auth.and_then(|auth| find_account_matching_auth(store, auth))
        .map(|account| account.id.clone())
}

/// Sync a loaded account store with the current Codex auth state.
///
/// Codex can rotate ChatGPT OAuth tokens while the switcher is not involved.
/// Persisting the rotated refresh token here prevents stored accounts from
/// later failing with "refresh token was already used".
pub fn sync_store_with_auth(store: &mut AccountsStore, auth: Option<&AuthDotJson>) -> bool {
    let active_account_id = auth
        .and_then(|auth| find_account_matching_auth(store, auth))
        .map(|account| account.id.clone());
    let mut changed = false;

    if store.active_account_id != active_account_id {
        store.active_account_id = active_account_id.clone();
        changed = true;
    }

    let (Some(auth), Some(account_id)) = (auth, active_account_id.as_deref()) else {
        return changed;
    };
    let Some(tokens) = auth.tokens.as_ref() else {
        return changed;
    };

    let claims = parse_chatgpt_id_token_claims(&tokens.id_token);
    let auth_account_id = tokens.account_id.clone().or(claims.account_id);
    let Some(account) = store
        .accounts
        .iter_mut()
        .find(|account| account.id == account_id)
    else {
        return changed;
    };

    if let AuthData::ChatGPT {
        id_token,
        access_token,
        refresh_token,
        account_id: stored_account_id,
    } = &mut account.auth_data
    {
        if *id_token != tokens.id_token {
            *id_token = tokens.id_token.clone();
            changed = true;
        }
        if *access_token != tokens.access_token {
            *access_token = tokens.access_token.clone();
            changed = true;
        }
        if *refresh_token != tokens.refresh_token {
            *refresh_token = tokens.refresh_token.clone();
            changed = true;
        }
        if let Some(auth_account_id) = auth_account_id {
            if stored_account_id.as_deref() != Some(auth_account_id.as_str()) {
                *stored_account_id = Some(auth_account_id);
                changed = true;
            }
        }
    }

    let claims = parse_chatgpt_id_token_claims(&tokens.id_token);
    if let Some(email) = claims.email {
        if account.email.as_deref() != Some(email.as_str()) {
            account.email = Some(email);
            changed = true;
        }
    }
    if let Some(plan_type) = claims.plan_type {
        if account.plan_type.as_deref() != Some(plan_type.as_str()) {
            account.plan_type = Some(plan_type);
            changed = true;
        }
    }
    if let Some(subscription_expires_at) = claims.subscription_expires_at {
        if account.subscription_expires_at != Some(subscription_expires_at) {
            account.subscription_expires_at = Some(subscription_expires_at);
            changed = true;
        }
    }

    changed
}

/// Keep accounts.json active state in sync with the auth file Codex actually reads.
pub fn load_accounts_synced_with_current_auth() -> Result<AccountsStore> {
    let current_auth = read_current_auth()?;
    mutate_accounts_if_changed(|store| {
        let changed = sync_store_with_auth(store, current_auth.as_ref());
        Ok((store.clone(), changed))
    })
}

#[cfg(test)]
mod tests {
    use super::{
        find_account_matching_auth, resolve_active_account_id_from_auth, sync_store_with_auth,
    };
    use crate::types::{AccountsStore, AuthData, AuthDotJson, StoredAccount, TokenData};
    use base64::Engine;

    fn test_id_token(email: &str, account_id: Option<&str>) -> String {
        let auth_claims = match account_id {
            Some(account_id) => {
                format!(r#","https://api.openai.com/auth":{{"chatgpt_account_id":"{account_id}"}}"#)
            }
            None => String::new(),
        };
        let payload = format!(r#"{{"email":"{email}"{auth_claims}}}"#);
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload);
        format!("header.{encoded}.signature")
    }

    fn chatgpt_account(name: &str, email: &str, account_id: &str) -> StoredAccount {
        StoredAccount::new_chatgpt(
            name.to_string(),
            Some(email.to_string()),
            Some("plus".to_string()),
            None,
            test_id_token(email, Some(account_id)),
            format!("{name}-access"),
            format!("{name}-refresh"),
            Some(account_id.to_string()),
        )
    }

    #[test]
    fn matches_current_chatgpt_auth_by_account_id_after_tokens_rotate() {
        let old_account = chatgpt_account("old", "old@example.com", "acct_old");
        let current_account = chatgpt_account("current", "current@example.com", "acct_current");
        let store = AccountsStore {
            version: 1,
            accounts: vec![old_account, current_account.clone()],
            active_account_id: Some("stale-active-id".to_string()),
            masked_account_ids: Vec::new(),
        };
        let auth = AuthDotJson {
            openai_api_key: None,
            tokens: Some(TokenData {
                id_token: test_id_token("current@example.com", Some("acct_current")),
                access_token: "rotated-access".to_string(),
                refresh_token: "rotated-refresh".to_string(),
                account_id: Some("acct_current".to_string()),
            }),
            last_refresh: None,
        };

        let matched = find_account_matching_auth(&store, &auth);

        assert_eq!(
            matched.map(|account| account.id.as_str()),
            Some(current_account.id.as_str())
        );
    }

    #[test]
    fn resolved_active_account_uses_current_auth_instead_of_stored_active_id() {
        let old_account = chatgpt_account("old", "old@example.com", "acct_old");
        let current_account = chatgpt_account("current", "current@example.com", "acct_current");
        let store = AccountsStore {
            version: 1,
            accounts: vec![old_account.clone(), current_account.clone()],
            active_account_id: Some(old_account.id),
            masked_account_ids: Vec::new(),
        };
        let auth = AuthDotJson {
            openai_api_key: None,
            tokens: Some(TokenData {
                id_token: test_id_token("current@example.com", Some("acct_current")),
                access_token: "rotated-access".to_string(),
                refresh_token: "rotated-refresh".to_string(),
                account_id: Some("acct_current".to_string()),
            }),
            last_refresh: None,
        };

        assert_eq!(
            resolve_active_account_id_from_auth(&store, Some(&auth)),
            Some(current_account.id)
        );
    }

    #[test]
    fn sync_store_updates_rotated_tokens_for_current_auth() {
        let old_account = chatgpt_account("old", "old@example.com", "acct_old");
        let current_account = chatgpt_account("current", "current@example.com", "acct_current");
        let current_id = current_account.id.clone();
        let mut store = AccountsStore {
            version: 1,
            accounts: vec![old_account.clone(), current_account],
            active_account_id: Some(old_account.id),
            masked_account_ids: Vec::new(),
        };
        let auth = AuthDotJson {
            openai_api_key: None,
            tokens: Some(TokenData {
                id_token: test_id_token("current@example.com", Some("acct_current")),
                access_token: "rotated-access".to_string(),
                refresh_token: "rotated-refresh".to_string(),
                account_id: Some("acct_current".to_string()),
            }),
            last_refresh: None,
        };

        assert!(sync_store_with_auth(&mut store, Some(&auth)));
        assert_eq!(
            store.active_account_id.as_deref(),
            Some(current_id.as_str())
        );

        let account = store
            .accounts
            .iter()
            .find(|account| account.id == current_id)
            .expect("current account exists");
        match &account.auth_data {
            AuthData::ChatGPT {
                access_token,
                refresh_token,
                account_id,
                ..
            } => {
                assert_eq!(access_token, "rotated-access");
                assert_eq!(refresh_token, "rotated-refresh");
                assert_eq!(account_id.as_deref(), Some("acct_current"));
            }
            AuthData::ApiKey { .. } => panic!("expected ChatGPT account"),
        }
    }
}
