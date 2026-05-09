"""Authentication helpers for the shared app access token."""

from __future__ import annotations

import os
from secrets import compare_digest

from fastapi import Header, HTTPException


def get_expected_AUTH_TOKEN() -> str:
    """Return the configured shared access token or fail safely."""

    token = os.getenv("AUTH_TOKEN", "").strip()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="AUTH_TOKEN is not configured on the server.",
        )
    return token


def is_valid_AUTH_TOKEN(token: str) -> bool:
    """Check whether the provided token matches the configured shared secret."""

    provided_token = token.strip()
    if not provided_token:
        return False

    expected_token = get_expected_AUTH_TOKEN()
    return compare_digest(provided_token, expected_token)


def require_AUTH_TOKEN(authorization: str | None = Header(default=None)) -> str:
    """Validate the Authorization header for protected endpoints."""

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header.")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header.")

    if not is_valid_AUTH_TOKEN(token):
        raise HTTPException(status_code=401, detail="Invalid access token.")

    return token.strip()