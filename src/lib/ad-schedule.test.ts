import { describe, expect, it } from "vitest";
import { adSetGoal, attributionSpec, zonedToIso } from "@/lib/ad-schedule";

describe("zonedToIso", () => {
  it("Nova York no inverno e no verão", () => {
    expect(zonedToIso("2026-11-24T08:00", "America/New_York")).toBe("2026-11-24T08:00:00-05:00");
    expect(zonedToIso("2026-07-01T23:30", "America/New_York")).toBe("2026-07-01T23:30:00-04:00");
  });
  it("São Paulo e UTC", () => {
    expect(zonedToIso("2026-11-24T08:00", "America/Sao_Paulo")).toBe("2026-11-24T08:00:00-03:00");
    expect(zonedToIso("2026-11-24T08:00", "UTC")).toBe("2026-11-24T08:00:00+00:00");
  });
});

describe("atribuição e ciclo de vida", () => {
  it("monta o spec", () => {
    expect(attributionSpec("c7")).toEqual([{ event_type: "CLICK_THROUGH", window_days: 7 }]);
    expect(attributionSpec("default")).toHaveLength(3);
  });
  it("ad_set_goal", () => {
    expect(adSetGoal("all", 180)).toEqual({ type: 0 });
    expect(adSetGoal("new", 180)).toEqual({ type: 2, existing_customers_auto_exclusion_retention_days: 180 });
  });
});
