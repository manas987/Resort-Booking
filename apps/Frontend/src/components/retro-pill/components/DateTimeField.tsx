import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar } from "./ui/calendar";

export function splitIso(iso: string): { date: Date; time: string } {
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date: d, time };
}

export function combine(date: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const out = new Date(date);
  out.setHours(h!, m!, 0, 0);
  return out;
}

export function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h! >= 12 ? "PM" : "AM";
  const hour12 = h! % 12 === 0 ? 12 : h! % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Parses freely-typed time ("10", "10:30am", "22:15") into 24h "HH:MM", or null if unparseable. */
export function parseTypedTime(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const period = m[3];
  if (min > 59) return null;
  if (period) {
    if (h < 1 || h > 12) return null;
    if (period === "pm" && h !== 12) h += 12;
    if (period === "am" && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Free-text time entry — no native picker overlay, just type it and tab/enter away. */
export function TimeTextInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (t: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(formatTime(value));
  useEffect(() => setDraft(formatTime(value)), [value]);

  function commit() {
    const parsed = parseTypedTime(draft);
    if (parsed) {
      onChange(parsed);
      setDraft(formatTime(parsed));
    } else {
      setDraft(formatTime(value));
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
    />
  );
}

/**
 * A single date, no time — the same calendar popover as `DateTimeField` minus
 * the time row. `fromYear` exists because `Calendar` blocks navigating into
 * the past by default (right for a pickup date, useless for a birth date), so
 * a past-dated field must hand it a real start month and a year dropdown.
 */
export function DateField({
  label,
  value,
  onChange,
  fromYear,
  toDate,
  placeholder = "Select a date",
}: {
  label: string;
  /** "YYYY-MM-DD", or "" for empty — the format the API takes, so no conversion at the call site. */
  value: string;
  onChange: (iso: string) => void;
  /** Earliest selectable year. Supplying it also turns on the month/year dropdowns. */
  fromYear?: number;
  toDate?: Date;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  // Parsed as local noon, not midnight UTC: `new Date("1994-03-07")` is UTC
  // midnight, which is the 6th in any timezone west of Greenwich and would
  // show (and round-trip) the wrong day.
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;

  return (
    <label className="flex flex-col gap-1.5 mb-4">
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rounded-full border border-line-strong px-3.5 py-2.5 text-sm text-left outline-none focus:border-ink"
          >
            {selected ? (
              selected.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
            ) : (
              <span className="text-ink-4">{placeholder}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            captionLayout={fromYear ? "dropdown" : "label"}
            startMonth={fromYear ? new Date(fromYear, 0, 1) : undefined}
            endMonth={toDate}
            disabled={toDate ? { after: toDate } : undefined}
            onSelect={(d) => {
              if (!d) return;
              const pad = (n: number) => String(n).padStart(2, "0");
              onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
              setOpen(false);
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </label>
  );
}

export function DateTimeField({
  label,
  date,
  time,
  onDate,
  onTime,
  disabled,
}: {
  label: string;
  date: Date;
  time: string;
  onDate: (d: Date | undefined) => void;
  onTime: (t: string) => void;
  disabled: (d: Date) => boolean;
}) {
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-ink-3">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="w-full text-left text-ink font-medium outline-none">
            {date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, {formatTime(time)}
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <Calendar mode="single" selected={date} onSelect={onDate} disabled={disabled} autoFocus />
          <div className="border-t border-line px-3 py-2.5 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-3">Time</span>
            <TimeTextInput
              value={time}
              onChange={onTime}
              className="w-24 text-sm font-medium text-ink bg-surface-2 rounded-row px-2 py-1 outline-none text-right"
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
