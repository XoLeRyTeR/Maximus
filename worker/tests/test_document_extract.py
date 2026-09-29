from __future__ import annotations

from io import BytesIO
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from app.processing.document_extract import extract_document
from app.processing.pdf_extract import extract_pdf


class DocumentExtractTests(unittest.TestCase):
    def test_pdf_reads_beyond_previous_25_page_limit(self):
        class Page:
            def extract_text(self):
                return "Поддержка молочного скотоводства"

        class Reader:
            pages = [Page() for _ in range(26)]

        with patch("app.processing.pdf_extract.PdfReader", return_value=Reader()):
            text, status = extract_pdf(b"%PDF sample")
        self.assertEqual(status, "text_extracted")
        self.assertIn("[Страница 26]", text)

    def test_docx_preserves_paragraphs(self):
        data = BytesIO()
        xml = ("<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>"
               "<w:body><w:p><w:r><w:t>Поддержка молочного скотоводства</w:t></w:r></w:p>"
               "<w:p><w:r><w:t>Переработка не включена</w:t></w:r></w:p></w:body></w:document>")
        with ZipFile(data, "w") as archive:
            archive.writestr("word/document.xml", xml)
        text, status = extract_document(data.getvalue())
        self.assertEqual(status, "text_extracted")
        self.assertIn("Поддержка молочного скотоводства\nПереработка", text)


if __name__ == "__main__":
    unittest.main()
