from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import textwrap, sys
def make(path, pages, title=''):
    c = canvas.Canvas(path, pagesize=A4); c.setTitle(title)
    for n, blocks in enumerate(pages, 1):
        y = 800
        for size, text in blocks:
            c.setFont('Helvetica-Bold' if size > 14 else 'Helvetica', size)
            for line in textwrap.wrap(text, 78 if size <= 14 else 45):
                c.drawString(60, y, line); y -= size * 1.35
            y -= size * 1.2
        c.setFont('Helvetica', 9); c.drawString(60, 30, 'Rollenspiel Coach - Vertraulich'); c.drawRightString(535, 30, f'Seite {n}')
        c.showPage()
    c.save()
DE1 = [(20, 'Handbuch für Trainer'),
       (11, 'Verwalten Sie Szenarien, Personas, Rubriken und Systemkonfiguration. Erstellen Sie neue Schulungsszenarien und weisen Sie diese Ihren Teilnehmern zu, bevor das Training beginnt.'),
       (11, 'Anfrage zu Versand-/Lieferverzögerungen: Die Trainees üben den Umgang mit unzufriedenen Kunden und lernen, Beschwerden über fehlerhafte Geräte professionell zu bearbeiten.'),
       (11, 'This section explains how to configure the scoring rubric and how to invite new participants to a training session. Please read it carefully before you start.')]
DE2 = [(16, 'Auswertung'),
       (11, 'Nach Abschluss jeder Sitzung erhalten Sie einen ausführlichen Bericht. Der Bericht zeigt Ihnen, wie gut der Teilnehmer mit dem Preiswiderstand des Kunden umgegangen ist.'),
       (11, 'Die Ergebnisse werden automatisch gespeichert und können jederzeit im globalen Sitzungsverlauf eingesehen werden. Version v2.1.0, Dauer 154m 32s.')]
make('/home/claude/translation-check/test/fixtures/de-mixed.pdf', [DE1, DE2], 'Handbuch')
ES = [[(16, 'Guía de inicio'), (11, 'Bienvenidos a nuestra tienda en línea. Aquí encontrarás todo lo que necesitas para tu hogar y tu familia, con envío gratis en pedidos superiores a cincuenta euros.'), (11, 'Si tienes alguna pregunta sobre tu pedido, puedes contactar con nuestro equipo de atención al cliente todos los días de la semana.')]]
make('/home/claude/translation-check/test/fixtures/es-clean.pdf', ES, 'Guía')
make('/home/claude/translation-check/test/fixtures/keys.pdf', [[(11, 'checkout.button.save'), (11, 'Hola {{name}}, bienvenido a la plataforma de formación para equipos comerciales.')]], 'x')
