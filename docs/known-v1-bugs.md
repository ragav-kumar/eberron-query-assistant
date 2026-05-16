# Known V1 Bugs

## Weekly startup slowdown from retrieval refresh after stale article index scrape

### Issue
If the Keith Baker index scrape is at least 7 days old, V1 startup can trigger retrieval refresh even when the scrape finds no article changes. This is not a reingest, but it can still make startup take minutes on large corpora.

### Reason
V1 treats scheduled discovery as enough to invalidate retrieval. Retrieval refresh is triggered from inventory change markers instead of actual corpus mutations.

### Suggestions For V2
- Do not let scheduled discovery alone trigger retrieval refresh.
- Key retrieval refresh off actual corpus changes only.
- Keep scrape bookkeeping separate from article content revision state.
- Log explicit refresh reasons such as `content-changed` or `no-op`.
