// SmartOLTPolling — central scheduler for browser-side polling that pauses
// when there's no reason to be polling: tab is hidden, OR the user has been
// idle for a while (default 5 min, no mouse / key / scroll). Pollers resume
// at their next scheduled tick the moment the tab becomes visible again or
// the user returns — no immediate extra call. Lives behind window.SmartOLTPolling.
//
// Two entry points:
//
//   register(fn, intervalMs, opts) → controller { stop, isPaused, isStopped }
//     Drop-in for `setInterval(fn, intervalMs)`. The interval starts after the
//     first `intervalMs` (matching setInterval). While paused (hidden / idle)
//     the interval is frozen (timer fully cleared); on resume a fresh full
//     interval is scheduled from the moment of resume — no immediate extra call.
//
//   scheduleOnce(fn, delayMs) → controller { clear }
//     Drop-in for a single `setTimeout`. Use this from inside recursive-
//     setTimeout pollers that compute their own next delay (e.g. the live
//     graph view or onu_view). If paused while the delay is pending, on resume
//     a fresh full delay is re-armed from the moment of resume; fn() fires
//     after that delay and self-reschedules as normal — no immediate extra call.
//
// Options on register():
//   fireImmediately:    boolean — call fn() right away in addition to the
//                       scheduled tick. Default false.
//   immediateOnResume:  boolean — call fn() the moment polling resumes
//                       after a pause. Default false.

