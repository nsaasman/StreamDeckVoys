# Voys Collega Status — Stream Deck Plugin

Stream Deck-plugin om de beschikbaarheidsstatus van Voys-collega's te tonen en je eigen status of bestemming te wisselen.

## Installatie (gebruikers)

1. Download **`voys-collega-status.streamDeckPlugin`** uit de GitHub Releases (of bouw lokaal met `build-release.bat`).
2. Dubbelklik het bestand — Stream Deck installeert de plugin automatisch.
3. Open de plugin-instellingen in Stream Deck en vul je **Voys API-token** in.
4. Klik **Detecteer client_id** of vul handmatig **Client UUID** en **Client ID** in.
5. Sleep een **Collega Status**-knop naar je deck en kies een collega.

Volledige uitleg: `nl.voys.collega-status.sdPlugin/docs/handleiding.html`

## Ontwikkelen

**Vereisten:** Node.js 18+, Elgato Stream Deck 6.5+

```bat
cd nl.voys.collega-status.sdPlugin
npm install
npm start
```

| Script | Doel |
|--------|------|
| `build-and-update.bat` | Bouwt en kopieert naar `%APPDATA%\Elgato\StreamDeck\Plugins\` |
| `build-release.bat` | Publieke `.streamDeckPlugin` in `dist/` |

## Licentie

MIT
