Do not read this file unless specifically requested to.

# Social Combat
Add a feature like the NPC generator, but provide social stat blocks as well.

## Social stats
| **Combat** | **Social**  |
|------------|-------------|
| AC         | Resolve DC  |
| HP         |  Composure  |
| Damage     |  Pressure   |
| Attack     | Skill check |
| Actions    |  NPC moves  |
| Weakness   |    Lever    |
| Resistance |    Armor    |
| Defeat     | Concession  |

- If reduced to half Composure, the NPC can offer a compromise.
- If reduced to 0 Composure, the NPC’s current position breaks.
- If the PCs offer a reasonable compromise first, roll Deal instead of Press.

## Social combat actions
These are "standard" actions. Players can absolutely use their RAW actions as well, to replace or enhance these. NPCs can specialized variants of these, if appropriate.

### Press
- Push against the NPC’s current position.
- Roll a relevant skill vs Resolve DC.
- Success: deal Pressure.
- Failure: NPC uses a move.

### Read
- Learn how to approach the NPC.
- Roll Insight, Investigation, History, Religion, etc.
- Success: reveal a Lever, Armor, hidden motive, or likely move.
- Failure: partial info, or NPC notices the probing.

### Leverage
- Create an advantage for later.
- Roll a relevant skill/tool/spell use.
- Success: create a leverage tag, such as “crowd is listening,” “proof established,” or “technical plan is credible.”
- Spend later for advantage or extra Pressure.

### Deal
- Offer terms instead of trying to break their position.
- Roll vs Resolve DC, usually with modifiers based on whether the offer respects their Lever/Armor.
- Success: take the Compromise outcome now.
- Failure: NPC worsens the terms or uses a move.

# Settings modal
- Add a settings modal to allow configuring items from the Settings DB table.
- Move "Additional Context" into this modal as a resizable textarea.

## API (implemented)
- `GET /api/v2/settings` returns `SettingDto[]`. Each entry is a discriminated union keyed on `settingType` (`'string' | 'password' | 'number' | 'boolean' | 'textarea' | 'array'`) and carries metadata (label, section, description, constraints such as min/max) alongside the current value.
- `PUT /api/v2/settings/:key` accepts and returns a single `SettingDto`. The setting key is a path parameter; the body carries the full DTO including the updated value. One setting at a time — save on blur means multiple simultaneous updates are not needed.
- Every write always logs a console entry regardless of `consolePersist`: `Setting "<key>" changed from <old> to <new>`. This is the recovery path for accidental misconfiguration.

## Disclaimer
The agent made several bad architectural decisions when describing the client side. Review carefully with the user.

## Trigger
- Add an icon-only gear button (`variant='secondary'`) to `LeftColumnHeader`'s `.actions` div.
- The button owns `showSettings: boolean` state and renders `<SettingsModal show={showSettings} onClose={...} />`.

## Settings modal component (`src/client/components/Settings/`)
All files in this folder share one `SettingsModal.module.css`.

- **`SettingsModal`** — loads `SettingDto[]` via `useSettingsQuery` on open. Groups entries by `section` and renders a `SettingsSection` heading per group. Delegates each entry to `SettingField`. Has only a close (×) button — no Save button.
- **`SettingField`** — switches on `settingType` and renders the correct input component. This is the only place `settingType` is inspected; the modal body is otherwise generic.
- **`SettingsSection`** — minimal wrapper: `<section>` with a `<h2>` heading.

### Input components
Each takes `value`, `onChange`, `onBlur`, `label`, optional `description`, optional `error`.

| Component | Renders |
|---|---|
| `StringInput` | `<input type="text">` with optional placeholder |
| `PasswordInput` | `<input type="password">` with show/hide toggle |
| `NumberInput` | `<input type="number">` with min/max from DTO; inline error |
| `BooleanInput` | `<input type="checkbox">` with label to the right |
| `TextareaInput` | `<textarea style="resize: vertical">` |
| `ArrayInput` | `<textarea>`, one entry per line, serializes to `string[]` |
| `UrlInput` | `<input type="url">` with URL format validation |
| `PathInput` | `<input type="text">` with filesystem path validation |

### Save on blur — no Save button
- Each field's `onBlur` calls `useSettingsMutation` with the full updated `SettingDto` if the value changed since the last server-confirmed state.
- Validation errors (from DTO constraints, e.g. min/max) block the save.
- Modal state tracks `serverValues` (last confirmed) and `localValues` (in-form). On blur: if `localValues[key] !== serverValues[key]` and valid, fire the mutation and update `serverValues` on success.

## LeftColumnTabs cleanup
Once the modal is live, remove the "Additional Context" tab from `LeftColumnTabs`. With only "Input" remaining, remove the `Tabs` wrapper and render `<Input />` directly. Remove the `useState` for `currentTabKey` and the `AdditionalContextInput` import.

## Cleanup
Once the modal is live:
- Remove `src/client/components/AdditionalContextInput.tsx` (and its stylesheet if one exists)
- Remove `src/client/api/hooks/additionalContext.ts`
- Remove `src/server/api/routes/additional-context.ts`
- Remove the `additionalContext` contract entries from `src/contract/contracts.ts`

# Reclaim left pane
- Discard the left pane.
- The console is now a collapsible left-sidebar, which auto expands during refresh or reingest.
- Input will now work like in normal ai chatbots: an input area at the bottom of the feed.
  - Figure out how to integrate all current controls into it
- As part of this, there will be only one chat component. Assistant tab maximizes this component, but all components render it.

# NPC <-> Assistant integration
- An assistant session can, on demand, be used for NPC generation.
  - Easiest by providing a mechanism to feed the assistant conversation, or perhaps a compact version of it, into an NPC session
  - But it'd be cool if the npc was still linked to the actual assistant session
  - would require blurring the line between session kinds
- Also the other direction: an assistant session can see NPC cards
  - Possibly by marking them to be included in the session
  - Or via a tool which lets it search for them.
  - Would require curation tools: marking NPCs as searchable or not, and maybe also NPC deletion.