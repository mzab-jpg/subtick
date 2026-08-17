-- Tangent recommendation-to-outcome source for Looker Studio.
-- Run once in BigQuery Console while project=subtick-bbd55 is selected.
-- This requires BigQuery permission to create views in analytics_545741262.
CREATE OR REPLACE VIEW `subtick-bbd55.analytics_545741262.v_personalization_health` AS
WITH raw_events AS (
  SELECT
    PARSE_DATE('%Y%m%d', REGEXP_EXTRACT(_TABLE_SUFFIX, r'(\d{8})')) AS event_date,
    TIMESTAMP_MICROS(event_timestamp) AS event_timestamp,
    user_pseudo_id, event_name,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'analytics_environment') AS analytics_environment,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'feed_id') AS feed_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'impression_id') AS impression_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'article_id') AS article_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'publisher_id') AS publisher_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'category_id') AS category_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'tranche') AS tranche,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'dominant_component') AS dominant_component,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'user_stage') AS user_stage,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64)) FROM UNNEST(event_params) WHERE key = 'position') AS position,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64)) FROM UNNEST(event_params) WHERE key = 'prior_qualifying_reads') AS prior_qualifying_reads,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64)) FROM UNNEST(event_params) WHERE key = 'days_since_last_read') AS days_since_last_read,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64)) FROM UNNEST(event_params) WHERE key = 'is_new_publisher') AS is_new_publisher,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64)) FROM UNNEST(event_params) WHERE key = 'is_new_category') AS is_new_category,
    (SELECT COALESCE(value.double_value, CAST(value.int_value AS FLOAT64), SAFE_CAST(value.string_value AS FLOAT64)) FROM UNNEST(event_params) WHERE key = 'profile_concentration') AS profile_concentration,
    (SELECT COALESCE(value.double_value, CAST(value.int_value AS FLOAT64), SAFE_CAST(value.string_value AS FLOAT64)) FROM UNNEST(event_params) WHERE key = 'score_p') AS score_p,
    (SELECT COALESCE(value.double_value, CAST(value.int_value AS FLOAT64), SAFE_CAST(value.string_value AS FLOAT64)) FROM UNNEST(event_params) WHERE key = 'score_t') AS score_t,
    (SELECT COALESCE(value.double_value, CAST(value.int_value AS FLOAT64), SAFE_CAST(value.string_value AS FLOAT64)) FROM UNNEST(event_params) WHERE key = 'score_r') AS score_r,
    (SELECT COALESCE(value.double_value, CAST(value.int_value AS FLOAT64), SAFE_CAST(value.string_value AS FLOAT64)) FROM UNNEST(event_params) WHERE key = 'score_q') AS score_q,
    (SELECT COALESCE(value.double_value, CAST(value.int_value AS FLOAT64), SAFE_CAST(value.string_value AS FLOAT64)) FROM UNNEST(event_params) WHERE key = 'final_score') AS final_score
  FROM `subtick-bbd55.analytics_545741262.events_*`
),
impressions AS (
  SELECT * FROM raw_events
  WHERE event_name = 'article_shown' AND analytics_environment = 'production'
    AND impression_id IS NOT NULL AND impression_id != ''
),
outcomes AS (
  SELECT impression_id,
    MAX(IF(event_name = 'read_thorough', 1, 0)) AS is_read_thorough,
    MAX(IF(event_name = 'like', 1, 0)) AS is_liked,
    MAX(IF(event_name = 'save', 1, 0)) AS is_saved,
    MAX(IF(event_name = 'quick_exit', 1, 0)) AS is_quick_exit,
    MAX(IF(event_name = 'swipe_not_interested', 1, 0)) AS is_not_interested,
    MIN(event_timestamp) AS first_outcome_timestamp
  FROM raw_events
  WHERE analytics_environment = 'production' AND impression_id IS NOT NULL AND impression_id != ''
    AND event_name IN ('read_thorough', 'like', 'save', 'quick_exit', 'swipe_not_interested')
  GROUP BY impression_id
)
SELECT
  i.event_date, i.event_timestamp AS impression_timestamp, i.user_pseudo_id,
  i.feed_id, i.impression_id, i.article_id, i.publisher_id, i.category_id,
  i.position, i.tranche, i.dominant_component, i.user_stage,
  i.prior_qualifying_reads, i.days_since_last_read, i.profile_concentration,
  i.is_new_publisher, i.is_new_category, i.score_p, i.score_t, i.score_r,
  i.score_q, i.final_score, i.analytics_environment,
  COALESCE(o.is_read_thorough, 0) AS is_read_thorough,
  COALESCE(o.is_liked, 0) AS is_liked,
  COALESCE(o.is_saved, 0) AS is_saved,
  COALESCE(o.is_quick_exit, 0) AS is_quick_exit,
  COALESCE(o.is_not_interested, 0) AS is_not_interested,
  IF(COALESCE(o.is_read_thorough, 0) = 1 OR COALESCE(o.is_liked, 0) = 1 OR COALESCE(o.is_saved, 0) = 1, 1, 0) AS is_meaningfully_engaged,
  o.first_outcome_timestamp
FROM impressions i LEFT JOIN outcomes o USING (impression_id);
