-- 001_init.sql — full schema for phases 1 and 2.
-- Conventions: money is integer paise (BIGINT); stay dates are DATE; events are timestamptz;
-- enum-like columns are TEXT + CHECK (cheaper to evolve than a Postgres ENUM).
-- Rationale per table lives in Docs/01-data-model.md.

-- ---------------------------------------------------------------------------
-- Identity and access
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL CHECK (kind IN ('guest', 'employee')),
  role              text NOT NULL CHECK (role IN ('guest', 'staff', 'gm', 'owner')),
  team              text CHECK (team IN ('reservations', 'sales')),
  name              text NOT NULL CHECK (length(btrim(name)) > 0),
  email             text,
  email_verified_at timestamptz,
  phone             text,
  phone_verified_at timestamptz,
  username          text,
  password_hash     text,
  google_sub        text,
  is_active         boolean NOT NULL DEFAULT true,
  disabled_at       timestamptz,
  disabled_by       uuid REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- A guest can never hold an employee role or a team, and never a username.
  CONSTRAINT users_guest_shape CHECK (
    kind <> 'guest' OR (role = 'guest' AND team IS NULL AND username IS NULL)
  ),
  CONSTRAINT users_employee_shape CHECK (
    kind <> 'employee' OR (role IN ('staff', 'gm', 'owner') AND username IS NOT NULL
                           AND email IS NOT NULL AND password_hash IS NOT NULL)
  ),
  -- Only staff carry a team; gm/owner do not.
  CONSTRAINT users_team_requires_staff CHECK (team IS NULL OR role = 'staff'),
  CONSTRAINT users_guest_has_contact CHECK (
    kind <> 'guest' OR email IS NOT NULL OR phone IS NOT NULL
  ),
  CONSTRAINT users_disabled_shape CHECK (is_active OR disabled_at IS NOT NULL)
);

-- Case-insensitive uniqueness, partial so NULLs don't collide.
CREATE UNIQUE INDEX users_email_uq     ON users (lower(email))    WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_username_uq  ON users (lower(username)) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX users_google_uq    ON users (google_sub)      WHERE google_sub IS NOT NULL;
CREATE UNIQUE INDEX users_phone_uq     ON users (phone)           WHERE phone IS NOT NULL;
CREATE INDEX users_employee_idx ON users (role, team) WHERE kind = 'employee' AND is_active;

-- Rotating refresh credentials. Opaque random value, stored only as a hash.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  rotated_from uuid REFERENCES sessions (id),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('logout', 'rotation', 'employee_disabled', 'reuse_detected')),
  user_agent   text,
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX sessions_user_idx   ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE otp_challenges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users (id) ON DELETE CASCADE,
  purpose          text NOT NULL CHECK (purpose IN ('guest_signup', 'guest_login', 'verify_email', 'verify_phone')),
  destination_kind text NOT NULL CHECK (destination_kind IN ('email', 'phone')),
  destination      text NOT NULL,
  code_hash        text NOT NULL,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  attempts         int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  resend_count     int NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
  last_sent_at     timestamptz NOT NULL DEFAULT now(),
  request_ip_hash  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- One live challenge per (purpose, destination); lookup path for verify and resend.
CREATE UNIQUE INDEX otp_live_uq ON otp_challenges (purpose, destination) WHERE consumed_at IS NULL;
CREATE INDEX otp_expiry_idx ON otp_challenges (expires_at) WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Tax configuration (versioned; snapshotted onto every booking)
-- ---------------------------------------------------------------------------

CREATE TABLE tax_config (
  version          int PRIMARY KEY,
  effective_from   date NOT NULL,
  threshold_paise  bigint NOT NULL CHECK (threshold_paise > 0),
  low_rate_bps     int NOT NULL CHECK (low_rate_bps  BETWEEN 0 AND 10000),
  high_rate_bps    int NOT NULL CHECK (high_rate_bps BETWEEN 0 AND 10000),
  source_note      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rates_ordered CHECK (low_rate_bps <= high_rate_bps)
);

-- Notification 15/2025-Central Tax (Rate), effective 22 Sep 2025:
-- value of supply per unit per day <= Rs 7,500 -> 5%; above -> 18%.
INSERT INTO tax_config (version, effective_from, threshold_paise, low_rate_bps, high_rate_bps, source_note)
VALUES (1, '2025-09-22', 750000, 500, 1800,
        'Notification 15/2025-Central Tax (Rate) dated 17 Sep 2025, effective 22 Sep 2025, amending 11/2017-CTR (56th GST Council). Bracket applies per unit per day on post-discount value.');

