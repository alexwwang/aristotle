# Requirements Document: Enhanced Review Phase UX

## Problem Statement

When Aristotle completes a reflection cycle and presents rules for review, the user is asked to accept or reject rules they cannot see. The current notification shows rule categories and one-line summaries but hides the rule body, confidence scores, risk levels, and conflict information. This forces reflexive confirmation or tedious manual investigation — a punitive user experience that undermines trust in the system.

## User Stories

| # | Priority | User Story |
|---|----------|-----------|
| US-1 | Core | As a developer, I want to inspect a specific rule's full content on demand, so that I can judge whether the prevention rule is correct before accepting it. |
| US-2 | Core | As a developer, I want to see the confidence score and risk level for each rule in the review listing, so that I can prioritize my attention and decide how carefully to review each rule. |
| US-3 | Core | As a developer, I want to see per-rule conflict warnings when a proposed rule contradicts an existing verified rule, so that I don't accidentally introduce contradictory knowledge. |
| US-4 | Core | As a developer, I want to see the Δ value and audit level in the review header, so that I know whether the system considers these rules uncertain or this is routine. |
| US-5 | Core | As a developer, I want the DRAFT report presented as a scannable summary (not a 2000-char truncation), so that I can quickly grasp the key findings without scrolling through raw analysis. |
| US-6 | Core | As a developer, I want to see the full DRAFT report on demand, so that I can read the complete analysis when the summary is insufficient. |
| US-7 | Secondary | As a developer, I want to see which rules are already auto-committed vs which need my action, so that I can focus only on what I control. |

## Data Flow Requirements

The review display requires data that is not currently passed to the formatter. The following data must be computed and/or retrieved before formatting:

| Data | Source | When Computed | Storage |
|------|--------|--------------|---------|
| Per-rule confidence, risk_level | Rule frontmatter | At review display time | Read from disk via `list_rules` metadata |
| Per-rule conflicts_with | Rule frontmatter (`conflicts_with` field) | At review display time | Read from disk via `list_rules` metadata |
| Per-rule Δ and audit_level | `get_audit_decision()` | At review display time | Computed on-the-fly (file-read, no LLM) |
| DRAFT summary | DRAFT file content | At review display time | Parse DRAFT file |
| Rule body content | Rule file on disk | On `inspect N` action | Read from disk |

**Note**: `list_rules()` already returns `metadata` dict containing `confidence`, `risk_level`, and `conflicts_with` from frontmatter. The formatter currently only reads `error_summary`, `category`, and `status`. The data exists; the formatter needs to use it.

## Acceptance Criteria

