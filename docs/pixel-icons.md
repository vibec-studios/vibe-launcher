# Pixel-Icons für Leerzustände

Große Platzhalter-Symbole (leere Listen, keine Treffer, Konsole ohne laufendes Spiel, Offline, Fehler) sind
Pixel-Art im Vibe-Stil. Kleine UI-Symbole in Knöpfen und Menüs bleiben Lucide.

## Benutzung

```tsx
<EmptyState icon="terminal" title={…} text={…} />
<PixelIcon name="folder" size={48} className="text-muted" />
```

`EmptyState` nimmt als `icon` entweder ein Motiv (String) oder wie bisher ein beliebiges React-Element
(z. B. Logo oder Robbe).

## Aufbau

- `src/components/ui/pixel/PixelIcon.tsx` – SVG-Baustein, `shape-rendering="crispEdges"`, Größe in Vielfachen von 16 wählen (32, 48).
- `motifs-*.ts` – Motive als 16×16-Zeichenraster, `motifs.ts` fasst sie zusammen und erzeugt Zeilen-Rechtecke.
- `grid.ts` – Helfer: `recolor` (Farbwechsel), `slash` (Durchstreichen für „aus/offline“), `disc` (runde Motive).
- `pixel-icon.css` – Farben über Theme-Tokens.

Zeichen im Raster:

| Zeichen | Farbe |
|---|---|
| `.` | leer |
| `o` / `m` / `l` | Tinte (`currentColor` bzw. `--pi-ink`) voll / 50 % / Fläche |
| `a` / `h` / `d` | Akzent / hell / dunkel |
| `r` / `y` / `g` / `k` | Fehler / Warnung / OK / OK dunkel |
| `c` | Akzent, blinkt (respektiert „Bewegung reduzieren“) |

Motive: terminal, file, folder, search, search_none, server, server_off, monitor, chart, box, puzzle, layers,
chest, friends, user, chat, inbox, shirt, key, camera, film, film_off, sparkle, globe, compass, clock, warning,
error, info, shield, ban, cloud, cloud_off, offline.

Neues Motiv: Raster mit genau 16 Zeilen à 16 Zeichen in der passenden `motifs-*.ts` ergänzen.
