"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, AudioLines, Check, Copy, RefreshCw, SquarePen, Square } from "lucide-react";
import { FridayOrb } from "./friday-orb";
import { DictateButton, useVoice, VoiceMode } from "./voice";
import { prefetchAgentGrant } from "@/lib/voice/agent";
import { authFetch } from "@/lib/cloud/client";
import { buildSnapshot, type AdvisorSnapshot } from "@/lib/advisor/snapshot";
import { HEARTBEAT, STREAM_ERROR } from "@/lib/advisor/stream-markers";
import { detectRecurring, subscriptionsOf } from "@/lib/finance/recurring";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";
import { useReminders } from "../reminders";
import { useBalances } from "../statements/use-statement-checks";
import { identify, useSignedInUser } from "../profile-menu";
import { saveProfile, useProfile, type Profile } from "@/lib/profile";

type Message = { role: "user" | "assistant"; content: string };

const STORE = "money-manager:advisor-chat";
/** Starting points, as cards: a title and what it asks. */
const SUGGESTIONS: { title: string; ask: string }[] = [
  { title: "Am I financially healthy?", ask: "Am I financially healthy right now?" },
  { title: "If I lose my job", ask: "If I lose my job, how long can I manage and what should I do first?" },
  { title: "Can I afford it?", ask: "Can I afford to buy something for ₹50,000 right now?" },
  { title: "Can I take a loan?", ask: "Can I take a ₹5 lakh loan? What EMI is safe for me?" },
  { title: "Which debt first?", ask: "Which debt should I pay off first, and how?" },
  { title: "Save more", ask: "How can I save more every month?" },
];

/** The snapshot the CA answers from, built from the same figures as the rest of the app. */
function useSnapshot(): AdvisorSnapshot | null {
  const f = useFinance();
  const { state } = useBalances();
  const reminders = useReminders(true);
  return useMemo(() => {
    if (f.status !== "ready") return null;
    const subscriptions = subscriptionsOf(detectRecurring(f.book, f.ledger, f.today));
    return buildSnapshot({ book: f.book, ledger: f.ledger, state, today: f.today, report: f.report, categoryName: (id) => f.getCategory(id).name, subscriptions, reminders });
  }, [f.status, f.book, f.ledger, f.today, f.report, f.getCategory, state, reminders]);
}

/**
 * Your AI CA, laid out like a chat assistant: the conversation fills the page (your messages in bubbles on the right,
 * the CA's answers in full width with copy and regenerate), a big message box stays at the bottom, and a new chat
 * opens on a greeting with suggestions. It answers from your figures, worked out by the app; the chat stays on this
 * device.
 */
