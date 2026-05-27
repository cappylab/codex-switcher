//! ChatGPT OAuth token refresh helpers

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{Context, Result};
use base64::Engine;
use chrono::Utc;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use tokio::time::{sleep, Duration};

use super::{
    load_accounts_synced_with_current_auth, switch_to_account, update_account_chatgpt_tokens,
};
use crate::types::{parse_chatgpt_id_token_claims, AuthData, StoredAccount};

const DEFAULT_ISSUER: &str = "https://auth.openai.com";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const EXPIRY_SKEW_SECONDS: i64 = 60;

static ACCOUNT_REFRESH_LOCKS: OnceLock<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> =
    OnceLock::new();

#[derive(Debug, serde::Deserialize)]
struct RefreshTokenResponse {
    #[serde(default)]
    id_token: Option<String>,
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

/// Ensure the account has a non-expired ChatGPT access token.
/// Returns an updated account when a refresh was performed.
pub async fn ensure_chatgpt_tokens_fresh(account: &StoredAccount) -> Result<StoredAccount> {
    match &account.auth_data {
        AuthData::ApiKey { .. } => Ok(account.clone()),
        AuthData::ChatGPT { access_token, .. } => {
            if token_expired_or_near_expiry(access_token) {
                println!(
                    "[Auth] Access token expired/near expiry for account {}, refreshing",
                    account.name
                );
                refresh_chatgpt_tokens(account).await
            } else {
                Ok(account.clone())
            }
        }
    }
}

/// Force-refresh ChatGPT OAuth tokens for an account.
pub async fn refresh_chatgpt_tokens(account: &StoredAccount) -> Result<StoredAccount> {
    if matches!(&account.auth_data, AuthData::ApiKey { .. }) {
        return Ok(account.clone());
    }

    let _refresh_guard = acquire_account_refresh_lock(&account.id).await;
    let store = load_accounts_synced_with_current_auth()?;
    let is_active = store.active_account_id.as_deref() == Some(account.id.as_str());

    let account_to_refresh = match store
        .accounts
        .into_iter()
        .find(|stored_account| stored_account.id == account.id)
    {
        Some(stored_account) => {
            if stored_refresh_token_rotated_since_request(account, &stored_account) {
                return Ok(stored_account);
            }
            stored_account
        }
        None => account.clone(),
    };

    let (current_id_token, current_refresh_token, current_account_id) =
        match &account_to_refresh.auth_data {
            AuthData::ApiKey { .. } => return Ok(account.clone()),
            AuthData::ChatGPT {
                id_token,
                refresh_token,
                account_id,
                ..
            } => (id_token.clone(), refresh_token.clone(), account_id.clone()),
        };

    if current_refresh_token.is_empty() {
        anyhow::bail!(
            "Missing refresh token for account {}",
            account_to_refresh.name
        );
    }

    let refreshed = refresh_tokens_with_refresh_token(&current_refresh_token).await?;
    let next_id_token = refreshed.id_token.unwrap_or(current_id_token);
    let next_refresh_token = refreshed
        .refresh_token
        .unwrap_or_else(|| current_refresh_token.clone());

    let claims = parse_chatgpt_id_token_claims(&next_id_token);
    let next_account_id = claims.account_id.or(current_account_id);

    let updated = update_account_chatgpt_tokens(
        &account_to_refresh.id,
        next_id_token,
        refreshed.access_token,
        next_refresh_token,
        next_account_id,
        claims.email,
        claims.plan_type,
        claims.subscription_expires_at,
    )?;

    // Keep ~/.codex/auth.json in sync when this is the active account.
    if is_active {
        if let Err(err) = switch_to_account(&updated) {
            println!("[Auth] Failed to sync active auth.json after token refresh: {err}");
        }
    }

    Ok(updated)
}

/// Build a new ChatGPT account from a refresh token.
/// This is used by slim import to recreate full credentials.
pub async fn create_chatgpt_account_from_refresh_token(
    account_name: String,
    refresh_token: String,
) -> Result<StoredAccount> {
    if refresh_token.trim().is_empty() {
        anyhow::bail!("Missing refresh token for account {account_name}");
    }

    let refreshed = refresh_tokens_with_refresh_token(&refresh_token).await?;
    let id_token = refreshed
        .id_token
        .context("Refresh response did not include id_token")?;
    let next_refresh_token = refreshed.refresh_token.unwrap_or(refresh_token);
    let claims = parse_chatgpt_id_token_claims(&id_token);

    Ok(StoredAccount::new_chatgpt(
        account_name,
        claims.email,
        claims.plan_type,
        claims.subscription_expires_at,
        id_token,
        refreshed.access_token,
        next_refresh_token,
        claims.account_id,
    ))
}

fn token_expired_or_near_expiry(access_token: &str) -> bool {
    match parse_jwt_exp(access_token) {
        Some(expiry) => expiry <= Utc::now().timestamp() + EXPIRY_SKEW_SECONDS,
        None => false,
    }
}

fn parse_jwt_exp(token: &str) -> Option<i64> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    json.get("exp").and_then(|v| v.as_i64())
}

