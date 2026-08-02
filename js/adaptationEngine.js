/* =========================================================================
 * adaptationEngine.js — the decision half of the adaptation loop
 * -------------------------------------------------------------------------
 * Combines the four learning components into a single policy that produces
 * an "adaptation plan": a declarative description of how the interface
 * should currently look and behave. ui.js is responsible for rendering that
 * plan; this module never touches the DOM. Separating inference from
 * presentation keeps the models testable in Node (see tests/).
 *
 * Design commitments, each traceable to a known usability risk of adaptive
 * interfaces (Jameson, 2008; Alvarez-Cortes et al., 2009):
 *
 *   Predictability — the navigation list is only *re-ranked*, never
 *     truncated, and the top item is pinned once chosen until the model's
 *     confidence in a different item exceeds a margin.
 *   Transparency  — every adaptation carries a human-readable `reason`
 *     string surfaced in the "Why did this change?" panel.
 *   Controllability — `mode` can be forced to 'manual', which freezes all
 *     adaptation but keeps telemetry running.
 *   Non-obtrusiveness — adaptations are debounced and rate-limited.
 *
 * Author: Surya Yellutla
 * ========================================================================= */

(function (global) {
  'use strict';

  var A = global.AdaptiveUI;

  var MIN_OBSERVATIONS_FOR_REORDER = 6;   // cold-start guard
  var REORDER_MARGIN = 0.08;              // prob. margin to unseat pinned item
  var MIN_MS_BETWEEN_ADAPTATIONS = 2500;  // rate limit

  /**
   * @param {Object} config
   *   panels      : [{id, label, icon, group}]
   *   suggestions : [{id, label, panel, description}]
   *   telemetry   : Telemetry instance
   */
  function AdaptationEngine(config) {
    this.panels = config.panels;
    this.suggestions = config.suggestions;
    this.telemetry = config.telemetry;

    var panelIds = this.panels.map(function (p) { return p.id; });
    var suggestionIds = this.suggestions.map(function (s) { return s.id; });

    this.bandit = new A.ThompsonBandit(suggestionIds);
    this.clusterer = new A.OnlineKMeans(0.08);
    this.predictor = new A.NaiveBayes(panelIds);
    this.ability = new A.AbilityOptimizer();

    this.mode = 'auto';               // 'auto' | 'manual'
    this.pinnedTop = null;
    this.currentSuggestion = null;
    this.lastAdaptation = 0;
    this.expertise = 0;               // 0..1, drives novice/expert affordances
    this.rationale = [];              // rolling explanation log
    this.plan = this.buildInitialPlan();
  }

  AdaptationEngine.prototype.buildInitialPlan = function () {
    return {
      navOrder: this.panels.map(function (p) { return p.id; }),
      suggestion: null,
      persona: { id: 'unknown', label: 'Calibrating…', confidence: 0 },
      presentation: { fontScale: 1, targetScale: 1, spacing: 'comfortable' },
      expertiseLevel: 'novice',
      showLabels: true,
      showTooltips: true,
      showShortcutHints: false,
      revealedAdvanced: false,
      theme: 'day',
      reasons: []
    };
  };

  /** Log a rationale entry that the XAI panel can render. */
  AdaptationEngine.prototype.explain = function (kind, text) {
    var entry = { t: Date.now(), kind: kind, text: text };
    this.rationale.unshift(entry);
    if (this.rationale.length > 40) this.rationale.pop();
    return entry;
  };

  /* ------------------------------------------------------------- learning */

  /**
   * Train the next-action predictor from an observed navigation.
   * Called *after* the user opens a panel, using the context that existed
   * immediately before the move.
   */
  AdaptationEngine.prototype.observeNavigation = function (contextBefore, panelOpened) {
    this.predictor.train(contextBefore, panelOpened);
  };

  /** Feed the outcome of a displayed suggestion back to the bandit. */
  AdaptationEngine.prototype.observeSuggestionOutcome = function (id, clicked) {
    this.bandit.update(id, clicked ? 1 : 0);
    this.explain(
      'bandit',
      (clicked ? 'Reinforced' : 'Down-weighted') + ' the "' +
      this.suggestionLabel(id) + '" shortcut — posterior click-through now ' +
      (this.bandit.estimate(id) * 100).toFixed(0) + '%.'
    );
  };

  AdaptationEngine.prototype.suggestionLabel = function (id) {
    var s = this.suggestions.filter(function (x) { return x.id === id; })[0];
    return s ? s.label : id;
  };

  AdaptationEngine.prototype.panelLabel = function (id) {
    var p = this.panels.filter(function (x) { return x.id === id; })[0];
    return p ? p.label : id;
  };

  /* ------------------------------------------------------------ expertise */

  /**
   * Expertise is a smoothed estimate combining shortcut adoption, error rate
   * and breadth. It drives progressive disclosure: advanced controls stay
   * hidden until the user demonstrably no longer needs the training wheels.
   *
   * The smoothing constant is *evidence-weighted* rather than fixed. An
   * earlier version applied a constant EMA weight once per tick, but ticks
   * are rate-limited by wall-clock time, so a burst of fifty expert actions
   * inside two seconds moved the estimate no more than a single idle tick
   * did. Scaling the weight by the number of interaction events observed
   * since the last update makes the estimate a function of evidence, which
   * is what it claims to measure. The per-update weight is still capped so a
   * single burst cannot slam the interface into expert mode.
   */
  AdaptationEngine.prototype.updateExpertise = function (v, newEvents) {
    var raw =
      0.45 * v[4] +               // shortcut usage
      0.20 * v[0] +               // interaction speed
      0.15 * v[1] +               // breadth
      0.20 * (1 - v[2]);          // inverse error rate

    var BASE_RETENTION = 0.85;    // weight kept per unit of evidence
    var EVENTS_PER_UNIT = 6;      // ~6 interactions counts as one observation
    var units = Math.max(1, Math.min(12, (newEvents || 0) / EVENTS_PER_UNIT));
    var retention = Math.pow(BASE_RETENTION, units);

    this.expertise = retention * this.expertise + (1 - retention) * raw;
    return this.expertise;
  };

  AdaptationEngine.prototype.expertiseLevel = function () {
    if (this.expertise < 0.28) return 'novice';
    if (this.expertise < 0.58) return 'intermediate';
    return 'expert';
  };

  /* --------------------------------------------------------------- policy */

  /**
   * Run one full inference pass and return an adaptation plan.
   * @param {Object} [opts] - {force:boolean, now:Date}
   */
  AdaptationEngine.prototype.tick = function (opts) {
    opts = opts || {};
    var now = Date.now();

    if (this.mode === 'manual' && !opts.force) {
      this.plan.reasons = [{
        kind: 'mode',
        text: 'Adaptation is paused (manual mode). Telemetry is still being collected.'
      }];
      return this.plan;
    }
    if (!opts.force && now - this.lastAdaptation < MIN_MS_BETWEEN_ADAPTATIONS) {
      return this.plan;
    }
    this.lastAdaptation = now;

    var t = this.telemetry;
    var v = t.featureVector();
    var reasons = [];

    /* --- 1. Persona clustering -------------------------------------- */
    var persona = this.clusterer.learn(v);
    if (!this.plan.persona || this.plan.persona.id !== persona.id) {
      reasons.push({
        kind: 'persona',
        text: 'Behaviour now matches the "' + persona.label + '" profile (' +
              (persona.confidence * 100).toFixed(0) + '% confidence): ' +
              persona.description
      });
      this.explain('persona', 'Switched persona to ' + persona.label + '.');
    }

    /* --- 2. Expertise / progressive disclosure ----------------------- */
    var prevLevel = this.plan.expertiseLevel;
    var eventCount = t.events.length + (t.actions || 0);
    var newEvents = Math.max(0, eventCount - (this._lastEventCount || 0));
    this._lastEventCount = eventCount;
    this.updateExpertise(v, newEvents);
    var level = this.expertiseLevel();
    if (level !== prevLevel) {
      reasons.push({
        kind: 'expertise',
        text: 'Expertise estimate moved from ' + prevLevel + ' to ' + level +
              ' (score ' + this.expertise.toFixed(2) + '), driven mainly by ' +
              (v[4] > 0.15 ? 'keyboard-shortcut adoption' : 'error rate and pace') + '.'
      });
      this.explain('expertise', 'Expertise level → ' + level + '.');
    }

    /* --- 3. Navigation re-ranking (Naive Bayes) ---------------------- */
    var navOrder = this.plan.navOrder.slice();
    var ranking = 'default';
    var context = {
      timeBucket: t.timeBucket(opts.now),
      lastAction: t.lastPanel(),
      persona: persona.id,
      sessionPhase: t.sessionPhase()
    };

    if (this.predictor.observations() >= MIN_OBSERVATIONS_FOR_REORDER) {
      ranking = 'model';
      var scored = this.predictor.predict(context);
      var top = scored[0];

      // Pin stability: only unseat the pinned item on a clear margin.
      if (this.pinnedTop && this.pinnedTop !== top.label) {
        var pinnedScore = scored.filter(function (s) {
          return s.label === this.pinnedTop;
        }, this)[0];
        if (pinnedScore && top.prob - pinnedScore.prob < REORDER_MARGIN) {
          top = pinnedScore;
        }
      }
      this.pinnedTop = top.label;

      var newOrder = scored.map(function (s) { return s.label; });
      // Move the (possibly pinned) top item to position 0.
      newOrder = [top.label].concat(newOrder.filter(function (l) {
        return l !== top.label;
      }));

      if (newOrder.join('|') !== navOrder.join('|')) {
        navOrder = newOrder;
        reasons.push({
          kind: 'navigation',
          text: 'Promoted "' + this.panelLabel(top.label) + '" to the top of the sidebar — ' +
                (top.prob * 100).toFixed(0) + '% predicted probability of being your next ' +
                'destination given it is ' + context.timeBucket + ', you were last in "' +
                this.panelLabel(context.lastAction) + '", and you are behaving like a ' +
                persona.label + '.'
        });
        this.explain('navigation', 'Sidebar re-ranked; "' + this.panelLabel(top.label) + '" first.');
      }
    } else {
      reasons.push({
        kind: 'navigation',
        text: 'Sidebar order is held steady — only ' + this.predictor.observations() +
              ' of ' + MIN_OBSERVATIONS_FOR_REORDER +
              ' navigation observations collected. Adapting this early would be guessing.'
      });
    }

    /* --- 4. Suggestion selection (Thompson Sampling) ------------------ */
    // Eligible arms exclude a shortcut pointing at the panel already open.
    var eligible = this.suggestions
      .filter(function (s) { return s.panel !== t.currentPanel; })
      .map(function (s) { return s.id; });
    var chosen = this.bandit.select(eligible);

    if (chosen && chosen !== this.currentSuggestion) {
      if (this.currentSuggestion) {
        // The previous suggestion was shown and not clicked → negative reward.
        this.bandit.update(this.currentSuggestion, 0);
      }
      this.currentSuggestion = chosen;
      reasons.push({
        kind: 'suggestion',
        text: 'Surfacing "' + this.suggestionLabel(chosen) + '". Thompson Sampling drew the ' +
              'highest value from its Beta posterior (mean ' +
              (this.bandit.estimate(chosen) * 100).toFixed(0) + '% after ' +
              this.bandit.arms[chosen].pulls + ' impressions) — this is the ' +
              'explore/exploit trade-off in action.'
      });
    }

    /* --- 5. Ability-based presentation tuning ------------------------- */
    var abilityProfile = t.abilityProfile(120);
    var opt = this.ability.optimize(abilityProfile);
    if (opt.changed) {
      reasons.push({ kind: 'presentation', text: opt.reason });
      this.explain('presentation', 'Presentation retuned: ' + JSON.stringify(opt.state) + '.');
    }

    /* --- 6. Circadian theme ------------------------------------------- */
    var bucket = context.timeBucket;
    var theme = (bucket === 'evening' || bucket === 'night') ? 'night' : 'day';
    if (theme !== this.plan.theme) {
      reasons.push({
        kind: 'context',
        text: 'Switched to the ' + theme + ' palette for the ' + bucket + ' context.'
      });
    }

    /* --- assemble ------------------------------------------------------ */
    this.plan = {
      navOrder: navOrder,
      ranking: ranking,
      suggestion: this.currentSuggestion,
      persona: persona,
      presentation: opt.state,
      expertiseLevel: level,
      expertiseScore: this.expertise,
      showLabels: level !== 'expert',
      showTooltips: level === 'novice',
      showShortcutHints: level !== 'novice',
      revealedAdvanced: level === 'expert' || this.expertise > 0.5,
      theme: theme,
      features: v,
      context: context,
      abilityProfile: abilityProfile,
      reasons: reasons
    };
    return this.plan;
  };

  /* ---------------------------------------------------------- persistence */

  AdaptationEngine.prototype.exportModel = function () {
    return {
      version: 1,
      bandit: this.bandit.toJSON(),
      clusterer: this.clusterer.toJSON(),
      predictor: this.predictor.toJSON(),
      ability: this.ability.toJSON(),
      expertise: this.expertise
    };
  };

  AdaptationEngine.prototype.importModel = function (o) {
    if (!o) return;
    this.bandit.fromJSON(o.bandit);
    this.clusterer.fromJSON(o.clusterer);
    this.predictor.fromJSON(o.predictor);
    this.ability.fromJSON(o.ability);
    this.expertise = typeof o.expertise === 'number' ? o.expertise : 0;
  };

  AdaptationEngine.prototype.resetModel = function () {
    var panelIds = this.panels.map(function (p) { return p.id; });
    var suggestionIds = this.suggestions.map(function (s) { return s.id; });
    this.bandit = new A.ThompsonBandit(suggestionIds);
    this.clusterer = new A.OnlineKMeans(0.08);
    this.predictor = new A.NaiveBayes(panelIds);
    this.ability = new A.AbilityOptimizer();
    this.expertise = 0;
    this._lastEventCount = 0;
    this.pinnedTop = null;
    this.currentSuggestion = null;
    this.rationale = [];
    this.plan = this.buildInitialPlan();
  };

  global.AdaptiveUI.AdaptationEngine = AdaptationEngine;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AdaptiveUI;
}
