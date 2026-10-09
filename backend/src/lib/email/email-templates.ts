export interface EmailTemplateVars {
  [key: string]: string;
}

export interface ResolvedTemplate {
  subject: string;
  body: string;
}

/**
 * These bodies are handed to the transport as `html`, not `text`. Template vars
 * carry user-supplied values (rule names, metric ids, report titles), so they
 * are escaped before insertion; interpolating them raw let a rule named
 * `<script>` or `<img onerror=...>` become markup in the recipient's mail
 * client. Newlines also had to become real markup: a plaintext body sent as
 * HTML collapses into one run-on line because HTML ignores bare `\n`.
 */
function escapeHtml(value: string | undefined | null): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(label: string | undefined, value: string | undefined): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(
    label,
  )}</td><td style="padding:4px 0;color:#111827;">${escapeHtml(value)}</td></tr>`;
}

function layout(heading: string, bodyHtml: string): string {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#111827;line-height:1.5;">',
    `<h1 style="margin:0 0 12px;font-size:18px;font-weight:600;">${escapeHtml(heading)}</h1>`,
    bodyHtml,
    '<p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">Sent by GrowMetrics.</p>',
    "</div>",
  ].join("");
}

function table(rows: string[]): string {
  return `<table style="border-collapse:collapse;margin:0;">${rows.join("")}</table>`;
}

const templates: Record<string, (vars: EmailTemplateVars) => ResolvedTemplate> = {
  alert_fired: (vars) => ({
    subject: `Alert: ${vars.ruleName} triggered`,
    body: layout(
      `Alert: ${vars.ruleName} triggered`,
      [
        `<p style="margin:0 0 12px;">${escapeHtml(vars.message)}</p>`,
        table([
          row("Metric", vars.metricKind),
          row("Current value", vars.currentValue),
          row("Threshold", vars.threshold),
          row("Period", vars.period),
        ]),
      ].join(""),
    ),
  }),
  anomaly_detected: (vars) => ({
    subject: `Anomaly detected: ${vars.metricKind} ${vars.deviationPct}% deviation`,
    body: layout(
      `Anomaly detected in ${vars.metricKind}`,
      [
        `<p style="margin:0 0 12px;">An anomaly was detected for ${escapeHtml(
          vars.metricKind,
        )} in ${escapeHtml(vars.period)}.</p>`,
        table([
          row("Baseline", vars.baseline),
          row("Observed", vars.observed),
          row("Deviation", `${vars.deviationPct}%`),
          row("Kind", vars.kind),
        ]),
      ].join(""),
    ),
  }),
  report_generated: (vars) => ({
    subject: `Report generated: ${vars.title}`,
    body: layout(
      `Report generated: ${vars.title}`,
      [
        table([
          row("Report", vars.title),
          row("Report ID", vars.reportId),
        ]),
        `<p style="margin:16px 0 0;"><a href="${escapeHtml(
          vars.reportUrl,
        )}" style="color:#2563eb;">View the report</a></p>`,
      ].join(""),
    ),
  }),
};

export function resolveTemplate(name: string, vars: EmailTemplateVars): ResolvedTemplate {
  const template = templates[name];
  if (!template) {
    throw new Error(`Unknown email template: "${name}".`);
  }
  return template(vars);
}

export function listTemplates(): string[] {
  return Object.keys(templates);
}