import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type DayButtonProps } from "react-day-picker";
import { cn } from "../../lib/cn";

/** shadcn's Calendar, re-themed onto this project's own ink/amber/surface
 *  tokens instead of shadcn's default CSS variables (which this repo doesn't
 *  define) — same underlying react-day-picker, this project's own styling. */
export function Calendar({
  className,
  classNames,
  // Airbnb leaves the leading/trailing week blank rather than showing grey
  // neighbouring-month dates.
  showOutsideDays = false,
  startMonth,
  endMonth,
  captionLayout,
  defaultMonth,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  // Blocks navigating to a month that's entirely in the past — the "<" button
  // greys out once there's nowhere earlier left to go.
  const defaultStartMonth = new Date();
  defaultStartMonth.setDate(1);
  defaultStartMonth.setHours(0, 0, 0, 0);

  // `captionLayout="dropdown"` is how a past-dated field (a date of birth) asks
  // for a month/year selector. It used to render native `<select>`s, which the
  // browser paints as an OS menu outside the popover entirely — grey, unstyled
  // and 100 years tall. Same opt-in, but the selector is now a year grid then a
  // month grid drawn inside this panel.
  const pickable = captionLayout === "dropdown";
  const [month, setMonth] = useState<Date>(defaultMonth ?? new Date());
  const [view, setView] = useState<"days" | "months" | "years">("days");

  if (pickable && view !== "days") {
    return (
      <GridPicker
        view={view}
        month={month}
        minDate={startMonth ?? new Date(1900, 0, 1)}
        maxDate={endMonth ?? new Date(new Date().getFullYear() + 10, 11, 31)}
        onMonth={setMonth}
        onView={setView}
      />
    );
  }

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      startMonth={startMonth ?? defaultStartMonth}
      endMonth={endMonth}
      captionLayout="label"
      // Controlled month when pickable (the grids set it), so defaultMonth
      // would be a second, conflicting source of truth — it seeds the state
      // above instead.
      {...(pickable ? { month, onMonthChange: setMonth } : { defaultMonth })}
      className={cn("p-3", className)}
      formatters={{
        // react-day-picker's default short weekday ("Su", "Mo"...) reads
        // wider than Airbnb's narrow single-letter header ("S", "M"...).
        formatWeekdayName: (date) => date.toLocaleDateString("en-US", { weekday: "narrow" }),
      }}
      classNames={{
        // `nav` below is positioned absolute against this element — without
        // `relative` here it escapes to whatever further-up ancestor happens
        // to be positioned, landing the chevrons above the month title
        // instead of level with it.
        root: "w-fit relative",
        months: "flex flex-col sm:flex-row gap-4 sm:gap-12",
        month: "flex flex-col gap-3",
        month_caption: "flex items-center justify-center pt-1 h-9 relative",
        caption_label: "flex items-center gap-1 text-base font-semibold text-ink",
        // inset-x resolves against root's *padding box*, so inset-x-0 would put
        // the chevrons flush against the popover border and skip root's p-3
        // entirely. 8px leaves them just outside the grid, as in Airbnb's.
        nav: "flex items-center justify-between absolute inset-x-2 top-3 h-9 z-10 pointer-events-none",
        button_previous: cn(
          "h-9 w-9 pointer-events-auto flex items-center justify-center rounded-row text-ink-3 hover:text-ink hover:bg-surface-3 transition-colors aria-disabled:opacity-30 aria-disabled:pointer-events-none",
        ),
        button_next: cn(
          "h-9 w-9 pointer-events-auto flex items-center justify-center rounded-row text-ink-3 hover:text-ink hover:bg-surface-3 transition-colors aria-disabled:opacity-30 aria-disabled:pointer-events-none",
        ),
        month_grid: "w-full border-collapse mt-2",
        weekdays: "flex",
        weekday: "text-ink-3 w-12 font-normal text-[11px] uppercase",
        week: "flex w-full mt-1",
        day: "w-12 p-0 text-center text-sm relative first:rounded-l-md last:rounded-r-md",
        day_button:
          "h-12 w-full flex items-center justify-center rounded-full font-normal text-ink hover:bg-surface-3 transition-colors",
        // react-day-picker v10 applies these as plain classes on the day cell
        // (not data-* attributes on the button) — reach into the nested
        // button so the fill and text color actually land on it. `selected`
        // fires for every day in a range (start, middle AND end), so
        // range_middle must force-override it or the whole range paints
        // solid instead of just the two ends. The grey band shares the cell
        // background with range_start/range_end (not just the circles) so it
        // flows seamlessly under them, Airbnb-style, instead of looking like
        // a separate block butted up against a solid square.
        selected: "calendar-selected [&>button]:bg-ink [&>button]:text-surface [&>button]:hover:bg-ink",
        range_start:
          "bg-surface-3 rounded-l-full! [&>button]:bg-ink [&>button]:text-surface [&>button]:hover:bg-ink",
        range_end: "bg-surface-3 rounded-r-full! [&>button]:bg-ink [&>button]:text-surface [&>button]:hover:bg-ink",
        range_middle: "calendar-range-middle bg-surface-3 [&>button]:bg-surface-3! [&>button]:text-ink! [&>button]:hover:bg-surface-3!",
        outside: "text-ink-4",
        disabled: "text-ink-4 opacity-40 pointer-events-none",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === "left") return <ChevronLeft className="h-4 w-4" />;
          if (orientation === "down") return <ChevronDown className="h-3.5 w-3.5" />;
          return <ChevronRight className="h-4 w-4" />;
        },
        ...(pickable
          ? {
              // The caption stops being a label and becomes the way into the
              // grids. It sits between the nav chevrons, which are themselves
              // pointer-events-none except on the buttons, so the whole middle
              // of the row is clickable.
              CaptionLabel: ({ children, className: labelClass, ...rest }) => (
                <button
                  type="button"
                  onClick={() => setView("years")}
                  className={cn(
                    "flex items-center gap-1 text-base font-semibold text-ink rounded-row px-2 h-9 hover:bg-surface-3 transition-colors",
                    labelClass,
                  )}
                  {...rest}
                >
                  {children}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              ),
            }
          : {}),
      }}
      {...props}
    />
  );
}

