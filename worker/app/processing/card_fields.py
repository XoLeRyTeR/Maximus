from __future__ import annotations

import re


TYPE_PATTERNS = (
    (re.compile(r"\bгрант\w*\b", re.IGNORECASE), "Грант"),
    (re.compile(r"\bсубсиди\w*\b", re.IGNORECASE), "Субсидия"),
    (re.compile(r"\bльготн\w*\s+кредит\w*\b|\bкредитовани\w*\b", re.IGNORECASE), "Льготный кредит"),
    (re.compile(r"\bлизинг\w*\b", re.IGNORECASE), "Лизинг"),
    (re.compile(r"\bзайм\w*\b|\bза[её]м\w*\b", re.IGNORECASE), "Заём"),
    (re.compile(r"\bналогов\w*\s+льгот\w*\b", re.IGNORECASE), "Налоговая льгота"),
    (re.compile(r"\bкомпенсаци\w*\b|\bвозмещени\w*\b", re.IGNORECASE), "Компенсация"),
)


def support_type(title: str, kind: str, description: str = "") -> str:
    # The title identifies the measure more reliably than a long document,
    # which can mention several unrelated types in legal references.
    for pattern, label in TYPE_PATTERNS:
        if pattern.search(title):
            return label
    if kind == "selection":
        return "Субсидия" if "субсиди" in description[:1500].lower() else "Иная поддержка"
    for pattern, label in TYPE_PATTERNS:
        if pattern.search(description[:600]):
            return label
    return "Иная поддержка"


def card_fields(source: str, source_url: str, title: str, kind: str, description: str) -> tuple[str, str]:
    del source  # kept in the call signature for source-specific extensions
    return support_type(title, kind, description), source_url
