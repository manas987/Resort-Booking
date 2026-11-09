import { useCallback, useLayoutEffect, useImperativeHandle, useRef, useState } from "react";
import { combine, splitIso } from "./DateTimeField";
import { RangeCalendar } from "./RangeCalendar";
import { Modal } from "./Modal";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { useMediaQuery } from "../lib/useMediaQuery";
import { toIsoWithOffset } from "../lib/searchParams";

export interface SearchCapsuleValue {
  pickupAt: string;
  returnAt: string;
}

type Field = "when";

export function missingSearchField( pickupDate: Date | null, returnDate: Date | null): Field | null {
  return !pickupDate || !returnDate ? "when" : null;
}

/** "" means the person has not picked yet. Anything else is a real ISO stamp. */
function splitOrBlank(iso: string, fallbackTime: string): { date: Date | null; time: string } {
  return iso ? splitIso(iso) : { date: null, time: fallbackTime };
}

export interface SearchCapsuleHandle {
  openMissingField: () => void;
  openCalendar: () => void;
}

export function SearchCapsule({
  ref,
  initial,
  onSearch,
  compact = false,
  className = "",
}: {
  ref?: React.Ref<SearchCapsuleHandle>;
  initial: SearchCapsuleValue;
  onSearch: (v: SearchCapsuleValue) => void;
  compact?: boolean;
  /** Width and placement are the caller's business — this component carries no
   *  margin or positioning of its own, so it drops into a hero, a toolbar or a
   *  centred overlay unchanged. */
  className?: string;
}) {
  // An empty string means "not chosen yet" — the homepage opens blank rather
  // than guessing a city and a window on someone's behalf. splitIso on "" would
  // give an Invalid Date and a "NaN:NaN" time, so it never sees one.
  const initPickup = splitOrBlank(initial.pickupAt, "10:00");
  const initReturn = splitOrBlank(initial.returnAt, "22:00");
  const [pickupDate, setPickupDate] = useState<Date | null>(initPickup.date);
  const [pickupTime, setPickupTime] = useState(initPickup.time);
  const [returnDate, setReturnDate] = useState<Date | null>(initReturn.date);
  const [returnTime, setReturnTime] = useState(initReturn.time);

  const isDesktop = useMediaQuery("(min-width: 900px)");
  const [active, setActive] = useState<Field | null>(null);

  useImperativeHandle(ref, () => ({
    openCalendar() { setActive("when"); },
    openMissingField() {
      const field = missingSearchField(pickupDate, returnDate);
      if (field) setActive(field);
    },
  }), [pickupDate, returnDate]);

  // The panel stays mounted while it fades out, so it has to keep rendering
  // the field that was open rather than falling back to the other one.
  const lastField = useRef<Field>("when");
  if (active) lastField.current = active;
  const shown = active ?? lastField.current;

  function runSearch() {
    if (!pickupDate || !returnDate || returnDate <= pickupDate) {
      setActive("when");
      return;
    }
    setActive(null);
    onSearch({
      pickupAt: toIsoWithOffset(combine(pickupDate, pickupTime)),
      returnAt: toIsoWithOffset(combine(returnDate, returnTime)),
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    runSearch();
  }

  // --- the travelling pill -------------------------------------------------
  // A single element that moves between segments rather than a background on
  // each one, because only one element can animate from one place to another.
  const formRef = useRef<HTMLFormElement>(null);
  const whenRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    function measure() {
      // Keep the existing measured active surface aligned with the date segment.
      const el = whenRef.current;
      if (!el || !formRef.current) return;
      const box = formRef.current.getBoundingClientRect();
      const seg = el.getBoundingClientRect();
      setPill({ left: seg.left - box.left, width: seg.width });
    }
    measure();
    // Watching the fields rather than the window also covers a late webfont
    // reflowing them, and costs less than a resize listener that fires for
    // every window change whether or not this bar moved.
    const ro = new ResizeObserver(measure);
    for (const el of [whenRef.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  const dayLabel = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const whenValue =
    pickupDate && returnDate
      ? `${dayLabel(pickupDate)} – ${dayLabel(returnDate)}`
      : null;

  const calendar = (months: number) => (
    <RangeCalendar
      months={months}
      showTimes={false}
      pickupDate={pickupDate}
      pickupTime={pickupTime}
      returnDate={returnDate}
      returnTime={returnTime}
      onPickupDate={setPickupDate}
      onReturnDate={setReturnDate}
      onPickupTime={setPickupTime}
      onReturnTime={setReturnTime}
      onEnter={runSearch}
    />
  );

  const pad = compact ? "px-7 py-3" : "px-7 py-3 min-[900px]:py-4";

  const bar = (
    <form
      ref={formRef}
      onSubmit={submit}
      className={`group relative border border-line p-2 flex flex-col gap-1 rounded-panel transition-colors min-[900px]:p-0 min-[900px]:flex-row min-[900px]:items-stretch min-[900px]:gap-0 min-[900px]:rounded-full ${
        /* The bar recedes so the open field is the only white thing on it.
           Sampling the reference: its bar greys to #e6e6e6, exactly the tint a
           hovered segment gets — the two states are the same grey by design.
           --color-line is that lightness already, and warm, so it matches the
           rest of the palette without a literal. */
        active ? "bg-surface min-[900px]:bg-line" : "bg-surface"
      } ${
        /* Sized to its content. On Browse it stays full width: there it is a
           toolbar over a full-width results grid, and a centred island above
           that would read as detached. */
        compact ? "text-sm" : "min-[900px]:max-w-[660px] min-[900px]:mx-auto"
      } ${className}`}
    >
      {/* inset-y-0 resolves against the padding box, so with the form's desktop
          padding at 0 this lands just inside the hairline border — the same
          rounded-full at the same height as the bar's interior, which is why
          its cap coincides with the bar's own curve at either end. */}
      <div
        aria-hidden="true"
        className="hidden min-[900px]:block absolute inset-y-0 rounded-full bg-surface shadow-[0_3px_14px_rgba(18,22,26,0.13)] transition-[left,width,opacity] duration-250 ease-out"
        style={{ left: pill.left, width: pill.width, opacity: active ? 1 : 0 }}
      />

      <Segment ref={whenRef} active={active === "when"} grow="flex-1">
        <button type="button" onClick={() => setActive("when")} className={`w-full h-full flex flex-col justify-center gap-1.5 text-left outline-none ${pad} min-[900px]:pr-[190px]}`}>
          <span className="flex items-center gap-2 text-[13px] font-semibold text-ink leading-none">
            When

          </span>
          <span title={whenValue ?? undefined} className={`max-w-full truncate ${whenValue ? "text-[15px] font-medium text-ink" : "text-[13px] text-ink-3"}`}>
            {whenValue ?? "Add dates"}
          </span>
        </button>
      </Segment>

      {/* Overlaid rather than in the flow, as in the reference — which is also
          what stops it reflowing the fields as it grows, and so what stops the
          pill being measured against a width the button is about to leave. */}
      <button
        type="submit"
        aria-label="Book your stay"
        data-search-submit=""
        className={`relative z-10 shrink-0 flex items-center justify-center gap-2 glass-yellow text-on-amber font-semibold text-sm transition-all w-full py-3 rounded-row min-[900px]:absolute min-[900px]:right-3 min-[900px]:top-1/2 min-[900px]:-translate-y-1/2 min-[900px]:h-12 min-[900px]:py-0 min-[900px]:rounded-full ${
          "min-[900px]:w-auto min-[900px]:px-6"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>Book your stay</span>
      </button>
    </form>
  );

  // A floating panel has nowhere good to put a two-month calendar on a phone,
  // so below the width the bar itself stacks at, both fields open as a modal.
  if (!isDesktop) {
    return (
      <>
        {bar}
        <Modal open={active !== null} onClose={() => setActive(null)} title="Dates">
          {calendar(1)}
        </Modal>
      </>
    );
  }

  return (
    <Popover open={active !== null} onOpenChange={(o) => !o && setActive(null)}>
      <PopoverAnchor asChild>{bar}</PopoverAnchor>
      <MorphPanel active={active} shown={shown}>
        {calendar(2)}
      </MorphPanel>
    </Popover>
  );
}

/**
 * One panel for both fields, which resizes between them instead of closing and
 * reopening — the reference keeps its left edge pinned and grows the right one
 * while the old content fades out under the new.
 *
 * Width and height have to be explicit numbers for that to animate at all, so
 * an inner `w-max` box is measured and the outer box is told the result. The
 * transition is suppressed on the way in, where the reference just fades.
 */
function MorphPanel({
  active,
  shown,
  children,
}: {
  active: Field | null;
  shown: Field;
  children: React.ReactNode;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Only a field-to-field switch animates. Opening from closed would otherwise
  // grow out of whatever the last panel measured, or out of nothing at all.
  const [morphing, setMorphing] = useState(false);
  const prev = useRef<Field | null>(null);

  useLayoutEffect(() => {
    setMorphing(prev.current !== null && active !== null && prev.current !== active);
    prev.current = active;
  }, [active]);

  // A callback ref, not an effect keyed on `shown`: this box mounts and
  // unmounts with the popover, which has nothing to do with when `shown`
  // changes. Keyed on `shown`, opening Where first measured nothing at all
  // (`shown` already defaults to "where", so the effect never re-ran) and a
  // close left the observer bound to a detached node. React calls this exactly
  // on mount and unmount, which is exactly when the observer should move.
  const ro = useRef<ResizeObserver>(undefined);
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    ro.current = new ResizeObserver(measure);
    ro.current.observe(el);
  }, []);

  return (
    <PopoverContent
      align="center"
      sideOffset={12}
      // Clicking the other segment must not take the dismiss path, or the close
      // races the open and the switch only lands sometimes. Letting the bar
      // handle its own clicks makes the switch a plain state change.
      onInteractOutside={(e) => {
        if ((e.target as HTMLElement | null)?.closest("form")) e.preventDefault();
      }}
      // The panel is the bar's own surface, so it must not steal focus from the
      // segment that opened it on every switch.
      onOpenAutoFocus={(e) => e.preventDefault()}
      className="overflow-hidden p-0"
      style={
        size
          ? {
              width: size.w,
              height: size.h,
              transition: morphing ? "width 250ms ease-out, height 250ms ease-out" : "none",
            }
          : undefined
      }
    >
      <div ref={measureRef} key={shown} className="w-max animate-in fade-in-0 duration-200">
        {children}
      </div>
    </PopoverContent>
  );
}

function Segment({
  ref,
  active,
  grow,
  children,
}: {
  ref: React.Ref<HTMLDivElement>;
  active: boolean;
  grow: string;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={ref}
      data-seg=""
      // A wrapper only — the button inside carries the padding and fills it, so
      // the whole segment is clickable rather than just the two lines of text.
      // z-10 keeps that text above the travelling pill. One hover rule for both
      // bar states: 10% ink lands on #e7e7e8 over white, which is the grey the
      // reference greys its bar to, and composites a step darker again over
      // that grey — matching its #e6e6e6 / #d7d7d7 pair. The open field skips
      // it; it already has the pill.
      className={`relative z-10 ${grow} min-w-0 rounded-panel transition-colors min-[900px]:rounded-full ${
        active ? "" : "hover:bg-ink/10 group-has-[[data-search-submit]:hover]:bg-transparent"
      }`}
    >
      {children}
    </div>
  );
}

