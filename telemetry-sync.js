(() => {
  'use strict';

  if (window.__focusSync && typeof window.__focusSync.stop === 'function') {
    try {
      window.__focusSync.stop();
    } catch (_) {
      // Ignore cleanup errors from prior instance
    }
  }

  const VERSION = '2.4.0';
  const TITLE_PREFIX = '· ';
  const DOT_ID = 'ff-telemetry-dot';
  const STORAGE_KEY = 'ff_sync_ts';

  const state = {
    active: true,
    startedAt: Date.now(),
    lastPulseAt: null,
    nextPulseAt: null,
    pulseCount: 0,
    timerId: null,
    stepTimeouts: new Set(),
    cleanupFns: [],
    wakeSentinel: null,
    audioCtx: null,
    oscillator: null,
    gainNode: null,
    titleObserver: null,
    dotEl: null,
    cursorX: Math.round((window.innerWidth || 1280) * 0.5),
    cursorY: Math.round((window.innerHeight || 800) * 0.5)
  };

  function registerCleanup(fn) {
    state.cleanupFns.push(fn);
  }

  function scheduleSubTimer(fn, delayMs) {
    const id = window.setTimeout(() => {
      state.stepTimeouts.delete(id);
      if (state.active) {
        fn();
      }
    }, delayMs);
    state.stepTimeouts.add(id);
    return id;
  }

  // 2.1 Visibility, Focus & Lifecycle Interception
  function bindViewportContinuity() {
    const docProto = typeof Document !== 'undefined' ? Document.prototype : null;
    const origHasFocus = docProto && docProto.hasFocus ? docProto.hasFocus : null;

    const propOverrides = [
      { prop: 'visibilityState', value: 'visible' },
      { prop: 'webkitVisibilityState', value: 'visible' },
      { prop: 'hidden', value: false },
      { prop: 'webkitHidden', value: false }
    ];

    const savedDescriptors = [];

    for (const { prop, value } of propOverrides) {
      for (const target of [document, docProto]) {
        if (!target) continue;
        try {
          const prev = Object.getOwnPropertyDescriptor(target, prop);
          savedDescriptors.push({ target, prop, prev });
          Object.defineProperty(target, prop, {
            get: () => value,
            set: () => {},
            configurable: true,
            enumerable: true
          });
        } catch (_) {
          // Ignore non-configurable property errors in restricted environments
        }
      }
    }

    try {
      if (docProto) {
        Object.defineProperty(docProto, 'hasFocus', {
          value: () => true,
          configurable: true,
          writable: true
        });
      }
      Object.defineProperty(document, 'hasFocus', {
        value: () => true,
        configurable: true,
        writable: true
      });
    } catch (_) {
      // Ignore if descriptor locked
    }

    const suppressLifecycleEvent = (e) => {
      if (!state.active) return;
      if (e.type === 'visibilitychange' || e.type === 'webkitvisibilitychange') {
        if (e.__ffInternal) return;
      }
      e.stopImmediatePropagation();
      e.stopPropagation();
    };

    const docEvents = ['visibilitychange', 'webkitvisibilitychange', 'freeze', 'pagehide'];
    const winEvents = ['blur', 'pagehide', 'freeze'];
    const listenerOpts = { capture: true, passive: false };

    for (const evtName of docEvents) {
      document.addEventListener(evtName, suppressLifecycleEvent, listenerOpts);
    }
    for (const evtName of winEvents) {
      window.addEventListener(evtName, suppressLifecycleEvent, listenerOpts);
    }

    registerCleanup(() => {
      for (const evtName of docEvents) {
        document.removeEventListener(evtName, suppressLifecycleEvent, listenerOpts);
      }
      for (const evtName of winEvents) {
        window.removeEventListener(evtName, suppressLifecycleEvent, listenerOpts);
      }
      for (const { target, prop, prev } of savedDescriptors) {
        try {
          if (prev) {
            Object.defineProperty(target, prop, prev);
          } else {
            delete target[prop];
          }
        } catch (_) {}
      }
      try {
        delete document.hasFocus;
        if (docProto && origHasFocus) {
          Object.defineProperty(docProto, 'hasFocus', {
            value: origHasFocus,
            configurable: true,
            writable: true
          });
        }
      } catch (_) {}
    });

    try {
      window.dispatchEvent(new Event('focus'));
      const visEvt = new Event('visibilitychange');
      Object.defineProperty(visEvt, '__ffInternal', { value: true });
      document.dispatchEvent(visEvt);
    } catch (_) {}
  }

  // 2.2 Idle Detection API Override
  function patchIdleObserver() {
    if (!('IdleDetector' in window) || typeof window.IdleDetector !== 'function') {
      return;
    }

    const IdleCtor = window.IdleDetector;
    const proto = IdleCtor.prototype;
    const origRequestPerm = IdleCtor.requestPermission;
    const origStart = proto ? proto.start : null;
    const origAddEvent = proto ? proto.addEventListener : null;

    try {
      IdleCtor.requestPermission = async () => 'granted';
    } catch (_) {}

    if (proto) {
      try {
        Object.defineProperty(proto, 'userState', {
          get: () => 'active',
          configurable: true
        });
        Object.defineProperty(proto, 'screenState', {
          get: () => 'unlocked',
          configurable: true
        });
      } catch (_) {}

      if (origAddEvent) {
        proto.addEventListener = function (type, listener, options) {
          if (state.active && type === 'change') {
            return;
          }
          return origAddEvent.call(this, type, listener, options);
        };
      }

      if (origStart) {
        proto.start = async function () {
          try {
            Object.defineProperty(this, 'userState', {
              get: () => 'active',
              configurable: true
            });
            Object.defineProperty(this, 'screenState', {
              get: () => 'unlocked',
              configurable: true
            });
            Object.defineProperty(this, 'onchange', {
              get: () => null,
              set: () => {},
              configurable: true
            });
          } catch (_) {}
          return Promise.resolve();
        };
      }
    }

    registerCleanup(() => {
      try {
        if (origRequestPerm) IdleCtor.requestPermission = origRequestPerm;
        if (proto && origStart) proto.start = origStart;
        if (proto && origAddEvent) proto.addEventListener = origAddEvent;
      } catch (_) {}
    });
  }

  // 2.3 Gaussian Jitter & Multi-Vector DOM Activity
  function nextGaussianInterval(minSec = 38, maxSec = 115) {
    const minMs = minSec * 1000;
    const maxMs = maxSec * 1000;
    const mean = (minMs + maxMs) / 2;
    const stdDev = (maxMs - minMs) / 6;

    let u1 = 0;
    let u2 = 0;
    while (u1 <= Number.EPSILON) u1 = Math.random();
    while (u2 <= Number.EPSILON) u2 = Math.random();

    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const sample = mean + z0 * stdDev + (Math.random() * 73 - 36.5);
    const clamped = Math.max(minMs, Math.min(maxMs, sample));
    return Math.floor(clamped);
  }

  function resolveCalibrationTarget(x, y) {
    try {
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.id !== DOT_ID) {
        return hit;
      }
    } catch (_) {}
    return (
      document.querySelector('#app, [data-tid], [role="main"], main') ||
      document.body ||
      document.documentElement
    );
  }

  function dispatchSpatialStep(x, y, dx, dy) {
    const target = resolveCalibrationTarget(x, y);
    if (!target) return;

    const screenX = (window.screenX || 0) + x;
    const screenY = (window.screenY || 0) + y;

    const commonInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX,
      screenY,
      movementX: dx,
      movementY: dy
    };

    const receivers = [target, document, window];

    if (typeof PointerEvent === 'function') {
      for (const recv of receivers) {
        try {
          recv.dispatchEvent(
            new PointerEvent('pointermove', {
              ...commonInit,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
              width: 1,
              height: 1,
              pressure: 0
            })
          );
        } catch (_) {}
      }
    }

    if (typeof MouseEvent === 'function') {
      for (const recv of receivers) {
        try {
          recv.dispatchEvent(new MouseEvent('mousemove', commonInit));
        } catch (_) {}
      }
    }
  }

  function emitViewportPulse() {
    if (!state.active) return;

    state.pulseCount += 1;
    state.lastPulseAt = Date.now();
    flashIndicatorDot();

    const vw = Math.max(window.innerWidth || 1280, 320);
    const vh = Math.max(window.innerHeight || 800, 240);
    const minX = Math.round(vw * 0.2);
    const maxX = Math.round(vw * 0.8);
    const minY = Math.round(vh * 0.2);
    const maxY = Math.round(vh * 0.8);

    if (state.cursorX < minX || state.cursorX > maxX) {
      state.cursorX = Math.round(minX + Math.random() * (maxX - minX));
    }
    if (state.cursorY < minY || state.cursorY > maxY) {
      state.cursorY = Math.round(minY + Math.random() * (maxY - minY));
    }

    const totalSteps = 3 + Math.floor(Math.random() * 4); // 3 to 6 steps
    let cumulativeDelay = 0;

    for (let i = 0; i < totalSteps; i++) {
      const stepDelay = i === 0 ? 0 : 18 + Math.floor(Math.random() * 28); // 18ms - 45ms
      cumulativeDelay += stepDelay;

      scheduleSubTimer(() => {
        const dx = Math.round((Math.random() * 12) - 6); // [-6, +6]
        const dy = Math.round((Math.random() * 12) - 6); // [-6, +6]
        state.cursorX = Math.max(minX, Math.min(maxX, state.cursorX + dx));
        state.cursorY = Math.max(minY, Math.min(maxY, state.cursorY + dy));
        dispatchSpatialStep(state.cursorX, state.cursorY, dx, dy);
      }, cumulativeDelay);
    }

    // 35% chance: benign modifier key tap
    if (Math.random() < 0.35) {
      const modifiers = [
        { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
        { key: 'Control', code: 'ControlLeft', keyCode: 17 },
        { key: 'F15', code: 'F15', keyCode: 126 }
      ];
      const chosen = modifiers[Math.floor(Math.random() * modifiers.length)];
      const keyTarget = document.activeElement || document.body || document.documentElement;

      if (keyTarget && typeof KeyboardEvent === 'function') {
        const keyOpts = {
          key: chosen.key,
          code: chosen.code,
          keyCode: chosen.keyCode,
          which: chosen.keyCode,
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        };
        try {
          keyTarget.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        } catch (_) {}

        const holdDuration = 55 + Math.floor(Math.random() * 56); // 55ms - 110ms
        scheduleSubTimer(() => {
          try {
            keyTarget.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
          } catch (_) {}
        }, holdDuration);
      }
    }

    // 25% chance: micro WheelEvent & scroll UIEvent
    if (Math.random() < 0.25) {
      const scrollTarget = resolveCalibrationTarget(state.cursorX, state.cursorY);
      try {
        if (scrollTarget && typeof WheelEvent === 'function') {
          scrollTarget.dispatchEvent(
            new WheelEvent('wheel', {
              deltaY: Math.random() > 0.5 ? 1 : -1,
              bubbles: true,
              composed: true
            })
          );
        }
        if (typeof UIEvent === 'function') {
          document.dispatchEvent(new UIEvent('scroll', { bubbles: true }));
        }
      } catch (_) {}
    }

    // Every 3rd pulse: subtle pointerdown + pointerup on document.body and storage timestamp sync
    if (state.pulseCount % 3 === 0) {
      const bodyEl = document.body || document.documentElement;
      if (bodyEl && typeof PointerEvent === 'function') {
        const ptrInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: state.cursorX,
          clientY: state.cursorY,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true
        };
        try {
          bodyEl.dispatchEvent(new PointerEvent('pointerdown', ptrInit));
          scheduleSubTimer(() => {
            try {
              bodyEl.dispatchEvent(new PointerEvent('pointerup', ptrInit));
            } catch (_) {}
          }, 32);
        } catch (_) {}
      }

      try {
        window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch (_) {}
    }
  }

  function scheduleLayoutCalibration() {
    if (!state.active) return;
    if (state.timerId !== null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    const intervalMs = nextGaussianInterval(38, 115);
    state.nextPulseAt = Date.now() + intervalMs;

    state.timerId = window.setTimeout(() => {
      state.timerId = null;
      if (!state.active) return;
      emitViewportPulse();
      scheduleLayoutCalibration();
    }, intervalMs);
  }

  // 2.4 In-Tab Wake Lock & Silent Acoustic Bus
  async function acquireViewportLock() {
    if (!state.active) return;
    if (!('wakeLock' in navigator) || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      return;
    }
    if (state.wakeSentinel && !state.wakeSentinel.released) {
      return;
    }
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!state.active) {
        try {
          await sentinel.release();
        } catch (_) {}
        return;
      }
      state.wakeSentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (state.active) {
          scheduleSubTimer(() => {
            acquireViewportLock();
          }, 1200);
        }
      });
    } catch (_) {
      // Permission or transient policy error; will retry on user gesture
    }
  }

  function initAcousticCalibration() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioCtor !== 'function') return;

    try {
      const ctx = new AudioCtor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1, ctx.currentTime);
      gain.gain.setValueAtTime(0.00001, ctx.currentTime);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      state.audioCtx = ctx;
      state.oscillator = osc;
      state.gainNode = gain;
    } catch (_) {}
  }

  function initMediaRetention() {
    acquireViewportLock();
    initAcousticCalibration();

    const resumeMediaOnGesture = () => {
      if (!state.active) return;
      if (!state.wakeSentinel || state.wakeSentinel.released) {
        acquireViewportLock();
      }
      if (state.audioCtx && state.audioCtx.state === 'suspended') {
        try {
          state.audioCtx.resume();
        } catch (_) {}
      }
    };

    window.addEventListener('click', resumeMediaOnGesture, { passive: true });
    window.addEventListener('keydown', resumeMediaOnGesture, { passive: true });

    registerCleanup(() => {
      window.removeEventListener('click', resumeMediaOnGesture, { passive: true });
      window.removeEventListener('keydown', resumeMediaOnGesture, { passive: true });

      if (state.wakeSentinel) {
        try {
          state.wakeSentinel.release();
        } catch (_) {}
        state.wakeSentinel = null;
      }

      if (state.oscillator) {
        try {
          state.oscillator.stop();
          state.oscillator.disconnect();
        } catch (_) {}
        state.oscillator = null;
      }

      if (state.gainNode) {
        try {
          state.gainNode.disconnect();
        } catch (_) {}
        state.gainNode = null;
      }

      if (state.audioCtx) {
        try {
          state.audioCtx.close();
        } catch (_) {}
        state.audioCtx = null;
      }
    });
  }

  // 2.5 Discreet Visual Indicator & Title Sync
  function flashIndicatorDot() {
    if (!state.dotEl) return;
    state.dotEl.style.opacity = '1';
    state.dotEl.style.transform = 'scale(1.45)';
    state.dotEl.style.boxShadow = '0 0 8px #10b981';
    scheduleSubTimer(() => {
      if (!state.dotEl) return;
      state.dotEl.style.opacity = '0.6';
      state.dotEl.style.transform = 'scale(1)';
      state.dotEl.style.boxShadow = 'none';
    }, 320);
  }

  function initVisualIndicator() {
    const syncTitlePrefix = () => {
      if (!state.active) return;
      if (typeof document.title === 'string' && !document.title.startsWith(TITLE_PREFIX)) {
        document.title = TITLE_PREFIX + document.title;
      }
    };

    syncTitlePrefix();

    const titleEl = document.querySelector('title') || document.head;
    if (titleEl && typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => {
        if (!state.active) return;
        if (!document.title.startsWith(TITLE_PREFIX)) {
          document.title = TITLE_PREFIX + document.title;
        }
      });
      observer.observe(titleEl, {
        childList: true,
        characterData: true,
        subtree: true
      });
      state.titleObserver = observer;
    }

    const mountDot = () => {
      if (!state.active || !document.body) return;
      let existing = document.getElementById(DOT_ID);
      if (existing) {
        existing.remove();
      }

      const dot = document.createElement('div');
      dot.id = DOT_ID;
      dot.title = 'FocusFlow Telemetry Sync: Active (Click to calibrate)';
      dot.style.cssText = [
        'inset: auto 6px 6px auto',
        'width: 6px',
        'height: 6px',
        'position: fixed',
        'z-index: 2147483647',
        'border-radius: 50%',
        'background: #10b981',
        'opacity: 0.6',
        'cursor: pointer',
        'transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease',
        'pointer-events: auto'
      ].join('; ');

      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.__focusSync && typeof window.__focusSync.triggerNow === 'function') {
          window.__focusSync.triggerNow();
        }
      });

      document.body.appendChild(dot);
      state.dotEl = dot;
    };

    if (document.body) {
      mountDot();
    } else {
      window.addEventListener('DOMContentLoaded', mountDot, { once: true });
    }

    registerCleanup(() => {
      if (state.titleObserver) {
        state.titleObserver.disconnect();
        state.titleObserver = null;
      }
      if (typeof document.title === 'string' && document.title.startsWith(TITLE_PREFIX)) {
        document.title = document.title.slice(TITLE_PREFIX.length);
      }
      if (state.dotEl) {
        state.dotEl.remove();
        state.dotEl = null;
      }
      const leftover = document.getElementById(DOT_ID);
      if (leftover) leftover.remove();
    });
  }

  // Public API on window.__focusSync
  const api = {
    active: true,
    version: VERSION,
    status() {
      return {
        active: state.active,
        version: VERSION,
        uptimeMs: Date.now() - state.startedAt,
        pulseCount: state.pulseCount,
        lastPulseAt: state.lastPulseAt ? new Date(state.lastPulseAt).toISOString() : null,
        nextPulseInMs:
          state.active && state.nextPulseAt ? Math.max(0, state.nextPulseAt - Date.now()) : null,
        viewportLockHeld: Boolean(state.wakeSentinel && !state.wakeSentinel.released),
        acousticState: state.audioCtx ? state.audioCtx.state : 'inactive',
        visibilityState: document.visibilityState,
        focused: document.hasFocus()
      };
    },
    triggerNow() {
      if (!state.active) return false;
      emitViewportPulse();
      scheduleLayoutCalibration();
      return this.status();
    },
    stop() {
      if (!state.active) return false;
      state.active = false;
      this.active = false;

      if (state.timerId !== null) {
        window.clearTimeout(state.timerId);
        state.timerId = null;
      }

      for (const id of state.stepTimeouts) {
        window.clearTimeout(id);
      }
      state.stepTimeouts.clear();

      while (state.cleanupFns.length > 0) {
        const fn = state.cleanupFns.pop();
        try {
          fn();
        } catch (_) {}
      }

      return true;
    }
  };

  window.__focusSync = api;

  // Boot sequence
  bindViewportContinuity();
  patchIdleObserver();
  initMediaRetention();
  initVisualIndicator();
  emitViewportPulse();
  scheduleLayoutCalibration();

  console.info('%c[FocusFlow] Telemetry & Viewport Sync v2.4 Active', 'color:#10b981;font-weight:600;');
})();
