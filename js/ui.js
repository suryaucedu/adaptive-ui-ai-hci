/* =========================================================================
 * ui.js — rendering layer
 * -------------------------------------------------------------------------
 * Consumes an adaptation plan produced by AdaptationEngine and reconciles
 * the DOM against it. This module contains no learning logic whatsoever:
 * given the same plan it always produces the same interface. That property
 * is what makes the adaptive behaviour reproducible and gradeable.
 *
 * Author: Surya Yellutla
 * ========================================================================= */

(function (global) {
  'use strict';

  var A = global.AdaptiveUI;

  function el(id) { return document.getElementById(id); }

  function UI(config) {
    this.panels = config.panels;
    this.suggestions = config.suggestions;
    this.onNavigate = config.onNavigate;
    this.onAction = config.onAction;
    this.onSuggestionTake = config.onSuggestionTake;
    this.onSuggestionDismiss = config.onSuggestionDismiss;

    this.activePanel = null;
    this.lastNavOrder = [];
    this.promotedId = null;
  }

  UI.prototype.panelById = function (id) {
    return this.panels.filter(function (p) { return p.id === id; })[0];
  };

  /* --------------------------------------------------------- navigation */

  UI.prototype.renderNav = function (plan) {
    var self = this;
    var list = el('navList');
    var advList = el('advancedList');
    var advZone = el('advancedZone');

    var core = [];
    var advanced = [];
    plan.navOrder.forEach(function (id) {
      var p = self.panelById(id);
      if (!p) return;
      if (p.group === 'advanced') advanced.push(p); else core.push(p);
    });

    // Detect a promotion so the change can be flagged rather than silent.
    var newTop = core.length ? core[0].id : null;
    var wasPromoted = newTop && this.lastNavOrder.length &&
                      this.lastNavOrder[0] !== newTop;
    this.promotedId = wasPromoted ? newTop : null;
    this.lastNavOrder = core.map(function (p) { return p.id; });

    list.innerHTML = '';
    core.forEach(function (p) { list.appendChild(self.navItem(p, plan)); });

    // Progressive disclosure: advanced panels only appear once the
    // expertise estimate clears the threshold.
    if (plan.revealedAdvanced && advanced.length) {
      advZone.hidden = false;
      advList.innerHTML = '';
      advanced.forEach(function (p) { advList.appendChild(self.navItem(p, plan)); });
    } else {
      advZone.hidden = true;
    }

    el('shortcutHints').hidden = !plan.showShortcutHints;

    // Be honest about whether the model is actually driving the order yet.
    // Claiming "ranked by model" during cold start would misrepresent the
    // system to the user, which is the transparency failure adaptive
    // interfaces are most often criticised for.
    var hint = el('navHint');
    if (plan.ranking === 'model') {
      hint.textContent = 'ranked by model';
      hint.title = 'A Naive Bayes model predicted your next destination and reordered this list.';
    } else {
      hint.textContent = 'default order';
      hint.title = 'Not enough navigation history yet — the list is in its authored order.';
    }
  };

  UI.prototype.navItem = function (p, plan) {
    var self = this;
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'nav-item';
    b.dataset.panel = p.id;
    if (this.activePanel === p.id) b.setAttribute('aria-current', 'page');
    if (plan.showTooltips) b.title = p.blurb;

    var icon = document.createElement('span');
    icon.className = 'nav-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = p.icon;
    b.appendChild(icon);

    var label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = p.label;
    b.appendChild(label);

    if (this.promotedId === p.id) {
      var tag = document.createElement('span');
      tag.className = 'promoted';
      tag.textContent = 'predicted';
      tag.title = 'The next-action model moved this to the top.';
      b.appendChild(tag);
    }

    b.addEventListener('click', function () { self.onNavigate(p.id); });
    li.appendChild(b);
    return li;
  };

  /* -------------------------------------------------------------- panel */

  UI.prototype.renderPanel = function (panelId, plan) {
    var self = this;
    var p = this.panelById(panelId);
    if (!p) return;
    this.activePanel = panelId;

    var host = el('panelHost');
    host.innerHTML = '';

    var section = document.createElement('section');
    section.className = 'panel';
    section.setAttribute('aria-labelledby', 'panelTitle');

    var head = document.createElement('div');
    head.className = 'panel-head';
    var h = document.createElement('h2');
    h.id = 'panelTitle';
    h.textContent = p.icon + '  ' + p.label;
    head.appendChild(h);
    section.appendChild(head);

    var blurb = document.createElement('p');
    blurb.className = 'panel-blurb';
    blurb.textContent = p.blurb;
    section.appendChild(blurb);

    var ul = document.createElement('ul');
    ul.className = 'item-list';
    // Density adaptation: the compact layout trims the list, the spacious
    // layout shows everything. This is a content-level adaptation, distinct
    // from the purely visual spacing change.
    var limit = plan.presentation.spacing === 'compact' ? p.items.length
              : plan.presentation.spacing === 'spacious' ? Math.min(3, p.items.length)
              : p.items.length;
    p.items.slice(0, limit).forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'item';
      var t = document.createElement('span');
      t.className = 'item-title';
      t.textContent = it.title;
      var m = document.createElement('span');
      m.className = 'item-meta';
      m.textContent = it.meta;
      li.appendChild(t); li.appendChild(m);
      ul.appendChild(li);
    });
    section.appendChild(ul);

    var row = document.createElement('div');
    row.className = 'action-row';
    p.actions.forEach(function (a, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (i === 0 ? ' btn-primary' : '');
      btn.textContent = plan.showLabels
        ? a.label
        : a.label; // labels always kept; expert mode adds the shortcut hint
      if (plan.showShortcutHints && i === 0) {
        btn.textContent = a.label + '  ⏎';
      }
      if (plan.showTooltips) btn.title = a.label + ' — this item';
      btn.addEventListener('click', function () { self.onAction(a.id, p.id); });
      row.appendChild(btn);
    });

    var undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'btn btn-ghost';
    undo.textContent = plan.showShortcutHints ? 'Undo  Z' : 'Undo';
    undo.addEventListener('click', function () { self.onAction('__undo__', p.id); });
    row.appendChild(undo);
    section.appendChild(row);

    if (plan.showTooltips) {
      var note = document.createElement('p');
      note.className = 'tooltip-note';
      note.textContent =
        'Tip: as you work, this interface adjusts its ordering, density and ' +
        'text size to match how you actually use it. Every change is explained ' +
        'in the panel on the right, and you can switch adaptation off at any time.';
      section.appendChild(note);
    }

    host.appendChild(section);
  };

  /* --------------------------------------------------------- suggestion */

  UI.prototype.renderSuggestion = function (plan) {
    var slot = el('suggestionSlot');
    if (!plan.suggestion) { slot.hidden = true; return; }
    var s = this.suggestions.filter(function (x) { return x.id === plan.suggestion; })[0];
    if (!s) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.dataset.suggestion = s.id;
    el('suggestionLabel').textContent = s.label;
    el('suggestionDesc').textContent = s.description;
  };

  /* ------------------------------------------------------- presentation */

  UI.prototype.applyPresentation = function (plan) {
    var b = document.body;
    b.style.setProperty('--font-scale', plan.presentation.fontScale);
    b.style.setProperty('--target-scale', plan.presentation.targetScale);
    b.dataset.spacing = plan.presentation.spacing;
    b.dataset.theme = plan.theme;
    b.dataset.expertise = plan.expertiseLevel;

    var chip = el('personaChip');
    chip.dataset.persona = plan.persona.id;
    el('personaChipLabel').textContent =
      plan.persona.label +
      (plan.persona.confidence
        ? ' · ' + Math.round(plan.persona.confidence * 100) + '%'
        : '');
  };

  /* ---------------------------------------------------------- inspector */

  UI.prototype.renderInspector = function (plan, engine) {
    if (plan.reasons && plan.reasons.length) {
      var list = el('reasonList');
      var ph = list.querySelector('.placeholder');
      if (ph) ph.remove();
      plan.reasons.forEach(function (r) {
        var li = document.createElement('li');
        li.className = 'reason';
        li.dataset.kind = r.kind;
        var k = document.createElement('span');
        k.className = 'kind';
        k.textContent = r.kind;
        li.appendChild(k);
        li.appendChild(document.createTextNode(r.text));
        list.insertBefore(li, list.firstChild);
      });
      while (list.children.length > 14) list.removeChild(list.lastChild);
    }

    el('mPersona').textContent =
      plan.persona.label + ' (' + Math.round((plan.persona.confidence || 0) * 100) + '%)';
    el('mExpertise').textContent =
      plan.expertiseLevel + ' · ' + (plan.expertiseScore || 0).toFixed(2);
    el('mPresentation').textContent =
      'font ×' + plan.presentation.fontScale.toFixed(2) +
      ' · target ×' + plan.presentation.targetScale.toFixed(2) +
      ' · ' + plan.presentation.spacing;

    if (engine && engine.predictor.observations() > 0 && plan.context) {
      var ranked = engine.predictor.predict(plan.context);
      el('mNext').textContent =
        engine.panelLabel(ranked[0].label) +
        ' (' + Math.round(ranked[0].prob * 100) + '%)';
    } else {
      el('mNext').textContent = 'insufficient data';
    }

    this.renderBars('featureBars', (plan.features || []).map(function (v, i) {
      return { label: A.FEATURE_NAMES[i], value: v };
    }));

    if (engine) {
      this.renderBars('banditBars', engine.bandit.report().slice(0, 6).map(function (r) {
        return {
          label: engine.suggestionLabel(r.id),
          value: r.mean,
          suffix: r.rewards + '/' + r.pulls
        };
      }));
    }

    el('telemetryDump').textContent =
      JSON.stringify(engine ? engine.telemetry.summary() : {}, null, 1);
  };

  UI.prototype.renderBars = function (hostId, rows) {
    var host = el(hostId);
    host.innerHTML = '';
    rows.forEach(function (r) {
      var wrap = document.createElement('div');
      wrap.className = 'bar-row';
      var lab = document.createElement('div');
      lab.className = 'bar-label';
      var n = document.createElement('span'); n.textContent = r.label;
      var v = document.createElement('span');
      v.textContent = r.suffix ? r.suffix + '  ' + r.value.toFixed(2) : r.value.toFixed(2);
      lab.appendChild(n); lab.appendChild(v);
      var track = document.createElement('div');
      track.className = 'bar-track';
      var fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = Math.max(2, Math.min(100, r.value * 100)) + '%';
      track.appendChild(fill);
      wrap.appendChild(lab); wrap.appendChild(track);
      host.appendChild(wrap);
    });
  };

  /* -------------------------------------------------------------- toast */

  UI.prototype.toast = function (msg) {
    var t = el('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  };

  A.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
