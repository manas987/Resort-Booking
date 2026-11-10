import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { Select, DateInput } from '../components/FormControls';
import { useCallback, useEffect, useRef, useState } from 'react';
import { History, Plus } from 'lucide-react';
import { adminFetch, AdminApiError } from './api';
import { useConsole } from './store';
import { money, dateText } from './model';
import { Drawer, Empty, Field, PageHeading } from './ui';

/**
 * Rates & allotment, against the real staff API. This is the first console screen wired to
 * `/api/admin/*`; `src/console/model.ts`'s rate/allotment/blackout branches were deleted in the
 * same change, so there is one code path, not two.
 *
 * The endpoints, all GM/owner-guarded server-side:
 *   GET    /rates|/inventory|/blackouts ?roomTypeId&from&to
 *   PATCH  /rates/room-types/:id        basePricePaise
 *   PATCH  /inventory/room-types/:id    baseAllotment
 *   POST   /rates|/inventory|/blackouts /preview   → { affected, conflicts, previewToken }
 *   PUT    /rates|/inventory|/blackouts            → requires that previewToken
 *   DELETE /rates|/inventory|/blackouts            → requires a previewToken too
 *   GET    /rates/history ?roomTypeId&from&to
 *
 * **Preview-then-apply is the backend's design, not decoration.** A write will not be accepted
 * without the `previewToken` the preview call returned, which is what guarantees the GM saw the
 * dates and conflicts they were about to overwrite. So "Review affected dates" is a required
 * step here, not a nicety that could be skipped.
 *
 * There is no range-override entity to manage: `room_day` is keyed
 * `(room_type_id, stay_date)` and written with `ON CONFLICT DO UPDATE`, so saving a window
 * twice overwrites it and stacking is impossible. Removing an override nulls the column and the
 * date falls back to the base. The screen reflects that per-date model directly, which is why
 * it shows a date list rather than a list of rules.
 *
 * Oversell protection is NOT re-implemented here. `assertAvailable` rejects an allotment below
 * committed usage inside the write transaction and names the dates; this screen shows that
 * error. A client-side pre-check would only be a second, weaker copy of the authority.
 */

type Room = {
  id: string;
  name: string;
  basePricePaise: number;
  physicalStock: number;
  baseAllotment: number;
  isActive: boolean;
};
type RateDay = { stayDate: string; pricePaise: number; hasOverride: boolean; isBlackout: boolean };
type InventoryDay = { stayDate: string; allotment: number; committed: number; remaining: number; isBlackout: boolean };
type Affected = { stayDate: string; currentPricePaise: number | null; currentAllotment: number | null; currentIsBlackout: boolean };
type Preview = { affected: Affected[]; conflicts: Array<{ stayDate: string }>; previewToken: string };
type HistoryEntry = { actorRole: string; action: string; createdAt: string; after: unknown };

type Kind = 'Rate' | 'Allotment' | 'Blackout';
const PATH: Record<Kind, string> = { Rate: '/rates', Allotment: '/inventory', Blackout: '/blackouts' };

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
function plusDays(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}

