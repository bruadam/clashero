---
name: hitl
description: Develop tasks with a Human in the Loop
---

# INPUTS

A PRD have been provided to you. Read it to understand the PRD, by looking up the PRD `gh issue view $issueId`

Review the last few commits to understand what work has been done. See the commits by running `git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found"` 

Look up the sub-issues in the PRD.
Decide which sub-issue to work on next.
This should be the one YOU decide has the highest priority – not necessarily the first in the list.

If there are no more sub-issues to complete, output <promise>NO MORE TASKS</promise>.

# EXPLORATION

Explore the repo.

# IMPLEMENTATION

Complete the task.

# FEEDBACK LOOPS

Before committing, run the feedback loops:

- `cargo fmt --check` to check formatting 
- `cargo build` to check the build

# COMMIT

Make a git commit. The commit message must:

1. Include key decisions made
2. Include files changed
3. Blockers or notes for next iteration
4. Follow conventional commit format

# Done
Close the issue.

# FINAL RULES

ONLY WORK ON A SINGLE SUB-ISSUE