-- ---------------------------------------------------------------------------
-- Room catalogue, pricing and inventory
-- ---------------------------------------------------------------------------

CREATE TABLE room_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  name             text NOT NULL,
  summary          text NOT NULL,
  description      text NOT NULL,
  amenities        text[] NOT NULL DEFAULT '{}',
  -- What the RATE includes (breakfast, estate walk), as opposed to what the room HAS.
  -- Separate from amenities so the room page can list them apart and the AI can state
  -- inclusions without inventing them. Docs/03-decisions.md.
  inclusions       text[] NOT NULL DEFAULT '{}',
  max_adults       int NOT NULL CHECK (max_adults >= 1),
  max_children     int NOT NULL CHECK (max_children >= 0),
  max_occupancy    int NOT NULL CHECK (max_occupancy >= 1),
  physical_stock   int NOT NULL CHECK (physical_stock >= 0),
  base_price_paise bigint NOT NULL CHECK (base_price_paise > 0),
  base_allotment   int NOT NULL CHECK (base_allotment >= 0),
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT room_occupancy_coherent CHECK (max_occupancy <= max_adults + max_children),
  -- The site sells an allotment, never more than the house physically has.
  CONSTRAINT room_allotment_within_stock CHECK (base_allotment <= physical_stock)
);

CREATE TABLE room_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id uuid NOT NULL REFERENCES room_types (id) ON DELETE CASCADE,
  alt          text NOT NULL CHECK (length(btrim(alt)) > 0),
  width        int NOT NULL CHECK (width > 0),
  height       int NOT NULL CHECK (height > 0),
  -- Pre-generated responsive variants: [{ "w": 640, "format": "avif", "url": "..." }, ...]
  variants     jsonb NOT NULL,
  is_cover     boolean NOT NULL DEFAULT false,
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_photo_variants_nonempty CHECK (jsonb_array_length(variants) > 0)
);
CREATE UNIQUE INDEX room_photos_cover_uq ON room_photos (room_type_id) WHERE is_cover;
CREATE INDEX room_photos_room_idx ON room_photos (room_type_id, sort_order);

-- One row per (room type, calendar date). Serves three jobs at once:
--   1. the optional price override for that date,
--   2. the optional allotment override and the blackout flag,
--   3. THE LOCK TARGET: reservations SELECT ... FOR UPDATE these rows, always ordered by
--      (room_type_id, stay_date), before rechecking availability.
-- Rows are materialised on demand (INSERT ... ON CONFLICT DO NOTHING); absence means
-- "no override", which is why both override columns are nullable rather than defaulted.
CREATE TABLE room_day (
  room_type_id uuid NOT NULL REFERENCES room_types (id) ON DELETE CASCADE,
  stay_date    date NOT NULL,
  price_paise  bigint CHECK (price_paise > 0),
  allotment    int CHECK (allotment >= 0),
  is_blackout  boolean NOT NULL DEFAULT false,
  note         text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES users (id),
  PRIMARY KEY (room_type_id, stay_date)
);

-- ---------------------------------------------------------------------------
-- Promo codes
-- ---------------------------------------------------------------------------

CREATE TABLE promo_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  -- percent: basis points (1000 = 10%). fixed: paise.
  value       bigint NOT NULL CHECK (value > 0),
  max_uses    int CHECK (max_uses > 0),
  starts_at   timestamptz,
  ends_at     timestamptz,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_percent_within_range CHECK (kind <> 'percent' OR value <= 10000),
  CONSTRAINT promo_window_ordered CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX promo_code_uq ON promo_codes (upper(code));

