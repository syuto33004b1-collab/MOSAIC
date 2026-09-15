import { describe, expect, it } from "vitest";
import {
  JAPAN_HOLIDAY_YEAR_MAX,
  JAPAN_HOLIDAY_YEAR_MIN,
  isJapanHoliday,
  japanHolidayStatus,
} from "./japanHolidays";

describe("Japanese national holidays", () => {
  it("marks Golden Week 2026, including the substitute for Sunday the 3rd", () => {
    expect(isJapanHoliday("2026-05-03")).toBe(true);
    expect(isJapanHoliday("2026-05-04")).toBe(true);
    expect(isJapanHoliday("2026-05-05")).toBe(true);
    expect(isJapanHoliday("2026-05-06")).toBe(true);
    expect(isJapanHoliday("2026-05-07")).toBe(false);
  });

  it("keeps Happy Monday and the 2019/2020 one-off moves", () => {
    expect(isJapanHoliday("2026-01-12")).toBe(true);
    expect(isJapanHoliday("2019-05-01")).toBe(true);
    expect(isJapanHoliday("2019-10-22")).toBe(true);
    expect(isJapanHoliday("2019-12-23")).toBe(false);
    expect(isJapanHoliday("2020-07-23")).toBe(true);
    expect(isJapanHoliday("2020-07-20")).toBe(false);
    expect(isJapanHoliday("2020-08-11")).toBe(false);
  });

  it("does not classify years outside the supported range", () => {
    expect(japanHolidayStatus(`${JAPAN_HOLIDAY_YEAR_MIN - 1}-01-01`)).toBeUndefined();
    expect(japanHolidayStatus(`${JAPAN_HOLIDAY_YEAR_MAX + 1}-01-01`)).toBeUndefined();
    expect(isJapanHoliday("9999-01-01")).toBe(false);
  });
});
