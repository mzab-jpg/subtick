// ============================================================
// SubTick — Analytics Logging (Measurement Protocol)
// Sends server-side events to Google Analytics 4 via Measurement Protocol.
// All events are fire-and-forget — errors are logged but never thrown.
//
// Targets the GA4 WEB data stream. The request format for a web stream is:
//   URL:  https://www.google-analytics.com/mp/collect?measurement_id=G-XXXXXXX&api_secret=...
//   body: { client_id: <id>, events: [...] }
// This differs from the Firebase APP stream, which uses firebase_app_id in
// the URL and app_instance_id in the body. Mixing the two silently drops events.
// ============================================================

import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';

// Runtime interface for firebase-functions/params defineSecret return type.
// SecretParam is an internal type not exported by the public API, so we declare
// the minimal shape needed to pass to onCall({ secrets: [...] }) and call .value().
interface SecretParam {
  value(): string;
  name: string;
}

// GA_API_SECRET is stored in Google Cloud Secret Manager and set via:
//   firebase functions:secrets:set GA_API_SECRET
// GA_MEASUREMENT_ID is stored in firebase/functions/.env (public identifier).
export const gaApiSecret: SecretParam = defineSecret('GA_API_SECRET');

const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || '';

// When true, sends events to the Measurement Protocol DEBUG endpoint instead of
// the production endpoint. The debug endpoint validates the payload and returns
// a JSON body with validationMessages — it does NOT ingest events. Use this to
// confirm payloads are well-formed before flipping back to false for real data.
// The production endpoint always returns 2xx on receipt, even for invalid payloads,
// so it is useless for diagnosing why events never appear in Realtime reports.
const GA_DEBUG = process.env.GA_DEBUG === 'true';

// Measurement Protocol allows up to 25 events per request.
const MAX_EVENTS_PER_REQUEST = 25;

interface GAEvent {
  name: string;
  params: Record<string, any>;
}

/**
 * Resolve the client_id to send to GA4.
 *
 * For a web stream, client_id identifies an "instance" of the app and must be
 * a stable per-install value (commonly a UUID). The client generates one and
 * sends it as `client_id` in the callable payload. If it's missing, we mint a
 * random per-request id so the events still land (just unattributed) instead of
 * silently failing — but we NEVER fall back to the Firebase Auth UID, which is
 * not a valid client_id and causes GA4 to drop the events.
 */
function resolveClientId(clientId?: string): string {
  // Preferred: standard GA4 dotted format XXXXXXXXXX.XXXXXXXXXX (matches _ga cookie format)
  if (clientId && /^\d{10}\.\d{10}$/.test(clientId)) {
    return clientId;
  }
  // Legacy: 32-hex UUID from older installs — convert to dotted format deterministically
  // by taking two 10-digit decimal slices of the hex so the same install always maps
  // to the same dotted id (preserving per-user continuity across deploys).
  if (clientId && /^[0-9a-f]{32}$/i.test(clientId)) {
    const a = (parseInt(clientId.slice(0, 8), 16) % 9_000_000_000 + 1_000_000_000).toString();
    const b = (parseInt(clientId.slice(8, 16), 16) % 9_000_000_000 + 1_000_000_000).toString();
    return `${a}.${b}`;
  }
  // Last resort: generate a GA4-standard dotted client_id so events still land unattributed
  const rand10 = () => Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000).toString();
  return `${rand10()}.${rand10()}`;
}

/**
 * Send events to GA4 via Measurement Protocol (web stream).
 * Auto-chunks batches exceeding the 25-event-per-request limit.
 *
 * @param clientId - Stable per-install web client_id (32-hex UUID from device).
 * @param events   - Array of GA4 events to send.
 */
