"""Authentication utilities.

- X.509 parsing/validation: cryptography (PyCA)
- Issue-password hashing: hashlib.scrypt (Python standard library)
- Sessions/rate limits: secrets + stdlib collections
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.x509.oid import NameOID

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
SCRYPT_MAXMEM = 64 * 1024 * 1024

SESSION_COOKIE = "admin_session"
SESSION_TTL_SECS = int(os.getenv("ADMIN_SESSION_HOURS", "8")) * 3600
MAX_CERT_BYTES = 64 * 1024

LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECS = 300
ROOM_PW_MAX_ATTEMPTS = 8
ROOM_PW_WINDOW_SECS = 300

_admin_sessions: dict[str, float] = {}
_attempt_log: dict[str, list[float]] = defaultdict(list)

_FINGERPRINT_RE = re.compile(r"^[a-f0-9]{64}$")


@dataclass(frozen=True)
class ParsedCertificate:
    fingerprint: str
    subject: str


def normalize_fingerprint(value: str) -> str | None:
    raw = value.strip().lower()
    if raw.startswith("sha256:"):
        raw = raw[7:]
    raw = raw.replace(":", "").replace(" ", "")
    if _FINGERPRINT_RE.fullmatch(raw):
        return raw
    return None


def env_cert_fingerprints() -> set[str]:
    raw = os.getenv("ADMIN_CERT_FINGERPRINTS", "")
    fps: set[str] = set()
    for part in raw.split(","):
        fp = normalize_fingerprint(part)
        if fp:
            fps.add(fp)
    return fps


def env_admin_configured() -> bool:
    return bool(env_cert_fingerprints())


def _cert_validity(cert: x509.Certificate) -> tuple[datetime, datetime]:
    if hasattr(cert, "not_valid_before_utc"):
        return cert.not_valid_before_utc, cert.not_valid_after_utc
    return (
        cert.not_valid_before.replace(tzinfo=timezone.utc),
        cert.not_valid_after.replace(tzinfo=timezone.utc),
    )


def _cert_subject(cert: x509.Certificate) -> str:
    attrs = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
    if attrs:
        return str(attrs[0].value)[:128]
    return cert.subject.rfc4514_string()[:128]


def _load_x509_certificate(data: bytes) -> x509.Certificate:
    if b"-----BEGIN" in data:
        return x509.load_pem_x509_certificate(data)
    return x509.load_der_x509_certificate(data)


def parse_certificate_bytes(data: bytes) -> ParsedCertificate:
    if not data or len(data) > MAX_CERT_BYTES:
        raise ValueError("Certificate file is empty or too large")

    try:
        cert = _load_x509_certificate(data)
    except Exception as exc:
        raise ValueError("Invalid certificate format") from exc

    now = datetime.now(timezone.utc)
    not_before, not_after = _cert_validity(cert)
    if now < not_before or now > not_after:
        raise ValueError("Certificate is expired or not yet valid")

    der = cert.public_bytes(encoding=serialization.Encoding.DER)
    fingerprint = hashlib.sha256(der).hexdigest()
    return ParsedCertificate(fingerprint=fingerprint, subject=_cert_subject(cert))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        maxmem=SCRYPT_MAXMEM,
        dklen=SCRYPT_DKLEN,
    )
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not password or not stored:
        return False
    try:
        algo, salt_hex, digest_hex = stored.split("$", 2)
        if algo != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False
    try:
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=SCRYPT_N,
            r=SCRYPT_R,
            p=SCRYPT_P,
            maxmem=SCRYPT_MAXMEM,
            dklen=SCRYPT_DKLEN,
        )
    except ValueError:
        return False
    return secrets.compare_digest(derived, expected)


def generate_issue_password() -> str:
    raw = secrets.token_hex(6).upper()
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"


def create_admin_session() -> str:
    token = secrets.token_urlsafe(32)
    _admin_sessions[token] = time.time() + SESSION_TTL_SECS
    return token


def validate_admin_session(token: str | None) -> bool:
    if not token:
        return False
    expiry = _admin_sessions.get(token)
    if not expiry:
        return False
    now = time.time()
    if now > expiry:
        _admin_sessions.pop(token, None)
        return False
    _admin_sessions[token] = now + SESSION_TTL_SECS
    return True


def revoke_admin_session(token: str | None) -> None:
    if token:
        _admin_sessions.pop(token, None)


def _prune_attempts(key: str, window: float) -> None:
    cutoff = time.time() - window
    attempts = _attempt_log[key]
    _attempt_log[key] = [t for t in attempts if t > cutoff]


def rate_limit_allowed(key: str, max_attempts: int, window: float) -> bool:
    _prune_attempts(key, window)
    return len(_attempt_log[key]) < max_attempts


def record_failed_attempt(key: str) -> None:
    _attempt_log[key].append(time.time())


def cookie_flags(request_scheme: str | None) -> dict:
    secure = request_scheme == "https"
    return {
        "httponly": True,
        "samesite": "strict",
        "secure": secure,
        "path": "/",
        "max_age": SESSION_TTL_SECS,
    }