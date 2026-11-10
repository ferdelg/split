import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../../data/state";
import { actions } from "../../data/actions";
import { QUICK_PROMPTS } from "../../coach/prompt";
import { formatReps } from "../../lib/units";
import { sessionOn } from "../../data/history";
import type { ChatMessage, WeightUnit } from "../../types";
import { w } from "../format";

const STATUS_TEXT: Record<string, string> = {
  applied: "Using this today.",
  kept: "Kept your plan.",
  saved: "Saved to your split.",
};

function ProposalCard({ msg, unit }: { msg: ChatMessage; unit: WeightUnit }) {
  const p = msg.proposal!;
  // Once today's workout is logged (and nothing is in progress) it can't be replaced.
  const doneToday = useApp((s) => !s.active && !!sessionOn(s.today, s.logs)?.finishedAt);
  return (
    <div class={`proposal is-${p.status}`} role="group" aria-label={p.title ? `Proposed workout: ${p.title}` : "Proposed workout"}>
      <p class="eyebrow">For today only</p>
      {p.title && <h3 class="proposal-title">{p.title}</h3>}
      <ol class="proposal-list">
        {p.exercises.map((e, i) => (
          <li key={i}>
            <span class="proposal-name">{e.name}</span>
            <span class="proposal-sets num">
              {e.sets} × {formatReps(e.reps)}
              {e.weightKg != null ? ` @ ${w(e.weightKg, unit)}` : ""}
            </span>
          </li>
        ))}
      </ol>
      {p.reason && <p class="proposal-reason">{p.reason}</p>}
      {p.status === "pending" && doneToday && (
        <>
          <p class="proposal-status">Today's workout is already logged.</p>
          <div class="row-actions">
            <button type="button" class="btn btn--secondary" onClick={() => actions.keepPlan(msg.id)}>
              Keep my plan
            </button>
            <button type="button" class="btn btn--primary btn--grow" onClick={() => actions.saveProposalToSplit(msg.id)}>
              Save to my split
            </button>
          </div>
        </>
      )}
      {p.status === "pending" && !doneToday && (
        <div class="row-actions">
          <button type="button" class="btn btn--secondary" onClick={() => actions.keepPlan(msg.id)}>
            Keep my plan
          </button>
          <button type="button" class="btn btn--primary btn--grow" onClick={() => actions.applyProposal(msg.id)}>
            Use for today
          </button>
        </div>
      )}
      {p.status !== "pending" && <p class="proposal-status">{STATUS_TEXT[p.status]}</p>}
      {p.status === "applied" && (
        <button type="button" class="btn btn--secondary btn--block" onClick={() => actions.saveProposalToSplit(msg.id)}>
          Save to my split
        </button>
      )}
    </div>
  );
}

function Bubble({ msg, unit }: { msg: ChatMessage; unit: WeightUnit }) {
  return (
    <li class={`msg msg--${msg.role}${msg.error ? " msg--error" : ""}`}>
      <span class="sr">{msg.role === "user" ? "You:" : "Coach:"}</span>
      {msg.text && <p class="msg-text">{msg.text}</p>}
      {msg.error && msg.code && <p class="msg-code">Code: {msg.code}</p>}
      {msg.proposal && <ProposalCard msg={msg} unit={unit} />}
    </li>
  );
}

export function CoachScreen() {
  const chat = useApp((s) => s.chat);
  const busy = useApp((s) => s.chatBusy);
  const caps = useApp((s) => s.caps);
  const coachError = useApp((s) => s.coachError);
  const unit = useApp((s) => s.profile?.units ?? "lb");
  const name = useApp((s) => s.profile?.name ?? "");
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const noKey = coachError?.code === "no_ai_key";
  const off = caps.ai === "none";
  const unavailable = off || noKey;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [chat.length, busy]);

  const send = (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy || off) return;
    setText("");
    void actions.sendCoach(t, "chat");
  };

  return (
    <section class="screen coach" aria-labelledby="coach-title">
      <header class="screen-head">
        <p class="eyebrow">Today's chat</p>
        <h1 id="coach-title" class="display">
          Coach
        </h1>
      </header>

      {unavailable && (
        <div class="card card--note" role="status">
          <h2 class="card-title">The coach is off</h2>
          {noKey || caps.inFlinsh ? (
            <p>Add your Anthropic key in Flinsh Settings to turn on the coach</p>
          ) : (
            <p>Add an Anthropic API key in Me → Settings</p>
          )}
          <p class="muted">Everything else in Split works without it.</p>
          {!caps.inFlinsh && !noKey && (
            <button type="button" class="btn btn--secondary" onClick={() => actions.setTab("me")}>
              Open Me
            </button>
          )}
        </div>
      )}

      {!off && (
        <>
          {chat.length === 0 && !busy && (
            <p class="lead">
              {name ? `Hi ${name}. ` : ""}Ask for a shorter workout, a swap when the rack is taken, or a rough calorie estimate. Plans it suggests are for today only until you save them.
            </p>
          )}
          <div class="quick" role="group" aria-label="Quick prompts">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                type="button"
                class="quick-chip"
                aria-disabled={busy ? "true" : undefined}
                onClick={() => !busy && void actions.sendCoach(q.text, q.mode)}
              >
                {q.label}
              </button>
            ))}
          </div>

          {chat.length > 0 && (
            <ol class="chat" aria-label="Conversation">
              {chat.map((m) => (
                <Bubble key={m.id} msg={m} unit={unit} />
              ))}
            </ol>
          )}
          {busy && (
            <p class="msg msg--assistant msg--busy" role="status">
              <span class="dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>Thinking…</span>
            </p>
          )}
          <div ref={endRef} />

          <form class="composer" onSubmit={send}>
            <input
              class="input"
              type="text"
              aria-label="Message the coach"
              placeholder="Message the coach"
              enterKeyHint="send"
              maxLength={600}
              value={text}
              onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
            />
            <button type="submit" class="btn btn--primary" aria-disabled={busy || !text.trim() ? "true" : undefined}>
              Send
            </button>
          </form>
          {chat.length > 0 && !busy && (
            <button type="button" class="link-btn link-btn--muted" onClick={() => actions.clearChat()}>
              Clear today's chat
            </button>
          )}
        </>
      )}
    </section>
  );
}
