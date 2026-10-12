/**
 * BookingDSL Assistant - Backend
 *
 * Express.js server that orchestrates the seven-phase DSML generation workflow
 * by proxying structured, chained prompts to the Anthropic API.
 *
 * The defining architectural feature is prompt chaining: each phase's prompt
 * is constructed from a set of typed segments (instruction | domain | injected),
 * where 'injected' segments carry the verbatim output of previous phases. This
 * structure is returned to the frontend alongside the LLM output, allowing the
 * UI to visually distinguish authored instruction from chained context.
 */

require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk").default;
const path = require("path");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-5";

/* ═══════════════════════════════════════════════════════════════════════
   PHASE DEFINITIONS
   Each phase declares its name, human-facing explanation, and a function
   that builds the prompt as an array of typed segments.
   ═══════════════════════════════════════════════════════════════════════ */

const PHASES = [
  {
    id: 1,
    name: "Concept extraction",
    dependsOn: [],
    explanation: {
      what: "Reads the domain description and identifies the core concepts (entities, actors, value types) that populate the domain.",
      produces: "A numbered list of domain concepts, each with a classification and a one-sentence definition.",
      howToRead: "Each item is a candidate metaclass for the metamodel. Look for completeness — are the important nouns in your domain captured, including implicit ones a domain expert would recognise?"
    },
    buildSegments: (domain, prev) => [
      { type: "instruction", content:
`You are a domain-specific modelling language (DSML) engineer.

From the following domain description, extract all core concepts. For each provide:
- Name (PascalCase)
- Category: entity (has identity and lifecycle), value (descriptive, no identity), or actor (performs actions)
- One-sentence definition

Include implicit concepts a domain expert would recognise even if not explicitly stated.`
      },
      { type: "domain", label: "Domain description", content: domain },
      { type: "instruction", content:
`Output format — a numbered markdown list, one concept per line:

1. **ConceptName** *(category)* — definition
2. **ConceptName** *(category)* — definition
...

Be thorough but precise. Do not merge distinct concepts.` }
    ]
  },

  {
    id: 2,
    name: "Relationship modelling",
    dependsOn: [1],
    explanation: {
      what: "Takes the extracted concepts and identifies structural relationships — associations, compositions, generalisations, and dependencies.",
      produces: "A markdown table of relationships with source, target, type, multiplicity, and rationale.",
      howToRead: "Each row is a structural link. Composition means the child cannot exist without the parent. Association is an independent link. Multiplicity (1, 0..1, 0..*, 1..*) tells you how many instances connect."
    },
    buildSegments: (domain, prev) => [
      { type: "instruction", content:
`You are a DSML engineer performing relationship modelling.

Identify every meaningful structural relationship among the concepts extracted in Phase 1. Consider the domain description as the source of truth for domain semantics.` },
      { type: "domain", label: "Domain description", content: domain },
      { type: "injected", source: "Phase 1", sourceName: "Concept extraction", content: prev[0] },
      { type: "instruction", content:
`Produce a markdown table with columns:

| Source | Target | Type | Multiplicity | Rationale |

Types: association, composition, generalisation, dependency.
Multiplicity format: "Source [m] — Target [n]" (e.g. Guest [1] — Booking [0..*]).

Rules:
- Every concept from Phase 1 must appear in at least one relationship.
- Prefer composition when the child has no meaning outside the parent.
- Use generalisation for natural type hierarchies (e.g. SingleRoom extends Room).
- Prefer tight multiplicity bounds over "*" when justifiable.` }
    ]
  },

  {
    id: 3,
    name: "Metamodel structure",
    dependsOn: [1, 2],
    explanation: {
      what: "Produces the formal metamodel — the backbone of the DSML — defining metaclasses with attributes, data types, and associations.",
      produces: "A structured specification with enumerations, abstract metaclasses, concrete metaclasses, an associations table, and an inheritance summary.",
      howToRead: "This is the 'class diagram' of your language expressed textually. Each metaclass becomes an element type users can instantiate. Attributes are the properties each element carries."
    },
    buildSegments: (domain, prev) => [
      { type: "instruction", content:
`You are a DSML engineer producing the formal metamodel.

Ground every metaclass in a concept from Phase 1 and every association in a relationship from Phase 2. Do not introduce elements without traceability to a prior phase.` },
      { type: "domain", label: "Domain description", content: domain },
      { type: "injected", source: "Phase 1", sourceName: "Concept extraction", content: prev[0] },
      { type: "injected", source: "Phase 2", sourceName: "Relationship modelling", content: prev[1] },
      { type: "instruction", content:
`Output the metamodel in EXACTLY this structure using markdown:

## 1. Enumerations
- **EnumName** { LITERAL_1, LITERAL_2, ... }

## 2. Abstract metaclasses
For each abstract metaclass:
- **Name**
  - Attributes: \`name : Type [multiplicity]\`
  - Purpose: one sentence

## 3. Concrete metaclasses
For each concrete metaclass:
- **Name** (extends AbstractName, if any)
  - Attributes: \`name : Type [multiplicity]\`
  - References: \`refName : TargetClass [multiplicity] {composition|association}\`

## 4. Associations table
| Association | Source | Target | Multiplicity | Kind |

## 5. Inheritance summary
- Parent → Child1, Child2, ...

Rules:
- Primitive types only: String, Integer, Boolean, Date, DateTime, Float, or defined Enumerations.
- Required attributes: [1]. Optional: [0..1]. Collections: [0..*] or [1..*].
- Every Phase 1 concept must appear as a metaclass or enumeration.
- Every Phase 2 relationship must appear as an association or reference.` }
    ]
  },

  {
    id: 4,
    name: "Textual syntax (EBNF)",
    dependsOn: [3],
    explanation: {
      what: "Defines the textual concrete syntax of the DSML using Extended Backus–Naur Form (EBNF) grammar notation.",
      produces: "A complete EBNF grammar specifying how valid models in this DSML are written as text.",
      howToRead: "Each rule defines how an element is spelled out. Terminals are in quotes ('booking'), non-terminals reference other rules. A parser could use this grammar directly to read model files."
    },
    buildSegments: (domain, prev) => [
      { type: "instruction", content:
`You are a DSML engineer defining the textual concrete syntax.

Produce a complete EBNF grammar that maps one-to-one to the metaclasses from Phase 3. Every concrete metaclass needs a corresponding production rule; every attribute and reference must be representable in the grammar.` },
      { type: "domain", label: "Domain description", content: domain },
      { type: "injected", source: "Phase 3", sourceName: "Metamodel structure", content: prev[2] },
      { type: "instruction", content:
`Grammar conventions:
- Use \`::=\` for production rules
- Terminal keywords in single quotes: 'booking'
- Optional elements in square brackets: [ ... ]
- Repetition in curly braces: { ... }
- Alternatives with pipe: ... | ...
- Grouping with parentheses: ( ... )
- STRING, INTEGER, BOOLEAN, DATE, DATETIME, FLOAT as terminal token types
- ID for identifiers
- \`//\` line comments and \`/* */\` block comments

Rules:
- The top-level rule is \`Model\`, containing all root elements.
- Enum values appear as keyword alternatives.
- The grammar must be unambiguous and parseable.

Wrap the entire grammar in a single fenced code block:

\`\`\`ebnf
Model ::= ...
...
\`\`\`

Output only the fenced grammar. No surrounding prose.` }
    ]
  },

  {
    id: 5,
    name: "Conforming example models",
    dependsOn: [3, 4],
    explanation: {
      what: "Generates concrete example models that conform to the EBNF grammar, proving the grammar works with realistic domain data.",
      produces: "Three example model instances in the DSL's textual syntax, each demonstrating different scenarios.",
      howToRead: "Each example is a valid 'program' in the DSML. It should parse against the grammar from Phase 4. Look for realism — do the examples represent plausible domain situations?"
    },
    buildSegments: (domain, prev) => [
      { type: "instruction", content:
`You are a DSML engineer writing conforming example models.

Every example must strictly conform to the EBNF grammar produced in Phase 4. Use realistic domain data. Together the three examples must exercise every grammar rule at least once.` },
      { type: "domain", label: "Domain description", content: domain },
      { type: "injected", source: "Phase 3", sourceName: "Metamodel structure", content: prev[2] },
      { type: "injected", source: "Phase 4", sourceName: "Textual syntax (EBNF)", content: prev[3] },
      { type: "instruction", content:
`Produce exactly three examples, each wrapped in its own fenced code block, preceded by a short markdown heading:

### 1. Basic scenario
Minimal but complete: demonstrate the core workflow with the smallest realistic model.

\`\`\`
[example 1 here]
\`\`\`

### 2. Rich scenario
Exercise most grammar features: multiple entities, various enum values, optional fields populated, nested structures.

\`\`\`
[example 2 here]
\`\`\`

### 3. Edge-case scenario
Test boundary conditions: cancelled or empty states, maximum values, edge-of-range dates, empty optional fields.

\`\`\`
[example 3 here]
\`\`\`

Each example must parse against the Phase 4 grammar using its exact syntax. Use plausible data (real-sounding names, valid dates, reasonable numbers).` }
    ]
  },

  {
    id: 6,
    name: "Validation constraints (OCL)",
    dependsOn: [3, 5],
    explanation: {
      what: "Defines validation rules in OCL (Object Constraint Language) that enforce domain semantics the grammar alone cannot capture.",
      produces: "A set of OCL invariants, derived values, and pre/post-conditions attached to specific metaclasses.",
      howToRead: "Each constraint is a rule every valid model must satisfy — for example, 'check-out must be after check-in' or 'no room can be double-booked'. These enforce meaning, not just structure."
    },
    buildSegments: (domain, prev) => [
      { type: "instruction", content:
`You are a DSML engineer defining OCL validation constraints.

Every constraint must reference real attributes and associations from the Phase 3 metamodel. Verify mentally that the Phase 5 examples would pass these constraints.` },
      { type: "domain", label: "Domain description", content: domain },
      { type: "injected", source: "Phase 3", sourceName: "Metamodel structure", content: prev[2] },
      { type: "injected", source: "Phase 5", sourceName: "Conforming example models", content: prev[4] },
      { type: "instruction", content:
`Produce at least 8 meaningful constraints, grouped under these markdown headings:

### Invariants (data integrity, business rules, referential integrity)
### Derived values (computed attributes: totals, durations, counts)
### Pre/post-conditions (if applicable to state changes)

Wrap the full set of constraints in a single fenced code block:

\`\`\`ocl
context MetaclassName
  inv constraintName:
    <OCL expression>
...
\`\`\`

Use standard OCL syntax: \`self\`, \`->\`, \`forAll\`, \`exists\`, \`select\`, \`size\`, \`includes\`, \`oclIsKindOf\`, \`->isEmpty()\`, \`->notEmpty()\`.

At least one constraint should be one that a deliberately invalid model would fail — this proves the constraints have teeth.` }
    ]
  },

  {
    id: 7,
    name: "Traceability table",
    dependsOn: [1, 2, 3, 4, 5, 6],
    explanation: {
      what: "The final phase — maps every domain concept through all six previous phases, producing a traceability matrix that proves completeness and consistency.",
      produces: "A markdown table with one row per concept, tracing extraction → relationships → metaclass → grammar rule → example usage → constraint.",
      howToRead: "Each row traces one concept across the workflow. No cell should be empty. If a concept disappears at some phase, that is a gap. This table is the strongest evidence that the workflow produced a complete, coherent DSML."
    },
    buildSegments: (domain, prev) => [
      { type: "instruction", content:
`You are a DSML engineer producing the final traceability artifact.

Map every domain concept from Phase 1 through all six previous phases. This table is the primary evidence of workflow completeness — treat gaps as findings, not failures.` },
      { type: "domain", label: "Domain description", content: domain },
      { type: "injected", source: "Phase 1", sourceName: "Concept extraction", content: prev[0] },
      { type: "injected", source: "Phase 2", sourceName: "Relationship modelling", content: prev[1] },
      { type: "injected", source: "Phase 3", sourceName: "Metamodel structure", content: prev[2] },
      { type: "injected", source: "Phase 4", sourceName: "Textual syntax (EBNF)", content: prev[3] },
      { type: "injected", source: "Phase 5", sourceName: "Conforming example models", content: prev[4] },
      { type: "injected", source: "Phase 6", sourceName: "Validation constraints (OCL)", content: prev[5] },
      { type: "instruction", content:
`Produce a markdown table with these columns:

| # | Concept | P1 Extraction | P2 Relationship | P3 Metaclass | P4 Grammar Rule | P5 Example Usage | P6 Constraint |

Rules:
- One row per concept from Phase 1.
- Every cell must contain a specific reference — a metaclass name, a rule name, an example number and instance, a named constraint.
- If a concept genuinely has no representation at a phase, write "GAP: [brief reason]" — do not use "N/A" without justification.
- Include a final summary row counting coverage per phase (e.g. "12/13 metaclasses, 12/13 grammar rules...").

After the table, add a short paragraph titled **Coverage summary** stating: total concepts, concepts with full coverage, and any gaps identified.` }
    ]
  }
];

