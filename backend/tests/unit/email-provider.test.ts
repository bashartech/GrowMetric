import { describe, expect, it } from "vitest";
import { LogSinkProvider } from "../../src/lib/email/email.provider.js";

describe("email provider — log sink", () => {
  /**
   * The log sink used to return `accepted: true`, which the SEND_EMAIL handler
   * recorded as `SENT`. That made an unconfigured install indistinguishable from
   * a real delivery, so emails looked sent in the database and in the UI while
   * nothing had been transmitted. It must report failure and mark itself as a
   * simulation instead.
   */
  it("does not claim the email was sent", async () => {
    const provider = new LogSinkProvider();
    const result = await provider.sendEmail(
      ["admin@example.com"],
      "Test Subject",
      "<p>Test Body</p>",
    );

    expect(result.accepted).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.error).toMatch(/not configured/i);
  });

  it("identifies itself as the log sink", () => {
    expect(new LogSinkProvider().kind).toBe("log-sink");
  });
});