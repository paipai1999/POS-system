'use strict';

// The time clock in the menu bar: anyone signed in clocks themselves in and out. (Staff hours are for managers: screens/attendance.js.)
Object.assign(App, {
  clockButton() {
    const on = Store.onShift(this.user.id);
    return `<button class="btn small clock-btn ${on ? 'on' : ''}" data-nav="clock" aria-label="${on ? 'Clock out' : 'Clock in'}" title="${on ? `On shift since ${fmtTime(on.in)}` : 'Start your shift'}">${icon('clock')} <span>${on ? 'On shift' : 'Clock in'}</span></button>`;
  },

  // Clock in at once; when on shift, show the shift and ask before clocking out.
  clockPressed() {
    const me = this.user;
    const on = Store.onShift(me.id);
    if (!on) {
      const forgot = Store.runningShift(me.id);
      const e = Store.clockIn(me);
      if (!e) return;
      this.renderTopbar();
      toast(`Clocked in at ${fmtTime(e.in)}`, 'ok');
      if (forgot) toast('Your last shift was never ended. A manager will correct it.', 'error');
      return;
    }
    const week = this.myWeek(me.id);
    const actions = {
      out: () => {
        const e = Store.clockOut(me);
        Modal.close();
        this.renderTopbar();
        if (e) toast(`Clocked out at ${fmtTime(e.out)} · ${hoursText(shiftHours(e))} today`, 'ok');
        if (this.screen === 'attendance') this.render();
      },
    };
    actions.__enter = actions.out;
    Modal.open({
      title: 'Clock out?',
      body: `
        <p>You started at ${fmtTime(on.in)}${new Date(on.in).toDateString() === new Date().toDateString() ? '' : ` on ${new Date(on.in).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}`}.</p>
        <p>Time on shift so far: <b>${hoursText(shiftHours(on))}</b></p>
        <p class="muted small">${week.shifts} shift${week.shifts === 1 ? '' : 's'} and ${hoursText(week.hours)} this week, counting this one.</p>`,
      footer: '<button class="btn" data-act="__close">Stay on shift</button><button class="btn primary" data-act="out">Clock out</button>',
      actions,
    });
  },

  // This person's shifts since Monday (what they can see of their own time sheet).
  myWeek(userId) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const mine = Store.data.attendance.filter(e => e.userId === userId && e.in >= d.getTime() && !attendanceUnsure(e));
    return { shifts: mine.length, hours: mine.reduce((n, e) => n + shiftHours(e), 0) };
  },
});
