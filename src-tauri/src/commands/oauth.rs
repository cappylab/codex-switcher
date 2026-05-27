//! OAuth login Tauri commands

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

use crate::auth::oauth_server::{start_oauth_login, wait_for_oauth_login, OAuthLoginResult};
use crate::auth::{
    add_account, load_accounts_synced_with_current_auth, set_active_account, switch_to_account,
    touch_account,
};
use crate::types::{AccountInfo, OAuthLoginInfo};

struct PendingOAuth {
    rx: oneshot::Receiver<anyhow::Result<OAuthLoginResult>>,
    cancelled: Arc<AtomicBool>,
}

// Global state for pending OAuth login
static PENDING_OAUTH: Mutex<Option<PendingOAuth>> = Mutex::new(None);

/// Start the OAuth login flow
#[tauri::command]
pub async fn start_login(account_name: String) -> Result<OAuthLoginInfo, String> {
    // Cancel any previous pending flow so it does not keep the callback port occupied.
    if let Some(previous) = {
        let mut pending = PENDING_OAUTH.lock().unwrap();
        pending.take()
    } {
        previous.cancelled.store(true, Ordering::Relaxed);
    }

    let (info, rx, cancelled) = start_oauth_login(account_name)
        .await
        .map_err(|e| e.to_string())?;

    // Store the receiver for later
    {
        let mut pending = PENDING_OAUTH.lock().unwrap();
        *pending = Some(PendingOAuth { rx, cancelled });
    }

    Ok(info)
}

/// Wait for the OAuth login to complete and add the account
#[tauri::command]
pub async fn complete_login() -> Result<AccountInfo, String> {
    let pending = {
        let mut pending = PENDING_OAUTH.lock().unwrap();
        pending
            .take()
            .ok_or_else(|| "No pending OAuth login".to_string())?
    };

    let account = wait_for_oauth_login(pending.rx)
        .await
        .map_err(|e| e.to_string())?;
    let previous_store = load_accounts_synced_with_current_auth().map_err(|e| e.to_string())?;
    let previous_active_id = previous_store.active_account_id.clone();

    // Add the account to storage
    let stored = add_account(account).map_err(|e| e.to_string())?;

    if should_activate_added_oauth_account(previous_active_id.as_deref(), &stored.id) {
        set_active_account(&stored.id).map_err(|e| e.to_string())?;
        switch_to_account(&stored).map_err(|e| e.to_string())?;
        touch_account(&stored.id).map_err(|e| e.to_string())?;
    }

    let store = load_accounts_synced_with_current_auth().map_err(|e| e.to_string())?;
    let active_id = store.active_account_id.as_deref();

    Ok(AccountInfo::from_stored(&stored, active_id))
}

fn should_activate_added_oauth_account(
    previous_active_id: Option<&str>,
    _new_account_id: &str,
) -> bool {
    previous_active_id.is_none()
}

/// Cancel a pending OAuth login
#[tauri::command]
pub async fn cancel_login() -> Result<(), String> {
    let mut pending = PENDING_OAUTH.lock().unwrap();
    if let Some(pending_oauth) = pending.take() {
        pending_oauth.cancelled.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_activate_added_oauth_account;

    #[test]
    fn oauth_add_does_not_replace_an_existing_active_account() {
        assert!(!should_activate_added_oauth_account(
            Some("existing-account"),
            "new-account"
        ));
    }

    #[test]
    fn oauth_add_activates_the_first_account() {
        assert!(should_activate_added_oauth_account(None, "new-account"));
    }
}
