"""
Authentication and Role-Based Access Control utilities.

Uses werkzeug.security when installed, with a compatible PBKDF2-SHA256 fallback
in Python stdlib so password hashing works in every environment.
Implements HS256 JWT tokens signed with JWT_SECRET.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

try:
    from werkzeug.security import check_password_hash as _wz_check
    from werkzeug.security import generate_password_hash as _wz_hash

    HAS_WERKZEUG = True
except ImportError:
    HAS_WERKZEUG = False


PBKDF2_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    if not password or len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    if HAS_WERKZEUG:
        return _wz_hash(password, method="pbkdf2:sha256:260000")
    salt = os.urandom(16).hex()
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS)
    return f"pbkdf2:sha256:{PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not password or not stored_hash:
        return False
    if HAS_WERKZEUG and stored_hash.startswith(("pbkdf2:", "scrypt:")):
        try:
            return _wz_check(stored_hash, password)
        except Exception:
            pass
    try:
        method_part, salt, expected_hex = stored_hash.split("$", 2)
        parts = method_part.split(":")
        iterations = int(parts[2]) if len(parts) >= 3 else PBKDF2_ITERATIONS
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
        return hmac.compare_digest(dk.hex(), expected_hex)
    except Exception:
        return False


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def create_access_token(
    user_id: int,
    email: str,
    role: str,
    secret: str,
    expiry_hours: int = 24,
) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user_id),
        "user_id": user_id,
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + expiry_hours * 3600,
    }
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url_encode(sig)}"


def decode_access_token(token: str, secret: str) -> dict[str, Any] | None:
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    header_b64, payload_b64, sig_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    try:
        actual_sig = _b64url_decode(sig_b64)
    except Exception:
        return None
    if not hmac.compare_digest(expected_sig, actual_sig):
        return None
    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload
