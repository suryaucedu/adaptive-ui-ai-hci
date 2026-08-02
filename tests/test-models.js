/* =========================================================================
 * tests/test-models.js — headless unit + integration tests
 * -------------------------------------------------------------------------
 * Run with:   node tests/test-models.js
 *
 * No test framework dependency: the assertions are hand-rolled so the
 * project stays zero-install. The tests cover the statistical behaviour of
 * each model (does the bandit converge? does k-means separate the personas?
 * does Naive Bayes recover a planted conditional dependency?) rather than
 * just checking that functions return without throwing.
 *
 * Author: Surya Yellutla
 * ========================================================================= */

'use strict';

// Provide a minimal global so the browser modules load unchanged in Node.
global.window = undefined;
require('../js/models/bandit.js');
require('../js/models/kmeans.js');
require('../js/models/naivebayes.js');
require('../js/models/abilityOptimizer.js');
require('../js/telemetry.js');
require('../js/content.js');
require('../js/adaptationEngine.js');
require('../js/simulator.js');

var A = globalThis.AdaptiveUI;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function close(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) {
    throw new Error((msg || 'not close') + ': ' + a + ' vs ' + b + ' (tol ' + tol + ')');
  }
}

console.log('\nThompson Sampling bandit');

test('Beta sampler stays in [0,1] and matches its analytic mean', function () {
  var n = 20000, sum = 0;
  for (var i = 0; i < n; i++) {
    var x = A._sampleBeta(3, 7);
    assert(x >= 0 && x <= 1, 'sample out of range: ' + x);
    sum += x;
  }
  close(sum / n, 3 / 10, 0.01, 'Beta(3,7) mean');
});

test('converges on the highest-reward arm', function () {
  var b = new A.ThompsonBandit(['a', 'b', 'c']);
  var truth = { a: 0.15, b: 0.70, c: 0.30 };
  var picks = { a: 0, b: 0, c: 0 };
  for (var i = 0; i < 3000; i++) {
    var arm = b.select();
    picks[arm]++;
    b.update(arm, Math.random() < truth[arm] ? 1 : 0);
  }
  assert(picks.b > picks.a + picks.c,
    'expected arm b to dominate, got ' + JSON.stringify(picks));
  close(b.estimate('b'), 0.70, 0.08, 'posterior mean for arm b');
});

test('restricting the eligible set is respected', function () {
  var b = new A.ThompsonBandit(['a', 'b', 'c']);
  for (var i = 0; i < 200; i++) {
    assert(b.select(['a', 'c']) !== 'b', 'selected an ineligible arm');
  }
});

test('report is sorted by posterior mean', function () {
  var b = new A.ThompsonBandit(['a', 'b']);
  for (var i = 0; i < 30; i++) { b.update('a', 1); b.update('b', 0); }
  var r = b.report();
  assert(r[0].id === 'a', 'expected arm a first');
  assert(r[0].mean > r[1].mean, 'report not sorted');
});

console.log('\nOnline k-means persona clustering');

test('separates the three planted personas', function () {
  var km = new A.OnlineKMeans(0.05);
  // Vectors drawn near each prototype should recover the right label.
  var samples = {
    focused:    [0.46, 0.18, 0.04, 0.78, 0.60],
    explorer:   [0.82, 0.88, 0.12, 0.22, 0.18],
    struggling: [0.33, 0.42, 0.66, 0.53, 0.01]
  };
  Object.keys(samples).forEach(function (k) {
    var r = km.predict(samples[k]);
    assert(r.id === k, 'expected ' + k + ', got ' + r.id);
    assert(r.confidence > 0.33, 'confidence too low for ' + k + ': ' + r.confidence);
  });
});

test('centroids drift toward observed behaviour', function () {
  var km = new A.OnlineKMeans(0.5);
  var before = km.clusters[0].centroid.slice();
  var v = [1, 1, 1, 1, 1];
  var r = km.predict(v);
  for (var i = 0; i < 10; i++) km.learn(v);
  var moved = km.clusters[r.index].centroid;
  assert(moved.every(function (x, j) { return x > before[j] || before[j] === 1; }),
    'centroid did not move toward the data');
});

