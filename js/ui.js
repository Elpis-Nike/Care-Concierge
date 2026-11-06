// Screens: senior view (voice-first), relative app, audit log, digital Vollmacht, onboarding, demo controls.
(function () {
  var CC = window.CC;
  var ui = CC.ui = { view: 'senior', openWhy: {}, typing: false, heard: '', onboardStep: 0 };

  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function lvl(level) { return CC.LEVELS[level] || CC.LEVELS.green; }

  var STATUS_LABEL = { idle: 'Watching', working: 'Working', waiting: 'Needs your OK', paused: 'Paused' };

  // ---------- senior view ----------
  function seniorView(w) {
    var hour = new Date(w.now).getHours();
    var greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    var upcoming = w.appointments.filter(function (a) { return a.status === 'booked' && a.time > w.now; })
      .sort(function (a, b) { return a.time - b.time; });
    var approvals = w.approvals.filter(function (a) { return a.status === 'pending'; });
    var docs = w.documents.slice().reverse();

    return '' +
      '<section class="greet"><h1>' + greet + ', ' + h(w.senior.short) + '</h1>' +
      '<p class="muted">' + h(CC.fmt.day(w.now)) + ' · ' + h(CC.fmt.time(w.now)) + '</p></section>' +

      '<section class="status status-' + w.status.mode + '">' +
      '<span class="pulse"></span><div><strong>' + STATUS_LABEL[w.status.mode] + '</strong><p>' + h(w.status.text) + '</p></div>' +
      (w.paused ? '<button class="btn btn-primary" data-act="resume">Resume</button>' : '') + '</section>' +

      approvals.map(function (a) { return approvalCard(a, 'Margaret'); }).join('') +
      medNowCard(w) +

      '<h2>Coming up</h2>' +
      (upcoming.length ? '<ul class="appts">' + upcoming.slice(0, 4).map(function (a) {
        var p = CC.practices[a.practiceId];
        var tr = w.transports.filter(function (t) { return t.id === a.transportId && t.status === 'booked'; })[0];
        return '<li><div class="when"><span>' + h(new Date(a.time).toLocaleDateString('en-GB', { weekday: 'short' })) + '</span><b>' +
          new Date(a.time).getDate() + '</b><span>' + h(new Date(a.time).toLocaleDateString('en-GB', { month: 'short' })) + '</span></div>' +
          '<div class="what"><b>' + h(a.title) + '</b><span>' + h(CC.fmt.time(a.time)) + ' · ' + h(p.name) + '</span>' +
          (tr ? '<span class="tag">🚕 Car at ' + h(CC.fmt.time(tr.pickup)) + '</span>' : (p.distanceKm >= 2 ? '<span class="tag tag-warn">No ride yet</span>' : '')) +
          '</div></li>';
      }).join('') + '</ul>' : '<p class="muted">Nothing planned.</p>') +

      (docs.length ? '<h2>Papers I prepared</h2><ul class="docs">' + docs.map(function (d) {
        return '<li><b>' + h(d.title) + '</b><span>' + (d.status === 'submitted' ? '✅ Sent to ' : '📝 Draft for ') + h(d.to) + '</span></li>';
      }).join('') + '</ul>' : '') +

      '<h2>Our conversation</h2>' + chatList(w.chat.slice(-6), 'senior') +
      '<div class="chips">' + ['What is coming up?', 'Taken', 'What medicine now?', 'Which cardiologists are there?', 'Book Dr. Hoffmann', 'What did the doctor write?', 'Can I take two tablets?', 'Why did you do that?', 'Undo']
        .map(function (c) { return '<button class="chip" data-act="say" data-text="' + h(c) + '">' + h(c) + '</button>'; }).join('') + '</div>';
  }

  function medNowCard(w) {
    var open = CC.health.openDoses(w);
    if (!open.length) return '';
    return '<section class="medcard"><div class="lvl">💊 Tablets now (' + h(CC.fmt.time(open[0].time)) + ')</div><ul>' +
      open.map(function (d) { var m = CC.health.med(w, d.medId); return '<li><b>' + h(m.drug + ' ' + m.strength) + '</b> – ' + h(m.dose) + '</li>'; }).join('') +
      '</ul><button class="btn btn-yes wide" data-act="taken">✔ I have taken them</button>' +
      '<p class="muted small">Exactly as in your medication plan. I never change a dose.</p></section>';
  }

  // ---------- health view ----------
  function healthView(w) {
    var STATUS = { taken: '✔ taken', due: '⏳ due', reminded: '⏳ reminded', missed: '✖ not confirmed' };
    var upcoming = w.appointments.filter(function (a) { return a.status === 'booked' && !a.done && a.time > w.now; })
      .sort(function (a, b) { return a.time - b.time; });
    return '' +
      medNowCard(w) +
      '<h2>Medication plan</h2><ul class="meds">' + w.medPlan.map(function (m) {
        return '<li><div><b>' + h(m.drug + ' ' + m.strength) + '</b> · ' + h(m.dose) + ' · ' + m.times.map(function (x) { return (x < 10 ? '0' : '') + x + ':00'; }).join(', ') +
          '<span class="small muted">' + h(m.purpose) + ' · prescribed by ' + h(m.prescribedBy) + '</span>' +
          '<span class="small muted">Authorisation: ' + h(m.source) + '</span></div>' +
          '<span class="stock' + (m.stock <= 5 ? ' low' : '') + '">' + m.stock + ' left' + (m.rxRequested ? ' · new Rx requested' : '') + '</span></li>';
      }).join('') + '</ul>' +
      '<p class="muted small">Source: federal medication plan / ePA medication list. Changes only by the doctor.</p>' +

      '<h2>Dose log</h2>' + (w.doses.length ? '<ul class="doselog">' + w.doses.slice().reverse().slice(0, 8).map(function (d) {
        var m = CC.health.med(w, d.medId);
        return '<li class="st-' + d.status + '"><span>' + h(CC.fmt.short(d.time)) + '</span><b>' + h(m.drug) + '</b><span>' + STATUS[d.status] + '</span></li>';
      }).join('') + '</ul>' : '<p class="muted small">No doses due yet in this demo. Use "💊 Tablets due now".</p>') +

      '<h2>Appointments & procedures</h2>' + (upcoming.length ? '<ul class="docs">' + upcoming.map(function (a) {
        return '<li><b>' + h(a.title) + (a.kind === 'procedure' ? ' (procedure)' : '') + '</b><span>' + h(CC.fmt.short(a.time)) + ' · ' + h(CC.practices[a.practiceId].name) + '</span>' +
          (a.prep ? '<span class="prep">Preparation: ' + h(a.prep) + '</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="muted small">Nothing planned.</p>') +

      '<h2>Health record (ePA)</h2>' +
      '<label class="switchrow"><input type="checkbox" data-act="epa"' + (w.epa.consent ? ' checked' : '') + '><span>Allow the Concierge to read my ePA <b>when a task needs it</b></span></label>' +
      '<ul class="docs">' + w.epa.docs.slice().sort(function (a, b) { return b.date - a.date; }).map(function (d) {
        return '<li><b>' + h(d.type + ': ' + d.title) + '</b><span>' + h(CC.fmt.day(d.date)) + ' · ' + h(d.from) + '</span><span>' + h(d.summary) + '</span></li>';
      }).join('') + '</ul>' +
      '<p class="small"><b>Access log</b> ' + (w.epa.accessLog.length ? w.epa.accessLog.slice(0, 4).map(function (x) {
        return '<br>' + h(CC.fmt.short(x.time)) + ' – ' + h(x.doc) + ' – ' + h(x.purpose); }).join('') : '– not accessed yet.') + '</p>' +

      '<h2>Contacts to keep informed</h2>' + w.contacts.map(function (c) {
        var last = w.messages.filter(function (m) { return m.to === c.id; })[0];
        return '<section class="card contact"><b>' + h(c.name) + '</b> <span class="muted small">' + h(c.relation) + ' · ' + h(c.phone) + '</span>' +
          '<label class="field">What may ' + h(c.short) + ' learn?<select data-act="cdetail" data-id="' + c.id + '">' +
          '<option value="basic"' + (c.detail === 'basic' ? ' selected' : '') + '>Basic: time, place, type</option>' +
          '<option value="full"' + (c.detail === 'full' ? ' selected' : '') + '>Also medical details</option></select></label>' +
          '<div class="stages">' + ['before', 'during', 'after'].map(function (s) {
            return '<label><input type="checkbox" data-act="cstage" data-id="' + c.id + '" data-stage="' + s + '"' + (c.stages[s] ? ' checked' : '') + '> ' + s + '</label>';
          }).join('') + '<label><input type="checkbox" data-act="cmissed" data-id="' + c.id + '"' + (c.missedDose ? ' checked' : '') + '> missed tablets</label></div>' +
          '<p class="small muted">Emergencies: always informed. ' + (last ? 'Last message: "' + h(last.text) + '"' : 'No messages yet.') + '</p></section>';
      }).join('');
  }

  function chatList(items, perspective) {
    if (!items.length) return '<p class="muted">Tap the microphone and talk to me.</p>';
    return '<div class="chat">' + items.map(function (m) {
      var mine = (perspective === 'senior' && m.from === 'senior') || (perspective === 'anna' && m.from === 'anna');
      var who = m.from === 'concierge' ? 'Concierge' : m.from === 'anna' ? 'Anna' : 'Margaret';
      return '<div class="bubble ' + (mine ? 'me' : m.from) + (m.urgent ? ' urgent' : '') + '"><small>' + who + ' · ' + h(CC.fmt.time(m.time)) + '</small>' + h(m.text) + '</div>';
    }).join('') + '</div>';
  }

  function approvalCard(a, viewer) {
    var canAct = viewer === 'Margaret' || a.approver === 'either';
    // "Send 3 applications: A; B; C." → heading plus a readable list
    var detail = '<p class="big">' + h(a.detail) + '</p>';
    var m = a.detail.match(/^([^:]+):\s*(.+;.+)$/);
    if (m) {
      detail = '<p class="big">' + h(m[1]) + ':</p><ul>' + m[2].replace(/\.$/, '').split(/;\s*/).map(function (x) { return '<li>' + h(x) + '</li>'; }).join('') + '</ul>';
    }
    return '<section class="approval"><div class="lvl">🔴 ' + (viewer === 'Margaret' ? 'Needs your OK' : 'Approval for Margaret') + '</div>' +
      detail + '<p class="muted small">' + h(a.reason) + '</p>' +
      (canAct ? '<div class="row"><button class="btn btn-yes" data-act="approve" data-id="' + a.id + '" data-by="' + viewer + '">Yes, go ahead</button>' +
        '<button class="btn btn-no" data-act="reject" data-id="' + a.id + '" data-by="' + viewer + '">No</button></div>'
        : '<p class="small">Only Margaret can confirm this one.</p>') + '</section>';
  }

  function annaMsgs(w) { return w.messages.filter(function (m) { return !m.to || m.to === 'anna'; }); }

  // ---------- relative view ----------
  function relativeView(w) {
    var v = w.vollmacht;
    var role = { approve: 'can see bookings and confirm 🔴 steps', inform: 'is kept informed only', none: 'has no access' }[v.relativeRole];
    var approvals = w.approvals.filter(function (a) { return a.status === 'pending'; });
    return '' +
      '<section class="rel-head"><div class="avatar">AW</div><div><b>' + h(w.relative.name) + '</b><p class="muted small">Daughter · ' + h(w.relative.city) + ' · ' + role + '</p></div></section>' +
      '<p class="privacy">🔒 Anna sees appointments, rides, papers and safety alerts. She does <b>not</b> see Margaret\'s conversations. Margaret can change this at any time.</p>' +
      (v.relativeRole === 'none' || !w.consent.relative ? '<p class="muted">Margaret has switched off Anna\'s access.</p>' :
        approvals.map(function (a) { return approvalCard(a, 'Anna'); }).join('') +
        '<h2>Messages from the Concierge</h2>' +
        (annaMsgs(w).length ? '<ul class="feed">' + annaMsgs(w).map(function (m) {
          return '<li class="lvl-' + m.level + '"><span class="dot">' + lvl(m.level).icon + '</span><div><p>' + h(m.text) + '</p><small>' + h(CC.fmt.short(m.time)) + '</small></div></li>';
        }).join('') + '</ul>' : '<p class="muted">No messages yet.</p>') +
        '<h2>Ask the Concierge for Margaret</h2>' +
        '<div class="chips">' + ['Mum is starting chemotherapy next month', 'Book Mum a cardiologist', 'What is coming up?']
          .map(function (c) { return '<button class="chip" data-act="say-anna" data-text="' + h(c) + '">' + h(c) + '</button>'; }).join('') + '</div>' +
        '<form class="ask" data-form="anna"><input name="q" placeholder="Type a request…" autocomplete="off"><button class="btn btn-primary">Send</button></form>' +
        '<p class="muted small">Requests from Anna that change Margaret\'s plans always need Margaret\'s own OK (duty of loyalty).</p>');
  }

  // ---------- audit log ----------
  function logView(w) {
    if (!w.log.length) return '<h2>Activity log</h2><p class="muted">Every action, with its reason, will appear here.</p>';
    return '<h2>Activity log</h2><p class="muted small">Everything the Concierge did, why, and under which rule. Margaret can undo actions.</p><ul class="log">' +
      w.log.map(function (e) {
        var open = ui.openWhy[e.id];
        return '<li class="lvl-' + e.level + (e.undone ? ' undone' : '') + (e.blocked ? ' blocked' : '') + '">' +
          '<div class="meta">' + lvl(e.level).icon + ' ' + h(CC.fmt.short(e.time)) + ' · ' + h(e.actor) + (e.informed ? ' · informed' : '') + '</div>' +
          '<div class="t">' + h(e.title) + (e.undone ? ' <span class="tag">undone</span>' : '') + '</div>' +
          (e.summary ? '<p>' + h(e.summary) + '</p>' : '') +
          '<div class="row">' + (e.why ? '<button class="link" data-act="why" data-id="' + e.id + '">' + (open ? 'Hide' : 'Why?') + '</button>' : '') +
          (e.undo && !e.undone ? '<button class="link" data-act="undo" data-id="' + e.id + '">↩ Undo</button>' : '') + '</div>' +
          (open ? '<div class="why"><p><b>Reason:</b> ' + h(e.why) + '</p>' + (e.policy ? '<p><b>Rule check:</b> ' + h(e.policy) + '</p>' : '') +
            (e.transcript ? '<div class="transcript"><b>Call transcript (agent ↔ practice AI)</b>' + e.transcript.map(function (l) {
              return '<p><i>' + h(l[0]) + ':</i> ' + h(l[1]) + '</p>';
            }).join('') + '</div>' : '') + '</div>' : '') +
          '</li>';
      }).join('') + '</ul>';
  }

  // ---------- digital Vollmacht & settings ----------
  function vollmachtView(w) {
    var v = w.vollmacht;
    var groups = Object.keys(CC.ACTIONS).filter(function (k) { return CC.ACTIONS[k].perm; });
    var seen = {};
    var perms = groups.map(function (k) { return CC.ACTIONS[k].perm; }).filter(function (p) { if (seen[p]) return false; seen[p] = true; return true; });
    return '' +
      '<section class="card vm"><div class="vm-head"><span>📜</span><div><b>Digital Vollmacht</b><p class="small muted">' + h(v.id) + ' · granted by ' + h(v.grantedBy) + ' on ' + h(CC.fmt.day(v.grantedAt)) +
      '<br>valid until ' + h(CC.fmt.day(v.validUntil)) + ' · revocable at any time</p></div></div>' +
      '<p class="small">This defines what the Concierge may do <b>for Margaret</b>. It is an instruction framework from Margaret – it does not replace a legal power of attorney (Vorsorgevollmacht) or a court-appointed guardian.</p></section>' +

      '<h2>The traffic light</h2><ul class="legend">' +
      '<li>🟢 <b>Acts alone</b> – reminders, information, moving a routine check-up</li>' +
      '<li>🟡 <b>Acts, then informs</b> – new bookings, rides (within the cost limit)</li>' +
      '<li>🔴 <b>Prepares, a human confirms</b> – sharing medical details, sending applications, anything above the cost limit</li>' +
      '<li>🛟 <b>Safety</b> – emergencies and crises always lead to human help</li></ul>' +

      '<h2>What the Concierge may do</h2><ul class="perms">' + perms.map(function (p) {
        var level = groups.filter(function (k) { return CC.ACTIONS[k].perm === p; }).map(function (k) { return lvl(CC.ACTIONS[k].level).icon; })[0];
        return '<li><label><input type="checkbox" data-act="perm" data-key="' + p + '"' + (v.permissions[p] ? ' checked' : '') + '><span>' + level + ' ' + h(CC.PERMISSION_LABELS[p]) + '</span></label></li>';
      }).join('') + '</ul>' +

      '<h2>Limits</h2>' +
      '<label class="field">Cost limit per action without asking<select data-act="cost">' + [20, 40, 60, 100].map(function (n) {
        return '<option value="' + n + '"' + (v.costLimit === n ? ' selected' : '') + '>€' + n + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field">Anna\'s role<select data-act="role">' +
      [['approve', 'Informed + may confirm 🔴 steps'], ['inform', 'Informed only'], ['none', 'No access']].map(function (o) {
        return '<option value="' + o[0] + '"' + (v.relativeRole === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' +

      '<h2>Consent</h2><ul class="consents">' +
      '<li>' + (w.consent.senior ? '✅' : '⬜') + ' Margaret (main user) <button class="link" data-act="consent-text" data-who="senior">Read</button></li>' +
      '<li>' + (w.consent.relative ? '✅' : '⬜') + ' Anna (overseer, optional) <button class="link" data-act="consent-text" data-who="relative">Read</button></li>' +
      '<li>' + (w.consent.crisisContact ? '✅' : '⬜') + ' Alert Anna in a personal crisis <label class="inline"><input type="checkbox" data-act="crisis"' + (w.consent.crisisContact ? ' checked' : '') + '> allowed</label></li></ul>' +

      '<h2>Accessibility</h2><ul class="perms">' +
      '<li><label><input type="checkbox" data-act="large"' + (document.body.classList.contains('large') ? ' checked' : '') + '><span>Extra large text</span></label></li>' +
      '<li><label><input type="checkbox" data-act="hearing"' + (document.body.classList.contains('hearing') ? ' checked' : '') + '><span>Hearing support: everything as large captions, screen flashes on news</span></label></li>' +
      '<li><label><input type="checkbox" data-act="mute"' + (CC.voice.muted ? ' checked' : '') + '><span>Silent mode (no spoken replies)</span></label></li></ul>' +

      '<button class="btn btn-danger wide" data-act="revoke">Revoke the Vollmacht (stop everything)</button>' +
      '<p class="muted small">Agent brain: ' + h(CC.brain.name) + '. A language model can be connected later behind the same rules.</p>';
  }

  // ---------- consent texts ----------
  var CONSENT = {
    senior: '<h2>Consent – main user</h2><p>I, Margaret Weber, allow the Care Concierge service to:</p><ul>' +
      '<li>store my appointments, contacts, insurer details and the papers it prepares,</li>' +
      '<li>contact practices, transport services and my insurer <b>on my behalf, within my digital Vollmacht</b>,</li>' +
      '<li>process health information (GDPR Art. 9) <b>only</b> for these tasks – medical details are only shared after I say yes.</li></ul>' +
      '<p>The Concierge always says it is an AI. It never decides medical questions and never sends applications without a human OK. ' +
      'I can see every action, undo it, say "stop" at any time, and withdraw this consent – then my data is deleted.</p>',
    relative: '<h2>Consent – overseer (optional)</h2><p>I, Anna Weber, agree to be Margaret\'s overseer, as she chose. I understand that:</p><ul>' +
      '<li>the Concierge works for <b>Margaret</b>, not for me – my requests that change her plans need her OK,</li>' +
      '<li>I see appointments, rides, papers and safety alerts, but <b>not</b> her conversations,</li>' +
      '<li>I may only confirm 🔴 steps if Margaret allows it, and never steps that benefit me,</li>' +
      '<li>Margaret can end my access at any time.</li></ul>'
  };

  ui.CONSENT = CONSENT;

  // ---------- onboarding ----------
  var ONBOARD = [
    '<div class="ob-icon">👋</div><h2>Hello, I am your Care Concierge</h2><p class="big">I am an <b>AI assistant</b>, not a person.</p>' +
      '<p>I look after your doctor appointments, rides and paperwork – and I do things for you, not just give advice.</p>' +
      '<p>You stay in charge: I tell you what I did, I ask before anything important, and you can say <b>"Stop"</b> at any time.</p>',
    CONSENT.senior + '<label class="check"><input type="checkbox" checked disabled> Margaret agrees (demo)</label>',
    '<h2>Someone to keep an eye on things?</h2><p>You can choose a person you trust. They are informed and can help – but they cannot take over.</p>' +
      '<div class="card"><b>Anna Weber</b> (daughter, Hamburg)<p class="small muted">Role: informed + may confirm 🔴 steps</p></div>' + CONSENT.relative,
    '<h2>Your digital Vollmacht</h2><ul class="legend"><li>🟢 I act alone – reminders, moving a routine check-up</li>' +
      '<li>🟡 I act, then tell you – new appointments, rides up to €60</li><li>🔴 I prepare, you confirm – sending papers, sharing medical details</li>' +
      '<li>🛟 Emergencies: I always point you to human help</li></ul><p class="small muted">You can change this any time under "Vollmacht".</p>'
  ];

  function showModal(html, buttons) {
    $('modal').innerHTML = '<div class="sheet">' + html + '<div class="row end">' + buttons + '</div></div>';
    $('modal').classList.add('open');
  }
  function closeModal() { $('modal').classList.remove('open'); $('modal').innerHTML = ''; }

  ui.onboard = function () {
    var s = ui.onboardStep;
    showModal(ONBOARD[s] + '<p class="steps">' + (s + 1) + ' / ' + ONBOARD.length + '</p>',
      (s > 0 ? '<button class="btn" data-act="ob-back">Back</button>' : '<button class="btn" data-act="ob-skip">Skip</button>') +
      '<button class="btn btn-primary" data-act="ob-next">' + (s === ONBOARD.length - 1 ? 'Start' : 'Next') + '</button>');
  };

  // ---------- render ----------
  ui.render = function () {
    var w = CC.state;
    var views = { senior: seniorView, health: healthView, relative: relativeView, log: logView, vollmacht: vollmachtView };
    var main = $('view');
    var keepScroll = main.scrollTop;
    main.innerHTML = views[ui.view](w);
    if (ui.view === 'senior') {
      var chat = main.querySelector('.chat');
      main.scrollTop = keepScroll;
      if (ui.scrollChat && chat) { chat.lastElementChild && chat.lastElementChild.scrollIntoView({ block: 'nearest' }); ui.scrollChat = false; }
    } else { main.scrollTop = keepScroll; }

    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === ui.view);
    });
    var pend = w.approvals.filter(function (a) { return a.status === 'pending'; }).length;
    $('badge-senior').textContent = pend ? pend : '';
    $('badge-relative').textContent = annaMsgs(w).length ? annaMsgs(w).length : '';
    var openD = CC.health.openDoses(w).length;
    $('badge-health').textContent = openD ? openD : '';
    $('dock').style.display = ui.view === 'senior' ? '' : 'none';
    $('clock').textContent = CC.fmt.short(w.now);
    $('demo-clock').textContent = CC.fmt.day(w.now) + ', ' + CC.fmt.time(w.now);
    $('stop').classList.toggle('is-paused', w.paused);
    $('stop').textContent = w.paused ? '▶ RESUME' : '■ STOP';
    $('brain-name').textContent = CC.brain.name;
  };

  // ---------- captions & simulated phone notifications ----------
  var capTimer;
  ui.caption = function (text) {
    var c = $('caption');
    c.textContent = text;
    c.classList.add('show');
    if (document.body.classList.contains('hearing')) {
      document.body.classList.add('flash');
      setTimeout(function () { document.body.classList.remove('flash'); }, 600);
    }
    clearTimeout(capTimer);
    var hearing = document.body.classList.contains('hearing');
    capTimer = setTimeout(function () { c.classList.remove('show'); }, hearing ? Math.max(6000, text.length * 80) : Math.min(8000, Math.max(4000, text.length * 45)));
  };

  var toastTimer;
  ui.toast = function (text) {
    var t = $('toast');
    t.innerHTML = '<b>📱 Anna\'s phone</b><span>' + h(text) + '</span>';
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 5000);
  };

  // ---------- input ----------
  ui.sendSenior = function (text) { ui.scrollChat = true; CC.brain.respond(text, 'Margaret'); };

  ui.mic = function () {
    var btn = $('mic');
    if (!CC.voice.canListen) { ui.toggleTyping(true); ui.caption('Voice input is not available in this browser – please type instead.'); return; }
    if (CC.voice.listening) { CC.voice.stopListening(); return; }
    CC.voice.listen(ui.sendSenior, function (state, text) {
      btn.classList.toggle('listening', state === 'listening' || state === 'hearing');
      $('mic-label').textContent = state === 'listening' ? 'Listening…' : state === 'hearing' ? '"' + text + '"' : state === 'error' ? 'Did not catch that – tap again' : 'Tap and speak';
    });
  };

  ui.toggleTyping = function (force) {
    ui.typing = force === undefined ? !ui.typing : force;
    $('typebox').classList.toggle('open', ui.typing);
    if (ui.typing) $('typebox').querySelector('input').focus();
  };
})();
