// The agent: runs multi-step plans through the policy engine, asks for approval when required,
// logs every action with its reason, and supports STOP, continue and undo.
(function () {
  var CC = window.CC;
  function W() { return CC.state; }

  // ---------- shared outputs: audit log, voice, relative messages, status ----------
  CC.log = function (entry) {
    var w = W();
    entry.id = CC.uid('log');
    entry.time = w.now;
    entry.actor = entry.actor || 'Concierge';
    w.log.unshift(entry);
    CC.bus.emit('change');
    return entry;
  };

  CC.say = function (text, opts) {
    var w = W();
    w.chat.push({ from: 'concierge', text: text, time: w.now, urgent: !!(opts && opts.urgent) });
    CC.bus.emit('say', { text: text });
    CC.bus.emit('change');
  };

  CC.tellRelative = function (text, level) {
    var w = W();
    if (!w.consent.relative || w.vollmacht.relativeRole === 'none') return false;
    w.messages.unshift({ id: CC.uid('msg'), time: w.now, text: text, level: level || 'yellow' });
    CC.bus.emit('relative-message', { text: text });
    CC.bus.emit('change');
    return true;
  };

  function setStatus(mode, text) {
    W().status = { mode: mode, text: text };
    CC.bus.emit('change');
  }

  function findAppt(w, id) { return w.appointments.filter(function (a) { return a.id === id; })[0]; }

  // ---------- tools (each call has already passed the policy engine) ----------
  CC.tools = {
    search_slots: function (w, a) {
      var slots = CC.services.searchSlots(w, a.practiceId, { after: a.after, count: 3 });
      var p = CC.practices[a.practiceId];
      return {
        data: slots,
        summary: slots.length
          ? 'Found ' + slots.length + ' free slots at ' + p.name + ': ' + slots.map(CC.fmt.short).join(' · ')
          : 'No free slots at ' + p.name + ' in the next 5 weeks.'
      };
    },
    share_minimal: function (w, a) {
      return { data: true, summary: 'Will share only: name, date of birth, insurer and referral number. No diagnoses or medication.' };
    },
    book_appointment: function (w, a) {
      var res = CC.services.bookAppointment(w, a.practiceId, a.time, a);
      var p = CC.practices[a.practiceId];
      return {
        data: res,
        summary: 'Booked ' + res.appointment.title + ' at ' + p.name + ', ' + CC.fmt.spoken(a.time) + ' (via ' + p.channel + ').',
        transcript: res.transcript,
        undo: { type: 'appointment', id: res.appointment.id }
      };
    },
    book_transport: function (w, a) {
      var appt = findAppt(w, a.apptId);
      var tr = CC.services.bookTransport(w, appt, a.quote);
      return {
        data: tr,
        summary: 'Booked ' + tr.provider + ': pick-up ' + CC.fmt.time(tr.pickup) + ', return ' + CC.fmt.time(tr.back) +
          ', ' + CC.fmt.euro(tr.price) + '. ' + a.quote.coverageNote,
        undo: { type: 'transport', id: tr.id }
      };
    },
    reschedule: function (w, a) {
      var appt = findAppt(w, a.apptId);
      var oldTime = appt.time;
      delete w.slotsTaken[appt.practiceId + '|' + oldTime];
      appt.time = a.newTime;
      appt.status = 'booked';
      w.slotsTaken[appt.practiceId + '|' + a.newTime] = appt.id;
      var tr = w.transports.filter(function (t) { return t.id === appt.transportId; })[0];
      if (tr) { tr.pickup = a.newTime - 45 * CC.MIN; tr.back = a.newTime + 90 * CC.MIN; }
      return {
        data: appt,
        summary: 'Moved ' + appt.title + ' from ' + CC.fmt.short(oldTime) + ' to ' + CC.fmt.short(a.newTime) + (tr ? ' (ride moved too).' : '.'),
        undo: { type: 'reschedule', id: appt.id, oldTime: oldTime }
      };
    },
    remind: function (w, a) {
      var appt = findAppt(w, a.apptId);
      appt.reminder = true;
      return { data: true, summary: 'Reminder set for the evening before ' + appt.title + ' (by voice and on screen).' };
    },
    say_reminder: function (w, a) {
      CC.say(a.text);
      return { data: true, summary: 'Reminded Margaret: "' + a.text + '"' };
    },
    notify_relative: function (w, a) {
      var sent = CC.tellRelative(a.text, a.level);
      return { data: sent, summary: sent ? 'Updated Anna: "' + a.text + '"' : 'Anna not informed (no oversight role).' };
    },
    identify_documents: function (w, a) {
      var docs = CC.documentCatalog(w, a.treatment);
      return { data: docs, summary: 'Identified ' + docs.length + ' applications for "' + a.treatment + '": ' + docs.map(function (d) { return d.title; }).join('; ') };
    },
    draft_documents: function (w, a) {
      var ids = a.docs.map(function (d) {
        var doc = { id: CC.uid('doc'), key: d.key, title: d.title, to: d.to, why: d.why, prefilled: d.prefilled, missing: d.missing, status: 'draft', createdAt: w.now };
        w.documents.push(doc);
        return doc.id;
      });
      return { data: ids, summary: 'Prepared ' + ids.length + ' drafts with what is already known. Nothing has been sent.' };
    },
    submit_documents: function (w, a) {
      CC.services.submitDocuments(w, a.docIds);
      return { data: true, summary: 'Sent ' + a.docIds.length + ' applications. Missing evidence will be added as follow-ups.' };
    }
  };

  // ---------- executor ----------
  var queue = [];
  var running = false;

  CC.agent = {
    enqueue: function (plan) {
      queue.push(plan);
      return pump();
    },

    run: function (plan) {
      var w = W();
      if (plan.gen === undefined) plan.gen = CC.gen;
      w.plans[plan.id] = plan;
      plan.ctx = plan.ctx || {};
      plan.i = plan.i || 0;
      plan.status = 'running';
      setStatus('working', plan.title);
      return next();

      function next() {
        if (plan.i >= plan.steps.length) return finish();
        var step = plan.steps[plan.i];
        var args = typeof step.args === 'function' ? step.args(plan.ctx, w) : (step.args || {});
        if (args === null) { plan.i += 1; return next(); } // step not needed
        var decision = CC.policy.evaluate(w, step.action, { cost: args.cost, requestedBy: plan.requestedBy });

        if (!decision.allowed) {
          plan.status = 'blocked';
          CC.log({ title: 'Blocked: ' + step.label, level: decision.level, blocked: true, why: decision.reason, planTitle: plan.title });
          if (plan.onBlocked) plan.onBlocked(plan.ctx, w, step, decision);
          else CC.say('I could not finish "' + plan.title + '": ' + decision.reason);
          return idle();
        }

        if (decision.mode === 'confirm' && !step.approved) {
          plan.status = 'waiting';
          var approval = {
            id: CC.uid('appr'), planId: plan.id, step: plan.i, time: w.now, status: 'pending',
            title: step.label,
            detail: step.approvalText ? step.approvalText(args, plan.ctx, w) : step.label,
            approver: decision.approver, reason: decision.reason, requestedBy: plan.requestedBy || 'agent'
          };
          w.approvals.unshift(approval);
          CC.log({ title: 'Waiting for approval: ' + step.label, level: 'red', why: decision.reason, planTitle: plan.title });
          CC.say('I need your OK before I continue: ' + step.label + '. ' +
            (approval.approver === 'either' ? 'You or Anna can confirm.' : 'Only you can confirm this.'), { approval: true });
          if (approval.approver === 'either') CC.tellRelative('Approval needed for Margaret: ' + step.label + '. Open the app to confirm or decline.', 'red');
          CC.bus.emit('approval', approval);
          return idle();
        }

        return CC.wait(CC.config.stepDelay).then(function () {
          if (plan.gen !== CC.gen) return plan; // demo was restarted meanwhile
          if (W().paused) {
            plan.status = 'stopped';
            CC.log({ title: 'Task stopped: ' + plan.title, level: 'green', why: 'Margaret said STOP before this step: ' + step.label, actor: 'Margaret' });
            return idle();
          }
          setStatus('working', step.label + '…');
          var res = CC.tools[step.tool](w, args, plan.ctx);
          plan.ctx[step.saveAs || step.tool] = res.data;
          CC.log({
            title: step.label, summary: res.summary, level: decision.level, why: step.why,
            policy: decision.reason, transcript: res.transcript, undo: res.undo, planTitle: plan.title,
            informed: decision.mode === 'act_inform'
          });
          plan.i += 1;
          return next();
        });
      }

      function finish() {
        plan.status = 'done';
        if (plan.onDone) plan.onDone(plan.ctx, w);
        return idle();
      }

      function idle() {
        var pending = w.approvals.some(function (a) { return a.status === 'pending'; });
        if (w.paused) setStatus('paused', 'Paused. Say "continue" or tap Resume when you are ready.');
        else if (pending) setStatus('waiting', 'Waiting for your OK.');
        else setStatus('idle', 'I am keeping an eye on your appointments and letters.');
        return Promise.resolve(plan);
      }
    },

    approve: function (approvalId, by) {
      var w = W();
      var a = w.approvals.filter(function (x) { return x.id === approvalId; })[0];
      if (!a || a.status !== 'pending') return Promise.resolve();
      if (a.approver === 'senior' && by !== 'Margaret') return Promise.resolve();
      a.status = 'approved'; a.by = by;
      CC.log({ title: 'Approved: ' + a.title, level: 'red', actor: by, why: by + ' confirmed this step.' });
      if (by === 'Anna') CC.say('Anna confirmed: ' + a.title + '. I am continuing.');
      var plan = w.plans[a.planId];
      plan.steps[a.step].approved = true;
      return CC.agent.run(plan);
    },

    reject: function (approvalId, by) {
      var w = W();
      var a = w.approvals.filter(function (x) { return x.id === approvalId; })[0];
      if (!a || a.status !== 'pending') return;
      a.status = 'rejected'; a.by = by;
      var plan = w.plans[a.planId];
      plan.status = 'cancelled';
      CC.log({ title: 'Declined: ' + a.title, level: 'red', actor: by, why: by + ' said no. Nothing was sent.' });
      CC.say('Understood, I did not do it: ' + a.title + '.');
      if (by === 'Margaret') CC.tellRelative('Margaret declined: ' + a.title + '.', 'green');
      setStatus('idle', 'I am keeping an eye on your appointments and letters.');
    },

    stop: function (by) {
      var w = W();
      if (w.paused) return;
      w.paused = true;
      CC.log({ title: 'STOP – everything paused', level: 'green', actor: by || 'Margaret', why: 'Circuit breaker: the agent takes no further action until Margaret says "continue".' });
      CC.say('Stopped. I will not do anything until you say "continue". You can also undo my last action.');
      CC.tellRelative('Margaret pressed STOP. The Concierge is paused.', 'green');
      setStatus('paused', 'Paused. Say "continue" or tap Resume when you are ready.');
    },

    resume: function (by) {
      var w = W();
      if (!w.paused) return;
      w.paused = false;
      CC.log({ title: 'Continued', level: 'green', actor: by || 'Margaret', why: 'Margaret allowed the agent to act again.' });
      CC.say('Thank you, I am back. Stopped tasks stay stopped – just ask me if you want me to start them again.');
      setStatus('idle', 'I am keeping an eye on your appointments and letters.');
      pump();
    },

    undo: function (logId, by) {
      var w = W();
      var entry = w.log.filter(function (e) { return e.id === logId; })[0];
      if (!entry || !entry.undo || entry.undone) return false;
      var u = entry.undo;
      var text;
      if (u.type === 'appointment') {
        var appt = CC.services.cancelAppointment(w, u.id);
        if (!appt) return false;
        w.log.forEach(function (e) { if (e.undo && e.undo.type === 'transport' && !e.undone) { var t = w.transports.filter(function (x) { return x.id === e.undo.id; })[0]; if (t && t.status === 'cancelled') e.undone = true; } });
        text = 'Cancelled ' + appt.title + ' on ' + CC.fmt.short(appt.time) + ' and freed the slot for other patients' + '.';
      } else if (u.type === 'transport') {
        CC.services.cancelTransport(w, u.id);
        text = 'Cancelled the ride.';
      } else if (u.type === 'reschedule') {
        var ap = findAppt(w, u.id);
        CC.tools.reschedule(w, { apptId: u.id, newTime: u.oldTime });
        text = 'Moved ' + ap.title + ' back to ' + CC.fmt.short(u.oldTime) + '.';
      }
      entry.undone = true;
      CC.log({ title: 'Undone: ' + entry.title, summary: text, level: 'green', actor: by || 'Margaret', why: 'Recourse: Margaret can reverse any agent action.' });
      CC.say('Done. ' + text);
      CC.tellRelative((by || 'Margaret') + ' undid an action: ' + text, 'green');
      return true;
    },

    lastUndoable: function () {
      return W().log.filter(function (e) { return e.undo && !e.undone; })[0];
    },

    reset: function () { queue = []; running = false; },

    // Number of plans still waiting or running (used by tests and the demo).
    busyCount: function () { return queue.length + (running ? 1 : 0); }
  };

  function pump() {
    if (running || !queue.length || W().paused) return Promise.resolve();
    running = true;
    var plan = queue.shift();
    return CC.agent.run(plan).then(function () {
      running = false;
      return pump();
    });
  }

  // ---------- plan templates (what the agent brain can propose) ----------
  CC.plans = {
    bookWithTransport: function (w, o) {
      var p = CC.practices[o.practiceId];
      return {
        id: CC.uid('plan'), title: 'Book ' + p.label + ' appointment', trigger: o.trigger, requestedBy: o.requestedBy,
        steps: [
          { action: 'inform', tool: 'search_slots', label: 'Check free ' + p.label + ' appointments', why: o.why,
            args: { practiceId: p.id } },
          { action: 'share_admin_data', tool: 'share_minimal', label: 'Limit what the practice gets to basic admin data',
            why: 'Data minimisation (GDPR Art. 5): booking needs name, birth date, insurer and referral – not her medical history.' },
          { action: 'book_appointment', tool: 'book_appointment', label: 'Book the earliest suitable ' + p.label + ' slot',
            why: 'Earliest slot within Margaret\'s preferred hours (' + w.vollmacht.preferences.earliestHour + ':00–' + w.vollmacht.preferences.latestHour + ':00) that does not clash with other appointments.',
            approvalText: function (a) { return 'Book ' + p.name + ' on ' + CC.fmt.spoken(a.time) + '.'; },
            args: function (ctx) {
              return ctx.search_slots && ctx.search_slots.length
                ? { practiceId: p.id, time: ctx.search_slots[0], title: o.title || (p.label + ' appointment'), referralNo: o.referralNo,
                    reason: o.reason, doctor: o.doctor, createdBy: o.requestedBy === 'relative' ? 'Anna (for Margaret)' : 'Concierge' }
                : null;
            } },
          { action: 'book_transport', tool: 'book_transport', label: 'Book a ride there and back',
            why: 'Margaret has no car and walks with a rollator; the practice is ' + p.distanceKm + ' km away.',
            approvalText: function (a) { return 'Book a ride with ' + a.quote.provider + ' for ' + CC.fmt.euro(a.quote.price) + ' (pick-up ' + CC.fmt.time(a.quote.pickup) + ').'; },
            args: function (ctx, world) {
              var appt = ctx.book_appointment && ctx.book_appointment.appointment;
              if (!appt || world.senior.hasCar || p.distanceKm < 2) return null;
              var q = CC.services.quoteTransport(world, appt);
              return { apptId: appt.id, quote: q, cost: q.price };
            } },
          { action: 'remind', tool: 'remind', label: 'Set a reminder for the evening before',
            why: 'Reminders reduce missed appointments; Margaret asked for evening reminders.',
            args: function (ctx) { var a = ctx.book_appointment && ctx.book_appointment.appointment; return a ? { apptId: a.id } : null; } },
          { action: 'notify_relative', tool: 'notify_relative', label: 'Update Anna',
            why: 'Margaret chose to keep Anna informed about new bookings (yellow actions).',
            args: function (ctx, world) {
              var a = ctx.book_appointment && ctx.book_appointment.appointment;
              if (!a) return null;
              var tr = ctx.book_transport;
              return { level: 'yellow', text: 'New appointment for Margaret: ' + a.title + ', ' + CC.fmt.short(a.time) + ' at ' + p.name + '.' + (tr ? ' Ride booked (' + CC.fmt.euro(tr.price) + ', pick-up ' + CC.fmt.time(tr.pickup) + ').' : '') + ' Margaret was told and can undo it.' };
            } }
        ],
        onDone: function (ctx) {
          var a = ctx.book_appointment && ctx.book_appointment.appointment;
          if (!a) { CC.say('I could not find a free ' + p.label + ' appointment in the next five weeks. Shall I ask your GP to help, or try another practice?'); return; }
          var tr = ctx.book_transport;
          CC.say((o.intro || '') + 'I booked ' + (o.doctor ? o.doctor + ' (' + p.name + ')' : 'the ' + p.label.toLowerCase()) + ' on ' + CC.fmt.spoken(a.time) + '. ' +
            (tr ? 'A car will pick you up at ' + CC.fmt.time(tr.pickup) + ' and bring you home. ' : '') +
            (w.consent.relative ? 'Anna knows. ' : '') + 'If it does not suit you, just say "change it" or "undo".');
        }
      };
    },

    transportFor: function (w, appt, why) {
      var p = CC.practices[appt.practiceId];
      return {
        id: CC.uid('plan'), title: 'Arrange a ride for ' + appt.title,
        steps: [
          { action: 'book_transport', tool: 'book_transport', label: 'Book a ride to ' + p.name, why: why,
            approvalText: function (a) { return 'Book a ride with ' + a.quote.provider + ' for ' + CC.fmt.euro(a.quote.price) + '.'; },
            args: function (ctx, world) { var q = CC.services.quoteTransport(world, appt); return { apptId: appt.id, quote: q, cost: q.price }; } },
          { action: 'notify_relative', tool: 'notify_relative', label: 'Update Anna', why: 'New ride booking (yellow).',
            args: function (ctx) { return ctx.book_transport ? { level: 'yellow', text: 'Ride booked for Margaret\'s ' + appt.title + ' tomorrow, pick-up ' + CC.fmt.time(ctx.book_transport.pickup) + '.' } : null; } }
        ],
        onDone: function (ctx) {
          if (ctx.book_transport) CC.say('For tomorrow\'s ' + appt.title.toLowerCase() + ' I booked a car. It picks you up at ' + CC.fmt.time(ctx.book_transport.pickup) + '.');
        }
      };
    },

    reschedule: function (w, appt, o) {
      var p = CC.practices[appt.practiceId];
      var action = appt.routine ? 'reschedule_routine' : 'reschedule_appointment';
      return {
        id: CC.uid('plan'), title: 'Move ' + appt.title, requestedBy: o.requestedBy,
        steps: [
          { action: 'inform', tool: 'search_slots', label: 'Find a new slot at ' + p.name, why: o.why,
            args: { practiceId: p.id, after: o.after || w.now } },
          { action: action, tool: 'reschedule', label: 'Move ' + appt.title + ' to the next suitable slot',
            why: appt.routine ? 'Routine check-up: moving it is low-risk (green).' : 'Specialist appointment: the agent moves it and informs (yellow).',
            approvalText: function (a) { return 'Move ' + appt.title + ' to ' + CC.fmt.spoken(a.newTime) + '.'; },
            args: function (ctx) { return ctx.search_slots && ctx.search_slots.length ? { apptId: appt.id, newTime: ctx.search_slots[0] } : null; } },
          { action: 'notify_relative', tool: 'notify_relative', label: 'Update Anna', why: 'Keep the relative informed of changes.',
            args: function (ctx) { return ctx.reschedule ? { level: appt.routine ? 'green' : 'yellow', text: appt.title + ' moved to ' + CC.fmt.short(ctx.reschedule.time) + '.' } : null; } }
        ],
        onDone: function (ctx) {
          if (ctx.reschedule) CC.say((o.intro || '') + 'Your ' + appt.title.toLowerCase() + ' is now on ' + CC.fmt.spoken(ctx.reschedule.time) + '. Say "undo" if you prefer the old time.');
          else CC.say('I could not find another slot for your ' + appt.title.toLowerCase() + '.');
        }
      };
    },

    documents: function (w, o) {
      return {
        id: CC.uid('plan'), title: 'Prepare paperwork for ' + o.treatment, requestedBy: o.requestedBy, trigger: o.trigger,
        steps: [
          { action: 'inform', tool: 'identify_documents', label: 'Work out which applications are needed', why: o.why, args: { treatment: o.treatment } },
          { action: 'draft_document', tool: 'draft_documents', label: 'Prepare the forms with known data (not sent)',
            why: 'Preparing drafts is reversible and shares nothing (green).', args: function (ctx) { return { docs: ctx.identify_documents }; } },
          { action: 'submit_application', tool: 'submit_documents', label: 'Send the prepared applications',
            why: 'Sending applications shares health data and has legal effect – a human must confirm (red).',
            approvalText: function (a, ctx) { return 'Send ' + ctx.identify_documents.length + ' applications: ' + ctx.identify_documents.map(function (d) { return d.title + ' → ' + d.to; }).join('; ') + '.'; },
            args: function (ctx) { return { docIds: ctx.draft_documents }; } },
          { action: 'notify_relative', tool: 'notify_relative', label: 'Update Anna', why: 'Applications sent.',
            args: function (ctx) { return { level: 'red', text: 'Applications for Margaret were sent (' + ctx.draft_documents.length + '). Some evidence is still missing – see the documents list.' }; } }
        ],
        onDone: function () {
          CC.say('The applications are sent. I will remind you about the missing papers and tell you when the insurer replies.');
        }
      };
    }
  };

  CC.agent.pump = pump;
})();
