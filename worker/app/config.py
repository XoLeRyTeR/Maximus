from __future__ import annotations

import os
import re
from pathlib import Path


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
    value = setting("DATABASE_URL")
    return value.replace("postgresql+psycopg://", "postgresql://", 1) if value else None
