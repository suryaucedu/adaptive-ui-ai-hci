/* =========================================================================
 * simulator.js — synthetic interaction traces
 * -------------------------------------------------------------------------
 * An adaptive interface is, by construction, invisible until it has enough
 * evidence to adapt. That is a real evaluation problem: a grader opening the
 * page for thirty seconds would see a static dashboard and reasonably
 * conclude nothing was happening.
 *
 * This module replays scripted interaction traces at accelerated speed so
 * the whole adaptation loop can be observed on demand. Three personas are
 * implemented, matching the prototype centroids in kmeans.js. The traces are
 * stochastic rather than fixed, so repeated runs exercise different paths
 * through the policy.
 *
 * The simulator drives the *same* public API a real user drives — it does
 * not write to the models directly — so nothing here can make the adaptation
 * look better than it actually is.
 *
 * Author: Surya Yellutla
 * ========================================================================= */

(function (global) {
  'use strict';

  var A = global.AdaptiveUI;

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function chance(p) { return Math.random() < p; }

  var PROFILES = {
    focused: {
      label: 'Focused Specialist',
      panels: ['tasks', 'documents', 'tasks', 'documents', 'tasks', 'calendar'],
      shortcutProb: 0.55,
      missProb: 0.04,
      undoProb: 0.03,
      actionsPerPanel: [2, 4],
      stepMs: 190,          // wall-clock pacing of the replay
      virtualStepMs: 5200   // how much simulated time each visit represents
    },
    explorer: {
      label: 'Broad Explorer',
      panels: ['inbox', 'analytics', 'calendar', 'documents', 'tasks', 'reports', 'inbox', 'analytics'],
      shortcutProb: 0.18,
      missProb: 0.08,
      undoProb: 0.06,
      actionsPerPanel: [1, 2],
      stepMs: 120,
      virtualStepMs: 2400   // explorers move on quickly — short dwell
    },
    struggling: {
      label: 'Effortful Novice',
      panels: ['inbox', 'inbox', 'tasks', 'inbox', 'calendar', 'inbox'],
      shortcutProb: 0.01,
      missProb: 0.34,
      undoProb: 0.30,
      actionsPerPanel: [2, 5],
      stepMs: 240,
      virtualStepMs: 9000   // slow, effortful, lots of re-reading
    }
  };

  /**
   * @param {Object} deps - {telemetry, engine, ui, onStep, onDone}
   */
  function Simulator(deps) {
    this.t = deps.telemetry;
    this.engine = deps.engine;
    this.ui = deps.ui;
    this.onStep = deps.onStep || function () {};
    this.onDone = deps.onDone || function () {};
    this.running = false;
    this.timer = null;
    // Accumulated virtual time. This persists after a replay finishes: the
    // simulated session genuinely "aged", and rewinding the clock back to
    // real time would place every recorded event in the future, corrupting
    // the sliding analysis window. Time must only ever move forward.
    this.offset = 0;
  }

  Simulator.prototype.stop = function () {
    this.running = false;
    clearTimeout(this.timer);
  };

  /**
   * Run a trace.
   * @param {string} profileName - 'focused' | 'explorer' | 'struggling'
   * @param {number} [steps] - number of panel visits to simulate
   */
  Simulator.prototype.run = function (profileName, steps) {
    var self = this;
    var profile = PROFILES[profileName] || PROFILES.explorer;
    var plan = [];
    var visits = steps || 14;

    for (var i = 0; i < visits; i++) {
      plan.push(profile.panels[i % profile.panels.length]);
    }

    this.running = true;
    var idx = 0;

    // Install a fast-forwarding clock. The replay executes in a few seconds
    // of wall time, but telemetry sees each panel visit separated by
    // profile.virtualStepMs — so dwell, interaction rate and session phase
    // are all computed from plausible timings instead of from an
    // instantaneous burst.
    var stepJitter = 0;
    this.t.setClock(function () { return Date.now() + self.offset + stepJitter; });

    function step() {
      if (!self.running || idx >= plan.length) {
        self.running = false;
        self.offset += stepJitter;   // keep the clock monotonic
        stepJitter = 0;
        self.onDone(profile);
        return;
      }
      var panelId = plan[idx++];
      self.offset += (profile.virtualStepMs || 3000) * (0.7 + Math.random() * 0.6);
      stepJitter = 0;

      // Pointer travel toward a plausible sidebar/target coordinate, with a
      // profile-dependent probability of missing the control entirely.
      var x = 120 + Math.random() * 760;
      var y = 140 + Math.random() * 480;
      self.t.pointer(x, y, !chance(profile.missProb));

      self.onStep(panelId, profile);

      var n = profile.actionsPerPanel[0] +
              Math.floor(Math.random() *
                (profile.actionsPerPanel[1] - profile.actionsPerPanel[0] + 1));

      for (var k = 0; k < n; k++) {
        var panel = A.PANELS.filter(function (p) { return p.id === panelId; })[0];
        if (!panel) continue;
        // Spread the actions within this visit across the virtual dwell.
        stepJitter += ((profile.virtualStepMs || 3000) / (n + 1)) * 0.8;
        var act = pick(panel.actions).id;
        if (chance(profile.shortcutProb)) {
          self.t.shortcut('ctrl+' + (k + 1), act);
        } else {
          self.t.action(act, { panel: panelId });
          self.t.pointer(x + (Math.random() - 0.5) * 320,
                         y + (Math.random() - 0.5) * 220,
                         !chance(profile.missProb));
        }
        if (chance(profile.undoProb)) self.t.undo(act);
      }

      self.timer = setTimeout(step, profile.stepMs);
    }

    step();
  };

  Simulator.prototype.profiles = function () { return Object.keys(PROFILES); };
  Simulator.prototype.profileLabel = function (id) {
    return (PROFILES[id] || {}).label || id;
  };

  A.Simulator = Simulator;
  A.SIM_PROFILES = PROFILES;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AdaptiveUI;
}