test('cluster counts increment on learn only', function () {
  var km = new A.OnlineKMeans();
  km.predict([0.5, 0.5, 0.5, 0.5, 0.5]);
  var total = km.clusters.reduce(function (a, c) { return a + c.count; }, 0);
  assert(total === 0, 'predict() must not train');
  km.learn([0.5, 0.5, 0.5, 0.5, 0.5]);
  total = km.clusters.reduce(function (a, c) { return a + c.count; }, 0);
  assert(total === 1, 'learn() must train');
});

console.log('\nNaive Bayes next-action predictor');

test('recovers a planted conditional dependency', function () {
  var nb = new A.NaiveBayes(['inbox', 'tasks', 'analytics']);
  for (var i = 0; i < 40; i++) {
    nb.train({ timeBucket: 'morning', lastAction: 'none' }, 'inbox');
    nb.train({ timeBucket: 'afternoon', lastAction: 'inbox' }, 'tasks');
    nb.train({ timeBucket: 'evening', lastAction: 'tasks' }, 'analytics');
  }
  assert(nb.predict({ timeBucket: 'morning', lastAction: 'none' })[0].label === 'inbox');
  assert(nb.predict({ timeBucket: 'afternoon', lastAction: 'inbox' })[0].label === 'tasks');
  assert(nb.predict({ timeBucket: 'evening', lastAction: 'tasks' })[0].label === 'analytics');
});

test('probabilities are a valid distribution', function () {
  var nb = new A.NaiveBayes(['a', 'b', 'c']);
  nb.train({ x: '1' }, 'a');
  nb.train({ x: '2' }, 'b');
  var out = nb.predict({ x: '1' });
  var sum = out.reduce(function (s, o) { return s + o.prob; }, 0);
  close(sum, 1, 1e-9, 'probabilities must sum to 1');
  out.forEach(function (o) { assert(o.prob >= 0 && o.prob <= 1, 'prob out of range'); });
});

test('Laplace smoothing keeps unseen values finite', function () {
  var nb = new A.NaiveBayes(['a', 'b']);
  nb.train({ x: 'seen' }, 'a');
  var out = nb.predict({ x: 'never-observed' });
  out.forEach(function (o) {
    assert(isFinite(o.logProb), 'log prob went infinite on an unseen value');
    assert(o.prob > 0, 'probability collapsed to zero');
  });
});

test('is ranked most-probable-first', function () {
  var nb = new A.NaiveBayes(['a', 'b']);
  for (var i = 0; i < 20; i++) nb.train({ x: '1' }, 'a');
  nb.train({ x: '1' }, 'b');
  var r = nb.rank({ x: '1' });
  assert(r[0] === 'a', 'ranking wrong: ' + r.join(','));
});

console.log('\nAbility-based presentation optimiser');

test("Fitts's Law movement time decreases as targets grow", function () {
  var small = A._fittsMT(300, 100, 1.0);
  var large = A._fittsMT(300, 100, 1.6);
  assert(large < small, 'larger target should be faster: ' + large + ' vs ' + small);
});

test('a high miss rate drives larger targets', function () {
  var opt = new A.AbilityOptimizer();
  var r = opt.optimize({
    missRate: 0.40, meanDistance: 400, baseTargetWidth: 110,
    readSlowdown: 0.1, density: 0.3
  });
  assert(r.changed, 'expected an adaptation, got: ' + r.reason);
  assert(r.state.targetScale > 1.0,
    'expected targets to grow, got ' + r.state.targetScale);
});

test('a clean profile leaves the default layout alone', function () {
  var opt = new A.AbilityOptimizer();
  var r = opt.optimize({
    missRate: 0.01, meanDistance: 180, baseTargetWidth: 120,
    readSlowdown: 0.02, density: 0.9
  });
  assert(r.state.targetScale <= 1.15,
    'over-adapted for a competent user: ' + r.state.targetScale);
});

