# Tangent — Temporary Diagnostics Register

> **Purpose:** A checklist for diagnostic code that is intentionally temporary.
> Do not treat any item in this document as a permanent product feature or part of
> the release architecture. Remove the corresponding code and its source-level
> regression assertion after it has answered its question.
>
> **Created:** 19 August 2026.

---

## Current investigation: slow startup and first personalised feed

### Question being answered

Tangent's first usable screen and first personalised feed feel slower than they
should. Initial phone timings showed approximately:

- returning account: authentication ~0.9 seconds, initial profile ~3.2 seconds,
  then first feed ~2.1 seconds;
- new account: authentication ~1.5 seconds, initial profile creation/read ~4.1
  seconds, category save ~0.2 seconds, then first feed ~1.8 seconds.

The category save is not the main delay. These temporary logs separate account
restoration, profile retrieval, and server-side feed generation so changes are
based on evidence rather than guesses.

---

## Temporary client-side timing logs

These messages appear only in development builds because they are wrapped in
`__DEV__`. They do not change the app's requests, ranking, saved data, or visible
behaviour.

| Location | Log prefix | What it measures | Remove when |
|---|---|---|---|
| `App.tsx` | `[Startup Timing]` | React initialization; account restoration; first profile retrieval; Home/Onboarding choice; startup screen dismissal | The source of normal startup delay is understood and the chosen speed improvements are verified |
| `src/contexts/UserContext.tsx` | `[Startup Timing] shared profile listener ready` | When the shared live profile listener receives its first snapshot | We no longer need to compare the initial direct profile read with the later listener handoff |
| `src/screens/DashboardScreen.tsx` | `[Startup Timing] first ranked feed requested/returned` | Phone-side callable time, including network travel and server work | Matching server timing has been collected and the final feed-speed fix is verified |
| `src/screens/OnboardingScreen.tsx` | `[Onboarding Timing]` | Category-save start, confirmation, and Dashboard navigation start | The onboarding-to-first-feed handoff has been improved and tested |

### How to collect client timings

1. Run the existing development client through Metro.
2. Fully close and reopen Tangent as a returning user.
3. Copy only lines beginning with `[Startup Timing]`.
4. Create/use a new account, choose categories, press **Start Reading**, and copy
   `[Onboarding Timing]` plus following `[Startup Timing]` feed lines.
5. Keep at least one normal-connection example. Repeated samples are useful because
   network and cold-start conditions vary.

### Exact client removal locations

- `App.tsx`: remove `startupStartedAtRef`, `startedAt`, and the added
  `[Startup Timing]` calls.
- `src/contexts/UserContext.tsx`: remove the first-profile-snapshot timing log.
- `src/screens/DashboardScreen.tsx`: remove the local `startedAt` value and the
  request/return timing logs in `loadFeedArticles`.
- `src/screens/OnboardingScreen.tsx`: remove the local `startedAt` value and the
  onboarding timing logs in `handleContinue`.
- `scripts/test-dashboard-metrics.js`: remove the
  `development timing markers cover startup, onboarding, and first-feed handoffs`
  assertion.

No APK rebuild is needed to add or remove these TypeScript-only client logs when
using the existing development client and Metro.

---

## Temporary server-side feed timing summary

### What it logs

`firebase/functions/src/getRankedFeed.ts` writes one `[Feed Timing]` summary for
each normal ranked-feed request and a shortened summary if the candidate pool is
empty. It reports only elapsed milliseconds, cache-state booleans, and counts:

```text
[Feed Timing] config=__ms profile=__ms pool=__ms publisher=__ms
selection=__ms response=__ms total=__ms
poolWarm=true|false publisherWarm=true|false
pool=__ unseen=__ returned=__
```

