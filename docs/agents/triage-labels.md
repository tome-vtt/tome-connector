# Triage Labels

The skills speak in terms of five canonical triage roles. Spider tracks workflow with ticket states, so in this repo each role maps to a Spider **state**, not a label.

| Role in mattpocock/skills | Spider state  | Meaning                                  |
| ------------------------- | ------------- | ---------------------------------------- |
| `needs-triage`            | `Unsorted`    | Bart needs to evaluate this ticket       |
| `needs-info`              | `Stuck`       | Waiting on a person for more information |
| `ready-for-agent`         | `Backlog`     | Fully specified; Bart promotes it        |
| `ready-for-human`         | `Stuck`       | Requires human implementation            |
| `wontfix`                 | `Wont-Do`     | Will not be actioned                     |

When a skill says to apply a role, move the ticket to the matching state with `transition`. Do not add a label of that name. `needs-info` and `ready-for-human` share `Stuck`; say which one applies in a comment.
