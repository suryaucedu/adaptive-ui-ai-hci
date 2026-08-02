/* =========================================================================
 * content.js — the static content model of the workspace
 * -------------------------------------------------------------------------
 * Kept separate from the adaptation logic so the same engine could be
 * dropped onto a different application by swapping this file. Panels are
 * ordinary content; the interesting part is that their *order*, *density*,
 * *labelling* and *visibility* are all decided at runtime.
 *
 * Author: Surya Yellutla
 * ========================================================================= */

(function (global) {
  'use strict';

  var PANELS = [
    {
      id: 'inbox', label: 'Inbox', icon: '✉', group: 'core',
      blurb: 'Messages routed to you, newest first.',
      items: [
        { title: 'Sprint 14 retro notes', meta: 'Priya · 8 min ago' },
        { title: 'Vendor contract needs a signature', meta: 'Legal · 41 min ago' },
        { title: 'Re: latency spike on the ingest queue', meta: 'Marcus · 2 h ago' },
        { title: 'Onboarding checklist for the new analyst', meta: 'People Ops · yesterday' }
      ],
      actions: [
        { id: 'inbox.reply', label: 'Reply' },
        { id: 'inbox.archive', label: 'Archive' },
        { id: 'inbox.flag', label: 'Flag' }
      ]
    },
    {
      id: 'tasks', label: 'Tasks', icon: '☑', group: 'core',
      blurb: 'Work assigned to you across every project.',
      items: [
        { title: 'Draft the Q3 capacity model', meta: 'Due Friday · High' },
        { title: 'Review PR #2841 — telemetry batching', meta: 'Due today · Medium' },
        { title: 'Update the incident runbook', meta: 'No due date · Low' },
        { title: 'Confirm vendor SOC 2 renewal', meta: 'Due Monday · High' }
      ],
      actions: [
        { id: 'tasks.complete', label: 'Mark done' },
        { id: 'tasks.assign', label: 'Reassign' },
        { id: 'tasks.snooze', label: 'Snooze' }
      ]
    },
    {
      id: 'analytics', label: 'Analytics', icon: '◆', group: 'core',
      blurb: 'Usage and performance trends for the last 30 days.',
      items: [
        { title: 'Weekly active users', meta: '18,402  ▲ 6.1%' },
        { title: 'Median session length', meta: '11 m 24 s  ▲ 2.0%' },
        { title: 'Task completion rate', meta: '73.5%  ▼ 1.4%' },
        { title: 'p95 response time', meta: '412 ms  ▲ 18 ms' }
      ],
      actions: [
        { id: 'analytics.filter', label: 'Filter range' },
        { id: 'analytics.export', label: 'Export CSV' },
        { id: 'analytics.compare', label: 'Compare cohorts' }
      ]
    },
    {
      id: 'documents', label: 'Documents', icon: '▤', group: 'core',
      blurb: 'Files you own or were recently shared with.',
      items: [
        { title: 'Adaptive UI literature review.docx', meta: 'Edited 20 min ago' },
        { title: 'FY26 headcount plan.xlsx', meta: 'Edited yesterday' },
        { title: 'Ingest architecture v3.pdf', meta: 'Shared by Marcus' },
        { title: 'Accessibility audit findings.md', meta: 'Edited 3 days ago' }
      ],
      actions: [
        { id: 'documents.open', label: 'Open' },
        { id: 'documents.share', label: 'Share' },
        { id: 'documents.version', label: 'Version history' }
      ]
    },
    {
      id: 'calendar', label: 'Calendar', icon: '▦', group: 'core',
      blurb: 'Today and the rest of the week.',
      items: [
        { title: '09:30  Standup', meta: '15 min · Engineering' },
        { title: '11:00  HCI project checkpoint', meta: '45 min · with instructor' },
        { title: '14:00  Vendor review', meta: '1 h · Procurement' },
        { title: '16:30  Focus block', meta: '90 min · no meetings' }
      ],
      actions: [
        { id: 'calendar.schedule', label: 'New event' },
        { id: 'calendar.decline', label: 'Decline' },
        { id: 'calendar.focus', label: 'Protect focus time' }
      ]
    },
    {
      id: 'reports', label: 'Reports', icon: '❐', group: 'advanced',
      blurb: 'Saved and scheduled reporting.',
      items: [
        { title: 'Monthly reliability summary', meta: 'Runs 1st of month' },
        { title: 'Adoption funnel by segment', meta: 'Runs weekly' },
        { title: 'Support backlog ageing', meta: 'Runs daily' }
      ],
      actions: [
        { id: 'reports.run', label: 'Run now' },
        { id: 'reports.schedule', label: 'Schedule' },
        { id: 'reports.duplicate', label: 'Duplicate' }
      ]
    },
    {
      id: 'automation', label: 'Automation', icon: '⚙', group: 'advanced',
      blurb: 'Rules that act on your behalf. Revealed once the system judges you ready.',
      items: [
        { title: 'Auto-archive newsletters after 7 days', meta: 'Active · 214 runs' },
        { title: 'Escalate P1 incidents to on-call', meta: 'Active · 3 runs' },
        { title: 'Weekly digest to the leadership channel', meta: 'Paused' }
      ],
      actions: [
        { id: 'automation.create', label: 'New rule' },
        { id: 'automation.test', label: 'Dry run' },
        { id: 'automation.disable', label: 'Disable' }
      ]
    }
  ];

  var SUGGESTIONS = [
    {
      id: 'sg.triage', label: 'Triage your inbox', panel: 'inbox',
      description: '4 unread messages, two flagged as needing a reply today.'
    },
    {
      id: 'sg.duetoday', label: 'Two tasks are due today', panel: 'tasks',
      description: 'PR #2841 and the vendor SOC 2 confirmation are both open.'
    },
    {
      id: 'sg.p95', label: 'p95 latency moved 18 ms', panel: 'analytics',
      description: 'Worth a look before the reliability report runs on the 1st.'
    },
    {
      id: 'sg.resume', label: 'Resume the literature review', panel: 'documents',
      description: 'You were editing it 20 minutes ago and left it unsaved.'
    },
    {
      id: 'sg.focus', label: 'Protect this afternoon', panel: 'calendar',
      description: 'Your 16:30 focus block has no meetings around it yet.'
    },
    {
      id: 'sg.digest', label: 'The leadership digest is paused', panel: 'automation',
      description: 'It has not run for three weeks. Re-enable or delete it?'
    }
  ];

  global.AdaptiveUI = global.AdaptiveUI || {};
  global.AdaptiveUI.PANELS = PANELS;
  global.AdaptiveUI.SUGGESTIONS = SUGGESTIONS;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AdaptiveUI;
}
