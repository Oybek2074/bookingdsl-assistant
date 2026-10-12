/* ═══════════════════════════════════════════════════════════════════════
   BookingDSL Assistant — Frontend Logic
   Handles: phase progression, tabs, prompt visualization, edit mode,
   regenerate, example loading, artifact export.
   ═══════════════════════════════════════════════════════════════════════ */

if (typeof marked !== "undefined") {
  marked.setOptions({ breaks: false, gfm: true });
}

const PHASE_FILES = [
  "01-concepts.md",
  "02-relationships.md",
  "03-metamodel.md",
  "04-grammar.ebnf.md",
  "05-examples.md",
  "06-constraints.ocl.md",
  "07-traceability.md"
];

const state = {
  domain: "",
  currentPhase: 1,
  outputs: [],           // outputs[i] = string output of phase i+1
  promptSegments: [],    // promptSegments[i] = array of segments for phase i+1
  explanations: [],      // cached from /api/phases
  timings: [],           // timings[i] = ms elapsed for phase i+1
  editingPhase: null
};

/* ── DOM refs ── */
const $ = sel => document.querySelector(sel);

const screenInput    = $("#screen-input");
const screenPhase    = $("#screen-phase");
const screenComplete = $("#screen-complete");

const domainInput    = $("#domain-input");
const exampleButtons = $("#example-buttons");
const btnStart       = $("#btn-start");
const btnReset       = $("#btn-reset");

const domainSummary  = $("#domain-summary");
const domainPreview  = $("#domain-preview");
const domainBody     = $("#domain-body");

const phaseBadge     = $("#phase-badge");
const dependsChip    = $("#depends-chip");
const timingChip     = $("#timing-chip");
const phaseTitle     = $("#phase-title");
const explWhat       = $("#expl-what");
const explProduces   = $("#expl-produces");
const explRead       = $("#expl-read");

const btnRegenerate  = $("#btn-regenerate");
const btnEdit        = $("#btn-edit");
const btnCopy        = $("#btn-copy");
const btnDownload    = $("#btn-download");
const btnPrev        = $("#btn-prev");
const btnNext        = $("#btn-next");

const tabOutput      = $("#tab-output");
const tabPrompt      = $("#tab-prompt");
const phaseOutput    = $("#phase-output");
const promptView     = $("#prompt-view");
const editTextarea   = $("#edit-textarea");
const editControls   = $("#edit-controls");
const btnEditSave    = $("#btn-edit-save");
const btnEditCancel  = $("#btn-edit-cancel");

const stepper        = $("#stepper");
const loading        = $("#loading");
const loadingText    = $("#loading-text");
const exportGrid     = $("#export-grid");
const btnExportAll   = $("#btn-export-all");
const btnReview      = $("#btn-review");

/* ═══════════════════════════════════════════════════════════════════════
   VIEW MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════ */

function showScreen(name) {
  screenInput.classList.toggle("hidden", name !== "input");
  screenPhase.classList.toggle("hidden", name !== "phase");
  screenComplete.classList.toggle("hidden", name !== "complete");
}

function updateStepper() {
  stepper.querySelectorAll(".stepper-step").forEach(el => {
    const p = parseInt(el.dataset.phase);
    el.classList.remove("active", "done");
    if (p === state.currentPhase) el.classList.add("active");
    else if (state.outputs[p - 1]) el.classList.add("done");
  });
}

