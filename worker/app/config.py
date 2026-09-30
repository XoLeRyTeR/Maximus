from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import quote


def setting(name: str) -> str | None:
    if value := os.environ.get(name, "").strip():
        return value
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        match = re.match(rf"(?:export\s+)?{re.escape(name)}\s*=\s*(.*)$", line)
        if match:
            return match.group(1).strip().strip('"').strip("'") or None
    return None


def database_url() -> str | None:
    host = os.environ.get("DB_HOST", "").strip()
    if host:
        user = os.environ.get("DB_USER", "").strip()
        password = os.environ.get("DB_PASSWORD", "")
        database = os.environ.get("DB_NAME", "").strip()
        if not (user and password and database):
            raise ValueError("DB_HOST requires DB_USER, DB_PASSWORD and DB_NAME")
        return f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}@{host}/{quote(database, safe='')}"
    value = setting("DATABASE_URL")
    return value.replace("postgresql+psycopg://", "postgresql://", 1) if value else None
