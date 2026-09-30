from __future__ import annotations

import json
import unittest

from app.llm.deadline_classifier import extract_deadlines, parse_windows


class FakeClient:
    def __init__(self, deadline: str):
        self.deadline = deadline

    def chat(self, messages, response_format):
        return json.dumps({"windows": [{
            "start": "", "deadline": self.deadline,
            "quote": "Заявки принимаются до 15 октября 2026 года",
        }]}, ensure_ascii=False)


class DeadlineClassifierTests(unittest.TestCase):
    def test_accepts_application_deadline_with_spelled_month(self):
        text = "Заявки принимаются до 15 октября 2026 года. Решение принимается позже."
        result = parse_windows(FakeClient("2026-10-15").chat([], {}), text, "document.pdf", 1)
        self.assertEqual(result[0]["deadline"], "2026-10-15")

    def test_rejects_date_of_order_and_unquoted_date(self):
        text = "Приказ подписан 15 октября 2026 года."
        content = json.dumps({"windows": [{"start": "", "deadline": "2026-10-15", "quote": text[:-1]}]})
        self.assertEqual(parse_windows(content, text, "document.pdf", 1), [])
        text = "Заявки принимаются до 15 октября 2026 года."
        content = json.dumps({"windows": [{"start": "", "deadline": "2026-10-16", "quote": text[:-1]}]})
        self.assertEqual(parse_windows(content, text, "document.pdf", 1), [])

    def test_rejects_start_of_submission_rule_as_deadline(self):
        text = "С 01.01.2024 заявки на получение субсидий подаются через Электронный бюджет."
        content = json.dumps({"windows": [{
            "start": "", "deadline": "2024-01-01", "quote": text,
        }]}, ensure_ascii=False)
        self.assertEqual(parse_windows(content, text, "document.pdf", 1), [])

    def test_rejects_historical_eligibility_cutoff_as_application_deadline(self):
        text = "Кредиты, прошедшие отбор Комиссии до 31 декабря 2016 года."
        content = json.dumps({"windows": [{
            "start": "", "deadline": "2016-12-31", "quote": text,
        }]}, ensure_ascii=False)
        self.assertEqual(parse_windows(content, text, "document.pdf", 1), [])

    def test_uses_document_text_not_only_fixed_phrase(self):
        row = {
            "source": "ivanovo_official_selections", "title": "Отбор получателей субсидии",
            "terms": "", "description": "",
            "documents": [{"url": "https://example.org/notice.pdf", "extracted_text":
                           "[Страница 1] Заявки принимаются до 15 октября 2026 года.",
                           "extraction_status": "text_extracted"}],
        }
        result = extract_deadlines(FakeClient("2026-10-15"), row)
        self.assertEqual(result["status"], "found")
        self.assertEqual(result["deadline"], "2026-10-15")


if __name__ == "__main__":
    unittest.main()
