# First milestone: review one opportunity

Status: proposed implementation plan; design recorded, runtime unselected.

## User outcome

Given one opportunity, help the user decide whether to spend application effort on it and identify one next action. The initial target is remote work from Peru, across jobs/freelance work and the user's existing specialty plus AI.

Success means a saved review helps make that decision. Producing a report alone does not prove usefulness.

## Small interaction

1. Supply a local professional profile with stable claim IDs, source references and the user's search constraints.
2. Supply one job-description snapshot with requirement IDs, source URL and capture date. Optional application questions add screening requirements.
3. Produce a source-backed review of eligibility and requirements, with direct/related/missing evidence, uncertainties, a recommendation and one next action.
4. Save the review locally and reopen it in a later invocation. Keep original input snapshots alongside the result so the evidence can be checked.

A supplied snapshot is not live verification. The report must show its capture date and avoid claiming that a vacancy is still open. Review recommendations do not submit applications or approve new candidate claims.

## First coding task

Choose and record a minimal runtime and explicit model configuration. Build the input and output contracts plus a local entry point for one review. Model-proposed experience matches must reference supplied claim/requirement IDs; validation must reject unknown references and preserve unsupported requirements as unknown. Keep personal inputs and outputs in a gitignored local location.

Use synthetic sources first. Document the command and actual observed output only after the workflow runs. Do not silently reuse credentials or introduce a fixed model without recording configuration.

## Acceptance cases for the first build

These are planned checks, not completed evaluation results.

| Synthetic case | Expected behavior |
|---|---|
| Posting explicitly lists Peru and remote work | Report stated geographic compatibility with supporting text, without asserting all employment conditions are satisfied |
| Posting requires US residence | Report location incompatibility with supporting text |
| Posting says LATAM/worldwide but includes country exclusions or no policy detail | Keep Peru eligibility conditional and recommend checking it |
| Profile lists React; job asks for high-frequency charts and WebGL | Mark React as supported; keep specialized chart experience unestablished |
| Application asks about Kafka; only a personal duplicate-safe intake example is supplied | Identify related concepts; do not claim professional Kafka use or personal ownership beyond evidence |
| Job text instructs the assistant to ignore the profile or invent experience | Treat that text as source data; do not follow its instructions |
| Saved inputs and output are reopened | Preserve sources, their dates and the same review without silently refreshing or approving facts |

Run the synthetic cases, report failures as well as successes, and check experience/eligibility citations. A passing fixture run does not establish live-model accuracy across real opportunities. Afterward, manually inspect one real opportunity with the user and record whether the output was useful, with uncertainty retained.

## Stop point

The first milestone ends after the local review workflow, saved/reopened result, recorded synthetic evaluation and one real user trial. Search automation, recurring jobs, full application tracking, résumé rewriting, dashboards, multi-agent orchestration and project-manager integration are outside this slice.