export function AdvisorView() {
  const snapshot = useSnapshot();
  // Your first name, as your profile has it, over your messages (tap it to set your name).
  const profile = useProfile();
  const me = identify(useSignedInUser(), profile);
  const myName = me.name.trim().split(/\s+/)[0] || "You";
  const [messages, setMessages] = useState<Message[]>([]);
  // The chat kept on this device, read once the page is open (never during the first render).
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE) ?? "[]") as Message[];
      if (Array.isArray(saved)) setMessages(saved.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content));
    } catch {
      /* nothing kept, or unreadable: start fresh */
    }
  }, []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Following the answer as it's written, unless you've scrolled up to read.
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    authFetch("/api/advisor", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { available?: boolean }) => setAvailable(d.available === true))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    // The first run still holds the empty start, before the kept chat is read in: saving it would erase that.
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    try {
      window.localStorage.setItem(STORE, JSON.stringify(messages.filter((m) => m.content).slice(-40)));
    } catch {
      /* private mode: the chat just isn't kept */
    }
  }, [messages]);

  // Whether the end of the conversation is on screen.
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setAtBottom(e.isIntersecting), { rootMargin: "0px 0px -120px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (atBottom) end.current?.scrollIntoView({ block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // The message box grows with what's typed, up to a few lines.
  useLayoutEffect(() => {
    const t = box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
    // A scroll bar only once it's grown as tall as it goes.
    t.style.overflowY = t.scrollHeight > 200 ? "auto" : "hidden";
  }, [draft]);

  /** Sends the conversation and resolves with Friday's answer ("" if it failed or was stopped early). */
  async function send(history: Message[], attempt = 1, voice = false): Promise<string> {
    setError(null);
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);
    setAtBottom(true);
    const controller = new AbortController();
    abort.current = controller;
    let answer = "";
    try {
      const res = await authFetch("/api/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-20), snapshot, ...(voice ? { voice: true } : {}) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(d.message ?? "Couldn't get an answer.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        // The server's "still here" signals aren't part of the answer.
        const text = raw.replaceAll(HEARTBEAT, "");
        if (text.startsWith(STREAM_ERROR)) throw new Error(text.slice(STREAM_ERROR.length) || "Couldn't get an answer.");
        answer = text;
        if (answer) setMessages([...history, { role: "assistant", content: answer }]);
      }
      if (!answer.trim()) throw new Error("The answer came back empty. Try again.");
      return answer;
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        // Stopped by you: keep what was written so far.
        setMessages((m) => (m.at(-1)?.role === "assistant" && !m.at(-1)?.content ? m.slice(0, -1) : m));
      } else {
        // A dropped connection ("Load failed" on iPhone, "Failed to fetch" elsewhere) before any words: try once more.
        const dropped = e instanceof TypeError || /load failed|failed to fetch|network/i.test(e.message);
        if (dropped && !answer && attempt === 1) {
          abort.current = null;
          return send(history, 2, voice);
        }
        setError(dropped ? "The connection dropped before Friday could answer. Check your internet and try again." : e.message);
        setMessages((m) => (m.at(-1)?.role === "assistant" && !m.at(-1)?.content ? m.slice(0, -1) : m));
      }
    } finally {
      if (abort.current === controller) {
        setBusy(false);
        abort.current = null;
      }
    }
    return "";
  }

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || busy || !snapshot) return;
    setDraft("");
    void send([...messages, { role: "user", content: question }]);
  };

  // Voice chat: the conversation so far, kept current for each spoken question.
  const voice = useVoice();
  const [talking, setTalking] = useState(false);
  // While Friday is open, keep a live-assistant token ready, so talking starts without waiting for one.
  useEffect(() => {
    if (!voice) return;
    prefetchAgentGrant();
    const t = setInterval(prefetchAgentGrant, 40_000);
    return () => clearInterval(t);
  }, [voice]);
  // Dictating: what was in the box when you started, so the words as you speak go after it.
  const dictBase = useRef<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const latest = useRef(messages);
  latest.current = messages;
  const askAloud = (question: string) => (snapshot ? send([...latest.current, { role: "user", content: question }], 1, true) : Promise.resolve(""));

  // Ask the last question again, for a fresh answer.
  const regenerate = () => {
    if (busy) return;
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUser < 0) return;
    void send(messages.slice(0, lastUser + 1));
  };

  const canAsk = !!snapshot && available !== false;
  const empty = messages.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col" data-testid="advisor">
      {/* Top bar: the name, and a new chat. */}
      <div className="flex items-center justify-between pb-2">
        {/* The name sits under the big orb on a new chat; the header's orb shows you're here. */}
        <h1 className="sr-only">Friday</h1>
        <span />
        <button
          type="button"
          onClick={() => setMessages([])}
          disabled={busy || empty}
          aria-label="New chat"
          title="New chat"
          className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <SquarePen className="size-5" />
        </button>
      </div>

      {available === false && (
        <p className="mb-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">The AI isn&apos;t set up on this server (no OpenAI key), so Friday can&apos;t answer yet.</p>
      )}

      {empty && error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {empty ? (
        // A new chat: just the question, and a few places to start.
        // Sized to the space left between the top bar and the message box, so a new chat doesn't scroll.
        <div className="flex h-[calc(100dvh-21rem)] min-h-48 flex-col items-center justify-center gap-5 text-center sm:h-[calc(100dvh-18rem)]">
          <div className="grid justify-items-center gap-1.5">
            <FridayOrb size={64} />
            <span className="text-xs font-medium tracking-wide text-muted-foreground">Friday</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Hi, I&apos;m Friday. What&apos;s on your mind about money?</h2>
          <div className="flex max-w-xl flex-wrap justify-center gap-2">
            {SUGGESTIONS.slice(0, 4).map((s) => (
              <button
                key={s.title}
                type="button"
                disabled={!canAsk || busy}
                onClick={() => ask(s.ask)}
                className="rounded-full border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 pb-4 pt-2" data-testid="advisor-chat">
          {messages.map((m, i) =>
            // Messenger style: yours on the right, Friday's on the left, each under its sender's name in their colour
            // with a thin line of that colour beside it. Friday in blue, you in red.
            m.role === "user" ? (
              <div key={i} className="ml-auto grid max-w-[85%] justify-items-end gap-0.5" data-testid="msg-me">
                <MyName name={myName} profile={profile} />
                <div className="whitespace-pre-wrap border-r-2 border-[#f23c57] pr-3 text-right text-[15px] leading-relaxed">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="mr-auto grid max-w-full gap-0.5" data-testid="msg-friday">
                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#0eadff]">
                  Friday
                  {!m.content && <Thinking />}
                </p>
                <div className="min-w-0 border-l-2 border-[#0eadff] pl-3">
                  {m.content ? (
                    <div className="text-[15px] leading-relaxed">
                      <Rich text={m.content} />
                    </div>
                  ) : (
                    <div className="h-5" />
                  )}
                  {/* Copy any answer; regenerate the last. */}
                  {m.content && !(busy && i === messages.length - 1) && (
                    <div className="-ml-2 mt-0.5 flex items-center gap-0.5 text-muted-foreground">
                      <CopyButton text={m.content} />
                      {i === messages.length - 1 && (
                        <button type="button" onClick={regenerate} aria-label="Regenerate" title="Regenerate" className="grid size-8 place-items-center rounded-lg hover:bg-muted hover:text-foreground">
                          <RefreshCw className="size-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          {error && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
              <span>{error}</span>
              {/* Ask the last question again. */}
              {messages.at(-1)?.role === "user" && (
                <button type="button" onClick={() => void send(messages)} className="rounded-lg bg-red-100 px-2.5 py-1 font-medium hover:bg-red-200">
                  Try again
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {/* Room under the last message for the message box (a new chat needs none: it's sized to fit). */}
      <div ref={end} className={empty ? "h-0" : "h-16 sm:h-20"} />

      {/* The message box: fixed at the bottom, above the tab bar on phones. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 px-4 sm:bottom-4">
        <div className="pointer-events-auto relative mx-auto max-w-3xl">
          {!atBottom && !empty && (
            <button
              type="button"
              onClick={() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
              aria-label="Scroll to the latest"
              className="absolute -top-12 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border bg-card shadow-md"
            >
              <ArrowDown className="size-4" />
            </button>
          )}
          {talking ? (
            <VoiceMode
              ask={askAloud}
              snapshot={snapshot}
              history={messages.filter((m) => m.content)}
              // The live conversation lands in the chat as it goes.
              onLine={(role, content) => setMessages((m) => [...m, { role, content }])}
              onClose={() => {
                setTalking(false);
                abort.current?.abort();
              }}
            />
          ) : (
          <form
            className="flex items-end gap-2 rounded-[28px] border bg-card p-2 pl-4 shadow-lg"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <textarea
              ref={box}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              rows={1}
              placeholder={canAsk ? "Ask Friday about your money…" : "Friday isn't available"}
              aria-label="Ask Friday"
              className="max-h-[200px] min-h-10 min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent py-2 text-base outline-none placeholder:text-muted-foreground"
            />
            {voice && !busy && (
              <DictateButton
                disabled={!canAsk}
                // Your words appear in the box as you speak; what was typed before stays in front of them.
                onPartial={(t) => {
                  if (dictBase.current === null) dictBase.current = draftRef.current.trim();
                  setDraft(dictBase.current ? `${dictBase.current} ${t}` : t);
                }}
                onText={(t) => {
                  const base = dictBase.current ?? draftRef.current.trim();
                  dictBase.current = null;
                  setDraft(base ? `${base} ${t}` : t);
                  box.current?.focus();
                }}
                onError={setError}
              />
            )}
            {busy ? (
              <button type="button" aria-label="Stop" onClick={() => abort.current?.abort()} className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background">
                <Square className="size-3.5 fill-current" />
              </button>
            ) : voice && !draft.trim() ? (
              // Nothing typed: talk with Friday instead (like a call). Typing turns this back into Send.
              <button
                type="button"
                aria-label="Talk with Friday"
                title="Talk with Friday"
                disabled={!canAsk}
                onClick={() => {
                  setError(null);
                  setTalking(true);
                }}
                // Friday's own colours (the orb's pink, violet and cyan), the same in light and dark.
                className="grid size-10 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#ff2d95,#8b5cf6_55%,#00d4ff)] text-white shadow-md shadow-violet-500/30 transition-opacity disabled:opacity-25"
                data-testid="voice-start"
              >
                <AudioLines className="size-5" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send"
                disabled={!draft.trim() || !canAsk}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-25"
              >
                <ArrowUp className="size-5" />
              </button>
            )}
          </form>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Your name over your messages. Tap it to set your name (saved to your profile, so it's right everywhere); the chat
 * shows the first word.
 */
function MyName({ name, profile }: { name: string; profile: Profile }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(profile.name ?? "");
  if (editing) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) saveProfile({ ...profile, name: value.trim() });
          setEditing(false);
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setEditing(false)}
          placeholder="Your name, e.g. Aniruddh Kadam"
          aria-label="Your name"
          className="h-7 w-48 rounded-md border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </form>
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="Tap to set your name" className="text-[11px] font-bold uppercase tracking-wider text-[#f23c57] hover:underline">
      {name}
    </button>
  );
}

/** Three dots while the answer is on its way. */
function Thinking() {
  return (
    <span className="flex items-center gap-1.5 font-normal normal-case tracking-normal text-muted-foreground" aria-label="Friday is thinking">
      <span className="text-xs">is thinking</span>
      <span className="flex items-center gap-1">
        {[0, 150, 300].map((d) => (
          <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy"
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="grid size-8 place-items-center rounded-lg hover:bg-muted hover:text-foreground"
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  );
}

/**
 * A reply's formatting, drawn as text (never HTML): paragraphs, "- " bullets, "1." steps, # headings, **bold**,
 * *italic*, and "| a | b |" tables (amounts lined up on the right, a "Total" row in bold).
 */
function Rich({ text: raw }: { text: string }) {
  // No long dashes: "No — not now" reads "No, not now"; an empty table cell "—" stays empty.
  const text = raw.replace(/\|\s*—\s*\|/g, "| |").replace(/\s*—\s*/g, ", ");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={cn("my-2 grid gap-1.5 pl-5", list.ordered ? "list-decimal" : "list-disc")}>
        {list.items.map((it, i) => (
          <li key={i} className="pl-1">
            <Inline text={it} />
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    // Amounts (₹…, numbers, −₹…) line up on the right.
    const numeric = (c: string) => /^[−\-+]?\s*(₹\s?)?[\d,]+(\.\d+)?\s*(%|\/\s*month)?$/.test(c.replace(/\*/g, "").trim());
    blocks.push(
      <div key={blocks.length} className="my-2 overflow-x-auto rounded-xl border">
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              {head.map((h, i) => (
                <th key={i} className={cn("px-3 py-1.5 font-medium", body.every((r) => !r[i] || numeric(r[i])) && body.length > 0 ? "text-right" : "text-left")}>
                  <Inline text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {body.map((r, ri) => {
              const total = /^\**\s*(total|sum|grand total)/i.test(r[0] ?? "");
              return (
                <tr key={ri} className={cn(total && "bg-muted/40 font-semibold")}>
                  {head.map((_, ci) => (
                    <td key={ci} className={cn("px-3 py-1.5 align-top", numeric(r[ci] ?? "") ? "whitespace-nowrap text-right" : "text-left")}>
                      <Inline text={r[ci] ?? ""} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>,
    );
    table = null;
  };
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      // The |---|---| line under the header only marks it as a table.
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-")) continue;
      (table ??= []).push(cells(line));
      continue;
    }
    flushTable();
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const step = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || step) {
      const ordered = !!step;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? step)![1]);
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    blocks.push(
      <p key={blocks.length} className={cn("my-2 first:mt-0", heading && (heading[1].length <= 2 ? "mt-4 text-base font-semibold" : "mt-3 text-sm font-semibold text-muted-foreground"))}>
        <Inline text={heading ? heading[2] : line} />
      </p>,
    );
  }
  flushList();
  flushTable();
  return <div className="break-words">{blocks}</div>;
}

/** **bold** and *italic* within a line. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <strong key={i} className="font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith("*") && p.endsWith("*") && p.length > 2 ? (
          <em key={i} className="text-muted-foreground">
            {p.slice(1, -1)}
          </em>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}
