import { DAY_MS } from "../constants/time.constants";

/** An accepted or completed order holds `quantity` of an item from `from` to `to` (both days count). */
export interface Booking {
  itemId: string;
  /** YYYY-MM-DD. Text in this form compares like a date. */
  from: string;
  to: string;
  quantity: number;
}

/** Days on which more of an item is booked than the owner has. */
export interface Overbooked {
  from: string;
  to: string;
  /** The highest total booked on one of these days. */
  booked: number;
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

function bookedOn(bookings: readonly Booking[], day: string): number {
  let total = 0;
  for (const booking of bookings) {
    if (booking.from <= day && day <= booking.to) {
      total += booking.quantity;
    }
  }
  return total;
}

/**
 * The highest total that is booked on one single day from `from` to `to`.
 * Two orders that never meet are not added up: 5 on 1-2 May and 5 on 9-10 May hold 5, not 10.
 * The total of a day can only go up on the first day of a booking, so only those days are checked.
 */
export function busiestDay(bookings: readonly Booking[], from: string, to: string): number {
  let most = 0;
  for (const booking of bookings) {
    if (booking.from > to || booking.to < from) {
      continue;
    }
    most = Math.max(most, bookedOn(bookings, booking.from < from ? from : booking.from));
  }
  return most;
}

/**
 * The date ranges, from `from` on, where more than `stock` is booked.
 * The total of a day changes only on the first day of a booking and on the day after its last.
 */
export function overbooked(
  bookings: readonly Booking[],
  stock: number,
  from: string,
): Overbooked[] {
  const days = new Set<string>([from]);
  for (const booking of bookings) {
    days.add(booking.from);
    days.add(nextDay(booking.to));
  }
  const ranges: Overbooked[] = [];
  let open: Overbooked | undefined;
  for (const day of [...days].sort()) {
    if (day < from) {
      continue;
    }
    // The range before this day ends on the day before it.
    if (open) {
      open.to = new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    }
    const booked = bookedOn(bookings, day);
    if (booked <= stock) {
      open = undefined;
    } else if (open) {
      open.booked = Math.max(open.booked, booked);
    } else {
      open = { from: day, to: day, booked };
      ranges.push(open);
    }
  }
  return ranges;
}