async fn refresh_tokens_with_refresh_token(refresh_token: &str) -> Result<RefreshTokenResponse> {
    let client = reqwest::Client::new();
    let body = format!(
        "grant_type=refresh_token&refresh_token={}&client_id={}",
        urlencoding::encode(refresh_token),
        urlencoding::encode(CLIENT_ID),
    );

    let mut last_send_error = None;
    let mut response = None;

    for attempt in 1..=3u8 {
        match client
            .post(format!("{DEFAULT_ISSUER}/oauth/token"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body.clone())
            .send()
            .await
        {
            Ok(resp) => {
                response = Some(resp);
                break;
            }
            Err(err) => {
                last_send_error = Some(err);
                if attempt < 3 {
                    sleep(Duration::from_millis(250 * u64::from(attempt))).await;
                }
            }
        }
    }

    let response = match response {
        Some(resp) => resp,
        None => {
            let err = last_send_error.context("Failed to send token refresh request")?;
            return Err(err.into());
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Token refresh failed: {status} - {body}");
    }

    response
        .json::<RefreshTokenResponse>()
        .await
        .context("Failed to parse token refresh response")
}

async fn acquire_account_refresh_lock(account_id: &str) -> OwnedMutexGuard<()> {
    let account_lock = {
        let locks = ACCOUNT_REFRESH_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
        let mut locks = locks.lock().expect("account refresh lock poisoned");
        locks
            .entry(account_id.to_string())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    };

    account_lock.lock_owned().await
}

fn stored_refresh_token_rotated_since_request(
    requested: &StoredAccount,
    latest: &StoredAccount,
) -> bool {
    if requested.id != latest.id {
        return false;
    }

    match (
        chatgpt_refresh_token(requested),
        chatgpt_refresh_token(latest),
    ) {
        (Some(requested_refresh_token), Some(latest_refresh_token)) => {
            requested_refresh_token != latest_refresh_token
        }
        _ => false,
    }
}

fn chatgpt_refresh_token(account: &StoredAccount) -> Option<&str> {
    match &account.auth_data {
        AuthData::ChatGPT { refresh_token, .. } => Some(refresh_token.as_str()),
        AuthData::ApiKey { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::stored_refresh_token_rotated_since_request;
    use crate::types::StoredAccount;

    fn chatgpt_account(refresh_token: &str) -> StoredAccount {
        StoredAccount::new_chatgpt(
            "test".to_string(),
            Some("test@example.com".to_string()),
            Some("plus".to_string()),
            None,
            "header.payload.signature".to_string(),
            "access-token".to_string(),
            refresh_token.to_string(),
            Some("acct_test".to_string()),
        )
    }

    #[test]
    fn detects_refresh_token_rotated_after_request_started() {
        let requested = chatgpt_account("old-refresh-token");
        let mut latest = requested.clone();
        if let crate::types::AuthData::ChatGPT { refresh_token, .. } = &mut latest.auth_data {
            *refresh_token = "new-refresh-token".to_string();
        }

        assert!(stored_refresh_token_rotated_since_request(
            &requested, &latest
        ));
    }

    #[test]
    fn does_not_report_rotation_when_refresh_token_matches() {
        let requested = chatgpt_account("same-refresh-token");
        let latest = requested.clone();

        assert!(!stored_refresh_token_rotated_since_request(
            &requested, &latest
        ));
    }
}