-- Redemption capacity is reserved alongside the payment hold and released with it, so the
-- usage cap holds under concurrency. The cap is enforced by counting held + consumed rows
-- while holding a FOR UPDATE lock on the promo_codes row -- never by a cached counter.
CREATE TABLE promo_redemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id    uuid NOT NULL REFERENCES promo_codes (id),
  booking_id  uuid NOT NULL,
  state       text NOT NULL CHECK (state IN ('held', 'consumed', 'released')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- One code per booking, no stacking.
CREATE UNIQUE INDEX promo_redemption_booking_uq ON promo_redemptions (booking_id)
  WHERE state <> 'released';
CREATE INDEX promo_redemption_count_idx ON promo_redemptions (promo_id) WHERE state <> 'released';

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------

CREATE TABLE quotes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  check_in           date NOT NULL,
  check_out          date NOT NULL,
  -- [{ "roomTypeId": "...", "adults": 2, "children": 1 }, ...] -- one entry per room sold
  lines              jsonb NOT NULL,
  -- Full per-room-night breakdown, discount allocation and tax bracketing as computed.
  pricing            jsonb NOT NULL,
  promo_id           uuid REFERENCES promo_codes (id),
  room_paise         bigint NOT NULL CHECK (room_paise >= 0),
  discount_paise     bigint NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  tax_paise          bigint NOT NULL CHECK (tax_paise >= 0),
  total_paise        bigint NOT NULL CHECK (total_paise >= 0),
  tax_config_version int NOT NULL REFERENCES tax_config (version),
  -- The booking_terms version in force when this quote was priced. Carried onto the
  -- booking so the guest is held to the terms they were actually shown (INV-28), not
  -- to whatever the GM published in the five minutes since.
  terms_version      int NOT NULL,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_dates_ordered CHECK (check_out > check_in),
  CONSTRAINT quote_lines_nonempty CHECK (jsonb_array_length(lines) > 0),
  CONSTRAINT quote_total_consistent CHECK (total_paise = room_paise - discount_paise + tax_paise),
  CONSTRAINT quote_discount_within_room CHECK (discount_paise <= room_paise)
);
CREATE INDEX quotes_guest_idx ON quotes (guest_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

CREATE TABLE bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          text NOT NULL UNIQUE,
  guest_user_id      uuid NOT NULL REFERENCES users (id),
  status             text NOT NULL CHECK (status IN ('pending_payment', 'confirmed', 'payment_failed', 'expired')),
  check_in           date NOT NULL,
  check_out          date NOT NULL,
  hold_expires_at    timestamptz,
  quote_id           uuid REFERENCES quotes (id),
  promo_id           uuid REFERENCES promo_codes (id),
  -- Purchased-price snapshot. Later rate, promo or tax edits must never move these.
  room_paise         bigint NOT NULL CHECK (room_paise >= 0),
  discount_paise     bigint NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  tax_paise          bigint NOT NULL CHECK (tax_paise >= 0),
  total_paise        bigint NOT NULL CHECK (total_paise >= 0),
  tax_config_version int NOT NULL REFERENCES tax_config (version),
  terms_version      int NOT NULL,
  guest_name         text NOT NULL,
  guest_email        text NOT NULL,
  guest_phone        text NOT NULL,
  confirmed_at       timestamptz,
  expired_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_dates_ordered CHECK (check_out > check_in),
  CONSTRAINT booking_total_consistent CHECK (total_paise = room_paise - discount_paise + tax_paise),
  CONSTRAINT booking_discount_within_room CHECK (discount_paise <= room_paise),
  CONSTRAINT booking_hold_has_expiry CHECK (status <> 'pending_payment' OR hold_expires_at IS NOT NULL),
  CONSTRAINT booking_confirmed_has_time CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL)
);
CREATE INDEX bookings_guest_idx     ON bookings (guest_user_id, created_at DESC);
-- The expiry worker's lookup, and the live-hold half of the availability expression.
CREATE INDEX bookings_live_hold_idx ON bookings (hold_expires_at) WHERE status = 'pending_payment';
-- CSV export and owner metrics filter on confirmation date, not stay dates.
CREATE INDEX bookings_confirmed_idx ON bookings (confirmed_at) WHERE status = 'confirmed';
CREATE INDEX bookings_stay_idx      ON bookings (check_in, check_out);

