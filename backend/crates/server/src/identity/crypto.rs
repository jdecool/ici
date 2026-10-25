use super::Error;
use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, AeadCore, OsRng as AeadRng},
};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};

pub fn token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
pub fn digest(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
pub async fn hash_password(password: String) -> Result<String, Error> {
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|hash| hash.to_string())
            .map_err(Error::internal_from)
    })
    .await
    .map_err(Error::internal_from)?
}
pub async fn verify_password(password: String, hash: String) -> Result<bool, Error> {
    tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(password.as_bytes(), &hash)
                .is_ok()
        })
    })
    .await
    .map_err(Error::internal_from)
}
pub fn encrypt(key: &[u8], value: &str) -> Result<String, Error> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(Error::internal_from)?;
    let nonce = Aes256Gcm::generate_nonce(&mut AeadRng);
    let ciphertext = cipher
        .encrypt(&nonce, value.as_bytes())
        .map_err(Error::internal_from)?;
    Ok(hex::encode(
        [nonce.as_slice(), ciphertext.as_slice()].concat(),
    ))
}
pub fn decrypt(key: &[u8], value: &str) -> Result<String, Error> {
    let bytes = hex::decode(value).map_err(Error::internal_from)?;
    if bytes.len() < 28 {
        return Err(Error::internal());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(Error::internal_from)?;
    let plaintext = cipher
        .decrypt(bytes[..12].into(), &bytes[12..])
        .map_err(Error::internal_from)?;
    String::from_utf8(plaintext).map_err(Error::internal_from)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn hashes_and_authenticated_encryption() -> Result<(), Error> {
        let password = "a long pass phrase".to_owned();
        let hash = hash_password(password.clone()).await?;
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password(password, hash.clone()).await?);
        assert!(!verify_password("wrong".into(), hash).await?);
        assert!(!verify_password("wrong".into(), "invalid".into()).await?);
        let key = [1u8; 32];
        let empty = encrypt(&key, "")?;
        assert_eq!(decrypt(&key, &empty)?, "");
        let encrypted = encrypt(&key, "sensitive")?;
        assert_eq!(decrypt(&key, &encrypted)?, "sensitive");
        assert!(decrypt(&[2u8; 32], &encrypted).is_err());
        assert!(decrypt(&key, "00").is_err());
        assert!(decrypt(&key, "zz").is_err());
        assert!(encrypt(&[], "text").is_err());
        assert_ne!(token(), token());
        assert_eq!(digest("a").len(), 64);
        Ok(())
    }
}
