import { describe, expect, it } from "vitest";
import { resolveTemplate, listTemplates } from "../../src/lib/email/email-templates.js";

describe("email templates", () => {
  it("resolves the alert_fired template", () => {
    const resolved = resolveTemplate("alert_fired", {
      ruleName: "Revenue Drop",
      message: "Revenue dropped below threshold",
      metricKind: "REVENUE",
      currentValue: "50000",
      threshold: "60000",
      period: "2026-08",
    });
    expect(resolved.subject).toContain("Alert");
    expect(resolved.body).toContain("Revenue Drop");
  });

  it("resolves the anomaly_detected template", () => {
    const resolved = resolveTemplate("anomaly_detected", {
      metricKind: "ORDERS",
      deviationPct: "45",
      period: "2026-08",
      baseline: "100",
      observed: "145",
      kind: "SPIKE",
    });
    expect(resolved.subject).toContain("Anomaly");
    expect(resolved.body).toContain("45%");
  });

  it("resolves the report_generated template", () => {
    const resolved = resolveTemplate("report_generated", {
      title: "Weekly Report",
      reportUrl: "http://localhost/reports/123",
      reportId: "abc-123",
    });
    expect(resolved.subject).toContain("Weekly Report");
    expect(resolved.body).toContain("http://localhost/reports/123");
  });

  it("throws for unknown templates", () => {
    expect(() => resolveTemplate("unknown", {})).toThrow('Unknown email template: "unknown".');
  });

  it("lists all templates", () => {
    const names = listTemplates();
    expect(names).toContain("alert_fired");
    expect(names).toContain("anomaly_detected");
    expect(names).toContain("report_generated");
  });
});
