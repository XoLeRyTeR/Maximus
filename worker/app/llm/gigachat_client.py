from __future__ import annotations

import time
from pathlib import Path
from uuid import uuid4

import requests

from app.config import setting

OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
CHAT_URL = "https://api.giga.chat/v1/chat/completions"
PROJECT_CA = Path(__file__).resolve().parents[3] / "backend" / "certs" / "russian_trusted_root_ca.pem"


class GigaChatError(RuntimeError):
    pass


class GigaChatClient:
    def __init__(self) -> None:
        self.key = setting("GIGA_API_KEY")
        if not self.key:
            raise GigaChatError("GIGA_API_KEY is missing")
        self.scope = setting("GIGACHAT_SCOPE") or "GIGACHAT_API_PERS"
        self.model = setting("GIGACHAT_MODEL") or "GigaChat-2"
        self.session = requests.Session()
        self.session.verify = setting("GIGACHAT_CA_BUNDLE") or (str(PROJECT_CA) if PROJECT_CA.exists() else True)
        self.token: str | None = None
        self.expires_at = 0.0

    def _access_token(self) -> str:
        if self.token and time.time() < self.expires_at - 60:
            return self.token
        try:
            response = self.session.post(
                OAUTH_URL,
                headers={"Authorization": f"Basic {self.key}", "RqUID": str(uuid4()), "Accept": "application/json"},
                data={"scope": self.scope},
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            token = payload["access_token"]
            expiry = payload["expires_at"]
        except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            raise GigaChatError(f"OAuth request failed (HTTP {status})") from exc
        if not isinstance(token, str) or not token:
            raise GigaChatError("OAuth response has no access token")
        self.token = token
        self.expires_at = float(expiry) / (1000 if float(expiry) > 1e12 else 1)
        return token

    def chat(self, messages: list[dict], response_format: dict) -> str:
        body = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
            "max_tokens": 1600,
            "response_format": response_format,
        }
        for attempt in range(4):
            token = self._access_token()
            try:
                response = self.session.post(
                    CHAT_URL,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=body,
                    timeout=90,
                )
                if response.status_code == 401 and attempt == 0:
                    self.token = None
                    continue
                if response.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(min(2 ** attempt, 8))
                    continue
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
                if not isinstance(content, str):
                    raise GigaChatError("Chat response has no text")
                return content
            except requests.RequestException as exc:
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if (status is None or status in (429, 500, 502, 503, 504)) and attempt < 3:
                    time.sleep(min(2 ** attempt, 8))
                    continue
                raise GigaChatError(f"Chat request failed (HTTP {status})") from exc
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                raise GigaChatError("Chat response could not be read") from exc
        raise GigaChatError("Chat request retries exhausted")
