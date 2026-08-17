# Tangent

Tangent is a full-stack Android-focused mobile reader that turns newsletter and RSS
content into a personalised, swipe-driven reading experience. It combines an Expo /
React Native client with Firebase Authentication, Firestore, and Cloud Functions for
RSS ingestion, ranking, behavioural learning, and account management.

> **Project status:** active personal product project. Android is the current focus;
> iOS Google Sign-In configuration remains a documented future release task.

## Highlights

- **Personalised reading feed** — ranks RSS articles using category and publisher
  preferences, trending activity, recency, publication quality, and diversity rules.
- **Full reading experience** — in-app WebView reader, sanitized RSS content,
  saved reads, reading history, light/dark themes, and offline behaviour queues.
- **Learning loop** — server-side classification of reading sessions, preference
  updates, reading-speed calibration, streaks, and engagement statistics.
- **Content pipeline** — scheduled RSS collection, paywall detection, article
  lifecycle handling, candidate pools, trending-score decay, and old-content cleanup.
- **Security-oriented backend** — Firestore ownership/schema rules, authenticated
  callable functions, server-side account reset/deletion, and HTML escaping for RSS
  metadata rendered in the reader.
- **Internal product tooling** — a High-Fidelity Matrix for evaluating ranking
  configurations and a Control Dashboard for protected scoring/feed actions.

## Architecture

| Area | Technology |
|---|---|
| Mobile client | Expo SDK 57, React Native 0.86, React 19, TypeScript |
| Navigation | React Navigation |
| Backend | Firebase Authentication, Firestore, Cloud Functions v2 |
| Content | RSS/Atom ingestion with `rss-parser`; client-side RSS extraction with `fast-xml-parser` |
| Reader | `react-native-webview` with sanitized content |
| On-device data | AsyncStorage, SecureStore, NetInfo |
| Build | Expo Application Services (EAS) |

See [`docs/architecture.md`](docs/architecture.md) for the detailed system design,
[`docs/system-patterns.md`](docs/system-patterns.md) for ranking/learning behaviour,
and [`docs/audit-backlog.md`](docs/audit-backlog.md) for intentionally deferred work.

## Repository layout

```text
src/                    Expo / React Native application
firebase/functions/     Firebase Cloud Functions (TypeScript)
firebase/               Firestore rules, indexes, feeds, emulator and admin scripts
docs/                   Architecture, emulator, analytics, and engineering notes
scripts/                Current internal web tools and focused regression scripts
archive/legacy-tools/   Retired simulator tooling retained for reference only
```

## Run locally

### Prerequisites

- Node.js compatible with Expo SDK 57
- npm
- Android Studio / an Android emulator or physical Android device
- Firebase CLI for emulator or deployment work

### Client

```bash
npm install
npm run android
```

For a development server instead:

```bash
npm start
```

### Firebase Functions

```bash
npm --prefix firebase/functions install
npm --prefix firebase/functions run build
```

For emulator setup, environment notes, and test flows, see
[`docs/emulator/EMULATOR_GUIDE.md`](docs/emulator/EMULATOR_GUIDE.md).

## Validation

The repository includes focused regression checks alongside TypeScript builds:

```bash
npm run typecheck
npm run test:dashboard-metrics
npm run test:reader-html
npm run test:session-timer
npm run test:classification
```

## Notes for reviewers

Current limitations and planned work are documented in [`docs/audit-backlog.md`](docs/audit-backlog.md).
