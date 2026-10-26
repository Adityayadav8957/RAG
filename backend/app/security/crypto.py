"""Encryption of third-party tokens at rest (Fernet / AES-128-CBC + HMAC)."""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings, get_settings


class TokenCipher:
    def __init__(self, key: str) -> None:
        self._fernet = Fernet(key.encode())

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        try:
            return self._fernet.decrypt(ciphertext.encode()).decode()
        except InvalidToken as exc:  # pragma: no cover - indicates key rotation/corruption
            raise ValueError("Stored token could not be decrypted") from exc


def get_cipher(settings: Settings | None = None) -> TokenCipher:
    settings = settings or get_settings()
    if settings.token_encryption_key is None:
        if settings.environment != "local":
            raise RuntimeError("TOKEN_ENCRYPTION_KEY is required")
        # Deterministic dev key so local restarts keep working. Never used outside local.
        return TokenCipher("ZGV2LW9ubHktZGV2LW9ubHktZGV2LW9ubHktMTIzNDU=")
    return TokenCipher(settings.token_encryption_key.get_secret_value())
