# BookingDSL Assistant — v4

An LLM-assisted prototype for generating Domain-Specific Modelling Languages (DSMLs) from natural-language domain descriptions. Built as the case study for the bachelor thesis *"A Large Language Model-Assisted Approach for Creating Domain-Specific Modelling Languages"* at Riga Technical University.

## What this prototype demonstrates

Seven design decisions in this prototype directly correspond to defensible thesis claims:

| Prototype feature | Thesis claim it supports |
|---|---|
| Seven-phase workflow | The workflow structure is the original contribution |
| Structured prompt segments with visible chaining | Phases are chained, not independent — verifiable in the UI |
| Per-phase explanation panels | The output is interpretable to non-metamodelers |
| Editable outputs before continuing | Human-in-the-loop workflow, not full automation |
| Regenerate button | The workflow accommodates LLM non-determinism |
| Example descriptions including keyword-only | Robustness to sparse input (a Chapter 4 finding) |
| Traceability table as the final artifact | Completeness and consistency are verifiable |

## The seven phases

1. **Concept extraction** — Identifies domain entities, actors, and value types
2. **Relationship modelling** — Maps associations, compositions, and generalisations
3. **Metamodel structure** — Produces formal metaclasses with attributes and references
4. **Textual syntax (EBNF)** — Generates EBNF grammar for textual concrete syntax
5. **Conforming example models** — Creates valid model instances in the DSL syntax
6. **Validation constraints (OCL)** — Defines OCL invariants and business rules
7. **Traceability table** — Maps every concept through all six previous phases

Each phase's prompt is constructed from typed segments (`instruction`, `domain`, `injected`). The `injected` segments carry the verbatim output of prior phases. This structure is what makes the seven prompts a **coordinated workflow** rather than seven independent LLM queries — and the UI makes this visible via the "Prompt sent to LLM" tab.

## Architecture

- **Backend**: Express.js server proxying requests to the Anthropic API
- **Frontend**: Plain HTML / CSS / JavaScript (no framework overhead)
- **LLM**: Claude Sonnet 5 (via Anthropic API, credit-based)
- **State**: In-memory only; no database, no authentication

## Setup

### 1. Get an Anthropic API key

- Go to [console.anthropic.com](https://console.anthropic.com)
- Create an account and add API credits
- Generate an API key (starts with `sk-ant-`)

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and paste your API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Install and run

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Using the prototype

1. **Load an example** or type your own domain description
2. Click **Start workflow** — Phase 1 generates
3. For each phase, review the output, then click **Next phase** to generate the next
4. Switch to the **Prompt sent to LLM** tab on any phase to see exactly what was sent — with chained sections from prior phases visually highlighted
5. Use **Edit** to modify a phase's output before it flows into subsequent phases (human-in-the-loop)
6. Use **Regenerate** to re-run a phase (LLM output is non-deterministic; this button acknowledges that)
7. After Phase 7, export individual artifacts or the full workflow

## Files

```
bookingdsl-assistant/
├── server.js           # Express backend, phase definitions, prompt segment builder
├── public/
│   ├── index.html      # Layout, stepper, tabs
│   ├── style.css       # All styling
│   └── app.js          # Phase progression, edit/regenerate, export logic
├── package.json
├── .env.example
└── README.md
```

## Notes for the defense

- **On the "Prompt sent to LLM" tab**: this is the strongest visual evidence that the seven prompts form a chained workflow. Every "injected" (blue) segment is the verbatim output of a prior phase, programmatically inserted — not paraphrased or summarised.
- **On non-determinism**: the Regenerate button acknowledges this openly. Run it twice on Phase 1 during your defense to demonstrate that the LLM produces varying but structurally consistent output.
- **On robustness**: the "Hotel booking (keywords only)" example is included specifically to demonstrate that the workflow tolerates sparse, non-native input — a finding worth calling out in Chapter 4.
- **On backup**: for the defense, run the workflow ahead of time and use the "Download all artifacts" button to save the output. If the API fails live, you can walk through the saved artifacts instead.

## Approximate cost per full run

Around $0.10–0.25 in API credits for all seven phases, using Claude Sonnet 5.
