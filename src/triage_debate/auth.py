"""Accounts and sessions for the PrioriHealth web app (stdlib only, so it runs on s390x).

Users belong to one of a fixed list of fictional hospitals. Passwords are hashed with scrypt;
session tokens are random and only their SHA-256 is stored. Every hospital in this module is
invented for the demo; none refers to a real organization.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

HOSPITALS: list[dict[str, str]] = [
    {"id": "riverbend", "name": "Riverbend General Hospital", "city": "Riverbend",
     "description": "Level II trauma center, 48 ED beds"},
    {"id": "sage-valley", "name": "Sage Valley Medical Center", "city": "Sage Valley",
     "description": "Academic medical center, 62 ED beds"},
    {"id": "northgate", "name": "Northgate Community Hospital", "city": "Northgate",
     "description": "Community hospital, 22 ED beds"},
    {"id": "cedar-ridge", "name": "Cedar Ridge Memorial Hospital", "city": "Cedar Ridge",
     "description": "Regional referral center, 36 ED beds"},
    {"id": "willow-creek", "name": "Willow Creek Children's Hospital", "city": "Willow Creek",
     "description": "Pediatric emergency department, 28 beds"},
    {"id": "summit-heights", "name": "Summit Heights Medical Center", "city": "Summit Heights",
     "description": "Urban medical center, 54 ED beds"},
    {"id": "lakeshore", "name": "Lakeshore Regional Hospital", "city": "Lakeshore",
     "description": "Regional hospital, 30 ED beds"},
    {"id": "meadowbrook", "name": "Meadowbrook Rural Health Center", "city": "Meadowbrook",
     "description": "Critical access hospital, 8 ED beds"},
]
HOSPITAL_IDS = {h["id"] for h in HOSPITALS}
ROLES = ["Triage Nurse", "Emergency Physician", "Charge Nurse", "Administrator"]

DEMO_EMAIL = "demo@priorihealth.demo"
DEMO_NAME = "Demo Clinician"
DEMO_HOSPITAL = "riverbend"
DEMO_ROLE = "Charge Nurse"

SESSION_COOKIE = "ph_session"
SESSION_TTL_S = 7 * 24 * 3600
MIN_PASSWORD = 8
MAX_FAILURES = 10
FAILURE_WINDOW_S = 15 * 60
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hospital(hospital_id: str) -> dict[str, str] | None:
    return next((h for h in HOSPITALS if h["id"] == hospital_id), None)


class AuthStore:
    """SQLite-backed users and sessions, plus in-memory sign-in throttling."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        with self._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    hospital_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    created_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    token_sha256 TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at REAL NOT NULL);
            """)

    def _db(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def _public(row: sqlite3.Row) -> dict[str, Any]:
        h = hospital(row["hospital_id"]) or {"id": row["hospital_id"], "name": row["hospital_id"]}
        return {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"],
                "hospital": h, "demo": row["email"] == DEMO_EMAIL}

    # -- throttling
    def _throttled(self, *keys: str) -> bool:
        now = time.time()
        with self._lock:
            for k in keys:
                q = self._failures[k]
                while q and q[0] < now - FAILURE_WINDOW_S:
                    q.popleft()
                if len(q) >= MAX_FAILURES:
                    return True
        return False

    def _record_failure(self, *keys: str) -> None:
        now = time.time()
        with self._lock:
            for k in keys:
                self._failures[k].append(now)

    # -- users
    def create_user(self, *, email: str, name: str, password: str, hospital_id: str,
                    role: str) -> dict[str, Any]:
        email = email.strip().lower()
        name = name.strip()
        if not _EMAIL_RE.match(email) or len(email) > 254:
            raise AuthError(422, "Enter a valid email address.")
        if not 1 <= len(name) <= 100:
            raise AuthError(422, "Enter your name.")
        if len(password) < MIN_PASSWORD or len(password) > 200:
            raise AuthError(422, f"Password must be at least {MIN_PASSWORD} characters.")
        if hospital_id not in HOSPITAL_IDS:
            raise AuthError(422, "Choose a hospital from the list.")
        if role not in ROLES:
            raise AuthError(422, "Choose a role from the list.")
        try:
            with self._db() as db:
                cur = db.execute(
                    "INSERT INTO users (email, name, password_hash, hospital_id, role, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (email, name, hash_password(password), hospital_id, role, time.time()))
                row = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
        except sqlite3.IntegrityError:
            raise AuthError(409, "An account with this email already exists.") from None
        return self._public(row)

    def authenticate(self, email: str, password: str, ip: str = "") -> dict[str, Any]:
        email = email.strip().lower()
        keys = (f"email:{email}", f"ip:{ip}")
        if self._throttled(*keys):
            raise AuthError(429, "Too many sign-in attempts. Try again in a few minutes.")
        with self._db() as db:
            row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if row is None or email == DEMO_EMAIL or not verify_password(password, row["password_hash"]):
            self._record_failure(*keys)
            raise AuthError(401, "Invalid email or password.")
        return self._public(row)

    def demo_user(self) -> dict[str, Any]:
        """The shared demo account (created on first use; it has no usable password)."""
        with self._db() as db:
            row = db.execute("SELECT * FROM users WHERE email = ?", (DEMO_EMAIL,)).fetchone()
            if row is None:
                db.execute(
                    "INSERT OR IGNORE INTO users (email, name, password_hash, hospital_id, role, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (DEMO_EMAIL, DEMO_NAME, "disabled", DEMO_HOSPITAL, DEMO_ROLE, time.time()))
                row = db.execute("SELECT * FROM users WHERE email = ?", (DEMO_EMAIL,)).fetchone()
        return self._public(row)

    # -- sessions
    def create_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._db() as db:
            db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            db.execute("INSERT INTO sessions (token_sha256, user_id, expires_at) VALUES (?, ?, ?)",
                       (_token_hash(token), user_id, now + SESSION_TTL_S))
        return token

    def user_for_token(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        with self._db() as db:
            row = db.execute(
                "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_sha256 = ? AND sessions.expires_at > ?",
                (_token_hash(token), time.time())).fetchone()
        return self._public(row) if row else None

    def delete_session(self, token: str | None) -> None:
        if token:
            with self._db() as db:
                db.execute("DELETE FROM sessions WHERE token_sha256 = ?", (_token_hash(token),))