test('hysteresis suppresses churn on marginal gains', function () {
  var opt = new A.AbilityOptimizer();
  var ability = {
    missRate: 0.30, meanDistance: 380, baseTargetWidth: 110,
    readSlowdown: 0.2, density: 0.4
  };
  opt.optimize(ability);            // first adaptation
  var second = opt.optimize(ability); // identical input
  assert(!second.changed, 'layout oscillated on identical input');
});

test('reading difficulty drives a larger font', function () {
  var opt = new A.AbilityOptimizer();
  var r = opt.optimize({
    missRate: 0.03, meanDistance: 200, baseTargetWidth: 120,
    readSlowdown: 0.85, density: 0.2
  });
  assert(r.state.fontScale > 1.0, 'expected font growth, got ' + r.state.fontScale);
});

console.log('\nTelemetry feature extraction');

test('feature vector is 5-dimensional and bounded to [0,1]', function () {
  var t = new A.Telemetry(['a', 'b', 'c']);
  t.enterPanel('a'); t.action('x'); t.pointer(10, 10, true); t.pointer(300, 300, false);
  var v = t.featureVector();
  assert(v.length === 5, 'expected 5 features, got ' + v.length);
  v.forEach(function (x, i) {
    assert(x >= 0 && x <= 1, 'feature ' + i + ' out of range: ' + x);
    assert(!isNaN(x), 'feature ' + i + ' is NaN');
  });
});

test('error rate rises with undos and misses', function () {
  var clean = new A.Telemetry(['a']);
  clean.enterPanel('a');
  for (var i = 0; i < 20; i++) { clean.action('x'); clean.pointer(i * 10, 10, true); }

  var messy = new A.Telemetry(['a']);
  messy.enterPanel('a');
  for (var j = 0; j < 20; j++) {
    messy.action('x'); messy.undo('x'); messy.pointer(j * 10, 10, false);
  }
  assert(messy.featureVector()[2] > clean.featureVector()[2],
    'error-rate feature failed to separate clean from messy behaviour');
});

test('shortcut feature rises with keyboard use', function () {
  var t = new A.Telemetry(['a']);
  t.enterPanel('a');
  for (var i = 0; i < 10; i++) t.shortcut('ctrl+k', 'x');
  assert(t.featureVector()[4] > 0.5, 'shortcut feature did not respond');
});

test('miss rate is reflected in the ability profile', function () {
  var t = new A.Telemetry(['a']);
  for (var i = 0; i < 10; i++) t.pointer(i * 40, 40, i % 2 === 0);
  var ab = t.abilityProfile(120);
  close(ab.missRate, 0.5, 0.01, 'miss rate');
  assert(ab.meanDistance > 0, 'mean distance not measured');
});

test('time buckets partition the day', function () {
  var t = new A.Telemetry(['a']);
  var mk = function (h) { var d = new Date(); d.setHours(h); return d; };
  assert(t.timeBucket(mk(8)) === 'morning');
  assert(t.timeBucket(mk(14)) === 'afternoon');
  assert(t.timeBucket(mk(19)) === 'evening');
  assert(t.timeBucket(mk(2)) === 'night');
});

console.log('\nAdaptationEngine integration');

function makeEngine() {
  var t = new A.Telemetry(A.PANELS.map(function (p) { return p.id; }));
  var e = new A.AdaptationEngine({
    panels: A.PANELS, suggestions: A.SUGGESTIONS, telemetry: t
  });
  return { t: t, e: e };
}

test('produces a well-formed plan on the very first tick', function () {
  var x = makeEngine();
  x.t.enterPanel('inbox');
  var plan = x.e.tick({ force: true });
  assert(Array.isArray(plan.navOrder) && plan.navOrder.length === A.PANELS.length,
    'navOrder malformed');
  assert(plan.presentation && plan.presentation.spacing, 'presentation missing');
  assert(plan.persona && plan.persona.label, 'persona missing');
  assert(['novice', 'intermediate', 'expert'].indexOf(plan.expertiseLevel) >= 0,
    'bad expertise level');
});

