# Career assistant

A personal agent for deciding which job and freelance opportunities are worth pursuing, using evidence from your experience and the opportunity's actual requirements.

**Status: design scaffold. No runtime or working evaluator yet.**

The initial search context is remote work from Peru, spanning the user's existing software-engineering specialty and AI-focused work. The first milestone reviews a supplied opportunity; automated discovery comes later if the reviews prove useful.

## First milestone: review one opportunity

Supply:

- A professional profile containing individual experience claims and their sources.
- One saved job description with its source URL and capture date.
- Any application questions that expose requirements missing from the description.

Receive a review explaining:

| Part | Result |
|---|---|
| Location | Explicitly permits Peru, explicitly excludes Peru, or needs confirmation, with supporting text |
| Requirements | Direct evidence, related evidence, or no evidence in the supplied profile |
| Screening questions | Which questions have a supported example and which need clarification |
| Suggested action | Pursue, clarify first, or deprioritize, with reasons |
| Next step | One concrete action the user can choose |

The review must distinguish an undocumented skill from a skill the candidate says they do not have. A repository containing code is not proof of personal authorship, production use or scale.

## Proposed example, not recorded output

**Synthetic input**

```text
Profile claim P1: Built React and TypeScript interfaces for a production product.
Profile claim P2: Integrated AI tools through MCP.

Job requirement J1: React and TypeScript experience.
Job requirement J2: High-frequency telemetry dashboards using virtualization.
Location text J3: Remote within LATAM; some countries may be unsupported.
```

**Expected review criteria**

```text
J1: Direct evidence from P1.
J2: Not established by the supplied profile; ask for a concrete example.
Location: Clarification required; LATAM is not a confirmed Peru hiring policy.
Suggested action: Clarify country eligibility and the dashboard requirement first.
```

This is a design example. It is not output from an implemented agent or a completed evaluation.

## Definition of done for the first build

Run the reviewer locally on a small synthetic evaluation set, then on one user-selected opportunity with a locally supplied profile. Save the review so it can be reopened. Each experience and eligibility conclusion must point to its source; uncertainties must remain visible. The result should help the user decide one next action.

Setup commands, model choice, pricing, evaluation results and a runnable demo will be documented when implemented. No runtime has been selected or dependencies installed.

## Later possibilities

- Discover and recheck live listings from employer sources.
- Compare a small shortlist.
- Draft supported application answers for user review.
- Track chosen application tasks through the existing project manager.

The first build does not depend on the project-manager service. Its current offline state does not have to block this experiment. No application submission, employer communication or recurring search is included in the initial design.

## Development

The first milestone is defined in [the implementation plan](memory-bank/plans/0000-first-slice.md). Development decisions and progress belong in [this agent's memory bank](memory-bank/PROTOCOL.md). Keep personal profiles and employer-source snapshots outside committed fixtures; use synthetic examples in the repository.
