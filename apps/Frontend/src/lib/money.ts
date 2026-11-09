// The backend computes every amount (Docs/00-conventions.md "Money"). This module FORMATS
// paise for display — it never adds, multiplies or otherwise derives a total.
const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function formatPaise(paise: number): string {
  return formatter.format(paise / 100);
}