/* ═══════════════════════════════════════════════════════════════════════
   API ENDPOINTS
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Generate a phase output.
 * Body: { domain, phase, previousOutputs }
 * Response includes both the LLM output AND the structured prompt segments,
 * enabling the frontend to visualise the chained context.
 */
app.post("/api/generate", async (req, res) => {
  const { domain, phase, previousOutputs } = req.body;

  if (!domain || !phase || phase < 1 || phase > 7) {
    return res.status(400).json({ error: "Invalid request. Provide domain (non-empty) and phase (1-7)." });
  }

  const phaseConfig = PHASES[phase - 1];
  const prev = previousOutputs || [];

  // Guard: dependent phases require their prior outputs
  for (const dep of phaseConfig.dependsOn) {
    if (!prev[dep - 1]) {
      return res.status(400).json({
        error: `Phase ${phase} depends on Phase ${dep}, which has not been generated yet.`
      });
    }
  }

  const segments = phaseConfig.buildSegments(domain, prev);
  const promptText = segments
    .map(s => {
      if (s.type === "domain") return `${s.label}:\n"""\n${s.content}\n"""`;
      if (s.type === "injected") return `${s.source} — ${s.sourceName}:\n${s.content}`;
      return s.content;
    })
    .join("\n\n");

  const start = Date.now();

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16384,
      messages: [{ role: "user", content: promptText }]
    });

    const output = message.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    const elapsedMs = Date.now() - start;

    res.json({
      phase: phaseConfig.id,
      name: phaseConfig.name,
      dependsOn: phaseConfig.dependsOn,
      explanation: phaseConfig.explanation,
      output,
      promptSegments: segments,
      elapsedMs,
      model: MODEL,
      tokensUsed: message.usage
    });
  } catch (err) {
    console.error(`Phase ${phase} error:`, err.message);
    res.status(500).json({ error: `API error in phase ${phase}: ${err.message}` });
  }
});

