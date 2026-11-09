/**
 * AI response validation — deliberately separate from request schemas (07-backend-structure
 * convention). `*JsonSchema` goes to the provider as `responseJsonSchema`; `*ResponseSchema`
 * (Zod) is what `processEnquiry` parses the returned text against, step 2 of the pipeline.
 */
import { z } from 'zod';

export const CATEGORIES = ['room', 'wedding', 'offsite', 'complaint'] as const;

export const classifyJsonSchema = {
  type: 'object',
  properties: {
    category: { type: ['string', 'null'], enum: [...CATEGORIES, null] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    isComplaint: { type: 'boolean' },
    extracted: {
      type: 'object',
      properties: {
        checkIn: { type: ['string', 'null'] },
        checkOut: { type: ['string', 'null'] },
        adults: { type: ['integer', 'null'] },
        children: { type: ['integer', 'null'] },
        guestCount: { type: ['integer', 'null'] },
        budgetPaise: { type: ['integer', 'null'] },
        // The exact phrase the guest used for dates, preserved verbatim — never silently
        // resolved away (INV-48).
        datesOriginalText: { type: ['string', 'null'] },
        datesTentative: { type: 'boolean' },
        notes: { type: ['string', 'null'] },
      },
      required: ['checkIn', 'checkOut', 'adults', 'children', 'guestCount', 'budgetPaise', 'datesOriginalText', 'datesTentative', 'notes'],
    },
  },
  required: ['category', 'confidence', 'isComplaint', 'extracted'],
} as const;

export const classifyResponseSchema = z.object({
  category: z.enum(CATEGORIES).nullable(),
  confidence: z.number().min(0).max(1),
  isComplaint: z.boolean(),
  extracted: z.object({
    checkIn: z.string().nullable(),
    checkOut: z.string().nullable(),
    adults: z.number().int().nullable(),
    children: z.number().int().nullable(),
    guestCount: z.number().int().nullable(),
    budgetPaise: z.number().int().nullable(),
    datesOriginalText: z.string().nullable(),
    datesTentative: z.boolean(),
    notes: z.string().nullable(),
  }),
});
export type ClassifyResponse = z.infer<typeof classifyResponseSchema>;

export const draftJsonSchema = {
  type: 'object',
  properties: {
    body: { type: 'string' },
    // The model flags a stated price itself, so the backend can check it against the
    // rendered quote block rather than scanning free text for currency-shaped substrings.
    statesPrice: { type: 'boolean' },
  },
  required: ['body', 'statesPrice'],
} as const;

export const draftResponseSchema = z.object({
  body: z.string().min(1),
  statesPrice: z.boolean(),
});
export type DraftResponse = z.infer<typeof draftResponseSchema>;
