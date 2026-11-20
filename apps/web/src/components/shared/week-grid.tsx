import { Link } from 'react-router';
import { minutesToTime } from '@ucrams/shared';
import { cn } from '@/lib/utils';

export interface WeekItem {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  title: string;
  subtitle?: string;
  href?: string;
  muted?: boolean;
}

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOUR_PX = 48;

function Block({
  item,
  className,
  style,
}: {
  item: WeekItem;
  className?: string;
  style?: React.CSSProperties;
}) {
  const body = (
    <>
      <span className="block truncate font-medium">{item.title}</span>
      <span className="block truncate opacity-80">
        {minutesToTime(item.startMinute)}–{minutesToTime(item.endMinute)}
        {item.subtitle ? ` · ${item.subtitle}` : ''}
      </span>
    </>
  );
  const classes = cn(
    'block overflow-hidden rounded-md border px-2 py-1 text-xs',
    item.muted
      ? 'border-dashed bg-muted text-muted-foreground'
      : 'border-brand/30 bg-brand/10 text-foreground',
    item.href &&
      'hover:bg-brand/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    className,
  );
  return item.href ? (
    <Link to={item.href} className={classes} style={style}>
      {body}
    </Link>
  ) : (
    <div className={classes} style={style}>
      {body}
    </div>
  );
}

/** Weekly timetable: time grid from md up, a per-day list on phones (FR-STUDENT-010 layout). */
export function WeekGrid({ items, caption }: { items: WeekItem[]; caption: string }) {
  const weekend = items.some((i) => i.dayOfWeek >= 6);
  const days = weekend ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
  const first = Math.min(8 * 60, ...items.map((i) => i.startMinute));
  const last = Math.max(18 * 60, ...items.map((i) => i.endMinute));
  const startHour = Math.floor(first / 60);
  const endHour = Math.ceil(last / 60);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing scheduled.</p>;
  return (
    <div aria-label={caption} role="region">
      <div className="hidden md:block">
        <div
          className="grid"
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <div />
          {days.map((d) => (
            <div
              key={d}
              className="border-b pb-1 text-center text-xs font-medium text-muted-foreground"
            >
              {DAYS[d]!.slice(0, 3)}
            </div>
          ))}
          <div className="relative" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h, i) => (
              <span
                key={h}
                className="absolute right-2 text-[11px] text-muted-foreground"
                style={{ top: i * HOUR_PX - 6 }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="relative border-l" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h, i) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: i * HOUR_PX }}
                />
              ))}
              {items
                .filter((it) => it.dayOfWeek === d)
                .map((it) => (
                  <Block
                    key={it.id}
                    item={it}
                    className="absolute inset-x-1"
                    style={{
                      top: ((it.startMinute - startHour * 60) / 60) * HOUR_PX + 1,
                      height: Math.max(((it.endMinute - it.startMinute) / 60) * HOUR_PX - 2, 20),
                    }}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4 md:hidden">
        {days
          .filter((d) => items.some((i) => i.dayOfWeek === d))
          .map((d) => (
            <section key={d}>
              <h3 className="mb-1 text-sm font-medium">{DAYS[d]}</h3>
              <div className="space-y-1">
                {items
                  .filter((i) => i.dayOfWeek === d)
                  .sort((a, b) => a.startMinute - b.startMinute)
                  .map((i) => (
                    <Block key={i.id} item={i} />
                  ))}
              </div>
            </section>
          ))}
      </div>
    </div>
  );
}
