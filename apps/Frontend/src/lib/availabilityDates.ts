export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The API rejects past dates and treats the end as checkout-exclusive. */
export function availabilityWindow(today: Date, monthOffset: number) {
  const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  return { from: toIsoDate(month < today ? today : month), to: toIsoDate(new Date(month.getFullYear(), month.getMonth() + 2, 1)) };
}