| # | User Story | Priority | Acceptance Criterion | Edge Cases |
|---|-----------|----------|---------------------|------------|
| AC-1 | US-1 | Core | Given a review with rule #2 on display, When user responds with `inspect 2`, Then the system returns the full rule body (Context/Rule/Why/Example sections). The index N refers to numbered staging rules only (per AC-7, verified rules are unnumbered). | Invalid index (0, -1, >S where S = staging rule count) → returns "Invalid rule index" error; rule file deleted → returns "Rule file not found"; rule body empty → returns "(empty rule body)" |
| AC-2 | US-2 | Core | Given a staging rule with metadata confidence=0.55 and risk_level=HIGH, When the rule is listed in the review notification, Then the output line includes the string "conf 0.55" and the string "HIGH" (or a risk indicator that maps 1:1 to HIGH/MEDIUM/LOW). If confidence is missing from frontmatter, display the default value 0.7. If risk_level is missing, omit the indicator. If confidence is present but non-numeric (e.g., "high"), treat as missing and display default 0.7. | confidence is 0.0 or 1.0; risk_level is missing; both confidence and risk_level are missing; confidence is non-numeric → treat as missing, show 0.7 |
| AC-3 | US-3 | Core | Given a staging rule with frontmatter `conflicts_with=["rule_a3x7k", "rule_b2m9p"]`, When the rule is listed, Then the output includes a line below the rule summary showing "Conflicts with: rule_a3x7k, rule_b2m9p". If more than 3 conflicting IDs, show first 3 + "+N more". | conflicts_with is empty → no conflict line shown; conflicts_with references deleted rules → IDs shown as-is (user can investigate); conflicts_with is not a valid list/array → skip conflict line |
| AC-4 | US-4 | Core | Given a review with 2 staging rules where `get_audit_decision()` returns Δ=0.55 and Δ=0.35, When the notification header is displayed, Then it shows "Δ 0.35" (the minimum) and one of these exact labels: "automatic" (for auto), "review suggested" (for semi), or "manual review required" (for manual). If no staging rules exist, omit the Δ line entirely. | All rules auto-committed (no staging) → omit Δ line; `get_audit_decision()` raises exception → omit Δ line gracefully; single staging rule |
| AC-5 | US-5 | Core | Given a DRAFT report with a `## Key Findings` section containing 3 markdown list items (lines starting with `- `), where each item follows the format `- [error_summary]: [proposed_rule_summary]` (error→rule pairing), When the review notification is displayed, Then the DRAFT section shows those list items followed by the line: "(N chars — use 'show draft' for full report)" where N is the total character count of the full DRAFT content. If no `## Key Findings` section exists, show the first 3 non-empty lines of the DRAFT. | DRAFT is empty → show "DRAFT report is empty"; DRAFT has no Key Findings section → fallback to first 3 lines; DRAFT has only 1 finding → show that 1 finding |
| AC-6 | US-6 | Core | Given a review with a DRAFT report, When user responds with `show draft`, Then the system returns the full DRAFT content. | DRAFT file deleted → returns "DRAFT file not found"; DRAFT file is empty → returns "(empty DRAFT)" |
| AC-7 | US-7 | Secondary | Given a review with 2 staging rules (status=staging) and 1 verified rule (status=verified), When the notification is displayed, Then staging rules appear in a numbered "Rules for Review" section and verified rules appear in a separate "Auto-committed" section as unnumbered single-line entries. | 0 staging rules → show "No rules require review" + auto-committed section; 0 verified rules → omit auto-committed section; all rules are staging → omit auto-committed section |

## Constraints & Assumptions

- **Risk indicator mapping**: ⚠ = HIGH, ● = MEDIUM, ○ = LOW. Unicode symbols may not render on minimal terminals; this is an accepted limitation. Tests may assert against the text labels (HIGH/MEDIUM/LOW) as a fallback.
- **Backward compatibility**: Existing actions (confirm/reject/revise/re-reflect) must continue to work unchanged
- **New actions are additions**: `inspect N` and `show draft` are appended to the action list, not reorderings
- **Rule count display limit**: Currently hard-coded to 10 rules in `_format_review_output` line 56 (`rules[:10]`). The new design should show all returned rules (up to `list_rules` limit of 20).
- **Performance**: `get_audit_decision` is a file-read operation (no LLM), acceptable to call per-rule
- **Fallback**: If audit_decisions or rule metadata is unavailable, the formatter must degrade gracefully (show what's available, skip what's not)
- **No new MCP tool functions**: `inspect` and `show draft` are new action strings handled within the existing `orchestrate_review_action` function, not new MCP endpoints
- **No changes to confirm/reject/re_reflect/revise logic**: Only presentation layer and two new actions
- **DRAFT format coupling**: AC-5 depends on the R sub-agent producing a `## Key Findings` section. The REFLECTOR.md prompt template should be updated in Phase 2 to guarantee this heading. The fallback (first 3 lines) handles legacy DRAFTs without this section.
- **Default confidence**: If a rule's frontmatter lacks `confidence`, display the system default (0.7). This matches the `write_rule` default in `_tools_rules.py`.

## Open Questions (All Resolved)

- ~~Should rule bodies be shown inline or only via inspect?~~ → **Resolved**: On-demand via `inspect N`. Inline dump would overwhelm for 3+ rules. Progressive disclosure.
- ~~Should DRAFT summary be extracted by R or by the formatter?~~ → **Resolved**: By the formatter (no LLM cost). Parse for `## Key Findings` section, fallback to first 3 lines.
- ~~How to visualize Δ?~~ → **Resolved**: Single line in header: `Δ 0.35 → manual review required`. No charts needed.
- ~~Per-rule conflict display or header-level summary?~~ → **Resolved**: Per-rule inline on the rule card. Conflicts are specific to a rule, not a global property.
