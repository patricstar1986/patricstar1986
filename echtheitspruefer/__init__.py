"""Echtheitsprüfer – prüft E-Mails und Dokumente auf Fälschungs- und Gefahrenhinweise."""

from .dokument import pruefe_dokument
from .mail import pruefe_mail

__all__ = ["pruefe_dokument", "pruefe_mail"]
__version__ = "0.1.0"