function truncate(s, n) {
  s = s.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function updateDomainSummary() {
  domainPreview.textContent = truncate(state.domain, 90);
  domainBody.textContent = state.domain;
}

/* ═══════════════════════════════════════════════════════════════════════
   PHASE DISPLAY
   ═══════════════════════════════════════════════════════════════════════ */

function showPhase(phase) {
  const idx = phase - 1;
  const meta = state.explanations[idx];
  showScreen("phase");

  // Header
  phaseBadge.textContent = `Phase ${phase} of 7`;
  phaseTitle.textContent = meta ? meta.name : `Phase ${phase}`;

  // Depends-on chip
  const deps = meta?.dependsOn || [];
  if (deps.length > 0) {
    dependsChip.hidden = false;
    dependsChip.textContent = `Depends on: ${deps.map(d => `P${d}`).join(", ")}`;
  } else {
    dependsChip.hidden = true;
  }

  // Timing chip
  if (state.timings[idx]) {
    timingChip.hidden = false;
    timingChip.textContent = `Generated in ${(state.timings[idx] / 1000).toFixed(1)}s`;
  } else {
    timingChip.hidden = true;
  }

  // Explanation
  if (meta) {
    explWhat.textContent = meta.explanation.what;
    explProduces.textContent = meta.explanation.produces;
    explRead.textContent = meta.explanation.howToRead;
  }

  // Output tab: render markdown
  const raw = state.outputs[idx] || "";
  phaseOutput.innerHTML = raw ? marked.parse(raw) : `<p style="color:var(--text-muted);">Not generated yet. Click "Generate phase ${phase}" below.</p>`;

  // Prompt tab: render structured segments
  renderPromptSegments(state.promptSegments[idx] || []);

  // Actions visibility
  const hasOutput = !!state.outputs[idx];
  btnRegenerate.hidden = !hasOutput;
  btnEdit.hidden       = !hasOutput;
  btnCopy.hidden       = !hasOutput;
  btnDownload.hidden   = !hasOutput;

  // Nav
  btnPrev.disabled = (phase === 1);
  btnNext.disabled = false;

  if (hasOutput) {
    if (phase === 7) {
      btnNext.innerHTML = `View summary <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    } else {
      btnNext.innerHTML = `Next phase <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
  } else {
    btnNext.innerHTML = `Generate phase ${phase} <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // Reset edit mode
  exitEditMode();

  // Reset tabs to output
  activateTab("output");

  // Reset scroll
  $("#scroll-output").scrollTop = 0;

  updateStepper();
}

/* ═══════════════════════════════════════════════════════════════════════
   PROMPT SEGMENT RENDERING — THE DEFENSE FEATURE
   Shows the actual prompt sent to the LLM with clear visual separation
   between authored instruction, domain input, and chained prior-phase output.
   ═══════════════════════════════════════════════════════════════════════ */

function renderPromptSegments(segments) {
  if (!segments || segments.length === 0) {
    promptView.innerHTML = `<p style="color:var(--text-muted);padding:1rem;font-family:var(--font);">The prompt will appear here after this phase is generated.</p>`;
    return;
  }

  promptView.innerHTML = "";
  segments.forEach(seg => {
    const div = document.createElement("div");
    div.className = `prompt-segment type-${seg.type}`;

    if (seg.type === "injected") {
      const label = document.createElement("span");
      label.className = "injected-label";
      label.textContent = `Injected from ${seg.source}: ${seg.sourceName}`;
      div.appendChild(label);
      div.appendChild(document.createTextNode(seg.content));
    } else if (seg.type === "domain") {
      const label = document.createElement("span");
      label.className = "segment-label";
      label.textContent = seg.label || "Domain description";
      div.appendChild(label);
      div.appendChild(document.createTextNode(seg.content));
    } else {
      div.textContent = seg.content;
    }

    promptView.appendChild(div);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   API — GENERATE PHASE
   ═══════════════════════════════════════════════════════════════════════ */

async function generatePhase(phase, { force = false } = {}) {
  const idx = phase - 1;

  if (state.outputs[idx] && !force) {
    showPhase(phase);
    return;
  }

  loading.classList.remove("hidden");
  const phaseName = state.explanations[idx]?.name || `Phase ${phase}`;
  loadingText.textContent = force
    ? `Regenerating phase ${phase} — ${phaseName}...`
    : `Generating phase ${phase} — ${phaseName}...`;

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: state.domain,
        phase,
        previousOutputs: state.outputs.slice(0, idx)
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    state.outputs[idx]         = data.output;
    state.promptSegments[idx]  = data.promptSegments;
    state.timings[idx]         = data.elapsedMs;
    state.currentPhase         = phase;

    loading.classList.add("hidden");
    showPhase(phase);

  } catch (err) {
    loading.classList.add("hidden");
    alert(`Error generating phase ${phase}:\n\n${err.message}\n\nCheck that your Anthropic API key is set correctly in .env and that you have API credits available.`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════════════════════════════════ */

function activateTab(name) {
  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  tabOutput.classList.toggle("hidden", name !== "output");
  tabPrompt.classList.toggle("hidden", name !== "prompt");
}

document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => activateTab(t.dataset.tab));
});

/* ═══════════════════════════════════════════════════════════════════════
   EDIT MODE — human-in-the-loop
   ═══════════════════════════════════════════════════════════════════════ */

function enterEditMode() {
  const idx = state.currentPhase - 1;
  state.editingPhase = state.currentPhase;
  editTextarea.value = state.outputs[idx] || "";
  editTextarea.classList.remove("hidden");
  phaseOutput.classList.add("hidden");
  editControls.classList.remove("hidden");
  activateTab("output");
  editTextarea.focus();
}

function exitEditMode() {
  state.editingPhase = null;
  editTextarea.classList.add("hidden");
  phaseOutput.classList.remove("hidden");
  editControls.classList.add("hidden");
}

function saveEdit() {
  const idx = state.currentPhase - 1;
  const newContent = editTextarea.value.trim();
  if (!newContent) {
    alert("Output cannot be empty.");
    return;
  }
  // Clear all downstream outputs since they were chained from the old value
  const downstream = state.outputs.slice(idx + 1).filter(x => x).length;
  if (downstream > 0 && !confirm(
    `You have ${downstream} downstream phase(s) already generated. Editing this phase will invalidate them (they were built from the previous output). Regenerate them after saving. Continue?`
  )) {
    return;
  }
  state.outputs[idx] = newContent;
  for (let i = idx + 1; i < 7; i++) {
    state.outputs[i] = undefined;
    state.promptSegments[i] = undefined;
    state.timings[i] = undefined;
  }
  exitEditMode();
  showPhase(state.currentPhase);
}

btnEdit.addEventListener("click", enterEditMode);
btnEditSave.addEventListener("click", saveEdit);
btnEditCancel.addEventListener("click", exitEditMode);

/* ═══════════════════════════════════════════════════════════════════════
   REGENERATE
   ═══════════════════════════════════════════════════════════════════════ */

btnRegenerate.addEventListener("click", () => {
  const idx = state.currentPhase - 1;
  const downstream = state.outputs.slice(idx + 1).filter(x => x).length;
  const msg = downstream > 0
    ? `Regenerating this phase will invalidate ${downstream} downstream phase(s). Continue?`
    : "Regenerate this phase? LLM output is non-deterministic — you'll likely get a slightly different result.";
  if (!confirm(msg)) return;

  for (let i = idx + 1; i < 7; i++) {
    state.outputs[i] = undefined;
    state.promptSegments[i] = undefined;
    state.timings[i] = undefined;
  }
  generatePhase(state.currentPhase, { force: true });
});

/* ═══════════════════════════════════════════════════════════════════════
   COMPLETION SCREEN
   ═══════════════════════════════════════════════════════════════════════ */

function showCompletion() {
  showScreen("complete");
  exportGrid.innerHTML = "";
  PHASE_FILES.forEach((filename, i) => {
    if (!state.outputs[i]) return;
    const item = document.createElement("div");
    item.className = "export-item";
    item.innerHTML = `
      <span class="export-item-name">
        <span class="export-item-icon">📄</span>
        ${filename}
      </span>
      <span style="color:var(--text-muted);font-size:12px;">↓</span>
    `;
    item.addEventListener("click", () => downloadFile(filename, state.outputs[i]));
    exportGrid.appendChild(item);
  });
  updateStepper();
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════════════════════════════════════ */

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadAll() {
  let combined = `# BookingDSL Assistant — Full Workflow Output\n\n`;
  combined += `**Model:** claude-sonnet-5\n`;
  combined += `**Generated:** ${new Date().toISOString()}\n\n`;
  combined += `## Domain description\n\n${state.domain}\n\n---\n\n`;

  PHASE_FILES.forEach((filename, i) => {
    if (!state.outputs[i]) return;
    const meta = state.explanations[i];
    combined += `## Phase ${i + 1}: ${meta?.name || filename}\n\n`;
    combined += `_File: ${filename}_\n\n`;
    combined += state.outputs[i];
    combined += `\n\n---\n\n`;
  });

  downloadFile("bookingdsl-full-workflow.md", combined);
}

btnCopy.addEventListener("click", () => {
  const text = state.outputs[state.currentPhase - 1] || "";
  navigator.clipboard.writeText(text).then(() => {
    btnCopy.textContent = "Copied ✓";
    setTimeout(() => btnCopy.textContent = "Copy", 1500);
  });
});

btnDownload.addEventListener("click", () => {
  const idx = state.currentPhase - 1;
  if (state.outputs[idx]) {
    downloadFile(PHASE_FILES[idx], state.outputs[idx]);
  }
});

btnExportAll.addEventListener("click", downloadAll);

btnReview.addEventListener("click", () => {
  state.currentPhase = 1;
  showPhase(1);
});

/* ═══════════════════════════════════════════════════════════════════════
   STEPPER NAV
   ═══════════════════════════════════════════════════════════════════════ */

stepper.addEventListener("click", (e) => {
  const step = e.target.closest(".stepper-step");
  if (!step) return;
  const p = parseInt(step.dataset.phase);
  if (state.outputs[p - 1] || p === state.currentPhase) {
    state.currentPhase = p;
    showPhase(p);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   MAIN CONTROLS
   ═══════════════════════════════════════════════════════════════════════ */

btnStart.addEventListener("click", () => {
  const domain = domainInput.value.trim();
  if (!domain) { domainInput.focus(); return; }
  state.domain = domain;
  state.currentPhase = 1;
  updateDomainSummary();
  generatePhase(1);
});

domainInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) btnStart.click();
});

btnNext.addEventListener("click", () => {
  const phase = state.currentPhase;
  const idx = phase - 1;

  if (phase === 7 && state.outputs[6]) {
    showCompletion();
    return;
  }
  if (state.outputs[idx]) {
    const next = phase + 1;
    state.currentPhase = next;
    if (state.outputs[next - 1]) showPhase(next);
    else generatePhase(next);
  } else {
    generatePhase(phase);
  }
});

btnPrev.addEventListener("click", () => {
  if (state.currentPhase > 1) {
    state.currentPhase--;
    showPhase(state.currentPhase);
  }
});

btnReset.addEventListener("click", () => {
  const anyOutput = state.outputs.some(x => x);
  if (anyOutput && !confirm("This will clear all generated outputs and return you to the start. Continue?")) return;
  state.domain = "";
  state.currentPhase = 1;
  state.outputs = [];
  state.promptSegments = [];
  state.timings = [];
  domainInput.value = "";
  showScreen("input");
  updateStepper();
});

/* ═══════════════════════════════════════════════════════════════════════
   INIT: load phase metadata and examples
   ═══════════════════════════════════════════════════════════════════════ */

async function init() {
  try {
    const [phasesRes, examplesRes] = await Promise.all([
      fetch("/api/phases"),
      fetch("/api/examples")
    ]);

    const phases = await phasesRes.json();
    phases.forEach((p, i) => {
      state.explanations[i] = {
        name: p.name,
        dependsOn: p.dependsOn,
        explanation: p.explanation
      };
    });

    const examples = await examplesRes.json();
    exampleButtons.innerHTML = "";
    examples.forEach(ex => {
      const btn = document.createElement("button");
      btn.className = "example-btn";
      btn.title = ex.description;
      btn.textContent = ex.label;
      btn.addEventListener("click", () => {
        domainInput.value = ex.text;
        domainInput.focus();
      });
      exampleButtons.appendChild(btn);
    });

  } catch (e) {
    console.warn("Init: failed to load metadata", e);
  }
  updateStepper();
}

init();
