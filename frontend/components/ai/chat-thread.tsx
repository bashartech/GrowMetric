"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot } from "lucide-react";
import type { ConversationMessageDTO } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RunBadge } from "./run-badge";

const EVIDENCE_META: Record<
  string,
  { label: string; className: string } | undefined
> = {
  CALCULATED: {
    label: "Calculated from your data",
    className: "bg-[rgba(59,130,246,0.15)] text-[#60A5FA]",
  },
  INFERRED: {
    label: "Inferred — please verify",
    className: "bg-[rgba(250,204,21,0.14)] text-[#FDE047]",
  },
};

/**
 * The analyst is instructed to tag every figure with its evidence class
 * (prompts.ts). Those markers are kept in the stored message for auditing, but
 * they are noise in the thread — the EvidenceBadge below already states the
 * evidence class once, per answer. Stripped at render time only.
 */
const INLINE_EVIDENCE_MARKER =
  /[ \t]*\((?:CALCULATED|OBSERVED|INFERRED|PROJECTED)\)/gi;

const stripInlineEvidenceMarkers = (content: string): string =>
  content.replace(INLINE_EVIDENCE_MARKER, "");

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const RELATIVE_URL = /^(?:[/#.?]|\.\.?\/?)/;

/**
 * react-markdown never renders raw HTML (no rehype-raw), so this is defence in
 * depth on top of that: anything that is not an http(s)/mailto URL or a
 * relative reference is dropped rather than linked.
 */
const safeUrlTransform = (url: string): string => {
  const trimmed = url.trim();
  if (trimmed === "" || RELATIVE_URL.test(trimmed)) return trimmed;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(trimmed).protocol) ? trimmed : "";
  } catch {
    return "";
  }
};

const MARKDOWN = {
  p: "mb-2 last:mb-0 leading-relaxed",
  h1: "mb-2 text-base font-semibold",
  h2: "mb-2 text-base font-semibold",
  h3: "mb-1.5 text-sm font-semibold",
  ul: "mb-2 ml-4 list-disc space-y-1 last:mb-0",
  ol: "mb-2 ml-4 list-decimal space-y-1 last:mb-0",
  li: "leading-relaxed",
  blockquote: "mb-2 border-l-2 border-border pl-3 italic text-muted-foreground",
  code: "rounded bg-muted px-1 py-0.5 font-mono text-[0.8em]",
  pre: "mb-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs",
  hr: "my-3 border-t border-border",
  table: "mb-2 w-full border-collapse text-left text-xs",
  th: "border border-border bg-muted px-2 py-1 font-semibold",
  td: "border border-border px-2 py-1",
} as const;

const AssistantContent = ({ content }: { content: string }) => {
  const cleaned = useMemo(() => stripInlineEvidenceMarkers(content), [content]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={safeUrlTransform}
      components={{
        // Model output is text; never embed remote or data-URI images.
        img: () => null,
        p: ({ children }) => <p className={MARKDOWN.p}>{children}</p>,
        h1: ({ children }) => <h1 className={MARKDOWN.h1}>{children}</h1>,
        h2: ({ children }) => <h2 className={MARKDOWN.h2}>{children}</h2>,
        h3: ({ children }) => <h3 className={MARKDOWN.h3}>{children}</h3>,
        ul: ({ children }) => <ul className={MARKDOWN.ul}>{children}</ul>,
        ol: ({ children }) => <ol className={MARKDOWN.ol}>{children}</ol>,
        li: ({ children }) => <li className={MARKDOWN.li}>{children}</li>,
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className={MARKDOWN.blockquote}>{children}</blockquote>
        ),
        hr: () => <hr className={MARKDOWN.hr} />,
        pre: ({ children }) => <pre className={MARKDOWN.pre}>{children}</pre>,
        code: ({ className, children, ...props }) => (
          <code
            className={cn(
              MARKDOWN.code,
              className === undefined && "bg-transparent p-0",
            )}
            {...props}
          >
            {children}
          </code>
        ),
        a: ({ href, children }) => (
          <a
            className="font-medium underline underline-offset-2"
            href={href}
            rel="noopener noreferrer"
            target="_blank"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <table className={MARKDOWN.table}>{children}</table>
        ),
        th: ({ children }) => <th className={MARKDOWN.th}>{children}</th>,
        td: ({ children }) => <td className={MARKDOWN.td}>{children}</td>,
      }}
    >
      {cleaned}
    </ReactMarkdown>
  );
};

const EvidenceBadge = ({ evidence }: { evidence: string }) => {
  const meta = EVIDENCE_META[evidence];
  if (!meta) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        meta.className,
      )}
      data-testid="evidence-badge"
    >
      {meta.label}
    </span>
  );
};

const UserBubble = ({ content }: { content: string }) => (
  <div className="flex justify-end animate-slide-in-right">
    <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-[0_0_20px_-8px_rgba(59,130,246,0.6)]">
      {content}
    </div>
  </div>
);

const AssistantBubble = ({ message }: { message: ConversationMessageDTO }) => {
  const isError = message.kind === "ERROR";
  const hasBadges = Boolean(message.evidenceClass || message.agentRun?.status);

  return (
    <div className="flex gap-3 animate-slide-in-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#7C3AED] to-[#3B82F6] shadow-[0_0_12px_-4px_rgba(124,58,237,0.7)]">
        <Bot className="h-4 w-4 text-white" aria-hidden />
      </div>
      <div className="max-w-[80%] space-y-2">
        {message.content ? (
          <div
            className={cn(
              "rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--card-elevated)] px-4 py-2.5 text-sm",
              isError && "border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.15)] text-[#F87171]",
            )}
          >
            {isError ? (
              message.content
            ) : (
              <AssistantContent content={message.content} />
            )}
          </div>
        ) : null}
        {hasBadges ? (
          <div className="flex flex-wrap items-center gap-2">
            {message.evidenceClass ? (
              <EvidenceBadge evidence={message.evidenceClass} />
            ) : null}
            {message.agentRun ? (
              <RunBadge status={message.agentRun.status} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export interface ChatThreadProps {
  messages: ConversationMessageDTO[];
  isRunning?: boolean;
}

export const ChatThread = ({ messages, isRunning = false }: ChatThreadProps) => {
  // Tool calls are an audit concern (ToolCallRecord + the evidence panel), not
  // part of the conversation. Rendering them showed one line per call, each
  // repeating the run's full cumulative tool list.
  const visible = useMemo(
    () => messages.filter((message) => message.role !== "TOOL"),
    [messages],
  );

  return (
    <div className="flex flex-col gap-4">
      {visible.map((message) =>
        message.role === "USER" ? (
          <UserBubble key={message.id} content={message.content ?? ""} />
        ) : (
          <AssistantBubble key={message.id} message={message} />
        ),
      )}
      {isRunning ? (
        <div className="flex gap-3 animate-fade-in">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#7C3AED] to-[#3B82F6]">
            <Bot className="h-4 w-4 text-white" aria-hidden />
          </div>
          <div
            role="status"
            className="rounded-2xl rounded-tl-sm border border-dashed px-4 py-2.5 text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#3B82F6]" />
              Analyzing your data…
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
};
