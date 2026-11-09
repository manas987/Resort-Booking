import { Router } from 'express';
import { requireEmployee } from '../../../middleware/adminAuth.ts';
import { rateLimit } from '../../../middleware/rateLimit.ts';
import { POLICY } from '../../../core/policy.ts';
import type { Principal } from '../../../core/tokens.ts';
import { generateEnquiryDraftController, retryEnquiryAiController } from './controllers.ts';

export const enquiryDraftsRouter = Router();

// Both routes spend a real provider call, so both draw on ONE bucket per employee — a separate
// limiter per route would let /retry double the allowance. Mounted after requireEmployee because
// the key is the principal, not the IP (POLICY.ai explains why).
const draftsPerEmployee = rateLimit({
  name: 'admin-enquiry-draft',
  windowSeconds: POLICY.ai.draftWindowSeconds,
  max: POLICY.ai.maxDraftsPerEmployee,
  key: (_request, response) => (response.locals.principal as Principal | undefined)?.userId ?? null,
});

enquiryDraftsRouter.post('/:enquiryId', requireEmployee, draftsPerEmployee, generateEnquiryDraftController);
enquiryDraftsRouter.post('/:enquiryId/retry', requireEmployee, draftsPerEmployee, retryEnquiryAiController);
