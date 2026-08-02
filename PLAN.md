# PLAN.md

# Technisches Konzept: VanSpace 3D

## Ziel

Eine webbasierte 3D-Anwendung zur Planung des Stauraums von Fahrzeugen.

Der Benutzer kann Fahrzeuge auswählen, eigene Fahrzeuge definieren,
Objekte aus einer Bibliothek platzieren, frei bewegen, Kollisionen
erkennen, Projekte speichern und Packvorschläge erzeugen.

## Architektur

``` text
Browser
 ├── React
 ├── TailwindCSS
 ├── React Three Fiber
 ├── Zustand
 └── TanStack Query
        │
     REST API
        │
 ASP.NET Core
        │
 SQLite/PostgreSQL
```

## Technologien

### Frontend

-   React
-   TypeScript
-   TailwindCSS
-   React Three Fiber
-   Three.js
-   @react-three/drei
-   @react-three/rapier
-   Zustand
-   TanStack Query

### Backend

-   ASP.NET Core
-   Entity Framework Core
-   SQLite/PostgreSQL
-   JWT
-   OpenAPI

## Datenmodell

-   Fahrzeug
-   Volumen
-   Hindernisse
-   Objektvorlagen
-   Projekte
-   Platzierte Objekte

Alle Fahrzeuge werden vollständig über JSON beschrieben.

## Kernmodule

1.  3D-Renderer
2.  Objektbibliothek
3.  Fahrzeugeditor
4.  Snap-System
5.  Kollisionsprüfung
6.  Undo/Redo
7.  Projektverwaltung
8.  Import/Export

## Entwicklung

  Phase   Beschreibung
  ------- ------------------------------
  1       React + Three.js Grundgerüst
  2       Fahrzeugmodell laden
  3       Objektbibliothek
  4       Kollisionserkennung
  5       Snap-System
  6       Property Panel
  7       Speichern/Laden
  8       Fahrzeugeditor
  9       Packoptimierung
  10      KI-Assistent

## Leitprinzipien

-   Datengetrieben (JSON)
-   Offlinefähig
-   Plugin-Architektur
-   Rendering und Logik getrennt
-   Bounding-Boxen statt CAD-Geometrie