/** Return phase metadata for the frontend without triggering API calls. */
app.get("/api/phases", (req, res) => {
  res.json(PHASES.map(p => ({
    id: p.id,
    name: p.name,
    dependsOn: p.dependsOn,
    explanation: p.explanation
  })));
});

/** Example domain descriptions demonstrating workflow robustness across input styles. */
app.get("/api/examples", (req, res) => {
  res.json([
    {
      id: "hotel_full",
      label: "Hotel booking (full prose)",
      description: "The canonical case study — a well-formed natural-language description.",
      text: "A hotel booking system where guests reserve rooms for a specific date range. Each hotel has multiple rooms, and each room has a type (single, double, or suite), a nightly price, and a maximum occupancy. Guests provide their name, email, and phone number when making a booking. A booking has a check-in date, a check-out date, a status (pending, confirmed, cancelled, or completed), and a total cost calculated from the nightly price and length of stay. Staff members manage room availability and can approve or reject bookings. Guests can cancel a booking before the check-in date, subject to a cancellation policy that determines whether a refund applies. Payments confirm a booking and record the amount paid, the payment method, and the payment date. A room cannot be booked by two different guests for overlapping dates."
    },
    {
      id: "hotel_keywords",
      label: "Hotel booking (keywords only)",
      description: "Demonstrates robustness to sparse, non-native input — a Chapter 4 finding.",
      text: "hotel booking, guest name email phone, room single double suite, nightly price, max occupancy, staff manage availability, booking check-in check-out, status pending confirmed cancelled completed, total cost, cancel before check-in, refund policy, payment method date amount, no double booking overlapping dates"
    },
    {
      id: "library",
      label: "Library management",
      description: "Different domain — demonstrates workflow generalisation beyond hotel booking.",
      text: "A library management system where members borrow books for a fixed loan period. Each book has a title, author, ISBN, and belongs to a category (fiction, non-fiction, reference, periodical). Members have a membership card with a member ID and expiration date, and can borrow up to 5 books at a time. A loan has a start date, a due date, and optionally a return date. Overdue loans incur a fine calculated per day past the due date. Librarians manage the catalogue, process returns, and can waive fines. Reference books cannot be borrowed — they are for on-site use only."
    },
    {
      id: "course",
      label: "Online course platform",
      description: "Third domain — a further generalisation test.",
      text: "An online learning platform where students enrol in courses taught by instructors. Each course has a title, description, syllabus, price, and duration in weeks. Courses contain lessons, and each lesson has video content and an optional quiz. Students track their progress through lessons and receive a certificate upon course completion, provided all quizzes are passed with at least 70%. Instructors create courses, upload lessons, and grade student submissions. A payment unlocks course access for a student and records the amount, method, and date."
    }
  ]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  BookingDSL Assistant v4`);
  console.log(`  Running at → http://localhost:${PORT}\n`);
});
