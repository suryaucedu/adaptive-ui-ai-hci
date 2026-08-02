/* =========================================================================
 * telemetry.js — interaction instrumentation and feature extraction
 * -------------------------------------------------------------------------
 * The user model is only as good as its observations. This module is the
 * sensing half of the adaptation loop described by Jameson (2008): it
 * captures raw interaction events, then derives the normalised feature
 * vector the learning models consume.
 *
 * Everything is captured locally and held in memory (plus an optional
 * localStorage snapshot when running outside the Claude artifact sandbox).
 * No interaction data leaves the browser — an explicit privacy decision,
 * since implicit behavioural monitoring is the primary ethical cost of
 * adaptive interfaces (Alvarez-Cortes et al., 2009).
 *
 * Author: Surya Yellutla
 * ========================================================================= */

(function (global) {
  'use strict';

  var MAX_EVENTS = 500;
  var WINDOW_MS = 90 * 1000; // sliding analysis window: last 90 seconds

  function Telemetry(panelIds) {
    this.panelIds = panelIds.slice();
    this.events = [];
    // All timestamps go through this.now() rather than Date.now() directly.
    // The simulator installs a fast-forwarding clock so that a replayed
    // trace carries realistic *inter-event timing* even though it executes
    // in a few seconds of wall time. Without this, every accelerated replay
    // saturates the interaction-rate feature at 1.0 and the persona
    // clusters collapse — the demo would misrepresent the models.
    this._clock = null;
    this.sessionStart = this.now();
    this.panelEnteredAt = null;
    this.currentPanel = null;
    this.dwellByPanel = {};
    this.lastPointer = null;
    this.pointerDistances = [];
    this.misses = 0;
    this.hits = 0;
    this.shortcutUses = 0;
    this.undos = 0;
    this.actions = 0;
    this.listeners = [];
  }

  /** Current time on the telemetry clock (real, or virtual under replay). */
  Telemetry.prototype.now = function () {
    return this._clock ? this._clock() : Date.now();
  };

  /** Install/remove a virtual clock. Pass null to return to real time. */
  Telemetry.prototype.setClock = function (fn) { this._clock = fn; };

  Telemetry.prototype.on = function (fn) { this.listeners.push(fn); };
  Telemetry.prototype.emit = function (evt) {
    this.listeners.forEach(function (fn) { fn(evt); });
  };

  Telemetry.prototype.record = function (type, payload) {
    var evt = { type: type, t: this.now(), payload: payload || {} };
    this.events.push(evt);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.emit(evt);
    return evt;
  };

  /* ---------------------------------------------------------------- panels */

  Telemetry.prototype.enterPanel = function (panelId) {
    var now = this.now();
    if (this.currentPanel && this.panelEnteredAt) {
      var dwell = (now - this.panelEnteredAt) / 1000;
      this.dwellByPanel[this.currentPanel] =
        (this.dwellByPanel[this.currentPanel] || 0) + dwell;
    }
    var previous = this.currentPanel;
    this.currentPanel = panelId;
    this.panelEnteredAt = now;
    this.actions += 1;
    return this.record('panel_enter', { panel: panelId, from: previous });
  };

  /* ---------------------------------------------------------------- actions */

  Telemetry.prototype.action = function (actionId, meta) {
    this.actions += 1;
    return this.record('action', Object.assign({ action: actionId }, meta || {}));
  };

  Telemetry.prototype.shortcut = function (combo, actionId) {
    this.shortcutUses += 1;
    this.actions += 1;
    return this.record('shortcut', { combo: combo, action: actionId });
  };

  Telemetry.prototype.undo = function (actionId) {
    this.undos += 1;
    this.actions += 1;
    return this.record('undo', { action: actionId });
  };

  /**
   * Register a pointer event against a target element so the ability model
   * can estimate travel distance and miss rate.
   * @param {number} x @param {number} y
   * @param {boolean} hitTarget - true if the click landed on an interactive
   *        control, false if it landed on inert chrome (a "miss")
   */
  Telemetry.prototype.pointer = function (x, y, hitTarget) {
    if (this.lastPointer) {
      var dx = x - this.lastPointer.x;
      var dy = y - this.lastPointer.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 4) {
        this.pointerDistances.push(d);
        if (this.pointerDistances.length > 120) this.pointerDistances.shift();
      }
    }
    this.lastPointer = { x: x, y: y };
    if (hitTarget) this.hits += 1; else this.misses += 1;
    return this.record('pointer', { x: x, y: y, hit: !!hitTarget });
  };

  Telemetry.prototype.suggestionShown = function (id) {
    return this.record('suggestion_shown', { suggestion: id });
  };
  Telemetry.prototype.suggestionClicked = function (id) {
    this.actions += 1;
    return this.record('suggestion_clicked', { suggestion: id });
  };
  Telemetry.prototype.suggestionDismissed = function (id) {
    return this.record('suggestion_dismissed', { suggestion: id });
  };

  /* -------------------------------------------------------- feature vector */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /**
   * Derive the 5-dimensional normalised vector consumed by OnlineKMeans.
   * @returns {number[]}
   */
  Telemetry.prototype.featureVector = function () {
    var now = this.now();
    var windowStart = now - WINDOW_MS;
    var recent = this.events.filter(function (e) { return e.t >= windowStart; });

    var elapsedMin = Math.max(0.25, (now - Math.max(this.sessionStart, windowStart)) / 60000);

    // [0] interaction rate — actions per minute, normalised so that 1.0
    // represents a sustained rate at roughly the ceiling of human input
    // speed. An earlier version normalised against 40 actions/min, but that
    // is only one action every 1.5 s — a brisk but entirely ordinary pace.
    // The feature saturated at 1.0 for most active users and stopped
    // discriminating between them, which in turn collapsed the persona
    // clusters (an engaged but error-prone user was being read as a fast
    // explorer). 100 actions/min keeps the feature informative across the
    // range of behaviour the interface actually sees.
    var RATE_CEILING_PER_MIN = 100;
    var clicks = recent.filter(function (e) {
      return e.type === 'action' || e.type === 'panel_enter' ||
             e.type === 'shortcut' || e.type === 'suggestion_clicked';
    }).length;
    var interactionRate = clamp01((clicks / elapsedMin) / RATE_CEILING_PER_MIN);

    // [1] navigation breadth — distinct panels visited / total panels
    var seen = {};
    recent.forEach(function (e) {
      if (e.type === 'panel_enter') seen[e.payload.panel] = true;
    });
    var breadth = clamp01(Object.keys(seen).length / Math.max(1, this.panelIds.length));

    // [2] error rate — (undos + misses) / total actions
    var recentUndo = recent.filter(function (e) { return e.type === 'undo'; }).length;
    var recentMiss = recent.filter(function (e) {
      return e.type === 'pointer' && !e.payload.hit;
    }).length;
    var denom = Math.max(1, clicks + recentMiss);
    var errorRate = clamp01((recentUndo + recentMiss) / denom);

    // [3] mean dwell — seconds per panel visit, normalised against 45s
    var visits = recent.filter(function (e) { return e.type === 'panel_enter'; }).length;
    var totalDwell = 0;
    for (var p in this.dwellByPanel) totalDwell += this.dwellByPanel[p];
    if (this.currentPanel && this.panelEnteredAt) {
      totalDwell += (now - this.panelEnteredAt) / 1000;
    }
    var meanDwell = clamp01((totalDwell / Math.max(1, visits)) / 45);

    // [4] shortcut usage — keyboard actions / total actions
    var recentShort = recent.filter(function (e) { return e.type === 'shortcut'; }).length;
    var shortcutUse = clamp01(recentShort / Math.max(1, clicks));

    return [interactionRate, breadth, errorRate, meanDwell, shortcutUse];
  };

  /**
   * Ability estimates consumed by AbilityOptimizer.
   */
  Telemetry.prototype.abilityProfile = function (baseTargetWidth) {
    var totalClicks = this.hits + this.misses;
    var missRate = totalClicks > 0 ? this.misses / totalClicks : 0.05;

    var meanDistance = this.pointerDistances.length
      ? this.pointerDistances.reduce(function (a, b) { return a + b; }, 0) /
        this.pointerDistances.length
      : 220;

    // readSlowdown: long dwell with few actions suggests the user is
    // labouring over the text rather than working through it.
    var v = this.featureVector();
    var readSlowdown = clamp01(v[3] * (1 - v[0]));

    // density preference: explorers who move fast across panels want more on
    // screen; slow, error-prone users want less.
    var density = clamp01(0.5 + 0.5 * (v[0] - v[2]));

    return {
      missRate: missRate,
      meanDistance: meanDistance,
      baseTargetWidth: baseTargetWidth || 120,
      readSlowdown: readSlowdown,
      density: density
    };
  };

  /* ------------------------------------------------------------- context */

  Telemetry.prototype.timeBucket = function (dateOverride) {
    var h = (dateOverride || new Date()).getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 22) return 'evening';
    return 'night';
  };

  Telemetry.prototype.sessionPhase = function () {
    var mins = (this.now() - this.sessionStart) / 60000;
    if (mins < 2) return 'start';
    if (mins < 10) return 'mid';
    return 'late';
  };

  Telemetry.prototype.lastPanel = function () {
    for (var i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].type === 'panel_enter') return this.events[i].payload.panel;
    }
    return 'none';
  };

  /** Top-N most-used actions, for the suggestion candidate pool. */
  Telemetry.prototype.topActions = function (n) {
    var counts = {};
    this.events.forEach(function (e) {
      if (e.type === 'action') {
        counts[e.payload.action] = (counts[e.payload.action] || 0) + 1;
      }
    });
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, n || 5);
  };

  Telemetry.prototype.summary = function () {
    return {
      events: this.events.length,
      actions: this.actions,
      undos: this.undos,
      hits: this.hits,
      misses: this.misses,
      shortcuts: this.shortcutUses,
      sessionSeconds: Math.round((this.now() - this.sessionStart) / 1000),
      dwellByPanel: this.dwellByPanel
    };
  };

  Telemetry.prototype.reset = function () {
    this.events = [];
    // Keep whatever clock is installed — resetting the models must not also
    // rewind time, or events recorded afterwards would be inconsistent with
    // any virtual offset the simulator has already accumulated.
    this.sessionStart = this.now();
    this.dwellByPanel = {};
    this.pointerDistances = [];
    this.misses = 0; this.hits = 0; this.shortcutUses = 0;
    this.undos = 0; this.actions = 0;
    this.currentPanel = null; this.panelEnteredAt = null;
    this.lastPointer = null;
  };

  global.AdaptiveUI = global.AdaptiveUI || {};
  global.AdaptiveUI.Telemetry = Telemetry;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AdaptiveUI;
}
