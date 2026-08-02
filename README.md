# AdaptiveDesk — AI-Based Adaptive Human-Computer Interaction

A browser-based **adaptive user interface** that observes how you work and reconfigures
itself at runtime. Built for a Human-Computer Interaction course project at the
University of the Cumberlands.

**Author:** Surya Yellutla
**Repository:** https://github.com/suryaucedu/adaptive-ui-ai-hci

---

## Running it

No build step, no package installation, no API keys, no network access.

```
git clone https://github.com/suryaucedu/adaptive-ui-ai-hci.git
cd adaptive-ui-ai-hci
open index.html          # macOS  (or: double-click the file)
```

Everything runs client-side from the local filesystem. If your browser restricts
`file://` scripts, serve the folder instead:

```
python3 -m http.server 8000     # then visit http://localhost:8000
```

### Seeing the adaptation quickly

An adaptive interface has nothing to adapt to until it has evidence, so a cold page
looks static. Press **Simulate user** in the header to replay a scripted interaction
trace at accelerated speed. Pressing it repeatedly cycles through three profiles —
*Focused Specialist*, *Broad Explorer*, and *Effortful Novice* — each of which drives
the interface somewhere visibly different. Watch the **Why did this change?** panel on
the right; every adaptation writes a plain-language justification there.

### Running the tests

```
node tests/test-models.js
```

32 assertions covering the statistical behaviour of each model (bandit convergence,
cluster separation, recovery of a planted conditional dependency, Fitts's Law
monotonicity, hysteresis, cold-start suppression, export/import round-tripping).
No test framework required.

---

## What adapts, and what drives it

| Adaptation | Driven by | Signal |
|---|---|---|
| Sidebar re-ranking | Multinomial Naive Bayes | time of day, previous panel, persona, session phase |
| "Suggested for you" slot | Thompson Sampling bandit | whether you took or dismissed past suggestions |
| Font size, target size, spacing | Fitts's-Law cost optimisation | pointer miss rate, travel distance, dwell |
| Progressive disclosure of advanced panels | Expertise estimator | shortcut adoption, error rate, pace, breadth |
| Density and layout persona | Online k-means | 5-dimensional interaction feature vector |
| Day / night palette | Context rule | local clock |

---

## Architecture

```
  user interaction
        │
        ▼
  telemetry.js  ──►  adaptationEngine.js  ──►  ui.js
   (sense)              (infer)                (act)
        ▲                                        │
        └────────────────────────────────────────┘
```

```
adaptive-ui-ai-hci/
├── index.html                    markup and load order
├── css/styles.css                presentation; reads the CSS variables the models set
├── js/
│   ├── models/
│   │   ├── bandit.js             Thompson Sampling over Beta posteriors
│   │   ├── kmeans.js             online (competitive-learning) k-means
│   │   ├── naivebayes.js         multinomial Naive Bayes with Laplace smoothing
│   │   └── abilityOptimizer.js   Fitts's-Law expected-effort minimisation
│   ├── telemetry.js              instrumentation and feature extraction
│   ├── adaptationEngine.js       the policy — combines all four models
│   ├── content.js                workspace content (swappable)
│   ├── ui.js                     rendering; contains no learning logic
│   ├── simulator.js              scripted interaction traces
│   └── app.js                    wiring and the adaptation loop
└── tests/test-models.js          headless unit + integration tests
```

The engine never touches the DOM and the renderer never learns anything. The engine's
only output is a declarative *adaptation plan*, which makes the whole system
deterministic given a plan and testable headlessly in Node.

---

## Design commitments

Adaptive interfaces fail in well-documented ways: they become unpredictable, they hide
things users were looking for, and they leave people unable to explain or undo what
just happened (Jameson, 2008). Four commitments in the code push back on each:

- **Predictability** — the sidebar is re-ranked, never truncated, and the top item is
  pinned until a competing prediction beats it by a margin of 0.08.
- **Transparency** — every adaptation emits a human-readable `reason` string. The
  inspector panel is a first-class part of the interface, not a debug view.
- **Controllability** — one switch pauses all adaptation while leaving sensing on.
  Reset clears every learned model.
- **Stability** — presentation changes require a predicted 6% improvement in expected
  interaction cost before they are applied, and adaptations are rate-limited.

## Privacy

All telemetry stays in the page. Nothing is transmitted, and no browser storage APIs
are used — closing the tab discards the user model entirely.

---

## AI assistance disclosure

This project was developed with assistance from **Anthropic Claude (Opus 5)**, used as
a pair-programming and drafting assistant. Its contributions and my own are itemised
in Table 1 of the accompanying report (`AI-Based Adaptive HCI Report.docx`). In
summary: Claude produced initial implementations of the four model modules, the
telemetry layer, the stylesheet, and the test suite from my specifications; I set the
architecture and the design commitments above, and I diagnosed and directed the fixes
for four defects the AI-generated code contained — a Laplace-smoothing error that
flattened the Naive Bayes posterior to uniform, an expertise estimator that learned on
wall-clock ticks instead of evidence, a cost model that shrank text for struggling
users, and a switch control that was unreachable by assistive technology. Those
defects and their diagnoses are documented in the report's Challenges section.

No AI-generated code was accepted without being read, tested, and in several cases
corrected.

---

## References

Alvarez-Cortes, V., Zayas-Pérez, B. E., Zárate-Silva, V. H., & Uresti, J. A. R. (2009).
Current challenges and applications for adaptive user interfaces. In I. Maurtua (Ed.),
*Human-computer interaction* (pp. 49–68). InTech.

Fitts, P. M. (1954). The information capacity of the human motor system in controlling
the amplitude of movement. *Journal of Experimental Psychology, 47*(6), 381–391.

Gajos, K. Z., Weld, D. S., & Wobbrock, J. O. (2010). Automatically generating
personalized user interfaces with SUPPLE. *Artificial Intelligence, 174*(12–13),
910–950.

Jameson, A. (2008). Adaptive interfaces and agents. In A. Sears & J. A. Jacko (Eds.),
*The human-computer interaction handbook* (2nd ed., pp. 433–458). Lawrence Erlbaum.

Russo, D. J., Van Roy, B., Kazerouni, A., Osband, I., & Wen, Z. (2018). A tutorial on
Thompson sampling. *Foundations and Trends in Machine Learning, 11*(1), 1–96.

## License

MIT — see `LICENSE`.
