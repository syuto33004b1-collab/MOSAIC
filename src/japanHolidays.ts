/**
 * National holidays of Japan, for weekday capacity (#323).
 *
 * The calendar is a function, not a table: Happy Monday, 振替休日, and 国民の休日
 * move every year. 春分 and 秋分 use the 1980–2099 approximation published for
 * civil use; they are predictions until that year's 暦要項 is gazetted.
 *
 * Years outside {@link JAPAN_HOLIDAY_YEAR_MIN}–{@link JAPAN_HOLIDAY_YEAR_MAX}
 * are not classified. Callers must not treat that as "no holiday".
 *
 * Once-off moves (即位, 五輪) are a map. They cannot be derived from the
 * standing Act.
 */

export const JAPAN_HOLIDAY_YEAR_MIN = 2016;
export const JAPAN_HOLIDAY_YEAR_MAX = 2035;

const extraDates: ReadonlySet<string> = new Set([
  "2019-04-30",
  "2019-05-01",
  "2019-05-02",
  "2019-10-22",
]);

const movedDates: Readonly<Record<string, string>> = {
  "2020-07-23": "海の日",
  "2020-07-24": "スポーツの日",
  "2020-08-10": "山の日",
  "2021-07-22": "海の日",
  "2021-07-23": "スポーツの日",
  "2021-08-08": "山の日",
};

const cancelledStanding: ReadonlySet<string> = new Set([
  "2020-07-20",
  "2020-08-11",
  "2020-10-12",
  "2021-07-19",
  "2021-08-11",
  "2021-10-11",
]);

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function iso(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function mondayNth(year: number, month: number, nth: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const weekday = first.getUTCDay();
  const firstMonday = weekday === 1 ? 1 : ((8 - weekday) % 7) + 1;
  return iso(year, month, firstMonday + (nth - 1) * 7);
}

function equinoxDay(year: number, base: number) {
  return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function standingDates(year: number): string[] {
  const dates = [
    iso(year, 1, 1),
    mondayNth(year, 1, 2),
    iso(year, 2, 11),
    ...(year >= 2020 ? [iso(year, 2, 23)] : year <= 2018 ? [iso(year, 12, 23)] : []),
    iso(year, 3, equinoxDay(year, 20.8431)),
    iso(year, 4, 29),
    iso(year, 5, 3),
    iso(year, 5, 4),
    iso(year, 5, 5),
    mondayNth(year, 7, 3),
    iso(year, 8, 11),
    mondayNth(year, 9, 3),
    iso(year, 9, equinoxDay(year, 23.2488)),
    mondayNth(year, 10, 2),
    iso(year, 11, 3),
    iso(year, 11, 23),
  ];
  return dates.filter((date) => !cancelledStanding.has(date));
}

function utcDay(isoDate: string) {
  return new Date(isoDate + "T00:00:00Z").getUTCDay();
}

function addUtcDays(isoDate: string, amount: number) {
  const date = new Date(isoDate + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function withObservedAndBridge(observed: Iterable<string>): Set<string> {
  const holidays = new Set(observed);
  const ordered = [...holidays].sort();
  for (const date of ordered) {
    if (utcDay(date) !== 0) continue;
    let next = addUtcDays(date, 1);
    while (holidays.has(next)) next = addUtcDays(next, 1);
    holidays.add(next);
  }
  const withSubstitute = [...holidays].sort();
  for (let index = 0; index < withSubstitute.length - 1; index += 1) {
    const left = withSubstitute[index];
    const right = withSubstitute[index + 1];
    if (addUtcDays(left, 2) !== right) continue;
    const middle = addUtcDays(left, 1);
    if (utcDay(middle) === 0) continue;
    holidays.add(middle);
  }
  return holidays;
}

const holidaysByYear = new Map<number, ReadonlySet<string>>();

function holidaysInYear(year: number): ReadonlySet<string> {
  const cached = holidaysByYear.get(year);
  if (cached) return cached;
  const observed = [
    ...standingDates(year),
    ...[...extraDates].filter((date) => date.startsWith(`${year}-`)),
    ...Object.keys(movedDates).filter((date) => date.startsWith(`${year}-`)),
  ];
  const set = withObservedAndBridge(observed);
  holidaysByYear.set(year, set);
  return set;
}

export function japanHolidayYearSupported(year: number) {
  return year >= JAPAN_HOLIDAY_YEAR_MIN && year <= JAPAN_HOLIDAY_YEAR_MAX;
}

/**
 * Whether this civil date is a national holiday of Japan.
 *
 * `undefined` means the year is outside the supported range, not that the day
 * is a working day.
 */
export function japanHolidayStatus(isoDate: string): boolean | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(isoDate)) return undefined;
  const year = Number(isoDate.slice(0, 4));
  if (!japanHolidayYearSupported(year)) return undefined;
  return holidaysInYear(year).has(isoDate);
}

export function isJapanHoliday(isoDate: string) {
  return japanHolidayStatus(isoDate) === true;
}