test('holds the sidebar steady during cold start', function () {
  var x = makeEngine();
  x.t.enterPanel('inbox');
  var first = x.e.tick({ force: true }).navOrder.join('|');
  x.t.enterPanel('tasks');
  var second = x.e.tick({ force: true }).navOrder.join('|');
  assert(first === second, 'reordered before enough observations were collected');
});

test('reorders the sidebar once the predictor has evidence', function () {
  var x = makeEngine();
  var ctx = {
    timeBucket: 'morning', lastAction: 'inbox',
    persona: 'focused', sessionPhase: 'start'
  };
  for (var i = 0; i < 25; i++) x.e.observeNavigation(ctx, 'analytics');
  x.t.enterPanel('inbox');
  var plan = x.e.tick({ force: true, now: new Date(2026, 0, 1, 9, 0, 0) });
  assert(plan.navOrder.indexOf('analytics') <= 1,
    'expected analytics near the top, got ' + plan.navOrder.join(','));
});

test('manual mode freezes adaptation but keeps sensing', function () {
  var x = makeEngine();
  x.t.enterPanel('inbox');
  x.e.tick({ force: true });
  var frozen = JSON.stringify(x.e.plan.presentation);
  x.e.mode = 'manual';
  for (var i = 0; i < 60; i++) x.t.pointer(i * 30, 90, false); // lots of misses
  x.e.tick();
  assert(JSON.stringify(x.e.plan.presentation) === frozen,
    'presentation changed while adaptation was paused');
  assert(x.t.misses === 60, 'telemetry stopped collecting in manual mode');
});

test('a struggling trace enlarges targets; a fluent trace does not', function () {
  var struggling = makeEngine();
  struggling.t.enterPanel('inbox');
  for (var i = 0; i < 60; i++) {
    struggling.t.action('inbox.reply');
    struggling.t.undo('inbox.reply');
    struggling.t.pointer(100 + i * 17, 200 + (i % 7) * 31, false);
  }
  var sPlan = struggling.e.tick({ force: true });

  var fluent = makeEngine();
  fluent.t.enterPanel('inbox');
  for (var j = 0; j < 60; j++) {
    fluent.t.shortcut('ctrl+' + (j % 5), 'inbox.reply');
    fluent.t.pointer(400 + (j % 3) * 12, 300 + (j % 3) * 9, true);
  }
  var fPlan = fluent.e.tick({ force: true });

  assert(sPlan.presentation.targetScale > fPlan.presentation.targetScale,
    'struggling user did not get larger targets (' +
    sPlan.presentation.targetScale + ' vs ' + fPlan.presentation.targetScale + ')');
});

test('sustained shortcut use raises expertise and reveals advanced features', function () {
  var x = makeEngine();
  x.t.enterPanel('inbox');
  for (var round = 0; round < 40; round++) {
    for (var k = 0; k < 6; k++) x.t.shortcut('ctrl+' + k, 'a' + k);
    x.t.enterPanel(A.PANELS[round % A.PANELS.length].id);
    x.e.tick({ force: true });
  }
  assert(x.e.expertise > 0.35,
    'expertise failed to rise: ' + x.e.expertise.toFixed(3));
  assert(x.e.plan.revealedAdvanced || x.e.plan.expertiseLevel !== 'novice',
    'progressive disclosure never triggered');
});

test('every adaptation carries a human-readable explanation', function () {
  var x = makeEngine();
  x.t.enterPanel('inbox');
  var sawReason = false;
  for (var i = 0; i < 20; i++) {
    x.t.action('inbox.reply');
    x.t.pointer(50 + i * 25, 120, i % 3 !== 0);
    var plan = x.e.tick({ force: true });
    plan.reasons.forEach(function (r) {
      assert(typeof r.kind === 'string' && r.kind.length, 'reason missing a kind');
      assert(typeof r.text === 'string' && r.text.length > 20,
        'reason text too short to be an explanation: ' + r.text);
      sawReason = true;
    });
  }
  assert(sawReason, 'the engine never explained itself');
});

