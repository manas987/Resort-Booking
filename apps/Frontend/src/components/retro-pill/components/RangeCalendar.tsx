import { useState } from "react";
import { Calendar } from "./ui/calendar";
import { TimeTextInput } from "./DateTimeField";
import { isSameDay, nextSelection } from "../lib/dateRange";
import type { DateRange } from "react-day-picker";

/**
 * The dual-month pick-up → return calendar, with the two time inputs under it.
 *
 * Split out of `DateRangeField` so the search bar can render it inside its own
 * morphing panel instead of a second popover. Both hosts unmount this on close
 * (neither Radix `Popover` nor `Dialog` force-mounts), so mounting *is* opening
 * and the seeding that used to live in an imperative `openPicker()` is just the
 * initial state below.
 */
export function RangeCalendar({
  pickupDate,
  pickupTime,
  returnDate,
  returnTime,
  onPickupDate,
  onReturnDate,
  onPickupTime,
  onReturnTime,
  onEnter,
  months = 2,
  showTimes = true,
}: {
  /** null until the person picks one — the search bar starts blank. */
  pickupDate: Date | null;
  pickupTime: string;
  returnDate: Date | null;
  returnTime: string;
  onPickupDate: (d: Date) => void;
  onReturnDate: (d: Date) => void;
  onPickupTime: (t: string) => void;
  onReturnTime: (t: string) => void;
  /** Enter on a finished range — "done picking, go". Omit and Enter stays the
   *  day button's own select. */
  onEnter?: () => void;
  months?: number;
  showTimes?: boolean;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // A check-in with no check-out yet. Holding this is what stops the library
  // from seeing a complete range on every click — the behaviour that let it
  // silently rewrite the start date. Decision logic lives in lib/dateRange.ts
  // so it is testable without a DOM.
  //
  // It starts seeded rather than null: the default window is same-day
  // (10:00 → 22:00), so the committed range paints as one lone circle —
  // indistinguishable from a check-in waiting for its check-out, but inert
  // (nothing previews on hover, and clicking the circle is a no-op, since
  // useRange drops a same-day full range to undefined). Seeding it makes it
  // behave the way it looks.
  const [pendingFrom, setPendingFrom] = useState<Date | null>(
    pickupDate && returnDate && isSameDay(pickupDate, returnDate) ? pickupDate : null,
  );
  const [hovered, setHovered] = useState<Date | null>(null);

  const range: DateRange | undefined = pendingFrom
    ? { from: pendingFrom, to: undefined }
    : pickupDate && returnDate
      ? { from: pickupDate, to: returnDate }
      : undefined;

  function handleSelect(next: DateRange | undefined) {
    const result = nextSelection(pendingFrom, next);
    setPendingFrom(result.pending);
    if (result.commit) {
      setHovered(null);
      onPickupDate(result.commit.from);
      onReturnDate(result.commit.to);
    }
  }

  // Live band from the pending check-in to whatever the cursor is over.
  const previewTo = pendingFrom && hovered && hovered > pendingFrom ? hovered : null;

  return (
    <>
      {/* Clearing the preview on each day's own mouse-leave made the band
          flicker: the cells don't tile (rows sit `mt-2` apart, past days are
          pointer-events-none), so crossing a gap fired leave with no matching
          enter. A container's leave doesn't fire for movement between its own
          descendants, so only actually leaving the calendar clears it. */}
      <div
        onMouseLeave={() => setHovered(null)}
        // This panel is portalled out of the search bar's <form>, so Enter
        // never reaches its submit; and a click leaves focus on the day button,
        // where Enter re-fires it and resetOnSelect turns the finished range
        // back into a lone check-in. Both are why Enter is handled here.
        //
        // A pending check-in means the pick is mid-flight — the parent still
        // holds the *previous* range, so searching now would search the wrong
        // window. Leave Enter alone there; it is the day button's select, and
        // that is what you are in the middle of doing.
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !onEnter || pendingFrom || !pickupDate || !returnDate) return;
          e.preventDefault();
          onEnter();
        }}
      >
        <Calendar
          className="calendar-black-glass"
          mode="range"
          min={showTimes ? 0 : 1}
          numberOfMonths={months}
          selected={range}
          onSelect={handleSelect}
          disabled={(d) => d < today}
          // With a complete range showing, the next click starts a fresh
          // check-in rather than stretching the old range — Airbnb's rule.
          resetOnSelect
          onDayMouseEnter={(day) => setHovered(day)}
          modifiers={
            previewTo && pendingFrom
              ? {
                  preview_start: pendingFrom,
                  preview_middle: { after: pendingFrom, before: previewTo },
                  preview_end: previewTo,
                }
              : undefined
          }
          modifiersClassNames={{
            // A pending check-in has no range_start to supply the band's
            // background (DayPicker needs both from and to for that), so
            // without this the circular button leaves white crescents where
            // the grey begins.
            preview_start: "bg-surface-3 rounded-l-full!",
            preview_middle: "bg-surface-3",
            // The day under the cursor is the prospective check-out, so it
            // gets the same dark circle as the check-in. The explicit hover:
            // is needed — day_button's own hover:bg-surface-3 outranks a bare
            // bg-ink in the cascade.
            preview_end: "calendar-preview-end bg-surface-3 rounded-r-full! [&>button]:bg-ink [&>button]:text-surface [&>button]:hover:bg-ink",
          }}
          autoFocus
        />
      </div>
      {showTimes && <div className="border-t border-line px-4 py-3 flex items-center justify-between gap-4">
        <TimePicker label="Pick-up time" value={pickupTime} onChange={onPickupTime} />
        <TimePicker label="Return time" value={returnTime} onChange={onReturnTime} />
      </div>}
    </>
  );
}

function TimePicker({ label, value, onChange }: { label: string; value: string; onChange: (t: string) => void }) {
  return (
    <label className="flex-1 flex flex-col gap-1">
      <span className="text-[11px] text-ink-3">{label}</span>
      <TimeTextInput
        value={value}
        onChange={onChange}
        className="text-sm font-medium text-ink bg-surface-2 rounded-row px-2 py-1.5 outline-none"
      />
    </label>
  );
}
