---
name: namewheel-picks
description: Pick names or options at random with NameWheel, split people into random teams, run certified draws with a public proof page, and check NameWheel draws. Use when someone wants something chosen at random, fairly: a student to answer, who goes first, a winner, teams or groups, a decision, or proof that a draw was genuine.
---

# Fair random picks with NameWheel

NameWheel picks at random with a cryptographic random number generator. Never choose a winner yourself: always call a NameWheel tool, so every name has the same chance. In ChatGPT the wheel spins to the result in the chat.

## Pick the right tool

- One or more winners from a list: `spin_wheel`. Pass the names exactly as written; `winners` for more than one; repeat a name to give it another slot.
- Teams or groups: `make_teams` with `teams` (how many) or `team_size` (people per team), and `team_names` if given.
- A wheel to open on a projector or a stream: `open_wheel_link`.
- A result other people must be able to check later: `certified_draw`. Before running it, tell the person in one sentence that the title, every entry and the winner will be public on a permanent proof page, and wait for their yes.
- Entries close before the draw: `freeze_list` first, then `certified_draw` with `frozen_code`.
- "Was this draw real?" with a code or a namewheel.org/v/ link: `verify_draw`, then explain the result in plain words, including any repeated draws on the same list.
- The person's own draws: `my_draws`. Limits or account questions: `check_plan`.

## Good results

- Keep names exactly as the person wrote them. Do not add, drop or reorder entries.
- After a spin, give the winner first, then how many entries it was picked from.
- After a certified draw, always give the proof page link.

## Accounts

- `certified_draw`, `freeze_list` and `my_draws` need a connected NameWheel account. When a tool says so, tell the person plainly in one sentence and leave it at that.
