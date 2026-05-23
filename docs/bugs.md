# Bugs

Bug tracking for V1 and V2. Each entry describes the defect, its root cause, and enough context to implement a fix without needing to rediscover the problem.

---

## Table of Contents

### V1
- [Weekly startup slowdown from retrieval refresh after stale article index scrape](#v1-startup-slowdown)

### V2
- [Orphan session rows left behind when a run fails after session insert](#v2-orphan-sessions)

---

## V1

<a name="v1-startup-slowdown"></a>
### Weekly startup slowdown from retrieval refresh after stale article index scrape

**Symptom**
If the Keith Baker index scrape is at least 7 days old, V1 startup can trigger a retrieval refresh even when the scrape finds no article changes. This is not a reingest, but it can still make startup take minutes on large corpora.

**Root cause**
V1 treats scheduled discovery as sufficient to invalidate retrieval. Refresh is triggered from inventory change markers rather than from actual corpus mutations.

**Fix guidance**
- Do not let scheduled discovery alone trigger retrieval refresh.
- Key retrieval refresh off actual corpus changes only.
- Keep scrape bookkeeping separate from article content revision state.
- Log explicit refresh reasons such as `content-changed` or `no-op`.

---

## V2

<a name="v2-orphan-sessions"></a>
### Orphan session rows left behind when a run fails after session insert

**Symptom**
Sessions submitted without a `sessionId` (i.e. from a temporary client session on first submit) can leave behind persisted session rows with empty titles and no runs. These orphan rows appear in the session list.

**Affected code**
`src/server/v2/services/run-coordinator.ts` — `startRun` / `insertNewSession`

**Root cause**
`insertNewSession` is called outside the main run transaction, immediately after the pre-flight checks:

```
assertRunNotBlocked        // failure here → no session created ✓
retrieval.prepare          // failure here → no session created ✓
insertNewSession           // session row committed unconditionally
  ↓
[transaction begins]
  model call, DB writes    // failure here → run rolled back, session row stays ✗
```

Because the session insert is committed before the transaction opens, any failure after that point (model error, DB write failure) leaves an empty session row that is never cleaned up and never promoted on the client.

**Fix**
Move `insertNewSession` inside the main transaction so the session row rolls back with the run on failure. The session-validate step (mode check, existence check) currently sits before the transaction but can move inside it as the first operation — it is safe to run inside a transaction and the check still needs to precede the expensive model call.

**Constraints**
- The `sessionId` resolution (`normalized.sessionId ?? insertNewSession(...)`) must remain before the session-validate query, since that query uses the resolved ID.
- Both the validate query and `insertNewSession` can be the first operations in the transaction with no ordering conflict.
- For pre-existing sessions passed via `sessionId`, nothing changes; `insertNewSession` is only called when `sessionId` is absent.
