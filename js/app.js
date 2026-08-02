/* =========================================================================
 * app.js — wiring
 * -------------------------------------------------------------------------
 * Closes the adaptation loop:
 *
 *      user interaction
 *            │
 *            ▼
 *      Telemetry (sense)  ──►  AdaptationEngine (infer)  ──►  UI (act)
 *            ▲                                                  │
 *            └──────────────────────────────────────────────────┘
 *
 * The loop is driven by two triggers: an event-driven tick after every
 * meaningful interaction (rate-limited inside the engine), and a slow
 * heartbeat so that time-of-day and dwell-based features keep the model
 * current even while the user is idle.
 *
 * Author: Surya Yellutla
 * ========================================================================= */

(function (global) {
  'use strict';

  var A = global.AdaptiveUI;

  document.addEventListener('DOMContentLoaded', function () {

    var telemetry = new A.Telemetry(A.PANELS.map(function (p) { return p.id; }));

    var engine = new A.AdaptationEngine({
      panels: A.PANELS,
      suggestions: A.SUGGESTIONS,
      telemetry: telemetry
    });

    var ui = new A.UI({
      panels: A.PANELS,
      suggestions: A.SUGGESTIONS,
      onNavigate: navigate,
      onAction: doAction,
      onSuggestionTake: takeSuggestion,
      onSuggestionDismiss: dismissSuggestion
    });

    var currentPanel = 'inbox';

    /* ---------------------------------------------------------- the loop */

    function render(force) {
      var plan = engine.tick({ force: !!force });
      ui.applyPresentation(plan);
      ui.renderNav(plan);
      ui.renderSuggestion(plan);
      ui.renderInspector(plan, engine);
      return plan;
    }

    function repaintPanel(force) {
      var plan = render(force);
      ui.renderPanel(currentPanel, plan);
      // renderPanel rebuilds the nav's aria-current target, so re-render nav.
      ui.renderNav(plan);
    }

    /* ------------------------------------------------------- interactions */

    function navigate(panelId) {
      // Capture the context that existed *before* the move; that is the
      // context the predictor must learn to map onto this destination.
      var contextBefore = {
        timeBucket: telemetry.timeBucket(),
        lastAction: telemetry.lastPanel(),
        persona: engine.plan.persona.id,
        sessionPhase: telemetry.sessionPhase()
      };
      engine.observeNavigation(contextBefore, panelId);

      telemetry.enterPanel(panelId);
      currentPanel = panelId;
      repaintPanel();
    }

    function doAction(actionId, panelId) {
      if (actionId === '__undo__') {
        telemetry.undo('manual');
        ui.toast('Undone — the model counts this as a correction.');
      } else {
        telemetry.action(actionId, { panel: panelId });
        ui.toast('Recorded: ' + actionId);
      }
      repaintPanel();
    }

    function takeSuggestion() {
      var id = engine.plan.suggestion;
      if (!id) return;
      var s = A.SUGGESTIONS.filter(function (x) { return x.id === id; })[0];
      telemetry.suggestionClicked(id);
      engine.observeSuggestionOutcome(id, true);
      engine.currentSuggestion = null;
      if (s) navigate(s.panel); else repaintPanel(true);
    }

    function dismissSuggestion() {
      var id = engine.plan.suggestion;
      if (!id) return;
      telemetry.suggestionDismissed(id);
      engine.observeSuggestionOutcome(id, false);
      engine.currentSuggestion = null;
      ui.toast('Dismissed — this shortcut will surface less often.');
      repaintPanel(true);
    }

    /* --------------------------------------------------- global listeners */

    // Every click anywhere feeds the pointing model. A click that did not
    // land on an interactive control is treated as a miss, which is the
    // signal the ability optimiser uses to enlarge targets.
    document.addEventListener('click', function (e) {
      var interactive = e.target.closest(
        'button, a, input, select, textarea, [role="button"], .item'
      );
      telemetry.pointer(e.clientX, e.clientY, !!interactive);
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input, textarea')) return;
      var order = engine.plan.navOrder;

      if (e.key >= '1' && e.key <= '7') {
        var idx = parseInt(e.key, 10) - 1;
        if (order[idx]) {
          telemetry.shortcut('key ' + e.key, 'navigate');
          navigate(order[idx]);
        }
      } else if (e.key === 's' || e.key === 'S') {
        telemetry.shortcut('S', 'suggestion');
        takeSuggestion();
      } else if (e.key === 'z' || e.key === 'Z') {
        telemetry.shortcut('Z', 'undo');
        doAction('__undo__', currentPanel);
      } else if (e.key === '?') {
        toggleInspector();
      }
    });

    document.getElementById('btnTakeSuggestion')
      .addEventListener('click', takeSuggestion);
    document.getElementById('btnDismissSuggestion')
      .addEventListener('click', dismissSuggestion);

    document.getElementById('adaptToggle').addEventListener('change', function (e) {
      engine.mode = e.target.checked ? 'auto' : 'manual';
      ui.toast(e.target.checked
        ? 'Adaptation resumed.'
        : 'Adaptation paused. Telemetry continues; the layout is frozen.');
      repaintPanel(true);
    });

    document.getElementById('btnReset').addEventListener('click', function () {
      engine.resetModel();
      telemetry.reset();
      document.getElementById('reasonList').innerHTML =
        '<li class="reason placeholder">Models cleared. Start interacting again.</li>';
      currentPanel = 'inbox';
      telemetry.enterPanel(currentPanel);
      ui.lastNavOrder = [];
      repaintPanel(true);
      ui.toast('All learned models cleared.');
    });

    /* ----------------------------------------------------------- simulator */

    var simulator = new A.Simulator({
      telemetry: telemetry,
      engine: engine,
      ui: ui,
      onStep: function (panelId) { navigate(panelId); },
      onDone: function (profile) {
        ui.toast('Simulated a "' + profile.label + '" session. Watch the panel on the right.');
        repaintPanel(true);
      }
    });

    var simProfiles = simulator.profiles();
    var simIndex = 0;
    document.getElementById('btnSimulate').addEventListener('click', function () {
      if (simulator.running) { simulator.stop(); ui.toast('Simulation stopped.'); return; }
      var profile = simProfiles[simIndex % simProfiles.length];
      simIndex += 1;
      ui.toast('Replaying a "' + simulator.profileLabel(profile) + '" trace…');
      simulator.run(profile, 16);
    });

    /* ---------------------------------------------------------- inspector */

    function toggleInspector() {
      var body = document.getElementById('inspectorBody');
      var btn = document.getElementById('btnCollapseInspector');
      var open = body.hidden;
      body.hidden = !open;
      btn.textContent = open ? '–' : '+';
      btn.setAttribute('aria-expanded', String(open));
    }
    document.getElementById('btnCollapseInspector')
      .addEventListener('click', toggleInspector);

    /* ------------------------------------------------------------- start */

    telemetry.enterPanel(currentPanel);
    repaintPanel(true);

    // Heartbeat: keeps dwell, time-of-day and idle-decay features fresh.
    setInterval(function () { repaintPanel(); }, 4000);

    // Expose for console inspection and for the headless test harness.
    global.__adaptive = {
      telemetry: telemetry, engine: engine, ui: ui,
      simulator: simulator, render: repaintPanel,
      navigate: navigate, doAction: doAction
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
