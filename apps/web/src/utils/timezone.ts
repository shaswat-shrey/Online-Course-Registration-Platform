/**
 * Conversions between UTC instants and wall-clock values in the university's
 * time zone (SRS A-05), independent of the browser's own zone.
 */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** ISO instant → "YYYY-MM-DDTHH:mm" for a datetime-local input, in `timeZone`. */
export function isoToZonedInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() + tzOffsetMinutes(date, timeZone) * 60000);
  return local.toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" wall-clock time in `timeZone` → ISO instant (DST-safe). */
export function zonedInputToIso(value: string, timeZone: string): string {
  const guess = new Date(`${value}:00Z`);
  const first = tzOffsetMinutes(guess, timeZone);
  let instant = new Date(guess.getTime() - first * 60000);
  const second = tzOffsetMinutes(instant, timeZone);
  if (second !== first) instant = new Date(guess.getTime() - second * 60000);
  return instant.toISOString();
}

export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}