// Matches the day grid's own width (7 × w-12) so the popover doesn't resize as
// the views swap.
const PANEL = "p-3 w-[22.5rem]";
const CELL =
  "h-11 flex items-center justify-center rounded-full text-sm text-ink hover:bg-surface-3 transition-colors";
const CELL_SELECTED = "bg-ink text-surface hover:bg-ink";
const CELL_DISABLED = "text-ink-4 opacity-40 pointer-events-none";

/** The year → month selector that replaces the native dropdowns. Rendered in
 *  place of the day grid inside the same popover — no nested Popover, so no
 *  second portal to fight the dialog overlay for stacking order. */
function GridPicker({
  view,
  month,
  minDate,
  maxDate,
  onMonth,
  onView,
}: {
  view: "months" | "years";
  month: Date;
  minDate: Date;
  maxDate: Date;
  onMonth: (d: Date) => void;
  onView: (v: "days" | "months" | "years") => void;
}) {
  const year = month.getFullYear();
  const selectedRef = useRef<HTMLButtonElement>(null);

  // 1920 to today is over a century of rows — open on the year already showing
  // rather than making the user scroll to it.
  useEffect(() => {
    if (view === "years") selectedRef.current?.scrollIntoView({ block: "center" });
  }, [view]);

  if (view === "years") {
    const years: number[] = [];
    for (let y = minDate.getFullYear(); y <= maxDate.getFullYear(); y++) years.push(y);

    return (
      <div className={PANEL}>
        <div className="flex items-center h-9 pt-1 mb-2">
          <button
            type="button"
            onClick={() => onView("days")}
            className="h-9 w-9 flex items-center justify-center rounded-row text-ink-3 hover:text-ink hover:bg-surface-3 transition-colors"
            aria-label="Back to days"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 text-center text-base font-semibold text-ink pr-9">Select a year</span>
        </div>
        <div className="grid grid-cols-4 gap-1 max-h-[18rem] overflow-y-auto">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              ref={y === year ? selectedRef : undefined}
              onClick={() => {
                const next = new Date(month);
                next.setFullYear(y);
                onMonth(next);
                onView("months");
              }}
              className={cn(CELL, y === year && CELL_SELECTED)}
            >
              {y}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const outOfRange = (m: number) =>
    year * 12 + m < minDate.getFullYear() * 12 + minDate.getMonth() ||
    year * 12 + m > maxDate.getFullYear() * 12 + maxDate.getMonth();

  const stepYear = (by: number) => {
    const next = new Date(month);
    next.setFullYear(year + by);
    onMonth(next);
  };

  return (
    <div className={PANEL}>
      <div className="flex items-center h-9 pt-1 mb-2">
        <button
          type="button"
          disabled={year - 1 < minDate.getFullYear()}
          onClick={() => stepYear(-1)}
          className="h-9 w-9 flex items-center justify-center rounded-row text-ink-3 hover:text-ink hover:bg-surface-3 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Previous year"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onView("years")}
          className="flex-1 flex items-center justify-center gap-1 h-9 rounded-row text-base font-semibold text-ink hover:bg-surface-3 transition-colors"
        >
          {year}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={year + 1 > maxDate.getFullYear()}
          onClick={() => stepYear(1)}
          className="h-9 w-9 flex items-center justify-center rounded-row text-ink-3 hover:text-ink hover:bg-surface-3 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Next year"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 12 }, (_, m) => (
          <button
            key={m}
            type="button"
            disabled={outOfRange(m)}
            onClick={() => {
              onMonth(new Date(year, m, 1));
              onView("days");
            }}
            className={cn(CELL, m === month.getMonth() && CELL_SELECTED, outOfRange(m) && CELL_DISABLED)}
          >
            {new Date(2000, m, 1).toLocaleDateString("en-US", { month: "long" })}
          </button>
        ))}
      </div>
    </div>
  );
}

export type { DayButtonProps };
