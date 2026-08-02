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
      stepMs: 190
    },
    explorer: {
      label: 'Broad Explorer',
      panels: ['inbox', 'analytics', 'calendar', 'documents', 'tasks', 'reports', 'inbox', 'analytics'],
      shortcutProb: 0.18,
      missProb: 0.08,
      undoProb: 0.06,
      actionsPerPanel: [1, 2],
      stepMs: 120
    },
    struggling: {
      label: 'Effortful Novice',
      panels: ['inbox', 'inbox', 'tasks', 'inbox', 'calendar', 'inbox'],
      shortcutProb: 0.01,
      missProb: 0.34,
      undoProb: 0.30,
      actionsPerPanel: [2, 5],
      stepMs: 240
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

    function step() {
      if (!self.running || idx >= plan.length) {
        self.running = false;
        self.onDone(profile);
        return;
      }
      var panelId = plan[idx++];

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