export async function sendGAEvents(
  clientId: string,
  events: Array<{ name: string; params: Record<string, any> }>
): Promise<void> {
  if (!GA_MEASUREMENT_ID) {
    console.warn('[Analytics] GA_MEASUREMENT_ID not set — skipping event send');
    return;
  }

  const apiSecret = (gaApiSecret.value() || '').trim();
  if (!apiSecret) {
    console.warn('[Analytics] GA_API_SECRET not available — skipping event send');
    return;
  }

  if (events.length === 0) return;

  const effectiveClientId = resolveClientId(clientId);

  // session_id is required for events to appear in GA4 Realtime reports.
  // Without it events are accepted (HTTP 204) but only appear in the delayed
  // Events report (24-48h), never in Realtime. Use seconds-epoch as the id —
  // all events in this batch share the same session (one feed generation).
  const sessionId = Math.floor(Date.now() / 1000);

  // Enrich each event. engagement_time_msec MUST be a number (the protocol rejects
  // string-typed values). We do not set timestamp_micros per-event — GA4 auto-
  // timestamps ingested events, and per-event timestamp_micros has its own strict
  // validation that is easy to get wrong.
  const enriched: GAEvent[] = events.map((e) => ({
    name: e.name,
    params: {
      ...e.params,
      engagement_time_msec: 1,
      session_id: sessionId,
    },
  }));

  // Chunk into batches of MAX_EVENTS_PER_REQUEST
  const chunks: GAEvent[][] = [];
  for (let i = 0; i < enriched.length; i += MAX_EVENTS_PER_REQUEST) {
    chunks.push(enriched.slice(i, i + MAX_EVENTS_PER_REQUEST));
  }

  const path = GA_DEBUG ? 'debug/mp/collect' : 'mp/collect';
  const baseUrl =
    `https://www.google-analytics.com/${path}` +
    `?measurement_id=${encodeURIComponent(GA_MEASUREMENT_ID)}` +
    `&api_secret=${encodeURIComponent(apiSecret)}`;

  let totalSent = 0;
  for (const chunk of chunks) {
    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: effectiveClientId,
          events: chunk,
        }),
      });

      if (!response.ok) {
        console.warn(
          `[Analytics] Measurement Protocol HTTP ${response.status}: ${response.statusText}`
        );
        continue;
      }

      // In debug mode, log Google's validation messages so we can see exactly
      // what (if anything) GA4 rejects. Empty validationMessages = payload is valid.
      if (GA_DEBUG) {
        let debugInfo: any = null;
        try {
          debugInfo = await response.json();
        } catch {
          // Non-JSON response — nothing to report
        }
        const messages = debugInfo?.validationMessages;
        if (messages && messages.length > 0) {
          console.warn(`[Analytics][DEBUG] ${messages.length} validation message(s):`, JSON.stringify(messages));
        } else {
          console.log(`[Analytics][DEBUG] Chunk of ${chunk.length} events validated OK (no issues)`);
        }
      }

      totalSent += chunk.length;
    } catch (err: any) {
      // Fire-and-forget — log and continue
      console.warn('[Analytics] Measurement Protocol request failed:', err.message);
    }
  }

  if (totalSent > 0) {
    console.log(
      `[Analytics] Sent ${totalSent} events via Measurement Protocol` +
      (GA_DEBUG ? ' [DEBUG MODE — events NOT ingested]' : '')
    );
  }
}

/**
 * Send user properties to GA4 via Measurement Protocol (web stream).
 * User properties are set by including a 'user_properties' field in the request body
 * alongside a dummy event (required by the protocol).
 *
 * @param clientId   - Stable per-install web client_id (32-hex UUID from device).
 * @param properties - Key-value map of user properties (values must be strings).
 */
export async function sendGAUserProperties(
  clientId: string,
  properties: Record<string, string>
): Promise<void> {
  if (!GA_MEASUREMENT_ID) {
    console.warn('[Analytics] GA_MEASUREMENT_ID not set — skipping user properties send');
    return;
  }

  const apiSecret = (gaApiSecret.value() || '').trim();
  if (!apiSecret) {
    console.warn('[Analytics] GA_API_SECRET not available — skipping user properties send');
    return;
  }

  if (Object.keys(properties).length === 0) return;

  const userProperties: Record<string, any> = {};
  for (const [key, value] of Object.entries(properties)) {
    // GA4 user property names: max 24 chars, alphanumeric + underscores only
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 24);
    userProperties[sanitizedKey] = { value };
  }

  const path = GA_DEBUG ? 'debug/mp/collect' : 'mp/collect';
  const url =
    `https://www.google-analytics.com/${path}` +
    `?measurement_id=${encodeURIComponent(GA_MEASUREMENT_ID)}` +
    `&api_secret=${encodeURIComponent(apiSecret)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: resolveClientId(clientId),
        user_properties: userProperties,
        events: [
          {
            // Measurement Protocol requires at least one event to accept user_properties.
            // Using a non-reserved custom event name.
            name: 'user_properties_update',
            params: {
              engagement_time_msec: 1,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(
        `[Analytics] User properties HTTP ${response.status}: ${response.statusText}`
      );
    } else if (GA_DEBUG) {
      let debugInfo: any = null;
      try {
        debugInfo = await response.json();
      } catch {
        // Non-JSON response
      }
      const messages = debugInfo?.validationMessages;
      if (messages && messages.length > 0) {
        console.warn(`[Analytics][DEBUG] User-properties validation:`, JSON.stringify(messages));
      } else {
        console.log(`[Analytics][DEBUG] User properties validated OK for ${clientId}: ${Object.keys(properties).join(', ')}`);
      }
    } else {
      console.log(`[Analytics] Set user properties for ${clientId}: ${Object.keys(properties).join(', ')}`);
    }
  } catch (err: any) {
    console.warn('[Analytics] User properties request failed:', err.message);
  }
}
