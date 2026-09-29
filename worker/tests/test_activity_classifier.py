from __future__ import annotations

import unittest

from app.llm.activity_classifier import (
    TextPart, activity_labels, aggregate, chunks, classify_part, parse_response, text_parts,
)


class FakeClient:
    def __init__(self, response: str):
        self.response = response
        self.calls = 0

    def chat(self, messages: list[dict], response_format: dict) -> str:
        self.calls += 1
        return self.response


class ActivityClassifierTests(unittest.TestCase):
    def test_uses_backend_labels_and_validates_quote(self):
        labels = activity_labels()
        self.assertIn("молочное скотоводство", labels)
        part = TextPart("rules.pdf", "Субсидия предоставляется производителям молока.")
        client = FakeClient('{"scope":"specific","scope_quote":"","findings":[{"label":"молочное скотоводство","relation":"supported","quote":"производителям молока"}]}')
        answers = classify_part(client, "Субсидия на молоко", part, labels)
        result = aggregate(answers, incomplete=False)
        self.assertEqual(result["labels"], ["молочное скотоводство"])
        self.assertNotIn("животноводство", result["labels"])
        self.assertEqual(result["status"], "classified")

    def test_exclusion_and_missing_document_require_review(self):
        answers = [
            {"scope": "specific", "scope_quote": "", "source": "card", "chunk": 1,
             "findings": [{"label": "свиноводство", "relation": "supported", "quote": "Поддержка свиноводства"}]},
            {"scope": "unknown", "scope_quote": "", "source": "rules", "chunk": 1,
             "findings": [{"label": "свиноводство", "relation": "excluded", "quote": "Свиноводство исключено"}]},
        ]
        result = aggregate(answers, incomplete=False)
        self.assertEqual(result["labels"], [])
        self.assertEqual(result["exclusions"], ["свиноводство"])
        self.assertEqual(result["status"], "needs_review")
        row = {"source": "ivanovo_official_support", "title": "Поддержка зерновых", "description": "Поддержка зерновых", "terms": "",
               "documents": [{"url": "rules.pdf", "extracted_text": None, "extraction_status": "not_fetched"}]}
        parts, incomplete = text_parts(row)
        self.assertEqual(len(parts), 1)
        self.assertTrue(incomplete)
        row["terms"] = "Поддержка зерновых по приказу"
        parts, _ = text_parts(row)
        self.assertEqual([part.source for part in parts], ["title", "terms"])

    def test_long_text_is_fully_chunked_and_unquoted_claim_rejected(self):
        text = "Зерновые культуры. " * 1000
        pieces = chunks(text, size=700, overlap=50)
        self.assertGreater(len(pieces), 1)
        self.assertIn("Зерновые культуры.", pieces[-1])
        answer = parse_response('{"scope":"specific","scope_quote":"","findings":[{"label":"зерновые","relation":"supported","quote":"Кукуруза разрешена"}]}',
                                "Субсидия на зерновые культуры", activity_labels())
        self.assertEqual(answer["findings"], [])
        self.assertTrue(answer["validation_issue"])

    def test_generic_agriculture_quote_cannot_prove_narrow_branch(self):
        quote = "производство и переработка сельскохозяйственной продукции"
        answer = parse_response(
            '{"scope":"specific","scope_quote":"","findings":['
            '{"label":"молочное скотоводство","relation":"supported","quote":"' + quote + '"},'
            '{"label":"переработка сельхозпродукции","relation":"supported","quote":"' + quote + '"}]}',
            quote, activity_labels(),
        )
        self.assertEqual([finding["label"] for finding in answer["findings"]], ["переработка сельхозпродукции"])
        self.assertTrue(answer["validation_issue"])

    def test_invalid_large_response_is_retried_in_smaller_parts(self):
        class SizeSensitiveClient:
            calls = 0

            def chat(self, messages, response_format):
                self.calls += 1
                excerpt = messages[1]["content"].split("Фрагмент: ", 1)[1]
                return "broken" if len(excerpt) > 3000 else '{"scope":"unknown","scope_quote":"","findings":[]}'

        client = SizeSensitiveClient()
        answers = classify_part(client, "Общая мера", TextPart("document", "Описание программы. " * 300), activity_labels())
        self.assertGreater(len(answers), 1)
        self.assertGreater(client.calls, len(answers))

    def test_unparseable_short_part_is_marked_for_review(self):
        client = FakeClient("broken")
        answers = classify_part(client, "Общая мера", TextPart("document", "Описание программы."), activity_labels())
        self.assertTrue(answers[0]["validation_issue"])
        self.assertEqual(aggregate(answers, incomplete=False)["status"], "needs_review")


if __name__ == "__main__":
    unittest.main()