function OverrideDrawer({
  room,
  onClose,
  onSaved,
  initialRange,
}: {
  room: Room;
  onClose: () => void;
  onSaved: (message: string) => void;
  initialRange: { from: string; to: string };
}) {
  const [kind, setKind] = useState<Kind>('Rate');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [rupees, setRupees] = useState(String(room.basePricePaise / 100));
  const [allotment, setAllotment] = useState(String(room.baseAllotment));
  const [preview, setPreview] = useState<{ signature: string; value: Preview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);

  // A previewToken is only valid for the exact values the server issued it for, so the preview
  // is keyed on those values rather than cleared by an effect. Change any input and the key
  // stops matching, which discards the stale token without a render pass to do it.
  const signature = JSON.stringify({ kind, from, to, rupees, allotment, removing });
  const current = preview?.signature === signature ? preview.value : null;

  function payload() {
    if (kind === 'Rate') return removing ? {} : { pricePaise: Math.round(Number(rupees) * 100) };
    if (kind === 'Allotment') return removing ? {} : { allotment: Number(allotment) };
    return {};
  }

  async function runPreview() {
    setBusy(true);
    setError('');
    try {
      // The preview body differs from the apply body by one field: a null value previews the
      // removal, which touches the same rows.
      const previewBody =
        kind === 'Rate'
          ? { roomTypeId: room.id, from, to, pricePaise: removing ? null : Math.round(Number(rupees) * 100) }
          : kind === 'Allotment'
            ? { roomTypeId: room.id, from, to, allotment: removing ? null : Number(allotment) }
            : { roomTypeId: room.id, from, to };
      const value = await adminFetch<Preview>(`${PATH[kind]}/preview`, { method: 'POST', body: previewBody });
      setPreview({ signature, value });
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not check these dates.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      await adminFetch(PATH[kind], {
        method: removing ? 'DELETE' : 'PUT',
        body: { roomTypeId: room.id, from, to, ...payload(), previewToken: current.previewToken },
      });
      onSaved(
        removing
          ? `${kind} override removed for ${dateText(from)} – ${dateText(to)}.`
          : `${kind} saved for ${dateText(from)} – ${dateText(to)}.`,
      );
      onClose();
    } catch (failure) {
      // The interesting failures all arrive here: an allotment below committed usage names its
      // dates, and a stale preview token is refused.
      setError(failure instanceof AdminApiError ? failure.message : 'Could not save these settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={`Edit dates · ${room.name}`} subtitle="Review the affected dates before saving" onClose={onClose}>
      <div className="c-stack">
        <Field label="What are you changing?">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="Rate">Nightly price</option>
            <option value="Allotment">Rooms on website</option>
            <option value="Blackout">Close online bookings</option>
          </Select>
        </Field>
        <div className="c-pair">
          <Field label="From">
            <DateInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To (inclusive)">
            <DateInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {kind === 'Rate' && !removing && (
          <Field label="Nightly rate (₹)" hint={`Base is ${money(room.basePricePaise)}.`}>
            <input inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} />
          </Field>
        )}
        {kind === 'Allotment' && !removing && (
          <Field label="Website allotment" hint={`Physical stock is ${room.physicalStock}.`}>
            <input inputMode="numeric" value={allotment} onChange={(e) => setAllotment(e.target.value)} />
          </Field>
        )}
        <label className="c-checkline">
          <input type="checkbox" checked={removing} onChange={(e) => setRemoving(e.target.checked)} />
          <span>Reset these dates to their standard settings</span>
        </label>

        {current && (
          <div className="c-panel c-preview">
            <h3>Affected dates · {current.affected.length}</h3>
            <ul>
              {current.affected.slice(0, 14).map((day) => (
                <li key={day.stayDate}>
                  <span>{dateText(day.stayDate)}</span>
                  <small>
                    {day.currentPricePaise !== null ? `now ${money(day.currentPricePaise)}` : 'base rate'}
                    {day.currentAllotment !== null ? ` · allotment ${day.currentAllotment}` : ''}
                    {day.currentIsBlackout ? ' · blackout' : ''}
                  </small>
                </li>
              ))}
            </ul>
            {current.affected.length > 14 && <p className="c-muted">…and {current.affected.length - 14} more.</p>}
            {current.conflicts.length > 0 && <p className="c-error" role="alert">
              Existing bookings or holds prevent this change on {current.conflicts.map((day) => dateText(day.stayDate)).join(', ')}. Choose different dates or increase the room limit.
            </p>}
            <p className="c-muted">
              Confirming replaces these dates only. Dates outside the range keep whatever they
              have now.
            </p>
          </div>
        )}
        {error && (
          <p className="c-error" role="alert">
            {error}
          </p>
        )}
        <div className="c-drawer-actions">
          <button type="button" className="c-button" onClick={onClose}>
            Cancel
          </button>
          {current ? (
            <button type="button" className="c-primary" disabled={busy || current.conflicts.length > 0} onClick={() => void apply()}>
              {busy ? 'Saving…' : removing ? 'Confirm removal' : 'Confirm and save'}
            </button>
          ) : (
            <button type="button" className="c-primary" disabled={busy} onClick={() => void runPreview()}>
              {busy ? 'Checking…' : 'Review affected dates'}
            </button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function BaseSettings({ room, onSaved }: { room: Room; onSaved: (message: string) => void }) {
  const [rupees, setRupees] = useState(String(room.basePricePaise / 100));
  const [allotment, setAllotment] = useState(String(room.baseAllotment));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function save(kind: 'rate' | 'allotment') {
    setBusy(kind); setError('');
    try {
      await adminFetch(`${kind === 'rate' ? '/rates' : '/inventory'}/room-types/${room.id}`, {
        method: 'PATCH',
        body: kind === 'rate' ? { basePricePaise: Math.round(Number(rupees) * 100) } : { baseAllotment: Number(allotment) },
      });
      onSaved(`${kind === 'rate' ? 'Base nightly rate' : 'Base website allotment'} saved for ${room.name}.`);
    } catch (failure) {
      setError(failure instanceof AdminApiError ? failure.message : 'Could not save this setting.');
    } finally { setBusy(''); }
  }
  return <section className="c-rate-base-settings" aria-label="Room defaults">
    <div className="c-rate-base-heading"><h2>Standard settings</h2><p>Used unless you set a different price or room limit for specific dates.</p></div>
    <form onSubmit={(e) => { e.preventDefault(); void save('rate'); }}>
      <Field label="Nightly price (₹)"><input type="number" min="0.01" step="0.01" required value={rupees} onChange={(e) => setRupees(e.target.value)} /></Field>
      <button className="c-button" disabled={!!busy || Math.round(Number(rupees) * 100) === room.basePricePaise}>{busy === 'rate' ? 'Saving…' : 'Save rate'}</button>
    </form>
    <form onSubmit={(e) => { e.preventDefault(); void save('allotment'); }}>
      <Field label="Rooms available on the website"><input type="number" step="1" required value={allotment} onChange={(e) => setAllotment(e.target.value)} /></Field>
      <button className="c-button" disabled={!!busy || Number(allotment) === room.baseAllotment}>{busy === 'allotment' ? 'Saving…' : 'Save allotment'}</button>
    </form>
    <div className="c-rate-stock"><span>Total rooms</span><strong>{room.physicalStock}</strong><small>in this room type</small></div>
    {error && <p className="c-error" role="alert">{error}</p>}
  </section>;
}

export default function RatesLive() {
  const { notify } = useConsole();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(plusDays(today(), 29));
  const [rateDays, setRateDays] = useState<RateDay[]>([]);
  const [inventoryDays, setInventoryDays] = useState<InventoryDay[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const requestVersion = useRef(0);
  const room = rooms?.find((r) => r.id === selected) ?? null;

  useEffect(() => {
    let cancelled = false;
    adminFetch<{ rooms: Room[] }>('/rooms')
      .then((body) => {
        if (cancelled) return;
        setRooms(body.rooms);
        setSelected((current) => current || body.rooms[0]?.id || '');
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof AdminApiError ? failure.message : 'Could not load room types.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    const request = ++requestVersion.current;
    if (!selected) return;
    setLoading(true);
    setError('');
    const query = `roomTypeId=${selected}&from=${from}&to=${to}`;
    try {
      const [rates, inventory, historyBody] = await Promise.all([
        adminFetch<{ days: RateDay[] }>(`/rates?${query}`),
        adminFetch<{ days: InventoryDay[] }>(`/inventory?${query}`),
        adminFetch<{ items: HistoryEntry[] }>(`/rates/history?${query}`),
      ]);
      if (request !== requestVersion.current) return;
      setRateDays(rates.days);
      setInventoryDays(inventory.days);
      setHistory(historyBody.items);
    } catch (failure) {
      if (request === requestVersion.current) setError(failure instanceof AdminApiError ? failure.message : 'Could not load these dates.');
    } finally {
      if (request === requestVersion.current) setLoading(false);
    }
  }, [selected, from, to]);

  useEffect(() => {
    // Deferred a tick so load()'s first setState is not synchronous inside the effect body
    // (react-hooks/set-state-in-effect) — the same pattern as src/lib/useResource.ts.
    void Promise.resolve().then(load);
  }, [load]);

  const inventoryFor = new Map(inventoryDays.map((day) => [day.stayDate, day]));

  return (
    <>
      <PageHeading
        title="Rates & allotment"
        description="Set room prices and how many rooms guests can book on the website."
        actions={<button className="c-button" disabled={!room || loading} onClick={() => setHistoryOpen(true)}><History size={15} /> History</button>}
      />

      <div className="c-rate-room-selector">
        <Field label="Room type">
          <Select disabled={!rooms} value={selected} onChange={(e) => setSelected(e.target.value)}>
            {(rooms ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {room && <BaseSettings key={room.id} room={room} onSaved={(message) => {
        notify(message);
        void adminFetch<{ rooms: Room[] }>('/rooms').then((body) => setRooms(body.rooms)).catch(() => setError('Saved, but could not refresh defaults. Reload this page.'));
        void load();
      }} />}
      <section className="c-rate-dates-section" aria-labelledby="rate-calendar-title">
      <div className="c-rate-range-action"><div><h2 id="rate-calendar-title">Changes by date</h2><p>Choose a period to change prices, limit rooms or close online bookings.</p></div><button className="c-primary" disabled={!room || !from || !to || from > to} onClick={() => setEditing({ from, to })}><Plus size={15} /> Edit selected dates</button></div>
      <div className="c-rate-period">
        <Field label="From">
          <DateInput required value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
        </Field>
        <Field label="Through">
          <DateInput required min={from} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>

        <span>Changes apply to every date in this period.</span>
      </div>

      {error && (
        <p className="c-error" role="alert">
          {error}{' '}
          <button type="button" className="c-linkish" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {loading && !error && <LoadingSkeleton label="Loading prices and availability…" variant="table" rows={7} />}

      {!loading && !error && room && (
        <>
          <div className="c-table-wrap"><table className="c-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Nightly rate</th>
                <th scope="col">Website rooms</th>
                <th scope="col">Booked / held</th>
                <th scope="col">Available</th>
                <th scope="col">Pricing</th><th scope="col"><span className="c-sr">Edit date</span></th>
              </tr>
            </thead>
            <tbody>
              {rateDays.map((day) => {
                const inv = inventoryFor.get(day.stayDate);
                return (
                  <tr key={day.stayDate}>
                    <th scope="row">{dateText(day.stayDate)}</th>
                    <td>{money(day.pricePaise)}</td>
                    <td>{inv ? inv.allotment : '—'}</td>
                    <td>{inv ? inv.committed : '—'}</td>
                    <td>{inv ? inv.remaining : '—'}</td>
                    <td>
                      {day.isBlackout ? 'Closed' : day.hasOverride ? 'Custom' : 'Standard'}
                    </td>
                    <td><button className="c-text-button" onClick={() => setEditing({ from: day.stayDate, to: day.stayDate })} aria-label={`Edit settings for ${dateText(day.stayDate)}`}>Edit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </>
      )}

      </section>
      {historyOpen && <Drawer title="Change history" subtitle={room?.name} onClose={() => setHistoryOpen(false)}>{
        (history.length === 0 ? (
          <Empty title="No changes yet" text="Rate, allotment and blackout edits for these dates will appear here." />
        ) : (
          <ul className="c-history">
            {history.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`}>
                <strong>{entry.action}</strong>
                <span>
                  {entry.actorRole} · {dateText(entry.createdAt)}
                </span>
                <code>{JSON.stringify(entry.after)}</code>
              </li>
            ))}
          </ul>
        ))}</Drawer>}

      {editing && room && (
        <OverrideDrawer
          room={room}
          initialRange={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            notify(message);
            void load();
          }}
        />
      )}

    </>
  );
}
