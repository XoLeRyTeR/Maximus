from __future__ import annotations

import unittest
from datetime import date

from app.ingestion.ivanovo_announcements import parse as parse_announcements
from app.ingestion.ivanovo_support import parse as parse_support
from app.ingestion.svoefermerstvo import parse as parse_federal, parse_detail
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

    def test_federal_card_and_detail_are_structured(self):
        listing = """<div class='color-2--gray-100-bg'>
        <h2>Грант на развитие</h2>
        Краткое описание. Главные условия Софинансирование 10%.
        Размер до 5 млн ₽ Получатели КФХ
        <a href='/mery-podderzhki/42'>Подробнее</a></div>"""
        measure = parse_federal(listing)[0]
        self.assertEqual(measure.description, "Краткое описание.")
        self.assertEqual(measure.amount, "до 5 млн ₽")
        self.assertIn("Получатели: КФХ", measure.terms)

        detail = """<main><div class='custom-first-block'><div><h1>Грант на развитие</h1></div>
        Грант Вид поддержки Федеральный Грант на развитие Полное описание.
        Главные условия Базовое условие</div>
        <h2>Условия получения</h2><p>Нет налоговой задолженности.</p>
        <h2>Как получить поддержку</h2><p>Подать документы в региональное министерство.</p>
        <p>Срок приема заявок с 01.10.2026 по 20.10.2026.</p>
        <a href='https://www.gosuslugi.ru/example'>Документ на Госуслугах</a>
        <script>mery_podderzhki_region:[{dict_item_name:"Ивановской области"}]</script></main>"""
        enriched = parse_detail(detail, measure)
        self.assertEqual(enriched.description, "Полное описание.")
        self.assertEqual(enriched.region, "Ивановской области")
        self.assertEqual(enriched.application_start, date(2026, 10, 1))
        self.assertEqual(enriched.application_deadline, date(2026, 10, 20))
        self.assertEqual(enriched.documents[0].title, "Документ на Госуслугах")


if __name__ == "__main__":
    unittest.main()