| Field | Plain meaning |
|---|---|
| `config` | Time to obtain Tangent's ranking settings |
| `profile` | Time to obtain stored preferences needed for ranking |
| `pool` | Time to obtain the shortlist of eligible articles |
| `publisher` | Time to obtain publication-quality values |
| `selection` | Time to score, select tranches, apply diversity, and order the feed |
| `response` | Time to prepare analytics records and the response object; GA4 sending remains non-blocking |
| `total` | Total work inside the Function after the request reaches it |
| `poolWarm` / `publisherWarm` | Whether that Function instance already had this data in short-term memory |
| counts | Candidate volume only; no titles, category choices, or account IDs are included in this new summary |

### Important deployment and cost note

Unlike the client logs, the server summary is not gated to a development phone. It
is written by the deployed Cloud Function. This is necessary because the timing
question concerns real production server/network behaviour, but it creates Cloud
Logging entries and must not remain indefinitely.

Deploy it only for the measurement window. Before deploying, confirm that
`firebase/functions/.env` contains only deploy-safe values such as
`GA_MEASUREMENT_ID` and `GA_DEBUG`. The emulator-only dummy `GA_API_SECRET` belongs
in ignored `firebase/functions/.env.local`; production receives the real value from
Google Secret Manager. A plain `.env` `GA_API_SECRET` conflicts with the Secret
Manager injection and causes Cloud Run deployment to fail.

```powershell
cd C:\2SubTick\firebase
firebase deploy --only functions
```


Then collect at least:

1. one first feed request after the Function has been idle for a while;
2. a second feed request shortly afterward;
3. one first feed immediately after category onboarding, if possible.

Compare `total` to the phone-side `ranked feed returned` duration. The difference
is network travel, callable setup, and phone-side processing. The server fields
identify the slow server stage; the warm flags identify whether cold Function memory
is responsible.

### Exact server removal locations

After enough samples have been collected and the feed-speed change has been
verified, remove all of the following together:

- `requestStartedAt`, `configReadyAt`, `profileReadyAt`, `poolReadyAt`,
  `publisherReadyAt`, `selectionReadyAt`, and `responsePreparedAt` in
  `firebase/functions/src/getRankedFeed.ts`;
- `candidateCacheWasWarm` and `publisherCacheWasWarm`, if they are no longer used
  for anything else;
- both `[Feed Timing]` `console.log` calls, including the empty-pool version;
- the `feed timing logs cover configuration...` assertion and source-file read
  added to `firebase/scripts/test-classification.js`.

Then redeploy Functions:

```powershell
cd C:\2SubTick\firebase
firebase deploy --only functions
```

---

## Decision record after measurement

Do not remove the diagnostics until this table is filled in:

| Finding | Evidence | Chosen fix | Verified result | Diagnostics removed? |
|---|---|---|---|---|
| Startup profile delay | Returning profile/route confirmation took roughly 2.3–2.7 seconds after authentication in phone samples | Implemented UID-bound local route snapshot plus persisted unread Dashboard cards; route/cards render after Firebase restores the same UID while profile verification runs in background. Google configuration and offline event sync are deferred until the route is visible. | Automated TypeScript/regression validation passed; physical-device startup timing must be recollected. | No — retain client timing logs until device evidence confirms the improvement. |
| First ranked-feed delay | Phone samples showed roughly 1.8–4.0 seconds after the request begins | Pending server timing analysis; client now stages a fresh result for the next launch rather than blocking cached cards. | Pending deployed `[Feed Timing]` samples. | No |
| Onboarding-to-Dashboard handoff | Category saving itself measured about 0.2 seconds; the first feed was the remaining wait. First device trial showed a race that started two requests. | After the save commits, onboarding reserves the one shared ranked-feed request before even reading local seen IDs; Dashboard consumes the running or completed result rather than duplicating it. | Automated TypeScript/regression validation passed; physical-device handoff timing must be recollected. | No |

The local startup cache is deliberately not a security decision: it is non-sensitive
phone display data keyed to the Firebase UID already restored from encrypted auth
storage. Cloud profile verification and all Functions remain the permanent authority.