CREATE TABLE booking_rooms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  room_type_id      uuid NOT NULL REFERENCES room_types (id),
  -- Snapshot: the catalogue may be renamed later; the booking must still read correctly.
  room_name_snapshot text NOT NULL,
  adults            int NOT NULL CHECK (adults >= 1),
  children          int NOT NULL CHECK (children >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_rooms_booking_idx ON booking_rooms (booking_id);

-- The inventory-consuming rows. One per room, per night. Everything about availability is
-- derived from these joined to bookings -- there is no stored "rooms sold" counter anywhere.
CREATE TABLE booking_nights (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  booking_room_id uuid NOT NULL REFERENCES booking_rooms (id) ON DELETE CASCADE,
  room_type_id    uuid NOT NULL REFERENCES room_types (id),
  stay_date       date NOT NULL,
  price_paise     bigint NOT NULL CHECK (price_paise >= 0),
  discount_paise  bigint NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  taxable_paise   bigint NOT NULL CHECK (taxable_paise >= 0),
  tax_rate_bps    int NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_paise       bigint NOT NULL CHECK (tax_paise >= 0),
  CONSTRAINT night_unique_per_room UNIQUE (booking_room_id, stay_date),
  CONSTRAINT night_taxable_consistent CHECK (taxable_paise = price_paise - discount_paise)
);
-- The hot path: availability for a room type over a date window.
CREATE INDEX booking_nights_inventory_idx ON booking_nights (room_type_id, stay_date);
CREATE INDEX booking_nights_booking_idx   ON booking_nights (booking_id);

-- ---------------------------------------------------------------------------
-- Mock payments and refunds
-- ---------------------------------------------------------------------------

CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  attempt_no     int NOT NULL CHECK (attempt_no >= 1),
  status         text NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  amount_paise   bigint NOT NULL CHECK (amount_paise > 0),
  provider_ref   text NOT NULL UNIQUE,
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_attempt_uq UNIQUE (booking_id, attempt_no),
  CONSTRAINT payment_failure_reason_shape CHECK (status <> 'failed' OR failure_reason IS NOT NULL)
);
CREATE INDEX payments_booking_idx ON payments (booking_id, attempt_no DESC);
-- At most one attempt in flight per booking.
CREATE UNIQUE INDEX payments_one_live_idx ON payments (booking_id) WHERE status = 'processing';

-- The server-controlled mock ledger. A redelivered event is a no-op, not a second
-- confirmation: event_key is unique and processing is skipped when already present.
CREATE TABLE payment_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  event_key    text NOT NULL UNIQUE,
  type         text NOT NULL CHECK (type IN ('authorized', 'succeeded', 'failed', 'late_success')),
  payload      jsonb NOT NULL DEFAULT '{}',
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  outcome      text
);
CREATE INDEX payment_events_unprocessed_idx ON payment_events (received_at) WHERE processed_at IS NULL;

CREATE TABLE refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  booking_id   uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  -- Only one automatic refund reason exists in this build: a payment that succeeded after
  -- its hold had already been released. This is payment recovery, not cancellation (SS29).
  reason       text NOT NULL CHECK (reason IN ('late_payment_inventory_released')),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  status       text NOT NULL CHECK (status IN ('refund_pending', 'refunded', 'refund_failed')),
  failure_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Makes a duplicate refund structurally impossible.
  CONSTRAINT refund_once_per_reason UNIQUE (payment_id, reason)
);

