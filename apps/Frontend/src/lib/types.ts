// Hand-written mirror of the guest API contract. Not generated — see Docs/14-frontend-api-map.md
// for the endpoint each type belongs to. Wire casing is camelCase (money fields suffixed
// `Paise`); stay dates are `YYYY-MM-DD` strings, check-in inclusive / checkout exclusive.

export type ErrorCode =
  | 'validation_failed'
  | 'malformed_json'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'availability_conflict'
  | 'promo_exhausted'
  | 'idempotency_key_reused'
  | 'quote_already_booked'
  | 'quote_expired'
  | 'hold_expired'
  | 'price_changed'
  | 'rate_limited'
  | 'feature_unavailable'
  | 'internal_error';

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; details?: unknown; requestId: string };
};

export type Principal = {
  userId: string;
  kind: 'guest' | 'employee';
  role: string;
  team: 'reservations' | 'sales' | null;
  emailVerified: boolean;
  phoneVerified: boolean;
};

/** `GET /content` — the approved resort facts, `is_current` rows only. The same corpus the AI
 *  drafter is grounded in (apps/Backend/src/core/enquiry/processing.ts). */
export type ResortContent = { key: string; title: string; body: string; version: number };

export type PhotoVariant = { w: number; format: string; url: string };
export type Photo = { alt: string; width: number; height: number; variants: PhotoVariant[]; isCover?: boolean };

export type RoomListing = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  amenities: string[];
  inclusions: string[];
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  fromPricePaise: number;
  coverPhoto: Photo | null;
};

export type RoomDetail = RoomListing & { description: string; photos: Photo[] };

export type AvailabilityRoom =
  | { roomTypeId: string; slug: string; name: string; available: false; reason: 'occupancy' }
  | {
      roomTypeId: string;
      slug: string;
      name: string;
      available: boolean;
      reason?: 'sold_out';
      remaining: number;
      fromPricePaise: number;
    };

export type AvailabilityResponse = { checkIn: string; checkOut: string; rooms: AvailabilityRoom[] };

// Added in 3B — not yet in the deployed backend contract map until that sub-phase lands.
export type AvailabilityCalendarDay = { date: string; remaining: number; pricePaise: number; isBlackout: boolean };
export type AvailabilityCalendarResponse = { slug: string; days: AvailabilityCalendarDay[] };

/** One physical room in a booking — NOT a quantity. `core/pricing.ts` iterates this array with
 * no multiplier; two Garden Suites are two entries. Capped at POLICY.maxRoomsPerBooking (4). */
export type QuoteLineItem = { roomTypeId: string; adults: number; children: number };

export type QuoteLineNight = {
  roomTypeId: string;
  stayDate: string;
  pricePaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxRateBps: number;
  taxPaise: number;
};

export type QuoteResult = {
  nights: QuoteLineNight[];
  roomPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  taxConfigVersion: number;
  termsVersion: number;
};

export type QuoteResponse = {
  quoteId: string;
  checkIn: string;
  checkOut: string;
  pricing: QuoteResult;
  roomPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  taxConfigVersion: number;
  termsVersion: number;
  expiresAt: string;
  expired: boolean;
};

export type PromoValidateResponse =
  | { valid: false; reason: string }
  | { valid: true; kind: 'percent' | 'fixed'; value: number };

export type BookingStatus = 'pending_payment' | 'confirmed' | 'payment_failed' | 'expired';

export type Booking = {
  bookingId: string;
  reference: string;
  status: BookingStatus;
  checkIn: string;
  checkOut: string;
  holdExpiresAt: string | null;
  totalPaise: number;
};

export type CreateBookingResponse = { bookingId: string; reference: string; holdExpiresAt: string };

export type PriceChangedDetails = { quoteId: string } & QuoteResult;

export type PaymentAttemptOutcome = 'succeed' | 'decline' | 'succeed_late';
export type CreatePaymentAttemptResponse = { paymentId: string; providerRef: string };

export type EnquirySummary = {
  enquiryId: string;
  publicRef: string;
  status: 'new' | 'in_progress' | 'awaiting_guest' | 'resolved';
  category: string | null;
  bookingId: string | null;
  lastActivityAt: string;
};

export type EnquiryMessage = { id: string; direction: 'inbound' | 'outbound'; body: string; createdAt: string };

export type EnquiryDetail = Omit<EnquirySummary, 'lastActivityAt'> & { messages: EnquiryMessage[] };

export type EventEnquiryInput = {
  eventType: 'wedding' | 'offsite';
  preferredDates:
    | { type: 'exact'; checkIn: string; checkOut: string }
    | { type: 'month'; month: string }
    | { type: 'flexible'; notes: string };
  guestCount: number;
  roomsNeeded: number;
  nights: number;
  budgetPaise?: number;
  requirements?: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
};

export type Paginated<T> = { items: T[]; nextCursor: string | null };
