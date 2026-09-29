from __future__ import annotations

import unittest
from datetime import date

from app.ingestion.ivanovo_announcements import parse as parse_announcements
from app.ingestion.ivanovo_support import parse as parse_support
from app.processing.normalize import application_window
from app.processing.card_fields import card_fields


class ParserTests(unittest.TestCase):
    def test_regional_table_keeps_document_link_and_stable_key(self):
        html = """<table><tr><th>Виды государственной поддержки</th><th>Акт</th></tr>
        <tr><td>Субсидия на молоко</td><td><a href='/upload/rules.pdf'>Порядок</a></td></tr></table>"""
        measure = parse_support(html)[0]
        self.assertEqual(measure.region, "Ивановская область")
        self.assertTrue(measure.external_id.startswith("title:"))
        self.assertEqual(measure.documents[0].url, "https://apk.ivanovoobl.ru/upload/rules.pdf")

    def test_announcement_uses_publication_date_and_pdf_identity(self):
        html = """<div class='Content__body'><p>25.09.2026</p>
        <p><a href='/upload/notice.pdf'>Объявление о проведении отбора получателей субсидии на молоко</a></p>
        <p>12.08.2025</p><p><a href='/upload/old.pdf'>Объявление о проведении отбора получателей субсидии</a></p></div>"""
        measures = parse_announcements(html, year=2026)
        self.assertEqual(len(measures), 1)
        self.assertEqual(measures[0].published_at, date(2026, 9, 25))
        self.assertTrue(measures[0].external_id.endswith("notice.pdf"))

    def test_pdf_application_window_ignores_unrelated_dates(self):
        text = "Опубликовано 25.09.2026. Срок приема заявок 26.09.2026 10:29 - 06.10.2026 10:29 (МСК)"
        self.assertEqual(application_window(text), (date(2026, 9, 26), date(2026, 10, 6)))
        self.assertEqual(application_window("Приказ от 25.09.2026 и поправка от 06.10.2026"), (None, None))

    def test_card_fields_use_summary_type_and_source_page(self):
        support, url = card_fields(
            "svoefermerstvo_federal", "https://svoefermerstvo.ru/mery-podderzhki/1",
            "Грант на развитие фермы", "measure",
            "Грант предоставляется для создания и развития хозяйства. Главные условия Получатели",
        )
        self.assertEqual(support, "Грант")
        self.assertEqual(url, "https://svoefermerstvo.ru/mery-podderzhki/1")


if __name__ == "__main__":
    unittest.main()
