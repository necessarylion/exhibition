import { describe, expect, test } from "bun:test";
import type { Page, PageQuery, ProjectLine } from "../resources/js/api";
import { availabilityText, canAdd, ownershipOf } from "../resources/js/availability";
import {
  countText,
  formatBoothSize,
  formatDate,
  formatDateRange,
  formatMonth,
  itemNote,
  joinParts,
  timeAgo,
} from "../resources/js/dates";
import { fetchAll } from "../resources/js/list";
import { formatPrice } from "../resources/js/money";
import { groupNotSent, sumGroups } from "../resources/js/project-lines";

/** The small helpers of the pages. They hold rules of what the user reads. */
describe("page helpers", () => {
  test("availability: by the dates of a project, or the stock without one", () => {
    const three = { stock: 5, available: 3 };
    expect(availabilityText(three, true, false)).toBe("3 available for your dates");
    expect(availabilityText({ stock: 5, available: 0 }, true, false)).toBe(
      "Not available for your dates",
    );
    expect(availabilityText({ stock: null, available: null }, true, false)).toBe(
      "Available for your dates",
    );
    // No project is chosen: the total stock.
    expect(availabilityText(three, false, false)).toBe("5 in stock");
    expect(availabilityText({ stock: 0, available: 0 }, false, false)).toBe("Out of stock");
    expect(availabilityText({ stock: null, available: null }, false, false)).toBe("In stock");
    // An own item is not checked by date.
    expect(availabilityText({ stock: 2, available: 2 }, true, true)).toBe("2 in stock");

    expect(canAdd({ stock: 5, available: 0 }, false)).toBe(false);
    expect(canAdd({ stock: 5, available: 1 }, false)).toBe(true);
    expect(canAdd({ stock: null, available: null }, false)).toBe(true);
    expect(canAdd({ stock: 0, available: 0 }, true)).toBe(true);
  });

  test("a catalog item is mine, shared by my group, or of a supplier", () => {
    expect(ownershipOf({ companyId: "me", companyType: "customer" }, "me")).toBe("own");
    expect(ownershipOf({ companyId: "mate", companyType: "customer" }, "me")).toBe("shared");
    expect(ownershipOf({ companyId: "s", companyType: "supplier" }, "me")).toBe("supplier");
    expect(ownershipOf({ companyId: "hq", companyType: "admin" }, "me")).toBe("supplier");
    // Before the user is loaded nothing counts as mine.
    expect(ownershipOf({ companyId: "s", companyType: "supplier" }, undefined)).toBe("supplier");
  });

  test("the time of a notification in short words", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(timeAgo("2026-10-09T11:59:30Z", now)).toBe("Just now");
    expect(timeAgo("2026-10-09T11:50:00Z", now)).toBe("10 minutes ago");
    expect(timeAgo("2026-10-09T11:59:00Z", now)).toBe("1 minute ago");
    expect(timeAgo("2026-10-09T10:00:00Z", now)).toBe("2 hours ago");
    expect(timeAgo("2026-10-03T10:00:00Z", now)).toBe("3 Oct 2026");
  });

  test("dates: a day never moves, and a range writes the month and year once", () => {
    expect(formatDate("2026-10-06")).toBe("6 Oct 2026");
    expect(formatDate("2027-01-01")).toBe("1 Jan 2027");
    expect(formatDateRange("2027-03-12", "2027-03-12")).toBe("12 Mar 2027");
    expect(formatDateRange("2027-03-12", "2027-03-14")).toBe("12 – 14 Mar 2027");
    expect(formatDateRange("2027-03-30", "2027-04-02")).toBe("30 Mar – 2 Apr 2027");
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("30 Dec 2026 – 2 Jan 2027");
    expect(formatMonth("2026-10")).toBe("Oct");
  });

  test("texts: sizes, counts, joined parts and prices", () => {
    expect(formatBoothSize(600, 300)).toBe("6 m wide × 3 m deep");
    expect(formatBoothSize(null, 250)).toBe("2.5 m deep");
    expect(formatBoothSize(null, null)).toBe("");
    expect(countText(1, "item")).toBe("1 item");
    expect(countText(0, "item")).toBe("0 items");
    expect(joinParts(["Hall 3", "", null, undefined, "Booth B-14"])).toBe("Hall 3 · Booth B-14");
    expect(itemNote({ category: "Booth", sku: "BM-1" })).toBe("Booth · SKU BM-1");
    expect(itemNote({ category: null })).toBe("");
    expect(formatPrice(123456)).toBe("$1,234.56");
    expect(formatPrice(0)).toBe("$0.00");
  });

  test("the send page: one group per supplier, and its total is what the API checks", () => {
    function line(companyId: string, state: ProjectLine["state"], lineTotalCents: number) {
      return { companyId, companyName: companyId, state, lineTotalCents } as ProjectLine;
    }
    const groups = groupNotSent([
      line("a", "not_sent", 1000),
      line("b", "not_sent", 250),
      line("a", "not_sent", 500),
      line("a", "sent", 9999),
      line("me", "own", 0),
      // An item that my group shares is free. It is never in an order.
      line("mate", "shared", 0),
    ]);
    expect(groups.map((group) => [group.companyId, group.lines.length, group.totalCents])).toEqual([
      ["a", 2, 1500],
      ["b", 1, 250],
    ]);
    expect(sumGroups(groups)).toEqual({ count: 3, totalCents: 1750 });
    expect(sumGroups([])).toEqual({ count: 0, totalCents: 0 });
  });

  test("a short list is read call after call until it ends", async () => {
    const calls: PageQuery[] = [];
    function pageOf(total: number) {
      return async function fetchPage(page: PageQuery): Promise<Page<number>> {
        calls.push(page);
        const offset = page.offset ?? 0;
        const rows = [];
        for (let row = offset; row < Math.min(total, offset + (page.limit ?? 0)); row++) {
          rows.push(row);
        }
        return { rows, total, counts: {} };
      };
    }

    const rows = await fetchAll(pageOf(450));
    expect(rows.length).toBe(450);
    expect(rows.at(-1)).toBe(449);
    expect(calls.map((call) => call.offset)).toEqual([0, 200, 400]);
    expect(await fetchAll(pageOf(0))).toEqual([]);
  });
});