window.SmartOLTPolling = (function () {
	var pollers = [];

	// Idle detection: pause polling after this much wall-clock time without
	// any user input (mouse, keyboard, scroll, touch).
	var IDLE_AFTER_MS = 5 * 60 * 1000;
	var IDLE_CHECK_INTERVAL_MS = 30 * 1000;

	var hiddenFlag = (typeof document !== 'undefined' &&
		typeof document.visibilityState === 'string' &&
		document.visibilityState === 'hidden');
	var idleFlag = false;
	var pausedState = hiddenFlag || idleFlag;
	var lastActivityTs = (typeof Date.now === 'function') ? Date.now() : new Date().getTime();

	function now() {
		return (typeof Date.now === 'function') ? Date.now() : new Date().getTime();
	}

	function logError(e) {
		if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
			console.error('SmartOLTPolling: poll function threw', e);
		}
	}

	function removeRec(rec) {
		var i = pollers.indexOf(rec);
		if (i !== -1) pollers.splice(i, 1);
	}

	function clearTimer(rec) {
		if (rec.timerId !== null) {
			clearTimeout(rec.timerId);
			rec.timerId = null;
		}
	}

	function scheduleNext(rec, delayMs) {
		clearTimer(rec);
		if (rec.stopped) {
			removeRec(rec);
			return;
		}
		if (pausedState) {
			rec.paused = true;
			return;
		}
		rec.paused = false;
		rec.timerId = setTimeout(function tick() {
			rec.timerId = null;
			if (rec.stopped) {
				removeRec(rec);
				return;
			}
			if (pausedState) {
				// Paused between scheduling and firing — defer to resume.
				rec.paused = true;
				return;
			}
			try { rec.fn(); } catch (e) { logError(e); }
			if (rec.stopped) {
				removeRec(rec);
				return;
			}
			if (rec.intervalMs > 0) {
				scheduleNext(rec, rec.intervalMs);
			} else {
				removeRec(rec);
			}
		}, delayMs);
	}

	function register(fn, intervalMs, opts) {
		opts = opts || {};
		var rec = {
			fn: fn,
			intervalMs: intervalMs,
			timerId: null,
			stopped: false,
			paused: false,
			immediateOnResume: opts.immediateOnResume === true
		};
		pollers.push(rec);
		if (opts.fireImmediately === true && !pausedState) {
			try { rec.fn(); } catch (e) { logError(e); }
		}
		scheduleNext(rec, intervalMs);
		return {
			stop: function () {
				rec.stopped = true;
				clearTimer(rec);
				removeRec(rec);
			},
			isStopped: function () { return rec.stopped; },
			isPaused: function () { return rec.paused; }
		};
	}

	function scheduleOnce(fn, delayMs) {
		var rec = {
			fn: fn,
			intervalMs: 0,
			onceDelayMs: delayMs,   // stored so resumeAllPollers() can re-arm
			timerId: null,
			stopped: false,
			paused: false,
			immediateOnResume: false  // resume re-arms the timer; fn() fires after delay
		};
		pollers.push(rec);
		scheduleNext(rec, delayMs);
		return {
			clear: function () {
				rec.stopped = true;
				clearTimer(rec);
				removeRec(rec);
			}
		};
	}

	function pauseAllPollers() {
		for (var i = 0; i < pollers.length; i++) {
			var rec = pollers[i];
			if (rec.stopped || rec.timerId === null) continue;
			clearTimeout(rec.timerId);
			rec.timerId = null;
			rec.paused = true;
		}
	}

	function resumeAllPollers() {
		// Snapshot the list — fn() may register or stop pollers.
		var resumeList = pollers.slice();
		for (var j = 0; j < resumeList.length; j++) {
			var p = resumeList[j];
			if (p.stopped || !p.paused) continue;
			p.paused = false;
			if (p.immediateOnResume) {
				// Fire fn() immediately on resume (opt-in only; no built-in caller
				// sets this today). fn() may self-reschedule or stop the rec.
				try { p.fn(); } catch (e) { logError(e); }
			}
			if (p.stopped) {
				removeRec(p);
				continue;
			}
			if (p.intervalMs > 0) {
				// Regular interval poller: re-arm with a fresh full interval from
				// the moment of resume (the old timer was clearTimeout'd on pause).
				scheduleNext(p, p.intervalMs);
			} else if (p.onceDelayMs !== undefined && !p.immediateOnResume) {
				// scheduleOnce poller that did NOT fire immediately: re-arm a fresh
				// full delay from the moment of resume. When it ticks, fn() fires
				// and self-reschedules via a new scheduleOnce() call (pushing a new
				// rec), then scheduleNext's tick() calls removeRec(p) for this old
				// rec — no leak, no duplicate.
				scheduleNext(p, p.onceDelayMs);
			} else {
				// scheduleOnce that already fired fn() immediately above (or an
				// intervalMs=0 rec with no onceDelayMs). fn() self-rescheduled, so
				// dropping the old rec here is correct and harmless.
				removeRec(p);
			}
		}
	}

	function recomputePauseState() {
		var nowPaused = hiddenFlag || idleFlag;
		if (nowPaused === pausedState) return;
		pausedState = nowPaused;
		if (pausedState) {
			pauseAllPollers();
		} else {
			resumeAllPollers();
		}
	}

	function handleVisibilityChange() {
		hiddenFlag = (document.visibilityState === 'hidden');
		recomputePauseState();
	}

	function markActivity() {
		lastActivityTs = now();
		// Common case: not idle, nothing to do beyond the timestamp.
		if (idleFlag) {
			idleFlag = false;
			recomputePauseState();
		}
	}

	function checkIdle() {
		if (!idleFlag && (now() - lastActivityTs) >= IDLE_AFTER_MS) {
			idleFlag = true;
			recomputePauseState();
		}
	}

	if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
		document.addEventListener('visibilitychange', handleVisibilityChange);

		// Activity listeners. capture:true so they fire before any handler
		// that calls stopPropagation; passive:true so they never block the
		// browser's default scroll/touch behavior.
		var activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'];
		var listenerOpts;
		try {
			// Probe for passive-listener support without throwing in old browsers.
			var probe = Object.defineProperty({}, 'passive', { get: function () { listenerOpts = { passive: true, capture: true }; } });
			window.addEventListener('test-passive', null, probe);
			window.removeEventListener('test-passive', null, probe);
		} catch (_) { /* listenerOpts stays undefined → falls back to useCapture=true */ }
		var useCapture = listenerOpts || true;
		for (var k = 0; k < activityEvents.length; k++) {
			document.addEventListener(activityEvents[k], markActivity, useCapture);
		}

		// Periodic idle check. Coarse on purpose — we don't need second-
		// level precision on the 5-minute threshold.
		setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS);
	}

	return {
		register: register,
		scheduleOnce: scheduleOnce,
		isHidden: function () { return hiddenFlag; },
		isIdle: function () { return idleFlag; },
		isPaused: function () { return pausedState; }
	};
})();