"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, MessageSquare, MessageSquarePlus, Send } from "lucide-react";
import { ApiError, api } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/signals/empty-state";
import { ErrorState } from "@/components/signals/error-state";
import { Loading } from "@/components/signals/loading";
import { ChatThread } from "@/components/ai/chat-thread";
import { RunBadge } from "@/components/ai/run-badge";
import type { ConversationSummaryDTO } from "@/lib/types";
import Link from "next/link";

const NO_READY_DATASETS_MESSAGE =
  "No analytics-ready datasets exist in this workspace yet. Import data before asking the AI Analyst.";

/**
 * The analyst job is queued before the worker creates its AgentRun, so the
 * conversation used to report no active run during that gap. The client now
 * watches the job itself: `activeJob` covers queued and running, and the send
 * response's `jobId` binds the exact answer this turn is waiting for.
 */
const POLL_FAST_MS = 1200;
const POLL_SLOW_MS = 3000;
const POLL_SLOW_AFTER_MS = 15000;
// A slow run earns a warning, never an unlock: the composer stays disabled
// until the job ends (Cancel is the escape hatch for a job that never will).
const RUN_TIMEOUT_MS = 120000;
// The first refetch after sending can still hold the pre-send snapshot, so an
// "activeJob is null" verdict only counts after the job had time to appear.
const JOB_NEVER_SEEN_GRACE_MS = 2000;

const isNoReadyDatasets = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.code === "CONFLICT" &&
  error.details !== null &&
  typeof error.details === "object" &&
  (error.details as { ready?: boolean }).ready === false;

const lastAssistantMessageId = (
  messages: { id: string; role: string }[],
): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "ASSISTANT") return message.id;
  }
  return null;
};

