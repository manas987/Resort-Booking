import { Children, isValidElement, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './retro-pill/components/ui/popover';
import { Calendar } from './retro-pill/components/ui/calendar';
import './form-controls.css';

type Option = { value: string; label: ReactNode; disabled: boolean };
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type !== 'option') return optionsFrom(child.props.children);
    return [{ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: !!child.props.disabled }];
  });
}

/** Native form semantics underneath; the visible menu uses the existing accessible popover. */
export function Select({ children, value, defaultValue, disabled, className, id, onChange, ...props }: ComponentProps<'select'>) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(String(defaultValue ?? ''));
  const [invalid, setInvalid] = useState(false);
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const options = optionsFrom(children);
  const selected = String(value ?? local);
  const active = options.findIndex((option) => option.value === selected);
  const label = options[active]?.label ?? options[0]?.label ?? 'Select';

  function choose(option: Option) {
    if (option.disabled || !native.current) return;
    native.current.value = option.value;
    native.current.dispatchEvent(new Event('change', { bubbles: true }));
    setLocal(option.value); setInvalid(false); setOpen(false);
  }
  return <span className={`form-control ${className ?? ''}`}>
    <select {...props} ref={native} className="form-native" value={selected} disabled={disabled} tabIndex={-1} aria-hidden="true" onChange={onChange} onFocus={() => trigger.current?.focus()}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }}>{children}</select>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button ref={trigger} id={id} type="button" className="form-control-trigger" role="combobox" aria-expanded={open} aria-controls={menuId}
        aria-haspopup="listbox" aria-label={props['aria-label']} aria-invalid={invalid || undefined} disabled={disabled}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
        <span>{label}</span><ChevronDown size={15} aria-hidden="true" />
      </button></PopoverTrigger>
      <PopoverContent className="form-options" role="presentation" onOpenAutoFocus={(event) => {
        event.preventDefault();
        const selectedOption = optionRefs.current[active];
        (selectedOption && !selectedOption.disabled ? selectedOption : optionRefs.current.find((button) => button && !button.disabled))?.focus();
      }}>
        <div id={menuId} role="listbox" aria-label={props['aria-label'] ?? 'Options'} onKeyDown={(event) => {
          const enabled = optionRefs.current.filter((button): button is HTMLButtonElement => !!button && !button.disabled);
          const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
          let index: number;
          if (event.key === 'ArrowDown') index = (current + 1) % enabled.length;
          else if (event.key === 'ArrowUp') index = (current - 1 + enabled.length) % enabled.length;
          else if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = enabled.length - 1;
          else if (event.key.length === 1 && event.key !== ' ') {
            const match = [...enabled.slice(current + 1), ...enabled.slice(0, current + 1)].find((button) => button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
            if (match) { event.preventDefault(); match.focus(); }
            return;
          } else return;
          event.preventDefault(); enabled[index]?.focus();
        }}>
          {options.map((option, index) => <button key={option.value} ref={(element) => { optionRefs.current[index] = element; }} type="button" role="option" tabIndex={-1}
            aria-selected={option.value === selected} disabled={option.disabled} onClick={() => choose(option)}>
            <span>{option.label}</span>{option.value === selected && <Check size={14} aria-hidden="true" />}
          </button>)}
        </div>
      </PopoverContent>
    </Popover>
    {invalid && <small role="alert">Choose an option.</small>}
  </span>;
}

const parseDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && dateValue(date) === value ? date : undefined;
};
const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Reuses the hero's Calendar, with past-date navigation for reports and audit filters. */
export function DateInput({ value, min, max, disabled, onChange, id, className, type: _type, ...props }: ComponentProps<'input'>) {
  void _type;
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const native = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = parseDate(value);
  const earliest = parseDate(min);
  const latest = parseDate(max);
  function choose(date: Date | undefined) {
    if (!native.current) return;
    // React tracks input values; the native setter lets its change event see this update.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(native.current, date ? dateValue(date) : '');
    native.current.dispatchEvent(new Event('input', { bubbles: true }));
    native.current.dispatchEvent(new Event('change', { bubbles: true }));
    setInvalid(false); setOpen(false);
  }
  return <span className={`form-control ${className ?? ''}`}>
    <input {...props} ref={native} type="date" value={value} min={min} max={max} disabled={disabled} className="form-native" tabIndex={-1} aria-hidden="true" onChange={onChange} onFocus={() => trigger.current?.focus()}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }} />
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
      <button ref={trigger} id={id} type="button" className="form-control-trigger" aria-label={props['aria-label']} aria-invalid={invalid || undefined} disabled={disabled}>
        <span>{selected ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(selected) : 'Choose date'}</span><CalendarDays size={16} aria-hidden="true" />
      </button>
    </PopoverTrigger>
      <PopoverContent className="form-date-popover" aria-label={props['aria-label'] ?? 'Choose date'}>
        <Calendar mode="single" selected={selected} defaultMonth={selected ?? earliest} captionLayout="dropdown"
          startMonth={earliest ?? new Date(1900, 0, 1)} endMonth={latest ?? new Date(2100, 11, 31)}
          disabled={(date) => !!earliest && dateValue(date) < dateValue(earliest) || !!latest && dateValue(date) > dateValue(latest)}
          onSelect={choose} autoFocus />
        {!props.required && <button type="button" className="form-date-clear" onClick={() => choose(undefined)}>Clear date</button>}
      </PopoverContent>
    </Popover>
    {invalid && <small role="alert">Choose a valid date.</small>}
  </span>;
}
