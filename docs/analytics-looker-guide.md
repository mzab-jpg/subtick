# Tangent — Personalization Health Reporting

> **One-time setup:** Run `firebase/analytics/create_personalization_health_view.sql` in BigQuery Console. The connected MCP service account is read-only and cannot create the view.
> **Data source:** `subtick-bbd55.analytics_545741262.v_personalization_health`
> **Purpose:** Measure whether recommendations improve as Tangent learns about a user.

## Use this view, not raw GA4 events

Connect Looker Studio to the BigQuery view named above. It contains one row per
**recommendation impression**: a particular article at a particular position in a
particular returned feed. It joins later actions to that exact impression through
`impression_id`.

Only rows where `analytics_environment = 'production'` belong in launch reports.
Emulator rows are intentionally retained for pipeline testing but must be filtered
out of real-user charts.

## Definitions

- **Meaningful engagement:** one or more of `read_thorough`, `like`, or `save`.
  It counts once per impression, even when a person does all three.
- **User stages:** `new` (0–2 earlier qualifying reads), `learning` (3–14),
  `established` (15+), and `inactive_returning` (previous qualifying read was
  at least 14 days ago). Stages are reporting-only; they do not change ranking.
- **Discovery publisher:** the user had no stored interaction with that publisher.
- **Discovery category:** the category had no expressed or learned preference
  signal at feed-generation time (neutral weight).

## Looker Studio setup

1. Create a **BigQuery** data source for `v_personalization_health`.
2. Set `impression_timestamp` and `event_date` to Date/DateTime fields.
3. Add a report-level filter: `analytics_environment` equals `production`.
4. Create these calculated metrics. They are BigQuery-source fields, so no GA4 custom-dimension registration is required for this Looker report:

| Name | Formula |
|---|---|
| Impressions | `COUNT(impression_id)` |
| Meaningful engagements | `SUM(is_meaningfully_engaged)` |
| Meaningful engagement rate | `SAFE_DIVIDE(SUM(is_meaningfully_engaged), COUNT(impression_id))` |
| Thorough-read rate | `SAFE_DIVIDE(SUM(is_read_thorough), COUNT(impression_id))` |
| Quick-exit rate | `SAFE_DIVIDE(SUM(is_quick_exit), COUNT(impression_id))` |
| Explicit-rejection rate | `SAFE_DIVIDE(SUM(is_not_interested), COUNT(impression_id))` |
| Discovery engagement rate | `SAFE_DIVIDE(SUM(CASE WHEN is_new_publisher = 1 OR is_new_category = 1 THEN is_meaningfully_engaged ELSE 0 END), SUM(CASE WHEN is_new_publisher = 1 OR is_new_category = 1 THEN 1 ELSE 0 END))` |

## Recommended launch pages

### 1. Personalization improvement

- Scorecards: Impressions, Meaningful engagement rate, Thorough-read rate,
  Quick-exit rate.
- Line chart: `event_date` with Meaningful engagement rate.
- Bar chart: `user_stage` with Meaningful engagement rate.
- Table: `user_stage`, impressions, meaningful engagement rate, quick-exit rate.

The launch question is whether learning and established users do better than new
users, then—once enough data exists—whether each user’s later feeds outperform
their earliest feeds.

### 2. Feed quality and diversity

- Table: `feed_id`, `user_stage`, `distinct_category_count`,
  `distinct_publisher_count`, `profile_concentration`, and feed engagement rate.
- Bar chart: `category_id` by impressions and meaningful engagement rate.
- Bar chart: `publisher_id` by impressions and meaningful engagement rate.
- Scatter chart: `profile_concentration` versus `is_meaningfully_engaged`.

A high concentration plus weak engagement is an overconfidence warning, not an
automatic ranking change.

### 3. Discovery and ranking diagnostics

- Bar chart: `is_new_publisher` and `is_new_category` by meaningful engagement rate.
- Bar chart: `tranche` by meaningful engagement rate.
- Bar chart: `dominant_component` by meaningful engagement rate.
- Line or bar chart: `position` by meaningful engagement rate.
- Scatter chart: `score_p` versus `is_meaningfully_engaged`.

## What not to conclude too early

Do not tune ranking defaults from emulator activity or from a few users. Wait for
production data spanning multiple feeds per person. WPM is a reading-calibration
metric; it is not a measure of whether personalization is working.
