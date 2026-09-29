from __future__ import annotations

import json
import unittest

from app.llm.summary_classifier import summarize_measure


class FakeSummaryClient:
    model = "fake"

    def _access_token(self):
        return "token"

    def chat(self, messages, response_format):
        return json.dumps({
            "summary": "Мера компенсирует часть затрат фермеров на оборудование.",
        }, ensure_ascii=False)


class SummaryClassifierTests(unittest.TestCase):
    def test_summary_comes_from_llm_for_full_measure_material(self):
        row = {
            "source": "svoefermerstvo_federal",
            "title": "Субсидия на оборудование",
            "description": "Субсидия предоставляется сельхозтоваропроизводителям на возмещение части затрат.",
            "terms": "Получатель должен вести деятельность на территории области.",
            "documents": [],
        }
        summary = summarize_measure(FakeSummaryClient(), row)
        self.assertEqual(summary, "Мера компенсирует часть затрат фермеров на оборудование.")


if __name__ == "__main__":
    unittest.main()
