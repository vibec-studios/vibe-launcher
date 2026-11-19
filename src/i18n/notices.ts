// Hinweis-Leiste (src/app/Notices.tsx): Ankündigungen des Backends (docs/DOMAINS.md).
// Dazu der Hinweis in der Serverliste einer Instanz für alte Relay-Adressen (*.vibey.henny.dev).
export default {
  de: {
    "notice.region": "Hinweise",
    "notice.dismiss": "Ausblenden",
    "notice.more": "Mehr erfahren",

    "notice.servers.title": "Alte Adresse in der Serverliste",
    "notice.servers.text_one": "Ein Server nutzt noch die alte Adresse .vibey.henny.dev. Sie funktioniert vorerst weiter – stell sie auf .axolite.cc um (gleicher Name, neue Domain).",
    "notice.servers.text_many": "{n} Server nutzen noch die alte Adresse .vibey.henny.dev. Sie funktioniert vorerst weiter – stell sie auf .axolite.cc um (gleicher Name, neue Domain).",
    "notice.servers.action": "Auf .axolite.cc umstellen",
    "notice.servers.done": "Serveradressen umgestellt",
    "notice.servers.failed": "Serveradressen konnten nicht umgestellt werden",
  },
  en: {
    "notice.region": "Notices",
    "notice.dismiss": "Dismiss",
    "notice.more": "Learn more",

    "notice.servers.title": "Old address in the server list",
    "notice.servers.text_one": "One server still uses the old address .vibey.henny.dev. It keeps working for now – switch it to .axolite.cc (same name, new domain).",
    "notice.servers.text_many": "{n} servers still use the old address .vibey.henny.dev. They keep working for now – switch them to .axolite.cc (same name, new domain).",
    "notice.servers.action": "Switch to .axolite.cc",
    "notice.servers.done": "Server addresses switched",
    "notice.servers.failed": "Could not switch the server addresses",
  },
};
