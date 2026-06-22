use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts, StatusCode},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const SECRET: &str = "inochi-secret-key-change-in-production";

// Byte-for-byte the header jsonwebtoken emitted for HS256, so tokens issued
// before this hand-rolled signer remain valid.
const HEADER: &str = r#"{"typ":"JWT","alg":"HS256"}"#;

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

fn sign(signing_input: &str) -> Vec<u8> {
    let mut mac =
        HmacSha256::new_from_slice(SECRET.as_bytes()).expect("HMAC accepts any key length");
    mac.update(signing_input.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

pub fn create_token(user_id: &str) -> Result<String, StatusCode> {
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(7))
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
        .timestamp() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        exp,
    };
    let payload = serde_json::to_vec(&claims).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let signing_input = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(HEADER),
        URL_SAFE_NO_PAD.encode(payload)
    );
    let sig = URL_SAFE_NO_PAD.encode(sign(&signing_input));
    Ok(format!("{}.{}", signing_input, sig))
}

fn verify_token(token: &str) -> Result<String, StatusCode> {
    let (signing_input, sig) = token.rsplit_once('.').ok_or(StatusCode::UNAUTHORIZED)?;
    let (_, payload_b64) = signing_input
        .split_once('.')
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let sig = URL_SAFE_NO_PAD.decode(sig).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let mut mac =
        HmacSha256::new_from_slice(SECRET.as_bytes()).expect("HMAC accepts any key length");
    mac.update(signing_input.as_bytes());
    mac.verify_slice(&sig).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let payload = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    let claims: Claims = serde_json::from_slice(&payload).map_err(|_| StatusCode::UNAUTHORIZED)?;
    if (claims.exp as i64) < chrono::Utc::now().timestamp() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(claims.sub)
}

/// Extractor that validates JWT and provides user_id
pub struct AuthUser(pub String);

impl<S: Send + Sync> FromRequestParts<S> for AuthUser {
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let user_id = verify_token(token)?;
        Ok(AuthUser(user_id))
    }
}
