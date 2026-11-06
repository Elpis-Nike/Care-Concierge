// Policy engine: every action the agent wants to take is checked HERE, in code, before it runs.
// The AI "brain" can propose anything, but cannot bypass these rules (digital Vollmacht + traffic light).
(function () {
  var CC = window.CC;

  // Traffic light per action type (Chan et al. 2024: autonomy graded by action and risk).
  CC.ACTIONS = {
    remind:                 { label: 'Send a reminder', level: 'green', perm: 'remind' },
    inform:                 { label: 'Look up information', level: 'green', perm: 'inform' },
    reschedule_routine:     { label: 'Move a routine appointment', level: 'green', perm: 'reschedule_appointment' },
    book_appointment:       { label: 'Book a new appointment', level: 'yellow', perm: 'book_appointment' },
    reschedule_appointment: { label: 'Move a specialist appointment', level: 'yellow', perm: 'reschedule_appointment' },
    cancel_appointment:     { label: 'Cancel an appointment', level: 'yellow', perm: 'cancel_appointment' },
    book_transport:         { label: 'Book a ride', level: 'yellow', perm: 'book_transport' },
    share_admin_data:       { label: 'Share name, birth date, insurer, referral', level: 'green', perm: 'share_admin_data' },
    share_health_data:      { label: 'Share medical details', level: 'red', perm: 'share_health_data' },
    draft_document:         { label: 'Prepare a form (not sent)', level: 'green', perm: 'draft_document' },
    submit_application:     { label: 'Send an application', level: 'red', perm: 'submit_application' },
    notify_relative:        { label: 'Update the relative', level: 'green', perm: 'notify_relative' },
    notify_contact:         { label: 'Notify chosen contacts', level: 'green', perm: 'notify_relative' },
    med_reminder:           { label: 'Medication reminder (as prescribed)', level: 'green', perm: 'medication' },
    log_dose:               { label: 'Record a dose as taken or missed', level: 'green', perm: 'medication' },
    request_prescription:   { label: 'Ask the practice for a repeat prescription', level: 'yellow', perm: 'request_prescription' },
    read_health_record:     { label: 'Read the health record (ePA) for this task', level: 'green', perm: 'read_health_record' },
    message_practice:       { label: 'Send a question to the practice', level: 'yellow', perm: 'message_practice' },
    // Deliberately NOT defined: changing a dose, diagnosing, triaging. Unknown actions are always denied.
    safety_escalation:      { label: 'Safety: offer help, alert contact', level: 'safety', perm: null, always: true }
  };

  CC.LEVELS = {
    green:  { name: 'Acts alone', icon: '🟢' },
    yellow: { name: 'Acts, then informs', icon: '🟡' },
    red:    { name: 'Prepares – a human confirms', icon: '🔴' },
    safety: { name: 'Safety protocol', icon: '🛟' }
  };

  CC.PERMISSION_LABELS = {
    remind: 'Reminders', inform: 'Look up information', book_appointment: 'Book new appointments',
    reschedule_appointment: 'Move appointments', cancel_appointment: 'Cancel appointments',
    book_transport: 'Book rides', share_admin_data: 'Share basic admin data (name, birth date, insurer)',
    share_health_data: 'Share medical details (always asks first)', draft_document: 'Prepare forms',
    submit_application: 'Send applications (always asks first)', notify_relative: 'Keep my contacts informed',
    medication: 'Medication reminders and dose log (as prescribed)', request_prescription: 'Ask for repeat prescriptions',
    read_health_record: 'Read my health record (ePA) when a task needs it', message_practice: 'Send my questions to the practice'
  };

  CC.policy = {
    // ctx: { cost, requestedBy: 'senior' | 'relative' | 'agent' }
    evaluate: function (world, type, ctx) {
      ctx = ctx || {};
      var def = CC.ACTIONS[type];
      var v = world.vollmacht;
      if (!def) return deny('Unknown action – not part of what the agent may do.');

      // Safety actions always run (never blocked by STOP or settings).
      if (def.always) return { allowed: true, level: 'safety', mode: 'act', reason: 'Safety protocol agreed at onboarding.' };

      if (world.paused) return deny('Paused – Margaret said STOP. Nothing happens until she says "continue".');
      if (!world.consent.senior) return deny('Margaret has not given consent.');
      if (world.now > v.validUntil) return deny('The digital Vollmacht has expired.');
      if (def.perm && v.permissions[def.perm] === false) {
        return deny('Not covered by Margaret\'s digital Vollmacht ("' + CC.PERMISSION_LABELS[def.perm] + '" is switched off).');
      }
      if (type === 'read_health_record' && !(world.epa && world.epa.consent)) {
        return deny('Margaret has not allowed access to her health record (ePA). She can switch it on under Health.');
      }
      if (type === 'notify_relative' && (!world.consent.relative || v.relativeRole === 'none')) {
        return deny('Anna has no oversight role (no consent or switched off).');
      }

      var level = def.level;
      var reasons = [def.label + ' is ' + CC.LEVELS[level].icon + ' by default.'];

      if (ctx.cost && ctx.cost > v.costLimit) {
        level = 'red';
        reasons.push('It costs ' + CC.fmt.euro(ctx.cost) + ', above the €' + v.costLimit + ' limit in the Vollmacht.');
      }

      // Duty of loyalty: the agent works for Margaret. If Anna asks for something that
      // changes Margaret's plans, Margaret herself has to agree.
      var approver = v.relativeRole === 'approve' ? 'either' : 'senior';
      if (ctx.requestedBy === 'relative' && level !== 'green') {
        level = 'red';
        approver = 'senior';
        reasons.push('Requested by Anna – Margaret must agree herself (the agent works for Margaret).');
      }

      return {
        allowed: true,
        level: level,
        mode: level === 'green' ? 'act' : level === 'yellow' ? 'act_inform' : 'confirm',
        approver: approver,
        reason: reasons.join(' ')
      };

      function deny(reason) { return { allowed: false, level: def ? def.level : 'red', mode: 'deny', reason: reason }; }
    }
  };
})();
