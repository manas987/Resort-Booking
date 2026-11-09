import { LoadingSkeleton } from './LoadingSkeleton';
import { apiFetch } from '../lib/api';
import { useResource } from '../lib/useResource';
import type { ResortContent } from '../lib/types';

/**
 * §8A's "brief resort information based on approved content", driven by `GET /api/user/content`.
 *
 * This is the guest-facing half of a loop that already existed entirely in the backend and was
 * wired at neither end: staff publish a new version with `PUT /api/admin/resortInfo`, which
 * supersedes the previous row in `resort_info`, and this section renders whatever
 * `is_current` says. Editing the copy is therefore an operational act, not a code change —
 * which is the point of keeping the text in the database at all.
 *
 * Never pre-rendered: `apps/Frontend/CLAUDE.md` rules out baking GM-editable facts into static
 * output, because a stale build would then contradict what staff just published.
 *
 * Native `<details>` on purpose — no JS, keyboard-operable and screen-reader-announced for
 * free, consistent with "no date library, the native controls are also the accessible ones".
 */
export function ResortInfo() {
  const { data, loading, error, refetch } = useResource<{ content: ResortContent[] }>(
    (signal) => apiFetch('/content', { signal }),
    [],
  );
  const sections = data?.content ?? [];

  return (
    <section className="resort-info" aria-labelledby="resort-info-title">
      <div className="resort-info-intro">
        <span className="welcome-label">GOOD TO KNOW</span>
        <h2 id="resort-info-title">Before you arrive.</h2>
        <p>The details our team keeps current — rooms, arrival, and what a stay includes.</p>
      </div>

      {loading && (
        <LoadingSkeleton label="Loading estate information…" rows={4} />
      )}
      {error && (
        <p className="resort-info-status" role="alert">
          We couldn’t load this just now.{' '}
          <button type="button" className="room-inline-link" onClick={refetch}>
            Try again
          </button>
        </p>
      )}
      {/* An empty corpus is a real state: nothing has been published yet. Saying so beats an
          empty box, and inventing filler copy here would defeat the whole approved-content
          idea (Product.md §8A: no facility or policy that is not in approved content). */}
      {!loading && !error && sections.length === 0 && (
        <p className="resort-info-status">Estate information is being updated. Our team can answer anything in the meantime.</p>
      )}

      {sections.length > 0 && (
        <div className="resort-info-list">
          {sections.map((section, index) => (
            <details key={section.key} name="resort-info" open={index === 0}>
              <summary>
                <span>{section.title}</span>
                <span className="resort-info-mark" aria-hidden="true" />
              </summary>
              <p>{section.body}</p>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
