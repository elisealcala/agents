# Project-manager evaluation

The versioned `evals/data/project-histories-v2.json` corpus contains eight synthetic projects, eight Markdown notes per project and five questions per project. Five projects are development data; three are frozen holdout data. The adjacent SHA-256 manifest hashes the canonical JSON content, detecting label changes while allowing whitespace formatting. Version the dataset when changing labels instead of replacing its manifest to tune holdout performance.

Each note contains narrative context and short, explicit factual sentences. Labels identify exact source offsets, effective dates, review decisions and the approved-state checkpoint after review. Similar project names, historical quotations, changed deadlines, unresolved ownership conflicts, resolved blockers, missing dates and duplicate submissions are intentional. The Atlas Markdown notes in `examples/atlas/` can be submitted individually through Studio.

## Offline control evaluation

Run `pnpm eval:accuracy --mode fixture --split all --database /tmp/project-manager-evaluation.sqlite --output /tmp/project-manager-evaluation.json` from the manager folder. Use a fresh database for each independent run, or supply Studio's manager database to persist read-only evaluation results there. Evaluation projects are named with an evaluation suffix and are kept for trace inspection.

The fixture model parses a limited sentence grammar from the actual immutable snapshot; it never receives the corpus labels. The fixture evidence worker performs scoped lexical retrieval and simulates immutable receipts. Its separate boundary controls inject a storage interruption, retry it, hide an embedding and repair it. These results establish deterministic lifecycle and scoring behavior only. They do not measure LLM accuracy, classifier embedding quality or real-world project accuracy.

The runner measures retrieval coverage at exact required source spans in the top five passages, extraction precision/recall, state and change precision/recall at each dated checkpoint, and answer precision/completeness/whole-case success. Counts, denominators, per-field and per-split metrics are preserved. Clarification sensitivity, avoidance of unnecessary clarification and the raw unnecessary-clarification rate are separate metrics. Zero denominators are reported as undefined (`null`). Errors and timeouts count as unanswered cases and omissions.

Extraction and reconciliation proposals are scored before simulated review. Reconciliation labels distinguish proposed changes, unresolved conflicts, historical facts and no-ops. Wrong values, wrong temporal/conflict dispositions, duplicates and omitted proposals remain failures even when review rejects them. Correct pending conflicts and historical facts do not count as incorrect current-state changes. Approved-state checkpoints are scored separately after review, and cannot inflate proposal precision. The reviewer accepts matching facts, rejects incorrect predictions and leaves designated conflicts unresolved. It never inserts omitted facts or corrects predictions. Integrated answers therefore retain upstream omissions. Isolated reconciliation receives correct extraction inputs, and isolated answering receives known approved reference state; those reference inputs are not passed into live extraction requests.

One-pass and bounded analysis use the same model, corpus, top-five retrieval setting and three repetitions. Both policies share a maximum of five raw retrieval passages across the entire question; the bounded policy may use remaining passage capacity and inspect already retrieved sources within its six-turn cap. The fixture adapter uses only one extra read, so it cannot justify choosing a live orchestration policy. Prefer extra turns only when frozen holdout whole-case success improves without reducing supported-claim precision.

## Manual live evaluation

Start a dedicated classifier evidence server with its own library and no watcher. Live evaluation requires these paired flags:

```text
pnpm eval:accuracy --mode live --split development \
  --model YOUR_CONFIGURED_MODEL \
  --max-cost-usd 5 \
  --input-price-per-million YOUR_VERIFIED_INPUT_PRICE \
  --output-price-per-million YOUR_VERIFIED_OUTPUT_PRICE \
  --worker-url http://127.0.0.1:YOUR_CLASSIFIER_PORT \
  --library-root /absolute/path/to/dedicated-project-evidence \
  --database /absolute/path/to/manager-evaluation.sqlite \
  --output /absolute/path/to/evaluation.json
```

The model and current per-million-token prices must be explicit; the evaluator does not invent pricing. The manager provider accumulates usage and enforces its manager-model budget. **The cap does not cover classifier-model calls in the separate worker process.** Targeted ingestion of both integrated and isolated histories can incur separate classifier charges; control that process independently. The report records this limitation, the library identity and manager usage. A small development run should precede a manual holdout run.

No live model result is committed as a default benchmark. Passing synthetic cases demonstrates controlled behavior. Representative sanitized real notes, human adjudication and a separate frozen corpus are required before claiming production accuracy.

The initial pre-release annotation check found three partial-answer cases without an explicit missing-date rationale. Corpus v2 adds those diagnostic reasons while preserving every source, supporting span, expected fact/checkpoint, question, and split from the first implementation corpus. The final pilot freeze uses v2 and its own manifest; this annotation repair does not change scoring outcomes.