export default function AiAnalystPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // True from the moment a question is accepted until its answer lands.
  const [awaitingAnswer, setAwaitingAnswer] = useState(false);
  const [slowRunWarning, setSlowRunWarning] = useState(false);

  // Read inside the refetchInterval callback, which would otherwise close over
  // stale state without the query key having to change.
  const awaitingAnswerRef = useRef(false);
  const runStartedAtRef = useRef<number | null>(null);
  const baselineAssistantIdRef = useRef<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const observedJobRef = useRef(false);
  const observedRunRef = useRef(false);

  const {
    data: listData,
    isLoading: listLoading,
    error: listError,
  } = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: () => api.ai.listConversations(),
  });

  const conversations = useMemo<ConversationSummaryDTO[]>(
    () => listData?.items ?? [],
    [listData],
  );
  const activeId = selectedId ?? conversations[0]?.id ?? null;

  const {
    data: conversation,
    isLoading: conversationLoading,
    error: conversationError,
    refetch: refetchConversation,
  } = useQuery({
    queryKey: ["ai-conversation", activeId],
    queryFn: () => api.ai.getConversation(activeId as string),
    enabled: activeId !== null,
    refetchInterval: (query) => {
      if (awaitingAnswerRef.current) {
        const startedAt = runStartedAtRef.current;
        const elapsed = startedAt === null ? 0 : Date.now() - startedAt;
        return elapsed > POLL_SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS;
      }
      // Covers opening a conversation whose job or run is already active.
      return query.state.data?.activeJob || query.state.data?.nextRun
        ? 2000
        : false;
    },
  });

  const invalidateActive = () => {
    void queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    if (activeId) {
      void queryClient.invalidateQueries({ queryKey: ["ai-conversation", activeId] });
    }
  };

  // Switching conversations abandons any pending watch rather than carrying it
  // across, so the new conversation is not polled against a stale baseline.
  const selectConversation = (conversationId: string) => {
    awaitingAnswerRef.current = false;
    runStartedAtRef.current = null;
    baselineAssistantIdRef.current = null;
    jobIdRef.current = null;
    observedJobRef.current = false;
    setAwaitingAnswer(false);
    setSlowRunWarning(false);
    setSelectedId(conversationId);
  };

  const createMutation = useMutation({
    mutationFn: () => api.ai.createConversation({}),
    onSuccess: (created) => {
      selectConversation(created.id);
      void queryClient.invalidateQueries({ queryKey: ["ai-conversations"] });
    },
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) => {
      if (!activeId) throw new Error("No conversation selected");
      return api.ai.runMessage(activeId, { content });
    },
    onSuccess: (accepted) => {
      setDraft("");
      // The run record does not exist yet, so start our own watch immediately.
      baselineAssistantIdRef.current = lastAssistantMessageId(
        conversation?.messages ?? [],
      );
      runStartedAtRef.current = Date.now();
      jobIdRef.current = accepted.jobId;
      observedJobRef.current = false;
      awaitingAnswerRef.current = true;
      setSlowRunWarning(false);
      setAwaitingAnswer(true);
      invalidateActive();
    },
  });

  const sendInFlight = sendMutation.isPending;

  const cancelMutation = useMutation({
    mutationFn: (conversationId: string) => api.ai.cancelRun(conversationId),
    onSuccess: () => {
      awaitingAnswerRef.current = false;
      runStartedAtRef.current = null;
      jobIdRef.current = null;
      observedJobRef.current = false;
      setAwaitingAnswer(false);
      invalidateActive();
    },
  });

  const hasActiveWork =
    conversation?.activeJob != null || conversation?.nextRun != null;
  const isRunning = sendInFlight || awaitingAnswer || hasActiveWork;

  // Stop watching when THIS turn's answer lands or its job goes terminal. The
  // jobId returned by the send response binds the answer, so a late answer to
  // some earlier turn can never resolve this one; position-based detection
  // remains only for payloads that predate the binding.
  useEffect(() => {
    if (!awaitingAnswer || !conversation) return;

    const finish = () => {
      awaitingAnswerRef.current = false;
      runStartedAtRef.current = null;
      jobIdRef.current = null;
      observedJobRef.current = false;
      setAwaitingAnswer(false);
    };

    const myJobId = jobIdRef.current;
    const activeJob = conversation.activeJob ?? null;
    if (myJobId !== null && activeJob?.id === myJobId) {
      observedJobRef.current = true;
    }

    if (
      myJobId !== null &&
      conversation.messages.some(
        (message) =>
          message.role === "ASSISTANT" &&
          (message.payload as { jobId?: string } | null)?.jobId === myJobId,
      )
    ) {
      finish();
      return;
    }

    if (myJobId === null) {
      const currentAssistantId = lastAssistantMessageId(conversation.messages);
      if (
        currentAssistantId !== null &&
        currentAssistantId !== baselineAssistantIdRef.current
      ) {
        finish();
        return;
      }
    } else if (observedJobRef.current && activeJob?.id !== myJobId) {
      finish();
      return;
    }

    const sentAt = runStartedAtRef.current;
    if (sentAt === null) return;

    if (activeJob === null && !observedJobRef.current) {
      // Structural sharing can keep the same conversation reference when
      // nothing visible changed (a job that failed before persisting any
      // message), so enforce the grace window with a timer, not the next poll.
      const timer = setTimeout(
        finish,
        Math.max(0, sentAt + JOB_NEVER_SEEN_GRACE_MS - Date.now()) + 100,
      );
      return () => clearTimeout(timer);
    }

    if (Date.now() - sentAt > RUN_TIMEOUT_MS && !slowRunWarning) {
      setSlowRunWarning(true);
    }
  }, [awaitingAnswer, conversation, slowRunWarning]);

  // Opening a conversation mid-run: the run can finish between two polls, which
  // would stop polling before the answer was ever fetched. Pull once more.
  useEffect(() => {
    if (!conversation) return;
    if (conversation.nextRun != null) {
      observedRunRef.current = true;
      return;
    }
    if (observedRunRef.current) {
      observedRunRef.current = false;
      void refetchConversation();
    }
  }, [conversation, refetchConversation]);

  const handleSend = () => {
    const content = draft.trim();
    if (!content || sendInFlight || isRunning) return;
    sendMutation.mutate(content);
  };

  const currentRunStatus = isRunning
    ? conversation?.activeJob?.status ??
      conversation?.nextRun?.status ??
      "PENDING"
    : null;

  if (listLoading) {
    return <Loading label="Loading conversations..." />;
  }

  if (listError) {
    return <ErrorState message={(listError as Error).message} />;
  }

  if (conversations.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">AI Analyst</h1>
          <p className="text-muted-foreground mt-1">
            Answer questions grounded in your own data, with cited evidence. The
            analyst never fabricates results.
          </p>
        </div>
        <Card className="p-10">
          <EmptyState
            icon={<MessageSquare className="h-12 w-12" />}
            title="No conversations yet"
            description="Start a new analyst conversation and ask a question about your data."
            action={
              <Button onClick={() => createMutation.mutate()}>
                <MessageSquarePlus className="h-4 w-4" />
                New conversation
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">AI Analyst</h1>
          <p className="text-muted-foreground mt-1">
            Ask questions about your data — answers carry cited evidence.
          </p>
        </div>
        <Button variant="outline" onClick={() => createMutation.mutate()}>
          <MessageSquarePlus className="h-4 w-4" />
          New conversation
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit lg:sticky lg:top-24 max-h-[70vh] overflow-y-auto">
          <div className="p-3">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Conversations
            </p>
            <ul className="space-y-1">
              {conversations.map((conversationItem) => (
                <li key={conversationItem.id}>
                  <button
                    type="button"
                      onClick={() => selectConversation(conversationItem.id)}

                    className={
                      activeId === conversationItem.id
                        ? "w-full rounded-md bg-accent px-3 py-2 text-left text-sm font-medium"
                        : "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                    }
                  >
                    <span className="block truncate">
                      {conversationItem.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {conversationItem.messageCount} message
                      {conversationItem.messageCount === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="flex min-h-[60vh] flex-col">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h2 className="font-semibold">
                {conversation?.title ?? "Conversation"}
              </h2>
              {currentRunStatus ? (
                <div className="flex items-center gap-2">
                  <RunBadge status={currentRunStatus} />
                  <Button
                    variant="outline"
                    size="sm"
                    loading={cancelMutation.isPending}
                    disabled={cancelMutation.isPending}
                    onClick={() => {
                      if (activeId) cancelMutation.mutate(activeId);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="flex-1 space-y-4 p-4">
              {conversationLoading && !conversation ? (
                <Loading label="Loading conversation..." />
              ) : conversationError ? (
                <ErrorState
                  message={(conversationError as Error).message}
                  onRetry={() => refetchConversation()}
                />
              ) : conversation && conversation.messages.length === 0 ? (
                <EmptyState
                  icon={<MessageSquare className="h-10 w-10" />}
                  title="Ask your first question"
                  description="For example: 'Which product drove revenue growth last quarter?'"
                />
              ) : conversation ? (
                <ChatThread
                  messages={conversation.messages}
                  isRunning={isRunning}
                />
              ) : null}
            </div>

            <div className="border-t border-border p-4">
              {slowRunWarning ? (
                <div
                  role="status"
                  data-testid="slow-run-warning"
                  className="mb-3 rounded-md border border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.14)] p-3 text-sm text-[#FDE047]"
                >
                  This question is taking longer than expected. The answer will
                  appear here when it is ready, or refresh the page.
                </div>
              ) : null}

              {sendMutation.isError ? (
                <div
                  data-testid="composer-error"
                  className={
                    isNoReadyDatasets(sendMutation.error)
                      ? "mb-3 flex items-start gap-3 rounded-md border border-[rgba(250,204,21,0.35)] bg-[rgba(250,204,21,0.14)] p-3 text-sm text-[#FDE047]"
                      : "mb-3 rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.15)] p-3 text-sm text-[#F87171]"
                  }
                >
                  <Database className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {isNoReadyDatasets(sendMutation.error) ? (
                    <span>
                      {NO_READY_DATASETS_MESSAGE}{" "}
                      <Link
                        href="/data-hub/datasets"
                        className="font-medium underline underline-offset-2"
                      >
                        Go to datasets
                      </Link>
                    </span>
                  ) : (
                    <span>{(sendMutation.error as Error).message}</span>
                  )}
                </div>
              ) : null}

              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={2}
                  disabled={sendInFlight || isRunning}
                  placeholder={
                    isRunning
                      ? "The analyst is working…"
                      : "Ask about your data…"
                  }
                  aria-label="Message"
                  className="min-h-[56px] flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-[var(--ring)] focus:shadow-[0_0_0_3px_rgba(96,165,250,0.15)] focus:outline-none disabled:opacity-50"
                />
                <Button
                  onClick={handleSend}
                  loading={sendInFlight}
                  disabled={sendInFlight || isRunning || draft.trim().length === 0}
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                  Send
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}