// Agent "brain": turns speech or events into plans. SWAPPABLE.
// Today: a rule-based planner (free, offline, predictable on stage).
// Later: an LLM brain with the same interface (respond / planForEvent). Whatever the brain proposes,
// every single step still has to pass the policy engine in policy.js.
(function () {
  var CC = window.CC;

  function nextAppt(w, filter) {
    return w.appointments
      .filter(function (a) { return a.status === 'booked' && a.time > w.now && (!filter || filter(a)); })
      .sort(function (a, b) { return a.time - b.time; })[0];
  }

  function detectSpecialty(t) {
    if (/cardio|heart|chest check/.test(t)) return 'cardio';
    if (/eye|ophthal|vision|see properly/.test(t)) return 'eye';
    if (/gp|family doctor|general practitioner|my doctor|dr\.? yilmaz/.test(t)) return 'gp';
    return null;
  }

  function detectTreatment(t) {
    var m = t.match(/chemo(therapy)?|radiotherapy|radiation|dialysis|physiotherapy|rehab/);
    if (!m) return null;
    var k = m[0];
    if (k.indexOf('chemo') === 0) return 'chemotherapy';
    if (k === 'radiation') return 'radiotherapy';
    return k;
  }

  var PATTERNS = {
    emergency: /chest pain|can'?t breathe|cannot breathe|i (have )?fallen|i fell|stroke|unconscious|bleeding heavily/,
    crisis: /don'?t want to live|do not want to live|end it all|kill myself|no point (in )?living|better off dead|suicid|want to die/,
    unlawful: /(tell|say|pretend|claim).*(worse|pflegegrad 3|care level 3|emergency so|i am someone else)|lie to|fake (a|the)|forge|sign (it )?(as|for) me/,
    stop: /\b(stop|stopp|halt|pause)\b/,
    resume: /\b(continue|carry on|go on|resume|start again)\b/,
    undo: /\bundo\b|take (that|it) back|cancel (that|it)|change it back|revert/,
    yes: /^(yes|yeah|yep|ok|okay|sure|go ahead|please do|do it|correct|right)\b/,
    no: /^(no|nope|don'?t|do not|not now|cancel)\b/,
    why: /\bwhy\b/,
    whatDid: /what (did|have) you (do|done)|what are you doing|status/,
    schedule: /what('?s| is) (on|next|planned)|my (next )?appointments?|do i have anything|when is my/,
    reschedule: /reschedul|move (my|the)|postpone|another day|can'?t (make|go)|cannot (make|go)|change it/,
    transport: /taxi|ride|lift|transport|get there|drive me|pick me up/,
    book: /appointment|book|see (a|the|my) (doctor|cardiologist|specialist)|need (a|an) (doctor|cardiologist|eye)/,
    help: /what can you do|help me|how does this work/
  };

  CC.RuleBrain = {
    name: 'Rule-based planner (offline)',
    pending: null, // plan waiting for a spoken "yes" (read-back confirmation)

    // Returns nothing; acts through CC.say / CC.agent. `who` is 'Margaret' or 'Anna'.
    respond: function (raw, who) {
      var w = CC.state;
      var t = (raw || '').toLowerCase().trim();
      who = who || 'Margaret';
      w.chat.push({ from: who === 'Anna' ? 'anna' : 'senior', text: raw, time: w.now });
      CC.bus.emit('change');
      if (!t) return;

      // 1. Safety first – these run even when paused.
      if (PATTERNS.emergency.test(t)) return CC.safety.emergency(raw);
      if (PATTERNS.crisis.test(t)) return CC.safety.crisis(raw);

      // 2. Circuit breaker and recourse.
      if (who === 'Margaret' && PATTERNS.stop.test(t)) { this.pending = null; return CC.agent.stop('Margaret'); }
      if (who === 'Margaret' && PATTERNS.resume.test(t)) return CC.agent.resume('Margaret');
      if (PATTERNS.undo.test(t)) {
        var last = CC.agent.lastUndoable();
        if (!last) return CC.say('There is nothing I can undo right now.');
        return CC.agent.undo(last.id, who);
      }

      // 3. Law-following: refuse unlawful instructions, even from the principal.
      if (PATTERNS.unlawful.test(t)) {
        CC.log({ title: 'Refused an unlawful instruction', level: 'red', blocked: true, actor: 'Concierge',
          why: 'Law-following AI: the agent does not give false information or sign for someone, even if asked by its principal.', summary: '"' + raw + '"' });
        return CC.say('I cannot give false information to a practice, insurer or authority – that could harm you and is not allowed. ' +
          'What I can do: describe honestly what has become harder for you, or ask for an urgent appointment if your symptoms got worse.');
      }

      // 4. Answers to a pending read-back question or approval.
      if (PATTERNS.yes.test(t) || PATTERNS.no.test(t)) {
        var isYes = PATTERNS.yes.test(t);
        if (this.pending) {
          var p = this.pending; this.pending = null;
          if (isYes) { CC.say('All right, I am doing it now.'); return CC.agent.enqueue(p); }
          return CC.say('Fine, I will leave it.');
        }
        var appr = w.approvals.filter(function (a) { return a.status === 'pending' && (a.approver === 'either' || who === 'Margaret'); })[0];
        if (appr) return isYes ? CC.agent.approve(appr.id, who) : CC.agent.reject(appr.id, who);
      }

      if (w.paused && who === 'Margaret') return CC.say('I am paused. Say "continue" first if you want me to act again.');

      // 5. Questions about the agent itself (transparency).
      if (PATTERNS.why.test(t)) {
        var e = w.log.filter(function (x) { return x.why && x.actor === 'Concierge'; })[0];
        return CC.say(e ? 'My last action was: ' + e.title + '. The reason: ' + e.why : 'I have not done anything yet.');
      }
      if (PATTERNS.whatDid.test(t)) {
        var recent = w.log.filter(function (x) { return x.actor === 'Concierge' && !x.blocked; }).slice(0, 3);
        return CC.say(recent.length ? 'Recently I: ' + recent.map(function (x) { return x.title.toLowerCase(); }).join('; ') + '.' : 'Nothing so far – I am keeping an eye on your letters and appointments.');
      }
      if (PATTERNS.schedule.test(t)) {
        var list = w.appointments.filter(function (a) { return a.status === 'booked' && a.time > w.now; }).sort(function (a, b) { return a.time - b.time; });
        if (!list.length) return CC.say('You have no appointments coming up.');
        return CC.say('Coming up: ' + list.slice(0, 3).map(function (a) {
          return a.title + ' on ' + CC.fmt.spoken(a.time) + (a.transportId ? ', with a ride' : '');
        }).join('; ') + '.');
      }
      if (PATTERNS.help.test(t)) {
        return CC.say('I can book and move doctor appointments – also with a doctor you choose – arrange rides, remind you of your tablets as your doctor prescribed them, ' +
          'prepare forms for your insurer, read your health record if you allow it, and keep your contacts informed. ' +
          'I always tell you what I did, and I ask before I send anything important. Say "stop" at any time.');
      }

      // 5b. Medication, health record and contacts.
      if (/repeat prescription|new prescription|(need|running out of|run out of|more) (of )?(my )?(tablets|pills|medicine|medication)/.test(t)) {
        var low = w.medPlan.slice().sort(function (a, b) { return a.stock - b.stock; })[0];
        this.pending = CC.plans.repeatPrescription(w, low, who + ' asked for a new prescription.');
        return CC.say('You have ' + low.stock + ' ' + low.drug + ' tablets left. Shall I ask ' + low.prescribedBy + ' for a repeat prescription?');
      }
      if (/(double|two|extra|half|skip|stop taking|less|increase|reduce|change).{0,20}(dose|tablets?|pills?|medicine|medication)|(dose|tablets?|pills?).{0,20}(double|change|increase|reduce)/.test(t)) {
        CC.log({ title: 'Refused to change a dose', level: 'red', blocked: true, actor: 'Concierge', summary: '"' + raw + '"',
          why: 'The agent follows the doctor\'s medication plan only. Changing doses is a medical decision – it stays with the doctor.' });
        var gp = w.medPlan[0].prescribedBy;
        this.pending = {
          id: CC.uid('plan'), title: 'Question to the practice', requestedBy: who === 'Anna' ? 'relative' : 'senior',
          steps: [{ action: 'message_practice', tool: 'message_practice', label: 'Send Margaret\'s question to ' + gp,
            why: 'Questions about doses go to the doctor, never answered by the agent.', args: { to: gp, text: raw } }],
          onDone: function () { CC.say('I sent your question to ' + gp + '. Until they answer, please keep taking your tablets as written in your plan.'); }
        };
        return CC.say('I cannot change your dose – only your doctor can decide that. Please keep to your plan for now. Shall I send your question to ' + gp + '?');
      }
      if (/did i take|have i taken|did i have my/.test(t)) {
        var today = w.doses.filter(function (d) { return new Date(d.time).toDateString() === new Date(w.now).toDateString(); });
        if (!today.length) return CC.say('No tablets were due yet today.');
        return CC.say(today.map(function (d) { var m = CC.health.med(w, d.medId); return m.drug + ' at ' + CC.fmt.time(d.time) + ': ' +
          ({ taken: 'taken', due: 'not yet', reminded: 'not yet', missed: 'not confirmed' })[d.status]; }).join('; ') + '.');
      }
      if (/\b(taken|took|swallowed)\b|^(done|i had my (tablets|pills|medicine))/.test(t)) {
        var n = CC.health.markTaken(w, who);
        return CC.say(n ? 'Thank you, I noted ' + n + ' tablet' + (n > 1 ? 's' : '') + ' as taken.' : 'There were no open tablets to record right now.');
      }
      if (/what (medicine|medication|pills|tablets)|which (pills|tablets|medicine)|my (medication|tablets|pills|medicines)/.test(t)) {
        var open = CC.health.openDoses(w);
        if (open.length) return CC.say('Now due: ' + CC.health.describe(w, open) + '. Say "taken" when done.');
        return CC.say('Your plan: ' + w.medPlan.map(function (m) { return m.drug + ' ' + m.strength + ', ' + m.dose + ' at ' + m.times.map(function (h) { return h + ':00'; }).join(' and '); }).join('; ') + '. Prescribed as written in your medication plan.');
      }
      if (/what did (the )?doctor write|medical (history|record)|health record|my records?|lab results?|\bepa\b|doctor'?s letter/.test(t)) {
        return CC.health.readEpa(w, who + ' asked: "' + raw + '"');
      }
      var tell = t.match(/^(tell|message|inform|text|let) (anna|peter)\b(.*)$/);
      if (tell) {
        var c = w.contacts.filter(function (x) { return x.id === tell[2]; })[0];
        var msg = raw.replace(/^\s*\S+\s+\S+\s*(that\s+)?/i, '').trim() || 'Please give me a call.';
        return CC.agent.enqueue({
          id: CC.uid('plan'), title: 'Message to ' + c.short,
          steps: [{ action: 'notify_contact', tool: 'notify_contacts', label: 'Message to ' + c.short, why: 'Margaret asked me to pass on a message.',
            args: { to: c.id, stage: 'direct', basic: 'Message from Margaret: "' + msg + '"' } }],
          onDone: function () { CC.say('I passed your message on to ' + c.short + '.'); }
        });
      }
      if (/which (doctors|cardiologists|eye doctors|practices)|other (doctors?|cardiologists?|practices?)|find (me )?(a |another )?(doctor|cardiologist|practice)|list (of )?doctors/.test(t)) {
        var sp = /eye|ophthal/.test(t) ? 'ophthalmology' : /gp|family/.test(t) ? 'gp' : 'cardiology';
        var opts = CC.directory.bySpecialty(sp);
        CC.log({ title: 'Looked up the doctor directory', level: 'green', summary: opts.map(function (p) { return p.doctors.join(', ') + ' – ' + p.name; }).join(' | '),
          why: 'Official doctor directory (KV doctor search / 116117) – not random websites.' });
        return CC.say('Here are the ' + (sp === 'gp' ? 'GP' : sp === 'ophthalmology' ? 'eye' : 'heart') + ' doctors near you: ' + opts.map(function (p) {
          return p.doctors.join(' and ') + ' at ' + p.name + ' (' + p.distanceKm + ' km)' + (w.usual[sp] === p.id ? ', your usual practice' : ''); }).join('; ') +
          '. Say for example "book ' + opts[opts.length - 1].doctors[0] + '".');
      }

      // 6. Requests that lead to actions.
      var treatment = detectTreatment(t);
      if (treatment) {
        var plan = CC.plans.documents(w, {
          treatment: treatment, requestedBy: who === 'Anna' ? 'relative' : 'senior',
          why: (who === 'Anna' ? 'Anna said' : 'Margaret said') + ' that ' + treatment + ' is starting. Proactive Document Assistant: find and prepare the paperwork early.'
        });
        CC.say('Starting ' + treatment + ' usually brings some paperwork. I will work out what is needed and prepare it – I will not send anything without ' + (who === 'Anna' ? 'Margaret\'s' : 'your') + ' OK.');
        return CC.agent.enqueue(plan);
      }

      if (PATTERNS.reschedule.test(t)) {
        var target = nextAppt(w, function (a) { var s = detectSpecialty(t); return !s || a.practiceId === s; });
        if (!target) return CC.say('I could not find an appointment to move.');
        this.pending = CC.plans.reschedule(w, target, { requestedBy: who === 'Anna' ? 'relative' : 'senior', why: who + ' asked to move it.' });
        return CC.say('You would like me to move your ' + target.title.toLowerCase() + ' on ' + CC.fmt.spoken(target.time) + '. Shall I go ahead?');
      }

      if (PATTERNS.transport.test(t)) {
        var appt = nextAppt(w, function (a) { return !a.transportId && CC.practices[a.practiceId].distanceKm >= 2; });
        if (!appt) return CC.say('All your upcoming appointments already have a ride, or are close by.');
        this.pending = CC.plans.transportFor(w, appt, who + ' asked for a ride.');
        return CC.say('Shall I book a car for your ' + appt.title.toLowerCase() + ' on ' + CC.fmt.spoken(appt.time) + '?');
      }

      var wanted = CC.directory.findDoctor(t);
      if (wanted && (PATTERNS.book.test(t) || /\bsee\b|\bvisit\b/.test(t))) {
        var wp = wanted.practice;
        this.pending = CC.plans.bookWithTransport(w, {
          practiceId: wp.id, doctor: wanted.doctor, title: wp.label + ' appointment with ' + wanted.doctor,
          requestedBy: who === 'Anna' ? 'relative' : 'senior', why: who + ' asked for ' + wanted.doctor + ' (free choice of doctor).'
        });
        return CC.say('I understood: book ' + wanted.doctor + ' at ' + wp.name + ', and a ride if needed. Shall I go ahead?');
      }

      if (PATTERNS.book.test(t)) {
        var spec = detectSpecialty(t);
        if (!spec) return CC.say('Which doctor would you like to see – your GP, a cardiologist or an eye doctor?');
        var pr = CC.practices[spec];
        this.pending = CC.plans.bookWithTransport(w, {
          practiceId: spec, title: pr.label + ' appointment', requestedBy: who === 'Anna' ? 'relative' : 'senior',
          why: who + ' asked for a ' + pr.label.toLowerCase() + ' appointment.'
        });
        // Read-back confirmation: protects against misheard speech before a real-world action.
        return CC.say('I understood: book an appointment with ' + (spec === 'gp' ? 'your GP' : 'a ' + pr.label.toLowerCase()) +
          (spec !== 'gp' ? ', and a ride if needed' : '') + '. Shall I go ahead?');
      }

      // 7. Not understood: never guess when an action could follow.
      CC.log({ title: 'Did not understand – no action taken', level: 'green', actor: 'Concierge', summary: '"' + raw + '"',
        why: 'Misunderstanding safeguard: when unsure, the agent asks again instead of guessing.' });
      return CC.say('I am not sure I understood. Could you say it again in other words? For example: "Book my eye doctor" or "What is coming up?"');
    },

    // Events from the proactive engine → plans.
    planForEvent: function (evt, w) {
      if (evt.type === 'referral_received') {
        var d = evt.data;
        w.inbox.unshift({ id: CC.uid('letter'), time: w.now, from: d.from, title: 'Referral to cardiology', text: d.reason, referralNo: d.referralNo });
        CC.log({ title: 'Noticed a new referral letter', summary: d.from + ': ' + d.reason, level: 'green',
          why: 'Proactive: a referral with a deadline ("within 4 weeks") needs an appointment – Margaret should not have to start this herself.' });
        return CC.plans.bookWithTransport(w, {
          practiceId: d.practiceId, title: 'Cardiology check-up', referralNo: d.referralNo, trigger: 'referral', reason: d.reason,
          intro: 'Good morning Margaret. Dr. Yilmaz sent a referral to the heart specialist. ',
          why: 'Referral from ' + d.from + ' (' + d.referralNo + '): ' + d.reason + '.'
        });
      }
      if (evt.type === 'practice_cancelled') {
        var appt = evt.appt;
        CC.log({ title: 'Practice cancelled an appointment', summary: CC.practices[appt.practiceId].name + ' cancelled ' + appt.title + ' (' + CC.fmt.short(appt.time) + ').',
          level: 'green', why: 'Proactive: a cancelled appointment must be replaced before Margaret goes there for nothing.' });
        return CC.plans.reschedule(w, appt, {
          after: appt.time, intro: 'The practice had to cancel. ',
          why: CC.practices[appt.practiceId].name + ' cancelled the original slot.'
        });
      }
      if (evt.type === 'treatment_start') {
        w.inbox.unshift({ id: CC.uid('letter'), time: w.now, from: CC.practices.onco.name, title: 'Treatment plan', text: evt.text });
        CC.log({ title: 'Noticed a treatment plan letter', summary: evt.text, level: 'green',
          why: 'Proactive Document Assistant: a new treatment series triggers known paperwork (transport, co-payments, care level).' });
        CC.say('A letter from the oncology day clinic arrived: ' + evt.text + ' I will prepare the paperwork that usually goes with it and ask you before anything is sent.');
        return CC.plans.documents(w, { treatment: evt.treatment, trigger: 'letter', why: 'Treatment plan letter: ' + evt.text });
      }
      if (evt.type === 'needs_transport') {
        return CC.plans.transportFor(w, evt.appt, 'Proactive: appointment tomorrow, ' + CC.practices[evt.appt.practiceId].distanceKm + ' km away, and no ride booked.');
      }
      return null;
    }
  };

  // Placeholder for a future LLM brain (claude.ai or API key). Same interface; not active.
  CC.LLMBrain = {
    name: 'LLM planner (not connected)',
    respond: function () { CC.say('The AI language model is not connected in this prototype. Using the offline planner.'); },
    planForEvent: function (evt, w) { return CC.RuleBrain.planForEvent(evt, w); }
  };

  CC.brain = CC.RuleBrain;

  // Safety protocols: no diagnosis, no triage – route to humans and emergency services.
  CC.safety = {
    emergency: function (raw) {
      CC.log({ title: 'Safety: possible emergency', level: 'safety', summary: '"' + raw + '"',
        why: 'The agent does not assess medical urgency. It tells Margaret to call 112 and alerts her contact.' });
      CC.say('This could be an emergency. Please call 112 now – or press the red button on your phone. I am alerting Anna.', { urgent: true });
      CC.tellRelative('URGENT: Margaret mentioned "' + raw + '". She was told to call 112. Please call her now.', 'safety');
    },
    crisis: function (raw) {
      var w = CC.state;
      CC.log({ title: 'Safety: Margaret sounded in distress', level: 'safety', summary: 'Conversation content not shared beyond this note.',
        why: 'Crisis protocol agreed at onboarding: offer human help, and alert the chosen contact only with prior consent.' });
      CC.say('I am really sorry you feel this way. You do not have to go through this alone. The Telefonseelsorge is free, day and night, on 0800 111 0 111. ' +
        (w.consent.crisisContact ? 'As you agreed, I am letting Anna know you would like someone to talk to.' : 'Shall I let Anna know?'), { urgent: true });
      if (w.consent.crisisContact) CC.tellRelative('Margaret may need someone to talk to today. Please give her a call. (Her words are not shared.)', 'safety');
    }
  };
})();
