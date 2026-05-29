Do not read this file unless specifically requested to.

# Social Combat

Add a feature like the NPC generator, but provide social stat blocks as well.

## Social stats

| **Combat** | **Social**  |
|------------|-------------|
| AC         | Resolve DC  |
| HP         | Composure   |
| Damage     | Pressure    |
| Attack     | Skill check |
| Actions    | NPC moves   |
| Weakness   | Lever       |
| Resistance | Armor       |
| Defeat     | Concession  |

- If reduced to half Composure, the NPC can offer a compromise.
- If reduced to 0 Composure, the NPC’s current position breaks.
- If the PCs offer a reasonable compromise first, roll Deal instead of Press.

## Social combat actions

These are "standard" actions. Players can absolutely use their RAW actions as well, to replace or enhance these. NPCs
can specialized variants of these, if appropriate.

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

# Reclaim left pane

- Discard the left pane.
- The console is now a collapsible left-sidebar, which auto expands during refresh or reingest.
- Input will now work like in normal ai chatbots: an input area at the bottom of the feed.
    - Figure out how to integrate all current controls into it
- As part of this, there will be only one chat component. Assistant tab maximizes this component, but all components
  render it.

# NPC <-> Assistant integration

- An assistant session can, on demand, be used for NPC generation.
    - Easiest by providing a mechanism to feed the assistant conversation, or perhaps a compact version of it, into an
      NPC session
    - But it'd be cool if the npc was still linked to the actual assistant session
    - would require blurring the line between session kinds
- Also the other direction: an assistant session can see NPC cards
    - Possibly by marking them to be included in the session
    - Or via a tool which lets it search for them.
    - Would require curation tools: marking NPCs as searchable or not, and maybe also NPC deletion.