test('bandit feedback flows through the engine', function () {
  var x = makeEngine();
  var id = A.SUGGESTIONS[0].id;
  var before = x.e.bandit.estimate(id);
  for (var i = 0; i < 15; i++) x.e.observeSuggestionOutcome(id, true);
  assert(x.e.bandit.estimate(id) > before, 'positive feedback had no effect');
  for (var j = 0; j < 40; j++) x.e.observeSuggestionOutcome(id, false);
  assert(x.e.bandit.estimate(id) < 0.6, 'negative feedback had no effect');
});

test('model export/import round-trips', function () {
  var x = makeEngine();
  x.t.enterPanel('inbox');
  for (var i = 0; i < 10; i++) {
    x.e.observeSuggestionOutcome(A.SUGGESTIONS[1].id, true);
    x.e.observeNavigation({ timeBucket: 'morning', lastAction: 'inbox' }, 'tasks');
  }
  x.e.tick({ force: true });
  var blob = JSON.parse(JSON.stringify(x.e.exportModel()));

  var y = makeEngine();
  y.e.importModel(blob);
  close(y.e.bandit.estimate(A.SUGGESTIONS[1].id),
        x.e.bandit.estimate(A.SUGGESTIONS[1].id), 1e-9, 'bandit did not round-trip');
  assert(y.e.predictor.observations() === x.e.predictor.observations(),
    'predictor did not round-trip');
});

test('reset returns the engine to its initial state', function () {
  var x = makeEngine();
  x.t.enterPanel('inbox');
  for (var i = 0; i < 20; i++) {
    x.e.observeSuggestionOutcome(A.SUGGESTIONS[2].id, true);
    x.t.shortcut('ctrl+a', 'x');
  }
  x.e.tick({ force: true });
  x.e.resetModel();
  assert(x.e.expertise === 0, 'expertise not cleared');
  assert(x.e.predictor.observations() === 0, 'predictor not cleared');
  close(x.e.bandit.estimate(A.SUGGESTIONS[2].id), 0.5, 1e-9, 'bandit not cleared');
});

console.log('\nSimulator');

test('each profile produces the behaviour signature it claims', function () {
  var results = {};
  ['focused', 'explorer', 'struggling'].forEach(function (name) {
    var t = new A.Telemetry(A.PANELS.map(function (p) { return p.id; }));
    var e = new A.AdaptationEngine({
      panels: A.PANELS, suggestions: A.SUGGESTIONS, telemetry: t
    });
    var profile = A.SIM_PROFILES[name];
    // Drive telemetry synchronously with the same distributions the
    // browser simulator uses, without the setTimeout pacing.
    for (var step = 0; step < 40; step++) {
      var panelId = profile.panels[step % profile.panels.length];
      t.enterPanel(panelId);
      t.pointer(Math.random() * 900, Math.random() * 600,
                Math.random() >= profile.missProb);
      for (var k = 0; k < 3; k++) {
        if (Math.random() < profile.shortcutProb) t.shortcut('ctrl+k', 'a');
        else t.action('a', { panel: panelId });
        if (Math.random() < profile.undoProb) t.undo('a');
      }
    }
    var v = t.featureVector();
    results[name] = { vector: v, plan: e.tick({ force: true }) };
  });

  assert(results.struggling.vector[2] > results.focused.vector[2],
    'struggling profile should show a higher error rate');
  assert(results.focused.vector[4] > results.struggling.vector[4],
    'focused profile should show more shortcut use');
  assert(results.explorer.vector[1] >= results.focused.vector[1],
    'explorer profile should show broader navigation');
});

/* ------------------------------------------------------------------------ */

console.log('\n' + '-'.repeat(52));
console.log(passed + ' passed, ' + failed + ' failed');
console.log('-'.repeat(52) + '\n');
process.exit(failed === 0 ? 0 : 1);
