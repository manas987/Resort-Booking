/**
 * Every business limit in one place. Docs/03-decisions.md is the written source; this file is
 * the only runtime copy. A limit duplicated as a literal in a Zod schema and again in a core
 * function is how the two drift, so validators, core workflows and tests all import from here.
 *
 * Changing a number here changes it everywhere. Change it in 03-decisions.md in the same edit.
 */
export const POLICY = {
  /** Asia/Kolkata. "Today", export filtering and working hours are all resort-local. */
  timezone: 'Asia/Kolkata',

  stay: {
    maxRoomsPerBooking: 4,
    maxNightsPerBooking: 14,
    /** Check-in may be at most this many days after today, resort-local. */
    bookingHorizonDays: 365,
    minAdultsPerRoom: 1,
  },

  /** Minutes. Server-stamped and server-checked; a client clock never extends either. */
  expiry: {
    quoteMinutes: 5,
    paymentHoldMinutes: 10,
    accessTokenMinutes: 15,
    refreshSessionDays: 7,
  },

  /** Employee password login, the only staff-side brute-force surface (§7's "rate limits,
   *  especially on staff login"). Mirrors the OTP window shape (INV-59). */
  employeeLogin: {
    windowSeconds: 300,
    maxPerAccount: 5,
    maxPerIp: 20,
  },

  otp: {
    digits: 6,
    expiryMinutes: 5,
    maxAttempts: 5,
    resendCooldownSeconds: 60,
    /** The request-rate ceiling around the per-challenge limits above. Was written as
     *  literals in `routes/user/auth/routes.ts`; moved here because it is a business limit
     *  like any other (INV-59). */
    requestWindowSeconds: 300,
    maxRequestsPerDestination: 3,
    maxRequestsPerIp: 10,
    /** Verification is additionally capped per IP, not only per challenge — the 5-attempt
     *  lock protects one challenge, this protects against sweeping many. */
    maxVerifyPerIp: 20,
  },

  /** Unauthenticated write and lookup endpoints. §7 asks for "per-account/destination/IP rate
   *  limits" beyond login and OTP; without these the public surface is unmetered.
   *  `promoCheck` is deliberately the tightest: `POST /promos/validate` answers
   *  valid/invalid for an arbitrary code, which is an enumeration oracle over the whole
   *  promo namespace if it is free to call. */
  publicRateLimits: {
    windowSeconds: 300,
    promoCheckPerIp: 20,
    registerPerIp: 10,
    refreshPerIp: 60,
    quotePerIp: 60,
    analyticsPerIp: 120,
  },

  pagination: {
    defaultLimit: 25,
    maxLimit: 100,
    /** No list endpoint accepts a window wider than this. */
    maxRangeDays: 366,
  },

  availability: {
    /** GET /availability/calendar returns one row per day — a UI-scoped cap (roughly two
     *  months), not the admin list-range figure above, which would hand back 366 rows to a
     *  display-only guest read. */
    calendarMaxDays: 62,
  },

  /** Body-parser limit, applied in app.ts. Nothing this API accepts is large. */
  bodyLimitBytes: 64 * 1024,

  jobs: {
    defaultMaxAttempts: 5,
    /** A claimed job whose lock is older than this is considered abandoned (INV-24). */
    staleLockSeconds: 300,
    claimBatchSize: 10,
    pollIntervalMs: 2_000,
  },

  ai: {
    timeoutMs: 20_000,
    maxAttempts: 2,
    /** Below this, classification goes to GM review rather than being trusted (INV-47). */
    minConfidence: 0.6,
    /** A sanity ceiling on extracted party size, not a real capacity figure — well above any
     *  plausible wedding/offsite, just enough to catch an obviously-malformed extraction
     *  (AV-6: 5,000 guests). */
    maxPlausibleGuestCount: 1000,
  },
} as const;