CREATE TABLE idempotency_keys (
  key           text PRIMARY KEY,
  user_id       uuid REFERENCES users (id) ON DELETE CASCADE,
  endpoint      text NOT NULL,
  request_hash  text NOT NULL,
  status        text NOT NULL CHECK (status IN ('in_flight', 'completed')),
  response_code int,
  response_body jsonb,
  booking_id    uuid REFERENCES bookings (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  CONSTRAINT idempotency_completed_shape CHECK (
    status <> 'completed' OR (response_code IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX idempotency_created_idx ON idempotency_keys (created_at);

-- ---------------------------------------------------------------------------
-- Enquiries
-- ---------------------------------------------------------------------------

CREATE TABLE enquiries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref        text NOT NULL UNIQUE,
  source            text NOT NULL CHECK (source IN ('website', 'email', 'whatsapp')),
  -- Channel-native identifier: sender address or number. Not an authorisation token.
  source_identifier text,
  status            text NOT NULL CHECK (status IN ('new', 'in_progress', 'awaiting_guest', 'resolved')),
  -- NULL means "not classified yet" or "uncertain" -- never a guessed category.
  category          text CHECK (category IN ('room', 'wedding', 'offsite', 'complaint')),
  assignee_id       uuid REFERENCES users (id),
  -- Set only for website enquiries, and only to the authenticated submitter.
  guest_user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  booking_id        uuid REFERENCES bookings (id) ON DELETE SET NULL,
  contact_name      text,
  contact_email     text,
  contact_phone     text,
  -- Validated extraction: dates, guest counts, budget, nights, flexibility.
  extracted         jsonb NOT NULL DEFAULT '{}',
  ai_status         text NOT NULL DEFAULT 'pending'
                      CHECK (ai_status IN ('pending', 'ok', 'low_confidence', 'invalid', 'failed', 'skipped')),
  confidence        numeric(4, 3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  -- Surfaced in the GM's Unsorted lane. A review condition, not a fifth status.
  needs_review      boolean NOT NULL DEFAULT false,
  -- Always alerts the GM when true, independent of model confidence.
  is_complaint      boolean NOT NULL DEFAULT false,
  tags              text[] NOT NULL DEFAULT '{}',
  first_staff_reply_at timestamptz,
  resolved_at       timestamptz,
  reopened_count    int NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Only a website enquiry may be owned by a guest account; email/WhatsApp threads must
  -- never surface in a guest's website account even when the contact details match.
  CONSTRAINT enquiry_guest_only_website CHECK (guest_user_id IS NULL OR source = 'website'),
  CONSTRAINT enquiry_resolved_has_time CHECK (status <> 'resolved' OR resolved_at IS NOT NULL)
);
CREATE INDEX enquiries_inbox_idx      ON enquiries (status, last_activity_at DESC);
CREATE INDEX enquiries_assignee_idx   ON enquiries (assignee_id, status) WHERE assignee_id IS NOT NULL;
CREATE INDEX enquiries_unassigned_idx ON enquiries (last_activity_at DESC) WHERE assignee_id IS NULL;
CREATE INDEX enquiries_review_idx     ON enquiries (last_activity_at DESC) WHERE needs_review;
CREATE INDEX enquiries_guest_idx      ON enquiries (guest_user_id, last_activity_at DESC) WHERE guest_user_id IS NOT NULL;
CREATE INDEX enquiries_category_idx   ON enquiries (category, status);

CREATE TABLE enquiry_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id      uuid NOT NULL REFERENCES enquiries (id) ON DELETE CASCADE,
  direction       text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  -- 'internal' notes are never shown to a guest and never enter an AI prompt.
  visibility      text NOT NULL CHECK (visibility IN ('guest', 'internal')),
  author_user_id  uuid REFERENCES users (id),
  body            text NOT NULL CHECK (length(btrim(body)) > 0),
  -- Set when this outbound message was sent from an AI draft, for metrics honesty.
  from_ai_run_id  uuid,
  delivery_status text NOT NULL DEFAULT 'not_applicable'
                    CHECK (delivery_status IN ('not_applicable', 'pending', 'sent', 'failed')),
  delivery_error  text,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- An internal note is never an outbound delivery.
  CONSTRAINT message_internal_not_delivered CHECK (
    visibility <> 'internal' OR delivery_status = 'not_applicable'
  ),
  CONSTRAINT message_inbound_not_delivered CHECK (
    direction <> 'inbound' OR delivery_status = 'not_applicable'
  )
);
CREATE INDEX enquiry_messages_thread_idx ON enquiry_messages (enquiry_id, created_at);
CREATE INDEX enquiry_messages_guest_idx  ON enquiry_messages (enquiry_id, created_at)
  WHERE visibility = 'guest';

-- Assignment and classification history, plus status transitions. Preserved across employee
-- disabling so the audit trail survives reassignment.
CREATE TABLE enquiry_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id uuid NOT NULL REFERENCES enquiries (id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES users (id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('guest', 'employee', 'system', 'ai')),
  type       text NOT NULL CHECK (type IN ('created', 'classified', 'assigned', 'reassigned',
                                           'unassigned', 'category_corrected', 'status_changed',
                                           'reopened', 'ai_failed', 'reply_sent')),
  before     jsonb,
  after      jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enquiry_events_thread_idx ON enquiry_events (enquiry_id, created_at);

-- Per-employee unread / new-activity indicators.
CREATE TABLE enquiry_reads (
  enquiry_id   uuid NOT NULL REFERENCES enquiries (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enquiry_id, user_id)
);

-- One row per model invocation. The traceability record: which model, which prompt version,
-- which knowledge version, what came back, and why it was rejected if it was.
CREATE TABLE ai_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id        uuid NOT NULL REFERENCES enquiries (id) ON DELETE CASCADE,
  stage             text NOT NULL CHECK (stage IN ('classify', 'draft')),
  provider          text NOT NULL,
  model             text NOT NULL,
  prompt_version    text NOT NULL,
  knowledge_version int,
  status            text NOT NULL CHECK (status IN ('ok', 'schema_invalid', 'semantic_invalid',
                                                    'low_confidence', 'timeout', 'provider_error',
                                                    'price_claim_rejected')),
  -- Validated output only. Raw prompts are deliberately not stored here (SS17).
  output            jsonb,
  validation_errors jsonb,
  attempt_no        int NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
  latency_ms        int CHECK (latency_ms >= 0),
  input_tokens      int CHECK (input_tokens >= 0),
  output_tokens     int CHECK (output_tokens >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_runs_enquiry_idx ON ai_runs (enquiry_id, created_at DESC);

-- The draft awaiting staff review. Separate from enquiry_messages: a draft is not a message
-- until a human explicitly sends it.
CREATE TABLE ai_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id  uuid NOT NULL REFERENCES enquiries (id) ON DELETE CASCADE,
  ai_run_id   uuid NOT NULL REFERENCES ai_runs (id) ON DELETE CASCADE,
  body        text NOT NULL,
  -- Backend-rendered authoritative price text, if the draft needed one. Never model-authored.
  quote_block jsonb,
  flags       text[] NOT NULL DEFAULT '{}',
  state       text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'discarded', 'superseded')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- At most one draft awaiting review per thread.
CREATE UNIQUE INDEX ai_drafts_pending_uq ON ai_drafts (enquiry_id) WHERE state = 'pending';

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

-- Approved resort information, versioned: a new row per revision, current = highest version
-- per key. This is the only factual source the AI may quote; prices never come from here.
CREATE TABLE resort_info (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  version     int NOT NULL CHECK (version >= 1),
  is_current  boolean NOT NULL DEFAULT true,
  created_by  uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resort_info_version_uq UNIQUE (key, version)
);
CREATE UNIQUE INDEX resort_info_current_uq ON resort_info (key) WHERE is_current;

-- Postgres-backed job queue. Claimed with FOR UPDATE SKIP LOCKED; survives restarts because
-- the state is in the table, not in a timer.
CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  -- Set to make a job type at-most-once for a given target (e.g. one refund per payment).
  dedupe_key   text,
  run_after    timestamptz NOT NULL DEFAULT now(),
  attempts     int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  completed_at timestamptz,
  failed_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX jobs_dedupe_uq ON jobs (type, dedupe_key) WHERE dedupe_key IS NOT NULL;
-- The claim query's index: ready, unclaimed, oldest first.
CREATE INDEX jobs_ready_idx ON jobs (run_after)
  WHERE completed_at IS NULL AND failed_at IS NULL;
-- Reclaim path for work abandoned by a crashed worker.
CREATE INDEX jobs_stuck_idx ON jobs (locked_at) WHERE locked_at IS NOT NULL AND completed_at IS NULL;

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('complaint_alert', 'unassigned_enquiry', 'ai_failure',
                                           'assignment', 'refund_recorded')),
  enquiry_id uuid REFERENCES enquiries (id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings (id) ON DELETE CASCADE,
  body       text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- Append-only. The trigger below makes that structural, not merely a convention.
CREATE TABLE audit_events (
  id             bigserial PRIMARY KEY,
  actor_user_id  uuid REFERENCES users (id),
  actor_role     text,
  action         text NOT NULL,
  target_kind    text NOT NULL,
  target_id      text,
  before         jsonb,
  after          jsonb,
  request_id     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_time_idx   ON audit_events (created_at DESC);
CREATE INDEX audit_events_actor_idx  ON audit_events (actor_user_id, created_at DESC);
CREATE INDEX audit_events_target_idx ON audit_events (target_kind, target_id, created_at DESC);

CREATE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS
$fn$ BEGIN
  RAISE EXCEPTION 'audit_events is append-only (attempted %)', TG_OP;
END $fn$;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();

-- Anonymous funnel events. anon_id is a random first-party cookie value, not a fingerprint.
CREATE TABLE analytics_events (
  id         bigserial PRIMARY KEY,
  anon_id    text NOT NULL,
  session_id text NOT NULL,
  type       text NOT NULL CHECK (type IN ('visit', 'search', 'checkout_started',
                                           'booking_confirmed', 'enquiry_submitted')),
  -- Deduplicates a repeated client event so a funnel step is counted once per session.
  dedupe_key text,
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX analytics_dedupe_uq ON analytics_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX analytics_funnel_idx ON analytics_events (type, created_at);

-- Deferred FKs that would otherwise be forward references.
ALTER TABLE promo_redemptions
  ADD CONSTRAINT promo_redemptions_booking_fk
  FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE;

ALTER TABLE enquiry_messages
  ADD CONSTRAINT enquiry_messages_ai_run_fk
  FOREIGN KEY (from_ai_run_id) REFERENCES ai_runs (id) ON DELETE SET NULL;
