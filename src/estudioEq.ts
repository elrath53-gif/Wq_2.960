/* eslint-disable @typescript-eslint/no-explicit-any */

interface AndroidBridgeAPI {
  hasMusicPermission?: () => boolean;
  requestMusicPermission?: () => void;
  rescanMusic?: () => void;
  updatePlaybackState?: (
    title: string,
    artist: string,
    isPlaying: boolean,
    positionMs: number,
    durationMs: number
  ) => void;
  vibrate?: (ms: number) => void;
  isIgnoringBatteryOptimizations?: () => boolean;
  openBatterySettings?: () => void;
  saveState?: (json: string) => boolean;
  loadState?: () => string;
  isInPhoneCall?: () => boolean;
  setWindowColors?: (statusHex: string, navHex: string) => void;
  getJackHiResInfo?: () => string;
  configureJackHiRes?: (enable: boolean, preferredRate: number) => string;
}

interface JackHardwareInfo {
  jackConnected: boolean;
  portType: 'jack_35mm' | 'usb_dac_jack' | 'bluetooth' | 'speaker' | 'web';
  deviceName: string;
  nativeRate: number;
  framesPerBuffer: number;
  arbitraryRates: boolean;
  maxSampleRate: number;
  supportedRates: number[];
  bitDepth: number;
  floatPcm: boolean;
}

declare global {
  interface Window {
    AndroidBridge?: AndroidBridgeAPI;
    webkitAudioContext?: typeof AudioContext;
    __onNativeTracks?: (tracksInput: unknown, reason?: string) => void;
    __onNativePermission?: (granted: boolean) => void;
    __onNativeJack?: (jackJson: unknown, reason?: string) => void;
    __nativeCmd?: (cmd: string, arg?: number) => void;
    __estudioEqBooted?: boolean;
  }
}

export function bootEstudioEQ(rootEl: HTMLElement): void {
  if (window.__estudioEqBooted) return;
  window.__estudioEqBooted = true;

  const NATIVE = typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge !== null;
  const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = rootEl): T | null =>
    r.querySelector<T>(s) || document.querySelector<T>(s);

  function h(tag: string, props?: Record<string, any> | null, ...kids: any[]): HTMLElement {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = String(v);
        else if (k === 'text') e.textContent = String(v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, String(v));
      }
    }
    for (const c of kids.flat()) {
      if (c != null && c !== false) {
        e.append(c.nodeType ? c : document.createTextNode(String(c)));
      }
    }
    return e;
  }

  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
  const dB = (x: number) => Math.pow(10, x / 20);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const fmtF = (f: number) => (f >= 1000 ? +(f / 1000).toFixed(2) + 'k' : String(f));
  const fmtHz = (f: number) => (f >= 1000 ? +(f / 1000).toFixed(2) + ' kHz' : f + ' Hz');
  const sgn = (v: number, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
  const mmss = (t: number) => {
    t = Math.max(0, t | 0);
    return ((t / 60) | 0) + ':' + String(t % 60).padStart(2, '0');
  };
  const normStr = (s: string) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  /* ---------- datos ---------- */
  const BANDS30 = [
    25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
  ];
  const BANDS16 = [40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 5000, 8000, 10000, 12500, 16000];
  const NAMES16 = [
    'Sub', 'Graves', 'Bajos', 'Cuerpo', 'Calidez', 'Barro', 'Medios', 'Voz',
    'Claridad', 'Nitidez', 'Dicción', 'Brillo', 'Agudos', 'Aire', 'Aire +', 'Ultra',
  ];
  const INST: Array<{ grp: string; name: string; items: Array<[string, string, number, number]> }> = [
    {
      grp: 'drums',
      name: 'Batería',
      items: [
        ['kick', 'Bombo', 60, 1.2],
        ['snareB', 'Caja · cuerpo', 200, 1.4],
        ['snareC', 'Caja · chasquido', 5000, 1.2],
        ['tomF', 'Tom de piso', 90, 1.5],
        ['tomM', 'Tom medio', 160, 1.5],
        ['tomH', 'Tom agudo', 250, 1.5],
        ['hat', 'Hi-hat', 9000, 1],
        ['cym', 'Platillos', 12000, 0.8],
      ],
    },
    {
      grp: 'guitar',
      name: 'Guitarras',
      items: [
        ['gBody', 'Guitarra · cuerpo', 250, 1.2],
        ['gPres', 'Guitarra · presencia', 3000, 1.2],
        ['gAc', 'Acústica · brillo', 6000, 1],
      ],
    },
    {
      grp: 'bass',
      name: 'Bajo',
      items: [
        ['bLow', 'Bajo · cuerpo', 80, 1.4],
        ['bAtk', 'Bajo · ataque', 900, 1.4],
      ],
    },
    {
      grp: 'voice',
      name: 'Voces',
      items: [
        ['vWarm', 'Voz · calidez', 200, 1.2],
        ['vPres', 'Voz · presencia', 3500, 1.2],
        ['vSib', 'Voz · sibilancia', 7000, 2],
        ['vAir', 'Voz · aire', 12000, 0.8],
      ],
    },
    {
      grp: 'keys',
      name: 'Teclas y piano',
      items: [
        ['kBody', 'Piano · cuerpo', 300, 1.2],
        ['kBri', 'Piano · brillo', 4500, 1],
      ],
    },
  ];
  const FXN: Record<string, string> = {
    tone: 'Tono y filtros',
    comp: 'Compresor maestro',
    mbcomp: 'Compresor multibanda (3 bandas)',
    deess: 'De-Esser vocal dinámico',
    sat: 'Saturación analógica 4×',
    airexc: 'Excitador de aire armónico 4×',
    bmono: 'Centrador de subgraves (Mono)',
    xfeed: 'Crossfeed de audífonos',
    wid: 'Ancho estéreo M/S',
    rev: 'Reverberación HD',
    dly: 'Eco / Delay',
    sp: 'Sonido 3D Binaural',
    sub: 'Subgraves potentes',
    glass: 'Resonancia de vidrios',
    harm: 'Armónicos de graves 4×',
    trem: 'Temblor (trémolo)',
    vibr: 'Vibrato',
    hap: 'Vibración del teléfono',
  };

  function defState(): any {
    const inst: Record<string, { g: number; f: number; q: number }> = {};
    INST.forEach((g) => g.items.forEach(([id, , f, q]) => (inst[id] = { g: 0, f, q })));
    return {
      master: { pre: 0, vol: 0, ceil: -0.1, autoHead: false },
      play: { xfade: 0, gapless: true, rate: 1, keepPitch: true, hz432: false },
      jack: { hiRes: true, rate: 0, dither24: true },
      playerVol: 100,
      q30: 4.32,
      r30: 12,
      propQ30: true,
      eq: Array(30).fill(0),
      q16: 2.8,
      r16: 12,
      propQ16: true,
      cl: Array(16).fill(0),
      inst,
      fx: {
        tone: { bass: 0, bassF: 100, treb: 0, trebF: 8000, lc: 20, hc: 20000 },
        comp: { on: false, th: 0, ratio: 1, attack: 3, release: 250, knee: 0, makeup: 0 },
        mbcomp: { on: false, lowX: 160, highX: 3200, lowTh: -20, midTh: -18, highTh: -20, ratio: 3, lowG: 0, midG: 0, highG: 0 },
        deess: { on: false, freq: 6800, th: -24, amt: 6 },
        sat: { on: false, drive: 0, mix: 0, mode: 0 },
        airexc: { on: false, freq: 9500, drive: 25, mix: 0 },
        bmono: { on: false, freq: 100, mono: 100 },
        xfeed: { on: false, mix: 30, fc: 700 },
        wid: { on: false, w: 0 },
        rev: { on: false, mix: 0, decay: 2, pre: 0, damp: 30, size: 50 },
        dly: { on: false, time: 250, fb: 0, mix: 0, tone: 8000 },
        sp: { on: false, mix: 0, az: 0, el: 0, dist: 1, rot: 0 },
        sub: { on: false, freq: 50, g: 0, q: 1.2 },
        glass: { on: false, freq: 90, g: 0, q: 6 },
        harm: { on: false, freq: 120, drive: 0, mix: 0 },
        trem: { on: false, rate: 5, depth: 0, shape: 0 },
        vibr: { on: false, rate: 5, depth: 0 },
        hap: { on: false, thr: 60, dur: 40, gap: 60, shake: 0 },
      },
      bypass: false,
      locks: {},
    };
  }

  const S = defState();
  const D = defState();

  function merge(t: any, s: any) {
    if (!s || typeof s !== 'object') return;
    for (const k in t) {
      if (!(k in s) || s[k] == null) continue;
      if (t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], s[k]);
      else if (typeof t[k] === 'number') {
        const n = +s[k];
        if (isFinite(n)) t[k] = n;
      } else if (typeof t[k] === 'boolean') t[k] = !!s[k];
      else if (typeof t[k] === typeof s[k] && !Array.isArray(t[k])) t[k] = s[k];
    }
  }

  const SEC: Record<string, { n: string; get: (s: any) => any; set: (s: any, d: any) => void }> = {
    master: { n: 'Entrada y salida', get: (s) => clone(s.master), set: (s, d) => merge(s.master, d) },
    play: { n: 'Transición y motor de reproducción', get: (s) => clone(s.play), set: (s, d) => merge(s.play, d) },
    eq30: {
      n: 'EQ de 30 bandas',
      get: (s) => ({ eq: s.eq.slice(), q30: s.q30, r30: s.r30, propQ30: !!s.propQ30 }),
      set: (s, d) => {
        if (!d || typeof d !== 'object') return;
        if (Array.isArray(d.eq) && d.eq.length === 30) s.eq = d.eq.map((v: any) => clamp(isFinite(+v) ? +v : 0, -24, 24));
        if (d.q30 != null && isFinite(+d.q30) && +d.q30 > 0) s.q30 = clamp(+d.q30, 0.3, 20);
        if (d.r30 != null && [6, 12, 24].includes(+d.r30)) s.r30 = +d.r30;
        if (typeof d.propQ30 === 'boolean') s.propQ30 = d.propQ30;
      },
    },
    cl16: {
      n: '16 bandas de claridad',
      get: (s) => ({ cl: s.cl.slice(), q16: s.q16, r16: s.r16, propQ16: !!s.propQ16 }),
      set: (s, d) => {
        if (!d || typeof d !== 'object') return;
        if (Array.isArray(d.cl) && d.cl.length === 16) s.cl = d.cl.map((v: any) => clamp(isFinite(+v) ? +v : 0, -24, 24));
        if (d.q16 != null && isFinite(+d.q16) && +d.q16 > 0) s.q16 = clamp(+d.q16, 0.3, 20);
        if (d.r16 != null && [6, 12, 24].includes(+d.r16)) s.r16 = +d.r16;
        if (typeof d.propQ16 === 'boolean') s.propQ16 = d.propQ16;
      },
    },
  };

  INST.forEach((g) => {
    SEC[g.grp] = {
      n: g.name,
      get: (s) => {
        const o: Record<string, any> = {};
        g.items.forEach(([id]) => (o[id] = clone(s.inst[id])));
        return o;
      },
      set: (s, d) => {
        if (d && typeof d === 'object') g.items.forEach(([id]) => { if (d[id]) merge(s.inst[id], d[id]); });
      },
    };
  });

  Object.keys(FXN).forEach((k) => {
    SEC[k] = { n: FXN[k], get: (s) => clone(s.fx[k]), set: (s, d) => merge(s.fx[k], d) };
  });

  const ORDER = [
    'master', 'play', 'eq30', 'cl16', 'drums', 'guitar', 'bass', 'voice', 'keys',
    'tone', 'comp', 'mbcomp', 'deess', 'sat', 'airexc', 'bmono', 'xfeed', 'wid', 'rev', 'dly', 'sp', 'sub', 'glass', 'harm', 'trem', 'vibr', 'hap',
  ];
  const getFull = () => {
    const o: Record<string, any> = {};
    ORDER.forEach((k) => (o[k] = SEC[k].get(S)));
    return o;
  };
  const resetSec = (k: string) => SEC[k].set(S, SEC[k].get(D));

  /* ---------- almacenamiento nativo + local ---------- */
  const KEY = 'estudio-master-hires-v1';
  const LAST_TRACK_KEY = 'estudio-master-hires-last-track';
  const store: { last: any; presets: any[]; sec: Record<string, any[]> } = { last: null, presets: [], sec: {} };
  let savedRepeat = 0;
  let savedShuffle = false;
  let savedSortMode: 'recent' | 'az' = 'recent';
  let savedLastTrackId: string | null = null;

  function loadRawStore(): string {
    if (NATIVE && window.AndroidBridge?.loadState) {
      try {
        const ns = window.AndroidBridge.loadState();
        if (ns && ns.length > 2) return ns;
      } catch (_e) {}
    }
    try {
      return localStorage.getItem(KEY) || '';
    } catch (_e) {
      return '';
    }
  }

  try {
    const r = loadRawStore();
    if (r) {
      const o = JSON.parse(r);
      if (o && typeof o === 'object') {
        store.last = o.last && typeof o.last === 'object' ? o.last : null;
        store.presets = Array.isArray(o.presets) ? o.presets : [];
        store.sec = o.sec && typeof o.sec === 'object' ? o.sec : {};
      }
    }
  } catch (_e) {}

  let toastTimer: any = null;
  function toast(m: string) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = m;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }

  function persist() {
    let ok = false;
    const raw = JSON.stringify(store);
    if (NATIVE && window.AndroidBridge?.saveState) {
      try {
        ok = !!window.AndroidBridge.saveState(raw);
      } catch (_e) {}
    }
    try {
      localStorage.setItem(KEY, raw);
      ok = true;
    } catch (_e) {}
    if (!ok) toast('Este navegador no permite guardar. Usa Exportar en Presets.');
    return ok;
  }

  function snapshotLast() {
    store.last = {
      data: getFull(),
      bypass: !!S.bypass,
      locks: clone(S.locks || {}),
      jack: clone(S.jack || { hiRes: true, rate: 0, dither24: true }),
      playerVol: clamp(isFinite(+S.playerVol) ? +S.playerVol : 100, 0, 100),
      repeat: savedRepeat,
      shuffle: savedShuffle,
      sortMode: savedSortMode,
      lastTrackId: savedLastTrackId,
    };
  }

  let saveT: any = 0;
  function persistNow() {
    clearTimeout(saveT);
    snapshotLast();
    return persist();
  }
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      snapshotLast();
      persist();
    }, 280);
  }

  if (store.last) {
    if (store.last.data && typeof store.last.data === 'object') {
      ORDER.forEach((k) => {
        if (store.last.data[k]) SEC[k].set(S, store.last.data[k]);
      });
    }
    S.bypass = !!store.last.bypass;
    S.locks = store.last.locks && typeof store.last.locks === 'object' ? store.last.locks : {};
    if (store.last.jack && typeof store.last.jack === 'object') {
      if (typeof store.last.jack.hiRes === 'boolean') S.jack.hiRes = store.last.jack.hiRes;
      if ([0, 48000, 96000, 192000].includes(+store.last.jack.rate)) S.jack.rate = +store.last.jack.rate;
      if (typeof store.last.jack.dither24 === 'boolean') S.jack.dither24 = store.last.jack.dither24;
    }
    if (store.last.playerVol != null && isFinite(+store.last.playerVol)) S.playerVol = clamp(+store.last.playerVol, 0, 100);
    if ([0, 1, 2].includes(+store.last.repeat)) savedRepeat = +store.last.repeat;
    if (typeof store.last.shuffle === 'boolean') savedShuffle = store.last.shuffle;
    if (store.last.sortMode === 'az' || store.last.sortMode === 'recent') savedSortMode = store.last.sortMode;
    if (store.last.lastTrackId != null) savedLastTrackId = String(store.last.lastTrackId);
  }
  try {
    if (!savedLastTrackId) savedLastTrackId = localStorage.getItem(LAST_TRACK_KEY);
  } catch (_e) {}

  const stamp = () => new Date().toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  /* ---------- Motor DSP Mastering Ultra (64-bit Float64 EQ · Dual-Deck Gapless · Oversampling 4× · Brickwall 2.5ms) ---------- */
  let ctx: AudioContext | null = null;
  let deckA!: HTMLAudioElement;
  let deckB!: HTMLAudioElement;
  let audio!: HTMLAudioElement;
  let standbyAudio!: HTMLAudioElement;
  let activeDeck: 'A' | 'B' = 'A';
  let engineGen = 0;
  let rebuildingCtx = false;
  let lastTargetRate = -1;
  let workletReady = false;
  let eq64Ready = false;
  let ditherReady = false;
  let jackStatusEl: HTMLElement | null = null;
  let jackHw: JackHardwareInfo = {
    jackConnected: false,
    portType: NATIVE ? 'speaker' : 'web',
    deviceName: NATIVE ? 'Altavoz del teléfono' : 'Salida del sistema / Jack',
    nativeRate: 48000,
    framesPerBuffer: 256,
    arbitraryRates: !NATIVE,
    maxSampleRate: NATIVE ? 48000 : 192000,
    supportedRates: NATIVE ? [48000] : [48000, 96000, 192000],
    bitDepth: 24,
    floatPcm: true,
  };
  const N: Record<string, any> = {};
  let irKey = '';
  let irT: any = 0;
  let satSig = '';
  let airDriveSig = -1;
  let harmDrive = -1;
  let ceilSig = -999;
  let eq64Sig = '';
  let vizDirty = true;
  const P_CACHE: Record<string, number> = Object.create(null);
  const FX_CONN = {
    harm: false,
    sat: false,
    airexc: false,
    mbcomp: false,
    deess: false,
    bmono: false,
    xfeed: false,
    sp: false,
    rev: false,
    dly: false,
    trem: false,
    vibr: false,
    dither: false,
  };

  const chain = (...n: AudioNode[]) => {
    for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]);
  };
  function safeConn(a: AudioNode, b: AudioNode, on: boolean) {
    if (on) {
      try {
        a.connect(b);
      } catch (_e) {}
    } else {
      try {
        a.disconnect(b);
      } catch (_e) {}
    }
  }

  /* Coeficientes Biquad RBJ en doble precisión IEEE-754 (64-bit Float64) */
  function biquadCoeffs64(type: string, f: number, Q: number, gainDb: number, fs: number): [number, number, number, number, number] {
    const w0 = (2 * Math.PI * clamp(f, 10, fs * 0.495)) / fs;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    if (type === 'peaking') {
      const A = Math.pow(10, gainDb / 40);
      const alpha = sinw / (2 * Math.max(0.1, Q));
      b0 = 1 + alpha * A;
      b1 = -2 * cosw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw;
      a2 = 1 - alpha / A;
    } else if (type === 'highpass') {
      const alpha = sinw / (2 * Math.max(0.1, Q));
      b0 = (1 + cosw) * 0.5;
      b1 = -(1 + cosw);
      b2 = (1 + cosw) * 0.5;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
    } else if (type === 'lowpass') {
      const alpha = sinw / (2 * Math.max(0.1, Q));
      b0 = (1 - cosw) * 0.5;
      b1 = 1 - cosw;
      b2 = (1 - cosw) * 0.5;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
    } else if (type === 'lowshelf') {
      const A = Math.pow(10, gainDb / 40);
      const sqA = Math.sqrt(A);
      const alpha = (sinw * 0.5) * Math.SQRT2;
      b0 = A * ((A + 1) - (A - 1) * cosw + 2 * sqA * alpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
      b2 = A * ((A + 1) - (A - 1) * cosw - 2 * sqA * alpha);
      a0 = (A + 1) + (A - 1) * cosw + 2 * sqA * alpha;
      a1 = -2 * ((A - 1) + (A + 1) * cosw);
      a2 = (A + 1) + (A - 1) * cosw - 2 * sqA * alpha;
    } else if (type === 'highshelf') {
      const A = Math.pow(10, gainDb / 40);
      const sqA = Math.sqrt(A);
      const alpha = (sinw * 0.5) * Math.SQRT2;
      b0 = A * ((A + 1) + (A - 1) * cosw + 2 * sqA * alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
      b2 = A * ((A + 1) + (A - 1) * cosw - 2 * sqA * alpha);
      a0 = (A + 1) - (A - 1) * cosw + 2 * sqA * alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cosw);
      a2 = (A + 1) - (A - 1) * cosw - 2 * sqA * alpha;
    }
    const invA0 = 1 / a0;
    return [b0 * invA0, b1 * invA0, b2 * invA0, a1 * invA0, a2 * invA0];
  }

  /* Curva de seguridad True-Peak 4× lineal hasta el 92% del techo y límite hiperbólico suave */
  function makeCeilingCurve(ceilDb: number) {
    const n = 16384;
    const c = new Float32Array(n);
    const ceilLin = clamp(dB(ceilDb), 0.25, 0.999);
    const knee = ceilLin * 0.92;
    const span = Math.max(1e-4, ceilLin - knee);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      const ax = Math.abs(x);
      if (ax <= knee) {
        c[i] = x;
      } else {
        const y = knee + span * Math.tanh((ax - knee) / span);
        c[i] = x < 0 ? -y : y;
      }
    }
    return c;
  }

  /* AudioWorklets: Cascada EQ 64-bit Float64 + Limitador Brickwall 2.5 ms + Dithering Analógico TPDF 24-bit Jack */
  async function attachMasteringWorklets(gen: number) {
    if (!ctx || !ctx.audioWorklet || typeof Blob === 'undefined' || typeof URL === 'undefined') return;
    const localCtx = ctx;
    const workletCode = `
      class EstudioEq64Processor extends AudioWorkletProcessor {
        constructor() {
          super();
          const MAX = 80;
          this.z1L = new Float64Array(MAX);
          this.z2L = new Float64Array(MAX);
          this.z1R = new Float64Array(MAX);
          this.z2R = new Float64Array(MAX);
          this.activeMask = new Uint8Array(MAX);
          this.secs = [];
          this.port.onmessage = (e) => {
            const arr = e.data;
            if (!Array.isArray(arr)) return;
            const nextMask = new Uint8Array(MAX);
            for (let i = 0; i < arr.length; i++) {
              const s = arr[i][0] | 0;
              nextMask[s] = 1;
              if (!this.activeMask[s]) {
                this.z1L[s] = 0; this.z2L[s] = 0;
                this.z1R[s] = 0; this.z2R[s] = 0;
              }
            }
            this.activeMask = nextMask;
            this.secs = arr;
          };
        }
        process(inputs, outputs) {
          const inp = inputs[0];
          const out = outputs[0];
          if (!inp || !inp.length || !out || !out.length) return true;
          const inL = inp[0];
          const inR = inp.length > 1 ? inp[1] : inp[0];
          const outL = out[0];
          const outR = out.length > 1 ? out[1] : null;
          const secs = this.secs;
          const nSec = secs.length;
          if (nSec === 0) {
            outL.set(inL);
            if (outR) outR.set(inR);
            return true;
          }
          const z1L = this.z1L, z2L = this.z2L, z1R = this.z1R, z2R = this.z2R;
          const frames = inL.length;
          for (let i = 0; i < frames; i++) {
            let xL = inL[i];
            let xR = inR[i];
            for (let k = 0; k < nSec; k++) {
              const sc = secs[k];
              const s = sc[0];
              const b0 = sc[1], b1 = sc[2], b2 = sc[3], a1 = sc[4], a2 = sc[5];
              const yL = b0 * xL + z1L[s];
              z1L[s] = b1 * xL - a1 * yL + z2L[s];
              z2L[s] = b2 * xL - a2 * yL;
              xL = yL;
              const yR = b0 * xR + z1R[s];
              z1R[s] = b1 * xR - a1 * yR + z2R[s];
              z2R[s] = b2 * xR - a2 * yR;
              xR = yR;
            }
            outL[i] = xL;
            if (outR) outR[i] = xR;
          }
          return true;
        }
      }
      registerProcessor('estudio-eq64', EstudioEq64Processor);

      class EstudioBrickwallProcessor extends AudioWorkletProcessor {
        static get parameterDescriptors() {
          return [{ name: 'ceiling', defaultValue: 0.9885, minValue: 0.25, maxValue: 0.999, automationRate: 'k-rate' }];
        }
        constructor() {
          super();
          this.la = Math.max(32, Math.round(sampleRate * 0.0025));
          this.bufL = new Float32Array(this.la);
          this.bufR = new Float32Array(this.la);
          this.idx = 0;
          this.env = 1.0;
          this.rel = Math.exp(-1 / (sampleRate * 0.065));
          this.attStep = 1 / Math.max(8, this.la * 0.85);
        }
        process(inputs, outputs, parameters) {
          const inp = inputs[0];
          const out = outputs[0];
          if (!inp || !inp.length || !out || !out.length) return true;
          const inL = inp[0];
          const inR = inp.length > 1 ? inp[1] : inp[0];
          const outL = out[0];
          const outR = out.length > 1 ? out[1] : null;
          const ceil = parameters.ceiling[0] || 0.9885;
          const la = this.la;
          const bL = this.bufL;
          const bR = this.bufR;
          let idx = this.idx;
          let env = this.env;
          const rel = this.rel;
          const att = this.attStep;
          for (let i = 0; i < inL.length; i++) {
            const xL = inL[i];
            const xR = inR[i];
            const dL = bL[idx];
            const dR = bR[idx];
            bL[idx] = xL;
            bR[idx] = xR;
            idx++;
            if (idx >= la) idx = 0;
            const pk = Math.max(Math.abs(xL), Math.abs(xR), Math.abs(dL), Math.abs(dR));
            const need = pk > ceil ? ceil / pk : 1.0;
            if (need < env) {
              env = Math.max(need, env - (1.0 - need) * att * 2.2);
              if (Math.max(Math.abs(dL), Math.abs(dR)) * env > ceil) {
                env = ceil / Math.max(Math.abs(dL), Math.abs(dR), 1e-6);
              }
            } else {
              env = rel * env + (1 - rel) * 1.0;
            }
            outL[i] = dL * env;
            if (outR) outR[i] = dR * env;
          }
          this.idx = idx;
          this.env = env;
          return true;
        }
      }
      registerProcessor('estudio-brickwall', EstudioBrickwallProcessor);

      class EstudioTpdf24Processor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.sL = 0x6d2b79f5;
          this.sR = 0x9e3779b9;
        }
        process(inputs, outputs) {
          const inp = inputs[0];
          const out = outputs[0];
          if (!inp || !inp.length || !out || !out.length) return true;
          const inL = inp[0];
          const inR = inp.length > 1 ? inp[1] : inp[0];
          const outL = out[0];
          const outR = out.length > 1 ? out[1] : null;
          const n = inL.length;
          let peak = 0;
          for (let i = 0; i < n; i++) {
            const a = Math.abs(inL[i]);
            const b = Math.abs(inR[i]);
            if (a > peak) peak = a;
            if (b > peak) peak = b;
          }
          if (peak < 1e-9) {
            outL.set(inL);
            if (outR) outR.set(inR);
            return true;
          }
          const lsb = 1.1920928955078125e-7;
          const inv = 2.3283064365386963e-10;
          let sL = this.sL | 0;
          let sR = this.sR | 0;
          for (let i = 0; i < n; i++) {
            sL ^= sL << 13; sL ^= sL >>> 17; sL ^= sL << 5;
            const r1L = (sL >>> 0) * inv;
            sL ^= sL << 13; sL ^= sL >>> 17; sL ^= sL << 5;
            const r2L = (sL >>> 0) * inv;
            let yL = inL[i] + (r1L - r2L) * lsb;
            if (yL > 0.9999998) yL = 0.9999998;
            else if (yL < -0.9999998) yL = -0.9999998;
            outL[i] = yL;
            if (outR) {
              sR ^= sR << 13; sR ^= sR >>> 17; sR ^= sR << 5;
              const r1R = (sR >>> 0) * inv;
              sR ^= sR << 13; sR ^= sR >>> 17; sR ^= sR << 5;
              const r2R = (sR >>> 0) * inv;
              let yR = inR[i] + (r1R - r2R) * lsb;
              if (yR > 0.9999998) yR = 0.9999998;
              else if (yR < -0.9999998) yR = -0.9999998;
              outR[i] = yR;
            }
          }
          this.sL = sL;
          this.sR = sR;
          return true;
        }
      }
      registerProcessor('estudio-tpdf24', EstudioTpdf24Processor);
    `;
    let url = '';
    try {
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      url = URL.createObjectURL(blob);
      await localCtx.audioWorklet.addModule(url);
      if (gen !== engineGen || ctx !== localCtx) return;

      const eq64 = new AudioWorkletNode(localCtx, 'estudio-eq64', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      N.eq64 = eq64;
      safeConn(N.eqTrim, N.dc, false);
      safeConn(N.vRes, N.xIn, false);
      N.eqTrim.connect(eq64);
      eq64.connect(N.xIn);
      eq64Ready = true;
      eq64Sig = '';

      const bw = new AudioWorkletNode(localCtx, 'estudio-brickwall', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const ceilParam = bw.parameters.get('ceiling');
      if (ceilParam) ceilParam.value = clamp(dB(S.master.ceil), 0.25, 0.999);
      N.bw = bw;
      safeConn(N.master, N.lim, false);
      safeConn(N.clipSafe, N.an, false);
      N.master.connect(bw);
      bw.connect(N.an);

      const dither = new AudioWorkletNode(localCtx, 'estudio-tpdf24', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      N.dither = dither;
      ditherReady = true;
      workletReady = true;
      applyAll(true);
      updateEngineSpecUi();
      paintJackStatus();
    } catch (_e) {
      if (gen === engineGen) {
        workletReady = false;
        eq64Ready = false;
        ditherReady = false;
      }
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  function makeDeckEl(): HTMLAudioElement {
    const el = new Audio();
    el.setAttribute('playsinline', '');
    el.preload = 'auto';
    (el as any).preservesPitch = true;
    (el as any).webkitPreservesPitch = true;
    el.volume = 1;
    return el;
  }

  function parseNativeJackJson(raw: unknown): JackHardwareInfo | null {
    try {
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!o || typeof o !== 'object') return null;
      const obj = o as Record<string, any>;
      const rates = Array.isArray(obj.supportedRates)
        ? obj.supportedRates.map((x: any) => +x).filter((x: number) => isFinite(x) && x >= 44100)
        : [48000];
      return {
        jackConnected: !!obj.jackConnected,
        portType: obj.portType || 'speaker',
        deviceName: String(obj.deviceName || (obj.jackConnected ? 'Puerto Jack 3.5 mm' : 'Altavoz del teléfono')),
        nativeRate: +obj.nativeRate || 48000,
        framesPerBuffer: +obj.framesPerBuffer || 256,
        arbitraryRates: !!obj.arbitraryRates,
        maxSampleRate: +obj.maxSampleRate || 48000,
        supportedRates: rates.length ? rates : [48000],
        bitDepth: +obj.bitDepth || 24,
        floatPcm: obj.floatPcm !== false,
      };
    } catch (_e) {
      return null;
    }
  }

  function refreshNativeJackSync() {
    if (!NATIVE || !window.AndroidBridge?.getJackHiResInfo) return;
    try {
      const parsed = parseNativeJackJson(window.AndroidBridge.getJackHiResInfo());
      if (parsed) jackHw = parsed;
    } catch (_e) {}
  }

  function computeDesiredSampleRate(): number {
    if (!S.jack.hiRes) return 0;
    const manual = +S.jack.rate || 0;
    if (manual === 48000 || manual === 96000 || manual === 192000) return manual;
    if (NATIVE) {
      if (!jackHw.jackConnected) return 0;
      if (!jackHw.arbitraryRates && jackHw.maxSampleRate >= 176400) {
        return Math.min(192000, jackHw.maxSampleRate);
      }
      if (jackHw.arbitraryRates || jackHw.maxSampleRate >= 88200) {
        return 96000;
      }
      return jackHw.maxSampleRate || 48000;
    }
    return 96000;
  }

  function createAudioContextAtRate(AC: typeof AudioContext, targetRate: number): AudioContext {
    const candidates: Array<number | undefined> = [];
    if (targetRate > 0) {
      candidates.push(targetRate);
      if (targetRate > 96000) candidates.push(96000);
      if (targetRate > 48000) candidates.push(48000);
    }
    candidates.push(undefined);
    for (const sr of candidates) {
      try {
        return sr ? new AC({ latencyHint: 'playback', sampleRate: sr }) : new AC({ latencyHint: 'playback' });
      } catch (_e) {}
    }
    return new AC();
  }

  function build(targetRate = computeDesiredSampleRate(), attachEvents?: (el: HTMLAudioElement) => void) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const gen = ++engineGen;
    lastTargetRate = targetRate;
    if (NATIVE && window.AndroidBridge?.configureJackHiRes) {
      try {
        const updated = parseNativeJackJson(
          window.AndroidBridge.configureJackHiRes(!!S.jack.hiRes, targetRate || jackHw.nativeRate || 48000)
        );
        if (updated) jackHw = updated;
      } catch (_e) {}
    }
    deckA = makeDeckEl();
    deckB = makeDeckEl();
    audio = deckA;
    standbyAudio = deckB;
    activeDeck = 'A';
    if (attachEvents) {
      attachEvents(deckA);
      attachEvents(deckB);
    }
    if (!AC) {
      toast('Este navegador no admite audio avanzado.');
      return;
    }
    ctx = createAudioContextAtRate(AC, targetRate);
    ctx.addEventListener('statechange', () => {
      if (gen !== engineGen) return;
      if (audio && !audio.paused && ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      updateEngineSpecUi();
      paintJackStatus();
    });
    const srcA = ctx.createMediaElementSource(deckA);
    const srcB = ctx.createMediaElementSource(deckB);
    const g = (v = 1) => {
      const n = ctx!.createGain();
      n.gain.value = v;
      return n;
    };
    const bq = (t: BiquadFilterType, f: number, q = 0.7071, gn = 0) => {
      const n = ctx!.createBiquadFilter();
      n.type = t;
      n.frequency.value = f;
      n.Q.value = q;
      n.gain.value = gn;
      return n;
    };

    /* Mezclador Dual-Deck en 32-bit float para Gapless real y Crossfade igual-potencia */
    N.gA = g(1);
    N.gB = g(0);
    N.deckSum = g(1);
    srcA.connect(N.gA);
    srcB.connect(N.gB);
    N.gA.connect(N.deckSum);
    N.gB.connect(N.deckSum);

    N.pre = g();
    N.pre.channelCount = 2;
    N.pre.channelCountMode = 'explicit';
    N.pre.channelInterpretation = 'speakers';
    N.eqTrim = g(1);

    /* Nodos de referencia espectral y respaldo nativo (reemplazados en vivo por cascada Float64 de carga cero) */
    N.dc = bq('highpass', 12, 0.7071);
    N.hp = bq('highpass', 20, 0.7071);
    N.lp = bq('lowpass', 20000, 0.7071);
    N.eq = BANDS30.map((f) => bq('peaking', f, 4.32));
    N.cl = BANDS16.map((f) => bq('peaking', f, 2.8));
    N.inst = {};
    INST.forEach((gr) => gr.items.forEach(([id, , f, q]) => (N.inst[id] = bq('peaking', f, q))));
    N.bass = bq('lowshelf', 100);
    N.treb = bq('highshelf', 8000);
    N.vSub = bq('peaking', 50, 1.2);
    N.vRes = bq('peaking', 90, 6);

    /* Armónicos de subgraves 4× */
    N.xIn = g();
    N.xLp = bq('lowpass', 120, 0.7071);
    N.xSh = ctx.createWaveShaper();
    N.xSh.oversample = '4x';
    N.xHp = bq('highpass', 32, 0.7071);
    N.xWet = g(0);
    N.xSum = g();

    /* Modulación (LFOs desconectados cuando están apagados = 0% carga en reposo) */
    N.trem = g(1);
    N.tLfo = ctx.createOscillator();
    N.tG = g(0);
    N.vibDry = g(1);
    N.vib = ctx.createDelay(0.05);
    N.vib.delayTime.value = 0.01;
    N.vibWet = g(0);
    N.vLfo = ctx.createOscillator();
    N.vG = g(0);
    N.vOut = g();

    /* Saturación analógica 4× + Excitador de Aire Armónico 4× */
    N.satDry = g();
    N.shaper = ctx.createWaveShaper();
    N.shaper.oversample = '4x';
    N.satDc = bq('highpass', 15, 0.7071);
    N.satWet = g(0);
    N.airHp = bq('highpass', 9500, 0.7071);
    N.airSh = ctx.createWaveShaper();
    N.airSh.oversample = '4x';
    N.airClean = bq('highpass', 5500, 0.7071);
    N.airWet = g(0);
    N.satSum = g();

    /* De-Esser Vocal Dinámico por división de banda transparente */
    N.deDry = g(1);
    N.deLow = bq('lowpass', 6800, 0.7071);
    N.deHigh = bq('highpass', 6800, 0.7071);
    N.deComp = ctx.createDynamicsCompressor();
    N.deComp.knee.value = 4;
    N.deComp.ratio.value = 6;
    N.deComp.attack.value = 0.0008;
    N.deComp.release.value = 0.042;
    N.deWet = g(0);
    N.deOut = g(1);

    /* Compresor Multibanda de 3 bandas (Graves / Medios / Agudos) */
    N.mbDry = g(1);
    N.mbLp1 = bq('lowpass', 160, 0.7071);
    N.mbHp1 = bq('highpass', 160, 0.7071);
    N.mbLp2 = bq('lowpass', 3200, 0.7071);
    N.mbHp2 = bq('highpass', 3200, 0.7071);
    const mkMbComp = () => {
      const c = ctx!.createDynamicsCompressor();
      c.knee.value = 6;
      c.attack.value = 0.008;
      c.release.value = 0.14;
      return c;
    };
    N.mbLowC = mkMbComp();
    N.mbMidC = mkMbComp();
    N.mbHighC = mkMbComp();
    N.mbLowG = g(1);
    N.mbMidG = g(1);
    N.mbHighG = g(1);
    N.mbWet = g(0);
    N.mbOut = g(1);

    /* Compresor Maestro de una banda */
    N.comp = ctx.createDynamicsCompressor();
    N.makeup = g();

    /* Matriz Estéreo Mid/Side */
    N.split = ctx.createChannelSplitter(2);
    N.mid = g(0.5);
    N.sL = g(0.5);
    N.sR = g(-0.5);
    N.sw = g(1);
    N.inv = g(-1);
    N.merge = ctx.createChannelMerger(2);

    /* Centrador Elíptico de Subgraves (Bass Mono Maker sin desfase en medios/agudos) */
    N.bmDry = g(1);
    N.bmSplit = ctx.createChannelSplitter(2);
    N.bmSL = g(0.5);
    N.bmSR = g(-0.5);
    N.bmLp = bq('lowpass', 100, 0.7071);
    N.bmNegL = g(0);
    N.bmPosR = g(0);
    N.bmMerge = ctx.createChannelMerger(2);
    N.bmOut = g(1);

    /* Crossfeed Binaural de Audífonos */
    N.xfDry = g(1);
    N.xfSplit = ctx.createChannelSplitter(2);
    N.xfDL = ctx.createDelay(0.01);
    N.xfDR = ctx.createDelay(0.01);
    N.xfDL.delayTime.value = 0.00028;
    N.xfDR.delayTime.value = 0.00028;
    N.xfLpL = bq('lowpass', 700, 0.7071);
    N.xfLpR = bq('lowpass', 700, 0.7071);
    N.xfGL = g(0);
    N.xfGR = g(0);
    N.xfMerge = ctx.createChannelMerger(2);
    N.xfOut = g(1);

    /* Audio Espacial 3D HRTF */
    N.spDry = g();
    N.pan = ctx.createPanner();
    N.pan.panningModel = 'HRTF';
    N.pan.distanceModel = 'inverse';
    N.pan.refDistance = 1;
    N.spWet = g(0);

    N.bus = g();
    N.busDry = g();
    N.preD = ctx.createDelay(1);
    N.conv = ctx.createConvolver();
    N.revWet = g(0);
    N.dly = ctx.createDelay(2);
    N.fb = g(0);
    N.dTone = bq('lowpass', 8000);
    N.dWet = g(0);
    N.fxSum = g();
    N.wet = g();
    N.direct = g(0);
    N.master = g();

    N.lim = ctx.createDynamicsCompressor();
    N.lim.threshold.value = -1.2;
    N.lim.knee.value = 0;
    N.lim.ratio.value = 20;
    N.lim.attack.value = 0.001;
    N.lim.release.value = 0.065;
    N.clipSafe = ctx.createWaveShaper();
    N.clipSafe.oversample = '4x';
    N.clipSafe.curve = makeCeilingCurve(S.master.ceil);

    N.an = ctx.createAnalyser();
    N.an.fftSize = ctx.sampleRate >= 160000 ? 16384 : ctx.sampleRate >= 88200 ? 8192 : 4096;
    N.an.minDecibels = -92;
    N.an.maxDecibels = -6;
    N.an.smoothingTimeConstant = 0.78;
    N.pvol = g(clamp(S.playerVol, 0, 100) / 100);

    /* Conexión de respaldo inicial (sustituida por estudio-eq64 al cargar worklet) */
    chain(
      N.deckSum,
      N.pre,
      N.eqTrim,
      N.dc,
      N.hp,
      N.lp,
      ...N.eq,
      ...N.cl,
      ...(Object.values(N.inst) as AudioNode[]),
      N.bass,
      N.treb,
      N.vSub,
      N.vRes,
      N.xIn,
      N.xSum
    );
    chain(N.xLp, N.xSh, N.xHp, N.xWet, N.xSum);

    /* Etapa Trémolo + Vibrato con bypass puro cuando están apagados */
    N.xSum.connect(N.trem);
    N.trem.connect(N.vibDry);
    N.vibDry.connect(N.vOut);
    chain(N.vib, N.vibWet, N.vOut);
    N.tLfo.connect(N.tG);
    N.vLfo.connect(N.vG);
    N.tLfo.start();
    N.vLfo.start();

    /* Etapa Saturación 4× + Excitador de Aire 4× */
    N.vOut.connect(N.satDry);
    N.satDry.connect(N.satSum);
    chain(N.shaper, N.satDc, N.satWet, N.satSum);
    chain(N.airHp, N.airSh, N.airClean, N.airWet, N.satSum);

    /* Etapa De-Esser Vocal Dinámico */
    N.satSum.connect(N.deDry);
    N.deDry.connect(N.deOut);
    N.deLow.connect(N.deWet);
    chain(N.deHigh, N.deComp, N.deWet);
    N.deWet.connect(N.deOut);

    /* Etapa Compresor Multibanda (3 bandas) */
    N.deOut.connect(N.mbDry);
    N.mbDry.connect(N.mbOut);
    chain(N.mbLp1, N.mbLowC, N.mbLowG, N.mbWet);
    chain(N.mbHp1, N.mbLp2, N.mbMidC, N.mbMidG, N.mbWet);
    chain(N.mbHp2, N.mbHighC, N.mbHighG, N.mbWet);
    N.mbWet.connect(N.mbOut);

    /* Compresor Maestro -> Matriz M/S */
    chain(N.mbOut, N.comp, N.makeup, N.split);
    N.split.connect(N.mid, 0);
    N.split.connect(N.mid, 1);
    N.split.connect(N.sL, 0);
    N.split.connect(N.sR, 1);
    N.sL.connect(N.sw);
    N.sR.connect(N.sw);
    N.sw.connect(N.inv);
    N.mid.connect(N.merge, 0, 0);
    N.sw.connect(N.merge, 0, 0);
    N.mid.connect(N.merge, 0, 1);
    N.inv.connect(N.merge, 0, 1);

    /* Etapa Centrador de Subgraves (Bass Mono Maker) */
    N.merge.connect(N.bmDry);
    N.bmDry.connect(N.bmOut);
    N.bmSplit.connect(N.bmSL, 0);
    N.bmSplit.connect(N.bmSR, 1);
    N.bmSL.connect(N.bmLp);
    N.bmSR.connect(N.bmLp);
    N.bmLp.connect(N.bmNegL);
    N.bmLp.connect(N.bmPosR);
    N.bmNegL.connect(N.bmMerge, 0, 0);
    N.bmPosR.connect(N.bmMerge, 0, 1);
    N.bmMerge.connect(N.bmOut);

    /* Conexión Crossfeed Binaural */
    N.bmOut.connect(N.xfDry);
    N.xfDry.connect(N.xfOut);
    N.xfSplit.connect(N.xfDL, 0);
    N.xfDL.connect(N.xfLpL);
    N.xfLpL.connect(N.xfGL);
    N.xfGL.connect(N.xfMerge, 0, 1);
    N.xfSplit.connect(N.xfDR, 1);
    N.xfDR.connect(N.xfLpR);
    N.xfLpR.connect(N.xfGR);
    N.xfGR.connect(N.xfMerge, 0, 0);
    N.xfMerge.connect(N.xfOut);

    N.xfOut.connect(N.spDry);
    N.spDry.connect(N.bus);
    chain(N.pan, N.spWet, N.bus);
    N.bus.connect(N.busDry);
    N.busDry.connect(N.fxSum);
    chain(N.preD, N.conv, N.revWet, N.fxSum);
    chain(N.dly, N.dTone, N.dWet, N.fxSum);
    N.dTone.connect(N.fb);
    N.fb.connect(N.dly);
    chain(N.fxSum, N.wet, N.master);
    N.deckSum.connect(N.direct);
    N.direct.connect(N.master);
    chain(N.master, N.lim, N.clipSafe, N.an, N.pvol, ctx.destination);

    attachMasteringWorklets(gen);
  }

  function TP(key: string, p: AudioParam, v: number) {
    const prev = P_CACHE[key];
    if (prev !== undefined && Math.abs(prev - v) < 1e-5) return;
    P_CACHE[key] = v;
    const now = ctx!.currentTime;
    try {
      p.cancelScheduledValues(now);
    } catch (_e) {}
    if (ctx!.state !== 'running') {
      try {
        p.value = v;
      } catch (_e) {}
    }
    p.setTargetAtTime(v, now, 0.018);
  }

  /* Curvas analógicas de 32,768 muestras Float32 (0 = Cinta cálida, 1 = Válvula Triodo, 2 = Consola Punch) */
  function curve(d: number, mode = 0) {
    const n = 32768;
    const c = new Float32Array(n);
    const k = 1 + d * 0.25;
    if (mode === 1) {
      /* Válvula Triodo: asimetría armónica par cálida y musical */
      const asym = 0.16 * Math.min(1, d / 40);
      const posRef = Math.tanh(k * (1 + asym));
      const negRef = Math.tanh(k * (-1 + asym));
      const norm = Math.max(Math.abs(posRef), Math.abs(negRef)) || 1;
      const dcOff = Math.tanh(k * asym);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / (n - 1) - 1;
        c[i] = clamp((Math.tanh(k * (x + asym)) - dcOff) / norm, -1, 1);
      }
      return c;
    }
    if (mode === 2) {
      /* Consola Británica Soft-Clip: preserva ataque percusivo con densidad media */
      const p = 2.35;
      const nr = 1 / Math.pow(1 + Math.pow(k, p), 1 / p);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / (n - 1) - 1;
        const y = (k * x) / Math.pow(1 + Math.pow(Math.abs(k * x), p), 1 / p);
        c[i] = clamp(y / (k * nr || 1), -1, 1);
      }
      return c;
    }
    /* Cinta Analógica simétrica de referencia */
    const nr = Math.tanh(k) || 1;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      c[i] = Math.tanh(k * x) / nr;
    }
    return c;
  }

  /* Convolución Acústica HD: Reflexiones Tempranas estéreo + Difusión decorrelacionada + Absorción de aire */
  function makeIR(dec: number, damp: number, size: number) {
    const sr = ctx!.sampleRate;
    const safeDec = sr > 96000 ? Math.min(3.2, Math.max(0.1, dec)) : Math.max(0.1, dec);
    const len = Math.max(128, Math.floor(sr * safeDec));
    const b = ctx!.createBuffer(2, len, sr);
    const sz = clamp(size, 0, 100) / 100;
    const dm = clamp(damp, 0, 100) / 100;
    const baseA = 1 - dm * 0.88;
    const ex = 3.1 - sz * 1.75;
    const att = Math.floor(sr * (0.003 + sz * 0.008));
    const earlyTaps = [
      [0.007, 0.011, 0.52],
      [0.014, 0.017, -0.41],
      [0.021, 0.019, 0.35],
      [0.028, 0.031, -0.29],
      [0.036, 0.041, 0.24],
      [0.047, 0.052, -0.19],
    ];
    const hpCoef = Math.exp((-2 * Math.PI * 65) / sr);

    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp1 = 0;
      let lp2 = 0;
      let hpPrevX = 0;
      let hpPrevY = 0;
      let seed = c === 0 ? 0x13579bdf : 0x2468ace1;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const wn = (seed / 2147483648) - 1;
        const prog = i / len;
        const airA = clamp(baseA * (1 - prog * dm * 0.55), 0.03, 0.99);
        lp1 += airA * (wn - lp1);
        lp2 += clamp(airA * 1.15, 0.05, 1) * (lp1 - lp2);
        const env = Math.pow(1 - prog, ex) * (i < att ? 0.22 + (0.78 * i) / Math.max(1, att) : 1);
        const x = lp2 * env;
        const y = hpCoef * (hpPrevY + x - hpPrevX);
        hpPrevX = x;
        hpPrevY = y;
        d[i] = y;
      }
      const roomScale = 0.55 + sz * 0.95;
      for (const [tL, tR, amp] of earlyTaps) {
        const idx = Math.floor((c === 0 ? tL : tR) * roomScale * sr);
        if (idx > 0 && idx < len) d[idx] += amp * (1 - dm * 0.35);
      }
      let e = 0;
      for (let i = 0; i < len; i++) e += d[i] * d[i];
      const sc = 1 / Math.sqrt(e || 1);
      for (let i = 0; i < len; i++) d[i] *= sc;
    }
    return b;
  }

  function calcEffectiveQ(baseQ: number, gainDb: number, prop: boolean) {
    if (!prop) return baseQ;
    const gAbs = Math.abs(gainDb);
    if (gAbs < 0.05) return baseQ;
    return clamp(baseQ * (0.68 + 0.52 * Math.min(1, gAbs / 12)), 0.3, 24);
  }

  let applyRaf = 0;
  function applyAllNow() {
    applyRaf = 0;
    if (!ctx) return;
    TP('pre', N.pre.gain, dB(S.master.pre));
    TP('mvol', N.master.gain, dB(S.master.vol));
    TP('pvol', N.pvol.gain, clamp(S.playerVol, 0, 100) / 100);
    TP('wet', N.wet.gain, S.bypass ? 0 : 1);
    TP('dir', N.direct.gain, S.bypass ? 1 : 0);

    /* Velocidad / Tono / Modo 432 Hz (por defecto 1.0× bit-perfect) */
    const baseRate = clamp(isFinite(+S.play.rate) ? +S.play.rate : 1, 0.5, 1.5);
    const effRate = S.play.hz432 ? baseRate * (432 / 440) : baseRate;
    const keepP = S.play.hz432 ? false : !!S.play.keepPitch;
    [deckA, deckB].forEach((el) => {
      if (!el) return;
      if ((el as any).preservesPitch !== keepP) {
        (el as any).preservesPitch = keepP;
        (el as any).webkitPreservesPitch = keepP;
      }
      if (Math.abs(el.playbackRate - effRate) > 1e-4) {
        el.playbackRate = effRate;
      }
    });

    /* Techo Brickwall True-Peak */
    const ceilDb = clamp(isFinite(+S.master.ceil) ? +S.master.ceil : -0.1, -6, -0.1);
    if (N.bw) {
      const cp = N.bw.parameters.get('ceiling');
      if (cp) TP('bwceil', cp, clamp(dB(ceilDb), 0.25, 0.999));
    } else if (Math.abs(ceilDb - ceilSig) > 0.02) {
      ceilSig = ceilDb;
      N.lim.threshold.value = Math.min(-0.8, ceilDb - 0.8);
      N.clipSafe.curve = makeCeilingCurve(ceilDb);
    }

    /* Etapa Dithering Analógico TPDF 24-bit para puerto Jack 3.5 mm (0% carga cuando está en bypass) */
    const wantDither = !!(
      ditherReady &&
      N.dither &&
      S.jack.hiRes &&
      S.jack.dither24 &&
      (!NATIVE || jackHw.jackConnected || S.jack.rate > 0)
    );
    if (wantDither !== FX_CONN.dither) {
      FX_CONN.dither = wantDither;
      if (wantDither) {
        safeConn(N.pvol, ctx.destination, false);
        safeConn(N.pvol, N.dither, true);
        safeConn(N.dither, ctx.destination, true);
      } else {
        safeConn(N.pvol, N.dither, false);
        safeConn(N.dither, ctx.destination, false);
        safeConn(N.pvol, ctx.destination, true);
      }
      updateEngineSpecUi();
      paintJackStatus();
    }

    const t = S.fx.tone;
    TP('lc', N.hp.frequency, t.lc);
    TP('hc', N.lp.frequency, t.hc);
    TP('bg', N.bass.gain, t.bass);
    TP('bf', N.bass.frequency, t.bassF);
    TP('tg', N.treb.gain, t.treb);
    TP('tf', N.treb.frequency, t.trebF);

    let maxBoost = Math.max(0, t.bass, t.treb, S.fx.sub.on ? S.fx.sub.g : 0);
    for (let i = 0; i < 30; i++) {
      const gv = S.eq[i];
      if (gv > maxBoost) maxBoost = gv;
      TP('eqg' + i, N.eq[i].gain, gv);
      TP('eqq' + i, N.eq[i].Q, calcEffectiveQ(S.q30, gv, !!S.propQ30));
    }
    for (let i = 0; i < 16; i++) {
      const gv = S.cl[i];
      if (gv > maxBoost) maxBoost = gv;
      TP('clg' + i, N.cl[i].gain, gv);
      TP('clq' + i, N.cl[i].Q, calcEffectiveQ(S.q16, gv, !!S.propQ16));
    }
    let instIdx = 0;
    for (const id in N.inst) {
      const p = S.inst[id];
      const n = N.inst[id];
      if (p.g > maxBoost) maxBoost = p.g;
      TP('ig_' + id, n.gain, p.g);
      TP('if_' + id, n.frequency, p.f);
      TP('iq_' + id, n.Q, p.q);
      instIdx++;
    }
    void instIdx;

    const sb = S.fx.sub;
    TP('sbg', N.vSub.gain, sb.on ? sb.g : 0);
    TP('sbf', N.vSub.frequency, sb.freq);
    TP('sbq', N.vSub.Q, sb.q);
    const gl = S.fx.glass;
    TP('glg', N.vRes.gain, gl.on ? gl.g : 0);
    TP('glf', N.vRes.frequency, gl.freq);
    TP('glq', N.vRes.Q, gl.q);

    /* Cascada EQ 64-bit Float64 con Bypass de Carga Cero (omite bandas en 0 dB) */
    if (eq64Ready && N.eq64) {
      const fs = ctx.sampleRate || 48000;
      const sigParts: string[] = [
        String(fs),
        t.lc.toFixed(1),
        t.hc.toFixed(1),
        t.bass.toFixed(2),
        t.bassF.toFixed(1),
        t.treb.toFixed(2),
        t.trebF.toFixed(1),
        S.q30.toFixed(2),
        String(+!!S.propQ30),
        S.eq.join(','),
        S.q16.toFixed(2),
        String(+!!S.propQ16),
        S.cl.join(','),
        sb.on ? `${sb.g},${sb.freq},${sb.q}` : '0',
        gl.on ? `${gl.g},${gl.freq},${gl.q}` : '0',
      ];
      for (const id in S.inst) {
        const p = S.inst[id];
        sigParts.push(Math.abs(p.g) >= 0.005 ? `${id}:${p.g},${p.f},${p.q}` : '');
      }
      const nextEqSig = sigParts.join('|');
      if (nextEqSig !== eq64Sig) {
        eq64Sig = nextEqSig;
        const secs: number[][] = [];
        if (t.lc > 20.2) secs.push([1, ...biquadCoeffs64('highpass', t.lc, 0.7071, 0, fs)]);
        if (t.hc < 19980) secs.push([2, ...biquadCoeffs64('lowpass', t.hc, 0.7071, 0, fs)]);
        for (let i = 0; i < 30; i++) {
          const gv = S.eq[i];
          if (Math.abs(gv) >= 0.005) {
            secs.push([3 + i, ...biquadCoeffs64('peaking', BANDS30[i], calcEffectiveQ(S.q30, gv, !!S.propQ30), gv, fs)]);
          }
        }
        for (let i = 0; i < 16; i++) {
          const gv = S.cl[i];
          if (Math.abs(gv) >= 0.005) {
            secs.push([33 + i, ...biquadCoeffs64('peaking', BANDS16[i], calcEffectiveQ(S.q16, gv, !!S.propQ16), gv, fs)]);
          }
        }
        let slot = 49;
        for (const id in S.inst) {
          const p = S.inst[id];
          if (Math.abs(p.g) >= 0.005) {
            secs.push([slot, ...biquadCoeffs64('peaking', p.f, p.q, p.g, fs)]);
          }
          slot++;
        }
        if (Math.abs(t.bass) >= 0.005) secs.push([70, ...biquadCoeffs64('lowshelf', t.bassF, 0.7071, t.bass, fs)]);
        if (Math.abs(t.treb) >= 0.005) secs.push([71, ...biquadCoeffs64('highshelf', t.trebF, 0.7071, t.treb, fs)]);
        if (sb.on && Math.abs(sb.g) >= 0.005) secs.push([72, ...biquadCoeffs64('peaking', sb.freq, sb.q, sb.g, fs)]);
        if (gl.on && Math.abs(gl.g) >= 0.005) secs.push([73, ...biquadCoeffs64('peaking', gl.freq, gl.q, gl.g, fs)]);
        if (secs.length > 0) {
          secs.unshift([0, ...biquadCoeffs64('highpass', 12, 0.7071, 0, fs)]);
        }
        N.eq64.port.postMessage(secs);
      }
    }

    /* Auto-Headroom inteligente opcional para evitar sobrecarga al subir múltiples bandas */
    const trimDb = S.master.autoHead && maxBoost > 1.5 ? -Math.min(12, (maxBoost - 1.5) * 0.55) : 0;
    TP('eqtrim', N.eqTrim.gain, dB(trimDb));

    /* Compresor Maestro */
    const c = S.fx.comp;
    if (c.on) {
      TP('cth', N.comp.threshold, c.th);
      TP('ckn', N.comp.knee, c.knee);
      TP('cra', N.comp.ratio, c.ratio);
      TP('cat', N.comp.attack, c.attack / 1000);
      TP('cre', N.comp.release, c.release / 1000);
      TP('cmk', N.makeup.gain, dB(c.makeup));
    } else {
      TP('cth', N.comp.threshold, 0);
      TP('ckn', N.comp.knee, 0);
      TP('cra', N.comp.ratio, 1);
      TP('cmk', N.makeup.gain, 1);
    }

    /* Compresor Multibanda (Graves / Medios / Agudos) con bypass bit-perfect */
    const mb = S.fx.mbcomp;
    const mbActive = !!mb.on;
    if (mbActive !== FX_CONN.mbcomp) {
      FX_CONN.mbcomp = mbActive;
      safeConn(N.deOut, N.mbLp1, mbActive);
      safeConn(N.deOut, N.mbHp1, mbActive);
      safeConn(N.deOut, N.mbHp2, mbActive);
    }
    TP('mbdry', N.mbDry.gain, mbActive ? 0 : 1);
    TP('mbwet', N.mbWet.gain, mbActive ? 1 : 0);
    if (mbActive) {
      const lx = clamp(mb.lowX, 50, 500);
      const hx = clamp(mb.highX, 1200, 10000);
      TP('mblp1', N.mbLp1.frequency, lx);
      TP('mbhp1', N.mbHp1.frequency, lx);
      TP('mblp2', N.mbLp2.frequency, hx);
      TP('mbhp2', N.mbHp2.frequency, hx);
      TP('mblth', N.mbLowC.threshold, mb.lowTh);
      TP('mbmth', N.mbMidC.threshold, mb.midTh);
      TP('mbhth', N.mbHighC.threshold, mb.highTh);
      TP('mblra', N.mbLowC.ratio, mb.ratio);
      TP('mbmra', N.mbMidC.ratio, mb.ratio);
      TP('mbhra', N.mbHighC.ratio, mb.ratio);
      TP('mblg', N.mbLowG.gain, dB(mb.lowG));
      TP('mbmg', N.mbMidG.gain, dB(mb.midG));
      TP('mbhg', N.mbHighG.gain, dB(mb.highG));
    }

    /* De-Esser Vocal Dinámico */
    const de = S.fx.deess;
    const deActive = !!(de.on && de.amt > 0);
    if (deActive !== FX_CONN.deess) {
      FX_CONN.deess = deActive;
      safeConn(N.satSum, N.deLow, deActive);
      safeConn(N.satSum, N.deHigh, deActive);
    }
    TP('dedry', N.deDry.gain, deActive ? 0 : 1);
    TP('dewet', N.deWet.gain, deActive ? 1 : 0);
    if (deActive) {
      const df = clamp(de.freq, 3500, 12000);
      TP('delow', N.deLow.frequency, df);
      TP('dehigh', N.deHigh.frequency, df);
      TP('deth', N.deComp.threshold, de.th);
      TP('dera', N.deComp.ratio, clamp(1 + de.amt * 1.4, 1.5, 20));
    }

    /* Saturación analógica 4× */
    const s = S.fx.sat;
    const satActive = !!(s.on && s.mix > 0);
    if (satActive !== FX_CONN.sat) {
      FX_CONN.sat = satActive;
      safeConn(N.vOut, N.shaper, satActive);
    }
    const nextSatSig = s.drive + '|' + (s.mode | 0);
    if (satActive && nextSatSig !== satSig) {
      satSig = nextSatSig;
      N.shaper.curve = curve(s.drive, s.mode | 0);
    }
    const sm = satActive ? s.mix / 100 : 0;
    TP('swet', N.satWet.gain, sm);
    TP('sdry', N.satDry.gain, 1 - sm);

    /* Excitador de Aire Armónico 4× (10–20 kHz) */
    const ax = S.fx.airexc;
    const airActive = !!(ax.on && ax.mix > 0);
    if (airActive !== FX_CONN.airexc) {
      FX_CONN.airexc = airActive;
      safeConn(N.vOut, N.airHp, airActive);
    }
    if (airActive && ax.drive !== airDriveSig) {
      airDriveSig = ax.drive;
      N.airSh.curve = curve(ax.drive * 0.75, 1);
    }
    TP('airhp', N.airHp.frequency, clamp(ax.freq, 5000, 15000));
    TP('aircl', N.airClean.frequency, clamp(ax.freq * 0.65, 3500, 11000));
    TP('airw', N.airWet.gain, airActive ? (ax.mix / 100) * 0.65 : 0);

    /* Armónicos de subgraves 4× */
    const hm = S.fx.harm;
    const harmActive = !!(hm.on && hm.mix > 0);
    if (harmActive !== FX_CONN.harm) {
      FX_CONN.harm = harmActive;
      safeConn(N.xIn, N.xLp, harmActive);
    }
    if (harmActive && hm.drive !== harmDrive) {
      harmDrive = hm.drive;
      N.xSh.curve = curve(hm.drive * 0.65, 1);
    }
    TP('xlp', N.xLp.frequency, hm.freq);
    TP('xwet', N.xWet.gain, harmActive ? hm.mix / 100 : 0);

    /* Trémolo y Vibrato con desconexión de LFOs en reposo */
    const tr = S.fx.trem;
    const trActive = !!(tr.on && tr.depth > 0);
    if (trActive !== FX_CONN.trem) {
      FX_CONN.trem = trActive;
      safeConn(N.tG, N.trem.gain, trActive);
    }
    if (trActive) {
      const tShape = (['sine', 'triangle', 'square'][tr.shape] || 'sine') as OscillatorType;
      if (N.tLfo.type !== tShape) N.tLfo.type = tShape;
      TP('trf', N.tLfo.frequency, tr.rate);
    }
    const td = trActive ? tr.depth / 100 : 0;
    TP('trg', N.trem.gain, 1 - td / 2);
    TP('trd', N.tG.gain, td / 2);

    const vb = S.fx.vibr;
    const vbActive = !!(vb.on && vb.depth > 0);
    if (vbActive !== FX_CONN.vibr) {
      FX_CONN.vibr = vbActive;
      safeConn(N.trem, N.vib, vbActive);
      safeConn(N.vG, N.vib.delayTime, vbActive);
    }
    TP('vibdry', N.vibDry.gain, vbActive ? 0 : 1);
    TP('vibwet', N.vibWet.gain, vbActive ? 1 : 0);
    if (vbActive) {
      TP('vbf', N.vLfo.frequency, vb.rate);
      TP('vbg', N.vG.gain, vb.depth / 1000);
    } else {
      TP('vbg', N.vG.gain, 0);
    }

    const w = S.fx.wid;
    TP('wid', N.sw.gain, w.on ? clamp(1 + w.w / 100, 0, 3) : 1);

    /* Centrador Elíptico de Subgraves (Bass Mono Maker) */
    const bm = S.fx.bmono;
    const bmActive = !!(bm.on && bm.mono > 0);
    if (bmActive !== FX_CONN.bmono) {
      FX_CONN.bmono = bmActive;
      safeConn(N.merge, N.bmSplit, bmActive);
    }
    const bmK = bmActive ? clamp(bm.mono, 0, 100) / 100 : 0;
    TP('bmlp', N.bmLp.frequency, clamp(bm.freq, 35, 220));
    TP('bmnegl', N.bmNegL.gain, -bmK);
    TP('bmposr', N.bmPosR.gain, bmK);

    /* Crossfeed Binaural de Audífonos */
    const xf = S.fx.xfeed;
    const xfActive = !!(xf.on && xf.mix > 0);
    if (xfActive !== FX_CONN.xfeed) {
      FX_CONN.xfeed = xfActive;
      safeConn(N.bmOut, N.xfSplit, xfActive);
    }
    const xfAmt = xfActive ? (xf.mix / 100) * 0.42 : 0;
    TP('xfdry', N.xfDry.gain, xfActive ? 1 - xfAmt * 0.42 : 1);
    TP('xfgl', N.xfGL.gain, xfAmt);
    TP('xfgr', N.xfGR.gain, xfAmt);
    TP('xflpl', N.xfLpL.frequency, xf.fc);
    TP('xflpr', N.xfLpR.frequency, xf.fc);

    const sp = S.fx.sp;
    const spActive = !!(sp.on && sp.mix > 0);
    if (spActive !== FX_CONN.sp) {
      FX_CONN.sp = spActive;
      safeConn(N.xfOut, N.pan, spActive);
    }
    const spm = spActive ? sp.mix / 100 : 0;
    TP('spw', N.spWet.gain, spm);
    TP('spd', N.spDry.gain, 1 - spm);

    const r = S.fx.rev;
    const revActive = !!(r.on && r.mix > 0);
    if (revActive !== FX_CONN.rev) {
      FX_CONN.rev = revActive;
      safeConn(N.bus, N.preD, revActive);
    }
    TP('rvw', N.revWet.gain, revActive ? (r.mix / 100) * 1.5 : 0);
    TP('rvp', N.preD.delayTime, r.pre / 1000);
    if (revActive) {
      const key = r.decay + '|' + r.damp + '|' + r.size;
      if (key !== irKey) {
        const first = !irKey;
        irKey = key;
        clearTimeout(irT);
        irT = setTimeout(() => {
          const q = S.fx.rev;
          if (ctx) N.conv.buffer = makeIR(q.decay, q.damp, q.size);
        }, first ? 0 : 180);
      }
    }

    const d = S.fx.dly;
    const dlyActive = !!(d.on && d.mix > 0);
    if (dlyActive !== FX_CONN.dly) {
      FX_CONN.dly = dlyActive;
      safeConn(N.bus, N.dly, dlyActive);
    }
    TP('dlt', N.dly.delayTime, d.time / 1000);
    TP('dlfb', N.fb.gain, dlyActive ? d.fb / 100 : 0);
    TP('dlw', N.dWet.gain, dlyActive ? d.mix / 100 : 0);
    TP('dltn', N.dTone.frequency, d.tone);
  }

  function applyAll(immediate = false) {
    if (!ctx) return;
    if (immediate) {
      if (applyRaf) {
        cancelAnimationFrame(applyRaf);
        applyRaf = 0;
      }
      applyAllNow();
      return;
    }
    if (!applyRaf) applyRaf = requestAnimationFrame(applyAllNow);
  }

  let spAz = 0;
  let lastPanX = NaN;
  let lastPanY = NaN;
  let lastPanZ = NaN;
  function placePan(dt: number) {
    if (!ctx || !FX_CONN.sp) return;
    const sp = S.fx.sp;
    if (sp.on && sp.rot) spAz = (spAz + sp.rot * 6 * dt + 360) % 360;
    else spAz = sp.az;
    const a = (spAz * Math.PI) / 180;
    const e = (sp.el * Math.PI) / 180;
    const d = Math.max(0.1, sp.dist);
    const x = Math.sin(a) * Math.cos(e) * d;
    const y = Math.sin(e) * d;
    const z = -Math.cos(a) * Math.cos(e) * d;
    if (Math.abs(x - lastPanX) < 1e-4 && Math.abs(y - lastPanY) < 1e-4 && Math.abs(z - lastPanZ) < 1e-4) return;
    lastPanX = x;
    lastPanY = y;
    lastPanZ = z;
    const p = N.pan;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
  }

  /* ---------- estado → interfaz ---------- */
  const syncers: Array<() => void> = [];
  function syncAll() {
    syncers.forEach((f) => f());
    paintBypass();
    vizDirty = true;
  }
  function commit() {
    applyAll(false);
    vizDirty = true;
    saveSoon();
  }
  const getP = (p: string) => p.split('.').reduce((o, k) => o[k], S);
  const getD = (p: string) => p.split('.').reduce((o, k) => o[k], D);
  function setP(p: string, v: any) {
    const ks = p.split('.');
    const l = ks.pop()!;
    ks.reduce((o, k) => o[k], S)[l] = v;
  }
  const decs = (st: number) => {
    const s = String(st);
    return s.includes('.') ? s.split('.')[1].length : 0;
  };
  function holdBtn(btn: HTMLElement, fn: () => void) {
    let t: any;
    let iv: any;
    const stop = () => {
      clearTimeout(t);
      clearInterval(iv);
      persistNow();
    };
    btn.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button > 0) return;
      e.preventDefault();
      fn();
      t = setTimeout(() => {
        iv = setInterval(fn, 70);
      }, 420);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('click', (e: MouseEvent) => {
      if (e.detail === 0) {
        fn();
        persistNow();
      }
    });
  }
  function row(path: string, label: string, o: any) {
    const dec = decs(o.step);
    const fine = o.fine || o.step;
    const num = h('input', {
      type: 'number',
      class: 'num in',
      id: 'n_' + path,
      step: o.step,
      min: o.min,
      max: o.max,
      inputmode: 'decimal',
      'aria-label': label,
    }) as HTMLInputElement;
    const rng = h('input', {
      type: 'range',
      id: 'r_' + path,
      'aria-label': label + ' (deslizador)',
      min: o.log ? 0 : o.min,
      max: o.log ? 1000 : o.max,
      step: o.log ? 1 : o.step,
    }) as HTMLInputElement;
    const toS = (v: number) => (o.log ? Math.round((1000 * Math.log(v / o.min)) / Math.log(o.max / o.min)) : v);
    const fromS = (s: string | number) => {
      if (!o.log) return +s;
      const v = o.min * Math.pow(o.max / o.min, +s / 1000);
      return o.step >= 1 ? Math.round(v) : +v.toFixed(dec);
    };
    const updPct = (el: HTMLInputElement) => {
      const mn = +el.min || 0;
      const mx = +el.max || 1;
      const pct = clamp(((+el.value - mn) / (mx - mn || 1)) * 100, 0, 100);
      el.style.setProperty('--p', pct.toFixed(1) + '%');
    };
    const show = () => {
      const v = getP(path);
      num.value = v.toFixed(dec);
      rng.value = String(toS(v));
      updPct(rng);
    };
    const set = (raw: string | number, flush: boolean) => {
      let v = clamp(+raw, o.min, o.max);
      if (!isFinite(v)) return show();
      v = +(Math.round(v / o.step) * o.step).toFixed(dec);
      if (getP(path) === v) {
        if (flush) persistNow();
        return;
      }
      setP(path, v);
      show();
      commit();
      if (flush) persistNow();
    };
    num.addEventListener('change', () => set(num.value, true));
    rng.addEventListener('input', () => set(fromS(rng.value), false));
    rng.addEventListener('change', () => persistNow());
    const minus = h('button', { class: 'step', 'aria-label': 'Restar ' + label, type: 'button', text: '−' });
    const plus = h('button', { class: 'step', 'aria-label': 'Sumar ' + label, type: 'button', text: '+' });
    holdBtn(minus, () => set(getP(path) - fine, false));
    holdBtn(plus, () => set(getP(path) + fine, false));
    const rst = h('button', {
      class: 'rst',
      'aria-label': 'Volver ' + label + ' a su valor inicial',
      type: 'button',
      text: '↺',
      onclick: () => set(getD(path), true),
    });
    syncers.push(show);
    show();
    return h(
      'div',
      { class: 'prow' },
      h(
        'div',
        { class: 'ptop' },
        h('label', { class: 'pl', for: 'n_' + path, text: label }),
        h('span', { class: 'pv' }, num, h('span', { class: 'u', text: o.unit || '' }))
      ),
      h('div', { class: 'pctl' }, minus, rng, plus, rst)
    );
  }

  const ICON_LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';
  const ICON_OPEN = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/></svg>';

  function card(key: string, title: string, opt: { on?: boolean } = {}) {
    const c = h('div', { class: 'card' });
    const body = h('div', { class: 'cbody' }) as HTMLElement & { inert?: boolean };
    const head = h('div', { class: 'chead' }, h('h2', { text: title }));
    let sw: HTMLElement | null = null;
    if (opt.on) {
      sw = h(
        'button',
        {
          class: 'sw',
          role: 'switch',
          type: 'button',
          'aria-label': 'Activar ' + title,
          onclick: () => {
            S.fx[key].on = !S.fx[key].on;
            syncAll();
            commit();
            persistNow();
          },
        },
        h('i')
      );
      head.append(sw);
    }
    const lock = h('button', {
      class: 'ib',
      type: 'button',
      onclick: () => {
        S.locks[key] = !S.locks[key];
        if (!S.locks[key]) delete S.locks[key];
        syncAll();
        persistNow();
        toast(S.locks[key] ? title + ' bloqueado' : title + ' desbloqueado');
      },
    });
    const save = h('button', {
      class: 'ib',
      type: 'button',
      'aria-label': 'Guardar ajuste de ' + title,
      text: 'Guardar',
      onclick: () => saveSection(key),
    });
    const rs = h('button', {
      class: 'ib',
      type: 'button',
      'aria-label': 'Poner ' + title + ' en cero',
      text: 'Cero',
      onclick: () => {
        resetSec(key);
        syncAll();
        commit();
        persistNow();
        toast(title + ' en cero');
      },
    });
    head.append(h('div', { class: 'cacts' }, lock, save, rs));
    c.append(head, body);
    syncers.push(() => {
      const l = !!S.locks[key];
      c.classList.toggle('locked', l);
      body.inert = l;
      lock.setAttribute('aria-pressed', String(l));
      lock.setAttribute('aria-label', (l ? 'Desbloquear ' : 'Bloquear ') + title);
      lock.innerHTML = (l ? ICON_LOCK : ICON_OPEN) + '<span>' + (l ? 'Bloqueado' : 'Libre') + '</span>';
      if (sw) sw.setAttribute('aria-checked', String(!!S.fx[key].on));
    });
    return { c, body, head };
  }

  /* ---------- analizador espectral HD 4096 ---------- */
  const cv = $<HTMLCanvasElement>('#viz')!;
  const c2 = cv.getContext('2d')!;
  const VIZ_N = 180;
  const FF = Float32Array.from({ length: VIZ_N }, (_, i) => 20 * Math.pow(1000, i / (VIZ_N - 1)));
  const respMag = new Float32Array(VIZ_N);
  const respTmp = new Float32Array(VIZ_N);
  const respPh = new Float32Array(VIZ_N);
  let resp: Float32Array | null = null;
  let accC = '#22F3FF';
  let fgC = '#EDEBF5';
  let numFont = 'ui-monospace,monospace';
  let freqData: Uint8Array<ArrayBuffer> | null = null;
  let vizW = 0;
  let vizH = 0;
  let lastVizDraw = 0;
  let lastRespCalc = 0;

  function syncVizSize() {
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    vizW = Math.round(r.width * dpr);
    vizH = Math.round(r.height * dpr);
    if (vizW > 0 && vizH > 0 && (cv.width !== vizW || cv.height !== vizH)) {
      cv.width = vizW;
      cv.height = vizH;
      vizDirty = true;
    }
  }
  if (typeof ResizeObserver !== 'undefined' && cv) {
    new ResizeObserver(() => syncVizSize()).observe(cv);
  }
  window.addEventListener('resize', syncVizSize, { passive: true });

  function calcResp() {
    if (!ctx) return;
    respMag.fill(1);
    if (S.fx.tone.lc > 20.5) {
      N.hp.getFrequencyResponse(FF, respTmp, respPh);
      for (let i = 0; i < VIZ_N; i++) respMag[i] *= respTmp[i];
    }
    if (S.fx.tone.hc < 19950) {
      N.lp.getFrequencyResponse(FF, respTmp, respPh);
      for (let i = 0; i < VIZ_N; i++) respMag[i] *= respTmp[i];
    }
    for (let k = 0; k < 30; k++) {
      if (Math.abs(S.eq[k]) > 0.01) {
        N.eq[k].getFrequencyResponse(FF, respTmp, respPh);
        for (let i = 0; i < VIZ_N; i++) respMag[i] *= respTmp[i];
      }
    }
    for (let k = 0; k < 16; k++) {
      if (Math.abs(S.cl[k]) > 0.01) {
        N.cl[k].getFrequencyResponse(FF, respTmp, respPh);
        for (let i = 0; i < VIZ_N; i++) respMag[i] *= respTmp[i];
      }
    }
    for (const id in N.inst) {
      if (Math.abs(S.inst[id].g) > 0.01) {
        N.inst[id].getFrequencyResponse(FF, respTmp, respPh);
        for (let i = 0; i < VIZ_N; i++) respMag[i] *= respTmp[i];
      }
    }
    if (Math.abs(S.fx.tone.bass) > 0.01) {
      N.bass.getFrequencyResponse(FF, respTmp, respPh);
      for (let i = 0; i < VIZ_N; i++) respMag[i] *= respTmp[i];
    }
    if (Math.abs(S.fx.tone.treb) > 0.01) {
      N.treb.getFrequencyResponse(FF, respTmp, respPh);
      for (let i = 0; i < VIZ_N; i++) respMag[i] *= respTmp[i];
    }
    if (S.fx.sub.on && Math.abs(S.fx.sub.g) > 0.01) {
      N.vSub.getFrequencyResponse(FF, respTmp, respPh);
      for (let i = 0; i < VIZ_N; i++) respMag[i] *= respTmp[i];
    }
    if (S.fx.glass.on && Math.abs(S.fx.glass.g) > 0.01) {
      N.vRes.getFrequencyResponse(FF, respTmp, respPh);
      for (let i = 0; i < VIZ_N; i++) respMag[i] *= respTmp[i];
    }
    if (!resp) resp = new Float32Array(VIZ_N);
    for (let i = 0; i < VIZ_N; i++) resp[i] = 20 * Math.log10(Math.max(respMag[i], 1e-4));
    vizDirty = false;
  }

  function sampleSpectrum() {
    if (ctx && N.an && audio && !audio.paused) {
      if (!freqData || freqData.length !== N.an.frequencyBinCount) {
        freqData = new Uint8Array(N.an.frequencyBinCount);
      }
      N.an.getByteFrequencyData(freqData);
    }
  }

  const SILK_NB = 28;
  const silkEnv = new Float32Array(SILK_NB);
  const SILK_PTS = 36;
  const silkTopX = new Float32Array(SILK_PTS);
  const silkTopY = new Float32Array(SILK_PTS);
  const silkBotY = new Float32Array(SILK_PTS);
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let gradW = 0;
  let silkFillGrads: CanvasGradient[] = [];
  let silkStrokeGrads: CanvasGradient[] = [];

  function ensureSilkGradients(w: number) {
    if (gradW === w && silkFillGrads.length === 3) return;
    gradW = w;
    const mk = (stops: Array<[number, string]>) => {
      const g = c2.createLinearGradient(0, 0, w, 0);
      stops.forEach(([p, col]) => g.addColorStop(p, col));
      return g;
    };
    silkFillGrads = [
      mk([[0, 'rgba(0,229,255,0.22)'], [0.46, 'rgba(157,78,221,0.18)'], [1, 'rgba(255,42,133,0.22)']]),
      mk([[0, 'rgba(56,249,215,0.16)'], [0.5, 'rgba(192,132,252,0.20)'], [1, 'rgba(255,93,162,0.18)']]),
      mk([[0, 'rgba(168,85,247,0.15)'], [0.52, 'rgba(0,229,255,0.14)'], [1, 'rgba(255,117,181,0.18)']]),
    ];
    silkStrokeGrads = [
      mk([[0, '#00F0FF'], [0.48, '#B36BFF'], [1, '#FF4FA3']]),
      mk([[0, '#5CEEFF'], [0.5, '#D896FF'], [1, '#FF75B5']]),
      mk([[0, '#A855F7'], [0.52, '#38F9D7'], [1, '#FF2A85']]),
    ];
  }

  function traceSmooth(xs: Float32Array, ys: Float32Array, n: number, rev: boolean) {
    if (!rev) {
      c2.moveTo(xs[0], ys[0]);
      for (let i = 0; i < n - 1; i++) {
        const mx = (xs[i] + xs[i + 1]) * 0.5;
        const my = (ys[i] + ys[i + 1]) * 0.5;
        c2.quadraticCurveTo(xs[i], ys[i], mx, my);
      }
      c2.lineTo(xs[n - 1], ys[n - 1]);
    } else {
      c2.lineTo(xs[n - 1], ys[n - 1]);
      for (let i = n - 1; i > 0; i--) {
        const mx = (xs[i] + xs[i - 1]) * 0.5;
        const my = (ys[i] + ys[i - 1]) * 0.5;
        c2.quadraticCurveTo(xs[i], ys[i], mx, my);
      }
      c2.lineTo(xs[0], ys[0]);
    }
  }

  function drawSilkWaves(now: number, w: number, hh: number, dpr: number, playing: boolean) {
    ensureSilkGradients(w);
    if (playing && ctx && freqData) {
      const sr = ctx.sampleRate;
      for (let j = 0; j < SILK_NB; j++) {
        const f0 = 22 * Math.pow(860, j / SILK_NB);
        const f1 = 22 * Math.pow(860, (j + 1) / SILK_NB);
        const a = Math.floor((f0 / (sr / 2)) * freqData.length);
        const b = Math.max(a + 1, Math.ceil((f1 / (sr / 2)) * freqData.length));
        let pk = 0;
        for (let k = a; k < b && k < freqData.length; k++) if (freqData[k] > pk) pk = freqData[k];
        const tgt = pk / 255;
        silkEnv[j] += (tgt - silkEnv[j]) * (tgt > silkEnv[j] ? 0.34 : 0.14);
      }
    } else {
      for (let j = 0; j < SILK_NB; j++) silkEnv[j] *= 0.9;
    }

    const t = reduceMotion && !playing ? 1.2 : now * 0.00135;
    const cy = hh * 0.52;

    for (let r = 0; r < 3; r++) {
      const ph = t * (0.9 + r * 0.24) + r * 1.85;
      const freq1 = 2.1 + r * 0.55;
      const freq2 = 3.7 - r * 0.4;

      for (let i = 0; i < SILK_PTS; i++) {
        const u = i / (SILK_PTS - 1);
        silkTopX[i] = u * w;

        const bj = u * (SILK_NB - 1);
        const b0 = bj | 0;
        const b1 = Math.min(SILK_NB - 1, b0 + 1);
        const e = silkEnv[b0] + (silkEnv[b1] - silkEnv[b0]) * (bj - b0);

        let eqLift = 0;
        if (resp) {
          const ri = Math.min(VIZ_N - 1, Math.round(u * (VIZ_N - 1)));
          eqLift = clamp(resp[ri] / 18, -0.85, 0.85) * hh * 0.16;
        }

        const env = (0.14 + e * 0.30) * hh;
        const w1 = Math.sin(u * Math.PI * freq1 + ph) * 0.68 + Math.cos(u * Math.PI * freq2 - ph * 0.72) * 0.32;
        const w2 = Math.sin(u * Math.PI * (freq1 + 0.35) + ph + 0.78) * 0.62 + Math.cos(u * Math.PI * (freq2 - 0.25) - ph * 0.64 + 0.5) * 0.38;
        const taper = 0.38 + 0.62 * Math.sin(u * Math.PI);

        silkTopY[i] = cy - eqLift + w1 * env * taper;
        silkBotY[i] = cy - eqLift * 0.82 + w2 * env * taper * 0.86;
      }

      c2.fillStyle = silkFillGrads[r];
      c2.beginPath();
      traceSmooth(silkTopX, silkTopY, SILK_PTS, false);
      traceSmooth(silkTopX, silkBotY, SILK_PTS, true);
      c2.closePath();
      c2.fill();

      c2.strokeStyle = silkStrokeGrads[r];
      for (let s = 0; s <= 4; s++) {
        const k = s / 4;
        const isEdge = s === 0 || s === 4;
        c2.globalAlpha = isEdge ? 0.78 : 0.22;
        c2.lineWidth = (isEdge ? 1.55 : 0.85) * dpr;
        c2.beginPath();
        for (let i = 0; i < SILK_PTS; i++) {
          const y = silkTopY[i] + (silkBotY[i] - silkTopY[i]) * k;
          if (i === 0) c2.moveTo(silkTopX[0], y);
          else {
            const prevY = silkTopY[i - 1] + (silkBotY[i - 1] - silkTopY[i - 1]) * k;
            c2.quadraticCurveTo(silkTopX[i - 1], prevY, (silkTopX[i - 1] + silkTopX[i]) * 0.5, (prevY + y) * 0.5);
          }
        }
        const lastIdx = SILK_PTS - 1;
        c2.lineTo(silkTopX[lastIdx], silkTopY[lastIdx] + (silkBotY[lastIdx] - silkTopY[lastIdx]) * k);
        c2.stroke();
      }
      c2.globalAlpha = 1;
    }
  }

  function drawViz(now: number) {
    if (document.hidden) return;
    const playing = !!(audio && !audio.paused);
    const minDt = !playing && !vizDirty ? (reduceMotion ? 1000 : 52) : 32;
    if (now - lastVizDraw < minDt && !vizDirty) return;
    lastVizDraw = now;
    if (playing) sampleSpectrum();
    if (!vizW || !vizH) syncVizSize();
    const w = vizW;
    const hh = vizH;
    const dpr = window.devicePixelRatio || 1;
    if (!w || !hh) return;
    c2.clearRect(0, 0, w, hh);

    if (ctx && vizDirty && (now - lastRespCalc > 50 || !playing)) {
      lastRespCalc = now;
      calcResp();
    }

    drawSilkWaves(now, w, hh, dpr, playing);

    /* En EQ 30 y Claridad 16 superponemos la curva dB de precisión de estudio */
    if (curTab !== 'eq30' && curTab !== 'cl16') return;

    const isCl = curTab === 'cl16';
    const strokeCol = isCl ? '#7CFFB8' : '#9AF5FF';
    const barCol = isCl ? '#4DFF9E' : '#5CEEFF';

    c2.strokeStyle = isCl ? 'rgba(130, 255, 195, 0.18)' : 'rgba(185, 235, 255, 0.20)';
    c2.lineWidth = 1;
    c2.beginPath();
    c2.moveTo(0, hh / 2);
    c2.lineTo(w, hh / 2);
    c2.stroke();
    if (ctx && N.an) {
      if (playing && freqData) {
        const nb = 64;
        const sr = ctx.sampleRate;
        const bw = w / nb;
        c2.fillStyle = barCol;
        c2.globalAlpha = 0.24;
        for (let i = 0; i < nb; i++) {
          const f0 = 20 * Math.pow(1000, i / nb);
          const f1 = 20 * Math.pow(1000, (i + 1) / nb);
          const a = Math.floor((f0 / (sr / 2)) * freqData.length);
          const b = Math.max(a + 1, Math.ceil((f1 / (sr / 2)) * freqData.length));
          let m = 0;
          for (let k = a; k < b && k < freqData.length; k++) if (freqData[k] > m) m = freqData[k];
          const bh = (m / 255) * hh * 0.88;
          c2.fillRect(i * bw + 1, hh - bh, Math.max(1, bw - 2), bh);
        }
        c2.globalAlpha = 1;
      }
      if (resp) {
        c2.save();
        c2.strokeStyle = strokeCol;
        c2.shadowColor = barCol;
        c2.shadowBlur = 8 * dpr;
        c2.lineWidth = 2 * dpr;
        c2.beginPath();
        for (let i = 0; i < VIZ_N; i++) {
          const x = (i / (VIZ_N - 1)) * w;
          const y = hh / 2 - (clamp(resp[i], -18, 18) / 18) * (hh / 2) * 0.86;
          if (i) c2.lineTo(x, y);
          else c2.moveTo(x, y);
        }
        c2.stroke();
        c2.restore();
      }
    }
    c2.fillStyle = 'rgba(215, 235, 255, 0.78)';
    c2.font = 10 * dpr + 'px ' + numFont;
    (
      [
        ['100', 100],
        ['1k', 1000],
        ['10k', 10000],
      ] as Array<[string, number]>
    ).forEach(([t, f]) => {
      const x = (Math.log(f / 20) / Math.log(1000)) * w;
      c2.fillText(t, x + 3 * dpr, hh - 5 * dpr);
    });
    c2.fillText('+18 dB', 6 * dpr, 13 * dpr);
    c2.fillText('−18', 6 * dpr, hh - 5 * dpr);
  }

  /* ---------- pestañas EQ (30 y 16 bandas con Q Proporcional) ---------- */
  const stripScrollSyncers: Array<() => void> = [];
  function eqTab(cfg: {
    key: string;
    arr: string;
    rk: string;
    qk: string;
    pqk: string;
    freqs: number[];
    names: string[] | null;
    title: string;
    hint: string;
  }) {
    const { c, body } = card(cfg.key, cfg.title);
    const arr = (): number[] => S[cfg.arr];
    const rg = (): number => S[cfg.rk];
    let sel = 0;
    let fineOn = false;
    body.append(h('p', { class: 'hint', text: cfg.hint }));
    const rchips = h('div', { class: 'chips' });
    [6, 12, 24].forEach((r) => {
      const b = h('button', {
        class: 'chip',
        type: 'button',
        text: '±' + r + ' dB',
        onclick: () => {
          if (arr().some((v) => Math.abs(v) > r)) {
            toast('Hay bandas fuera de ±' + r + ' dB');
            return;
          }
          S[cfg.rk] = r;
          syncAll();
          commit();
          persistNow();
        },
      });
      b.dataset.r = String(r);
      rchips.append(b);
    });
    const fineChip = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Precisión ×5',
      'aria-pressed': 'false',
      onclick: () => {
        fineOn = !fineOn;
        fineChip.setAttribute('aria-pressed', String(fineOn));
      },
    });
    const propChip = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Q Proporcional',
      'aria-pressed': String(!!S[cfg.pqk]),
      onclick: () => {
        S[cfg.pqk] = !S[cfg.pqk];
        syncAll();
        commit();
        persistNow();
        toast(S[cfg.pqk] ? 'Q Proporcional analógico activo' : 'Q Constante quirúrgico activo');
      },
    });
    body.append(
      h('div', { class: 'chips' }, rchips.children.length ? [...Array.from(rchips.children)] : [], fineChip, propChip)
    );

    const strip = h('div', { class: 'strip', role: 'group', 'aria-label': cfg.title });
    const panBar = h('input', {
      type: 'range',
      class: 'rfull strip-pan',
      min: 0,
      max: 1000,
      step: 1,
      value: 0,
      'aria-label': 'Recorrer bandas horizontalmente',
    }) as HTMLInputElement;
    panBar.style.setProperty('--p', '0%');
    const panWrap = h(
      'div',
      { class: 'strip-nav' },
      h('span', { class: 'strip-nav-lbl num', text: fmtF(cfg.freqs[0]) + ' Hz' }),
      panBar,
      h('span', { class: 'strip-nav-lbl num', text: fmtF(cfg.freqs[cfg.freqs.length - 1]) + ' Hz' })
    );
    const syncPanBar = () => {
      const maxSc = Math.max(0, strip.scrollWidth - strip.clientWidth);
      panWrap.hidden = maxSc < 8;
      if (maxSc < 8) return;
      const ratio = clamp(strip.scrollLeft / maxSc, 0, 1);
      panBar.value = String(Math.round(ratio * 1000));
      panBar.style.setProperty('--p', (ratio * 100).toFixed(1) + '%');
    };
    panBar.addEventListener('input', () => {
      const maxSc = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const ratio = clamp(+panBar.value / 1000, 0, 1);
      strip.scrollLeft = ratio * maxSc;
      panBar.style.setProperty('--p', (ratio * 100).toFixed(1) + '%');
    });
    strip.addEventListener('scroll', syncPanBar, { passive: true });
    window.addEventListener('resize', syncPanBar, { passive: true });
    stripScrollSyncers.push(syncPanBar);
    body.append(panWrap);

    const cols: HTMLElement[] = [];
    const vals: HTMLElement[] = [];
    const fills: HTMLElement[] = [];
    const thumbs: HTMLElement[] = [];
    const tracks: HTMLElement[] = [];

    function paint(i: number) {
      const v = arr()[i];
      const r = rg();
      const p = ((v / r + 1) / 2) * 100;
      thumbs[i].style.top = 100 - p + '%';
      if (v >= 0) {
        fills[i].style.top = 100 - p + '%';
        fills[i].style.height = p - 50 + '%';
      } else {
        fills[i].style.top = '50%';
        fills[i].style.height = 50 - p + '%';
      }
      vals[i].textContent = (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
      const tr = tracks[i];
      tr.setAttribute('aria-valuenow', String(v));
      tr.setAttribute('aria-valuemin', String(-r));
      tr.setAttribute('aria-valuemax', String(r));
    }
    function paintAll() {
      arr().forEach((_, i) => paint(i));
      cols.forEach((colEl, i) => colEl.classList.toggle('sel', i === sel));
      body.querySelectorAll<HTMLElement>('[data-r]').forEach((b) =>
        b.setAttribute('aria-pressed', String(+(b.dataset.r || 0) === rg()))
      );
      propChip.setAttribute('aria-pressed', String(!!S[cfg.pqk]));
      updFine();
      syncPanBar();
    }
    function setBand(i: number, v: number, flush: boolean) {
      const nv = clamp(r1(v), -rg(), rg());
      if (arr()[i] === nv) {
        if (flush) persistNow();
        return;
      }
      arr()[i] = nv;
      paint(i);
      updFine();
      commit();
      if (flush) persistNow();
    }
    function select(i: number, scroll?: boolean) {
      sel = clamp(i, 0, cfg.freqs.length - 1);
      cols.forEach((colEl, k) => colEl.classList.toggle('sel', k === sel));
      updFine();
      if (scroll) {
        cols[sel].scrollIntoView({ inline: 'center', block: 'nearest' });
        setTimeout(syncPanBar, 40);
      }
    }

    cfg.freqs.forEach((f, i) => {
      const val = h('span', { class: 'bv num' });
      const fill = h('div', { class: 'bfill' });
      const thumb = h('div', { class: 'bthumb' });
      const bin = h('div', { class: 'bin' }, h('div', { class: 'brail' }), h('div', { class: 'bzero' }), fill, thumb);
      const track = h(
        'div',
        {
          class: 'btrack',
          tabindex: '0',
          role: 'slider',
          'aria-label': 'Banda ' + fmtHz(f) + (cfg.names ? ' ' + cfg.names[i] : ''),
          'aria-orientation': 'vertical',
          'aria-valuetext': '',
        },
        bin
      );
      let drag: { y: number; v: number; top: number; h: number; touchId?: number; ptrId?: number } | null = null;
      const fromDragY = (clientY: number) => (1 - clamp((clientY - drag!.top) / drag!.h, 0, 1)) * 2 - 1;
      const beginDrag = (clientY: number, touchId?: number, ptrId?: number) => {
        if (S.locks[cfg.key]) {
          toast(cfg.title + ' está bloqueado');
          return;
        }
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
        select(i);
        const rc = bin.getBoundingClientRect();
        const trc = rc.height > 10 ? rc : track.getBoundingClientRect();
        drag = { y: clientY, v: arr()[i], top: trc.top, h: trc.height || 180, touchId, ptrId };
        track.classList.add('dragging');
        if (!fineOn) setBand(i, fromDragY(clientY) * rg(), false);
      };
      const moveDrag = (clientY: number) => {
        if (!drag) return;
        if (fineOn) setBand(i, drag.v + (((drag.y - clientY) / drag.h) * 2 * rg()) / 5, false);
        else setBand(i, fromDragY(clientY) * rg(), false);
      };
      const endDrag = () => {
        if (drag) {
          drag = null;
          track.classList.remove('dragging');
          persistNow();
        }
      };

      track.addEventListener(
        'touchstart',
        (e: TouchEvent) => {
          if (!e.changedTouches.length) return;
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
          const t = e.changedTouches[0];
          beginDrag(t.clientY, t.identifier, undefined);
        },
        { passive: false }
      );
      track.addEventListener(
        'touchmove',
        (e: TouchEvent) => {
          if (!drag || drag.touchId === undefined) return;
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
          for (let k = 0; k < e.changedTouches.length; k++) {
            if (e.changedTouches[k].identifier === drag.touchId) {
              moveDrag(e.changedTouches[k].clientY);
              break;
            }
          }
        },
        { passive: false }
      );
      track.addEventListener('touchend', (e: TouchEvent) => {
        if (!drag || drag.touchId === undefined) return;
        for (let k = 0; k < e.changedTouches.length; k++) {
          if (e.changedTouches[k].identifier === drag.touchId) {
            endDrag();
            break;
          }
        }
      });
      track.addEventListener('touchcancel', () => {
        if (drag && drag.touchId !== undefined) endDrag();
      });

      const onWinPtrMove = (e: PointerEvent) => {
        if (!drag || drag.ptrId !== e.pointerId) return;
        if (e.cancelable) e.preventDefault();
        moveDrag(e.clientY);
      };
      const onWinPtrUp = (e: PointerEvent) => {
        if (!drag || drag.ptrId !== e.pointerId) return;
        window.removeEventListener('pointermove', onWinPtrMove);
        window.removeEventListener('pointerup', onWinPtrUp);
        window.removeEventListener('pointercancel', onWinPtrUp);
        endDrag();
      };
      track.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.pointerType === 'touch' && 'ontouchstart' in window) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.cancelable) e.preventDefault();
        try {
          track.setPointerCapture(e.pointerId);
        } catch (_err) {}
        beginDrag(e.clientY, undefined, e.pointerId);
        window.addEventListener('pointermove', onWinPtrMove, { passive: false });
        window.addEventListener('pointerup', onWinPtrUp);
        window.addEventListener('pointercancel', onWinPtrUp);
      });

      track.addEventListener('keydown', (e: KeyboardEvent) => {
        const st = e.shiftKey ? 1 : 0.1;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          setBand(i, arr()[i] + st, true);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          setBand(i, arr()[i] - st, true);
        } else if (e.key === 'Home') {
          e.preventDefault();
          setBand(i, 0, true);
        }
      });
      const col = h(
        'div',
        { class: 'bcol' },
        val,
        track,
        h('span', { class: 'bf num', text: fmtF(f) }),
        cfg.names ? h('span', { class: 'bn', text: cfg.names[i] }) : null
      );
      cols.push(col);
      vals.push(val);
      fills.push(fill);
      thumbs.push(thumb);
      tracks.push(track);
      strip.append(col);
    });
    body.append(strip);

    const fname = h('div', { class: 'fname' });
    const fval = h('div', { class: 'fval num' });
    const prev = h('button', { class: 'btn', type: 'button', 'aria-label': 'Banda anterior', text: '◀', onclick: () => select(sel - 1, true) });
    const next = h('button', { class: 'btn', type: 'button', 'aria-label': 'Banda siguiente', text: '▶', onclick: () => select(sel + 1, true) });
    const fnum = h('input', {
      type: 'number',
      class: 'num in',
      id: 'fn_' + cfg.key,
      step: 0.1,
      inputmode: 'decimal',
      'aria-label': 'Ganancia exacta de la banda seleccionada',
    }) as HTMLInputElement;
    fnum.addEventListener('change', () => {
      const v = parseFloat(fnum.value);
      if (isFinite(v)) setBand(sel, v, true);
      else updFine();
    });
    const adj = (d: number, t: string) => {
      const b = h('button', { class: 'btn', type: 'button', text: t, 'aria-label': (d > 0 ? 'Subir ' : 'Bajar ') + Math.abs(d) + ' dB' });
      holdBtn(b, () => setBand(sel, arr()[sel] + d, false));
      return b;
    };
    const frow = h(
      'div',
      { class: 'frow' },
      adj(-1, '−1'),
      adj(-0.1, '−0.1'),
      fnum,
      adj(0.1, '+0.1'),
      adj(1, '+1'),
      h('button', { class: 'btn', type: 'button', text: '0', onclick: () => setBand(sel, 0, true) })
    );
    function updFine() {
      const f = cfg.freqs[sel];
      fname.textContent = fmtHz(f) + (cfg.names ? ' · ' + cfg.names[sel] : '');
      const v = arr()[sel];
      fval.textContent = sgn(v) + ' dB';
      fnum.value = v.toFixed(1);
      fnum.max = String(rg());
      fnum.min = String(-rg());
    }
    body.append(h('div', { class: 'fine' }, h('div', { class: 'fnav' }, prev, h('div', { class: 'mid' }, fname, fval), next), frow));
    body.append(row(cfg.qk, 'Ancho de banda base (Q)', { min: 0.3, max: 20, step: 0.01, fine: 0.01, unit: 'Q' }));
    body.append(
      h(
        'div',
        { class: 'chips', style: 'margin-top:8px' },
        h('button', {
          class: 'btn',
          type: 'button',
          text: 'Aplanar',
          onclick: () => {
            arr().fill(0);
            paintAll();
            commit();
            persistNow();
          },
        }),
        h('button', {
          class: 'btn',
          type: 'button',
          text: 'Suavizar curva',
          onclick: () => {
            const a = arr();
            const n = a.map((v, i) => r1((a[i - 1] ?? v) * 0.25 + v * 0.5 + (a[i + 1] ?? v) * 0.25));
            n.forEach((v, i) => (a[i] = v));
            paintAll();
            commit();
            persistNow();
          },
        }),
        h('button', {
          class: 'btn ghost',
          type: 'button',
          text: 'Invertir',
          onclick: () => {
            const a = arr();
            for (let i = 0; i < a.length; i++) a[i] = clamp(r1(-a[i]), -rg(), rg());
            paintAll();
            commit();
            persistNow();
          },
        })
      )
    );
    syncers.push(paintAll);
    return c;
  }

  /* ---------- reproductor Hi-Res + decodificador de respaldo 32-bit Float ---------- */
  interface TrackItem {
    id: string | number;
    name: string;
    artist: string;
    fmt?: string;
    kbps?: number;
    duration: number;
    dateAdded: number;
    url: string;
    rawFile?: File;
    decodedFallback?: boolean;
  }

  const PL: TrackItem[] = [];
  let nativeRaw: TrackItem[] = [];
  let cur = -1;
  let repeat = savedRepeat;
  let shuffle = savedShuffle;
  let seeking = false;
  let searchQ = '';
  let sortMode: 'recent' | 'az' = savedSortMode;
  let hasPerm = !NATIVE;
  let lastNotifSync = 0;
  let userWantsPlaying = false;
  let resumeT: any = 0;

  const REP = ['Repetir: no', 'Repetir: todo', 'Repetir: una'];
  function inPhoneCall(): boolean {
    if (NATIVE && window.AndroidBridge?.isInPhoneCall) {
      try {
        return !!window.AndroidBridge.isInPhoneCall();
      } catch (_e) {}
    }
    return false;
  }

  function detectFileFormat(f: File): string {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const map: Record<string, string> = {
      flac: 'FLAC Lossless',
      wav: 'WAV PCM',
      wave: 'WAV PCM',
      aif: 'AIFF Studio',
      aiff: 'AIFF Studio',
      aifc: 'AIFF Studio',
      m4a: 'M4A / ALAC',
      alac: 'ALAC Lossless',
      opus: 'OPUS Hi-Fi',
      ogg: 'OGG Vorbis',
      oga: 'OGG Audio',
      aac: 'AAC',
      weba: 'WebM Audio',
      webm: 'WebM Audio',
      mp3: 'MP3',
      caf: 'CAF Apple',
    };
    return map[ext] || (ext ? ext.toUpperCase() : 'AUDIO');
  }

  function isAudioFile(f: File) {
    return (
      (f.type && f.type.startsWith('audio')) ||
      /\.(mp3|m4a|alac|aac|wav|wave|flac|ogg|oga|opus|weba|webm|aif|aiff|aifc|caf|3gp|mp4)$/i.test(f.name)
    );
  }

  /* Convierte un AudioBuffer decodificado en WAV IEEE 32-bit Float sin pérdida para contenedores exóticos */
  function audioBufferToFloatWavBlob(buf: AudioBuffer): Blob {
    const numCh = Math.min(2, buf.numberOfChannels || 1);
    const sr = buf.sampleRate;
    const frames = buf.length;
    const bytesPerSample = 4;
    const blockAlign = numCh * bytesPerSample;
    const dataSize = frames * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const dv = new DataView(ab);
    const wr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
    };
    wr(0, 'RIFF');
    dv.setUint32(4, 36 + dataSize, true);
    wr(8, 'WAVE');
    wr(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 3, true); /* Formato 3 = IEEE 32-bit Float */
    dv.setUint16(22, numCh, true);
    dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * blockAlign, true);
    dv.setUint16(32, blockAlign, true);
    dv.setUint16(34, 32, true);
    wr(36, 'data');
    dv.setUint32(40, dataSize, true);
    const ch0 = buf.getChannelData(0);
    const ch1 = numCh > 1 ? buf.getChannelData(1) : ch0;
    const out = new Float32Array(ab, 44, frames * numCh);
    if (numCh === 1) {
      out.set(ch0);
    } else {
      for (let i = 0, j = 0; i < frames; i++) {
        out[j++] = ch0[i];
        out[j++] = ch1[i];
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  async function tryDecodeFallback(track: TrackItem): Promise<boolean> {
    if (!ctx || !track.rawFile || track.decodedFallback) return false;
    track.decodedFallback = true;
    try {
      const rawBuf = await track.rawFile.arrayBuffer();
      const decoded = await ctx.decodeAudioData(rawBuf);
      const wavBlob = audioBufferToFloatWavBlob(decoded);
      track.url = URL.createObjectURL(wavBlob);
      track.duration = Math.round(decoded.duration);
      track.fmt = (track.fmt || 'Hi-Res') + ' · 32f';
      audio.src = track.url;
      updateEngineSpecUi();
      if (userWantsPlaying) await playNow();
      return true;
    } catch (_e) {
      return false;
    }
  }

  let preloadedIdx = -1;
  let queuedShuffleNext = -1;
  let xfadeTimer: any = 0;
  let xfadeActive = false;

  function resetDeckGainsImmediate() {
    clearTimeout(xfadeTimer);
    xfadeActive = false;
    preloadedIdx = -1;
    if (standbyAudio && !standbyAudio.paused) {
      try {
        standbyAudio.pause();
      } catch (_e) {}
    }
    if (ctx && N.gA && N.gB) {
      const t = ctx.currentTime;
      const gAct = activeDeck === 'A' ? N.gA.gain : N.gB.gain;
      const gStb = activeDeck === 'A' ? N.gB.gain : N.gA.gain;
      gAct.cancelScheduledValues(t);
      gStb.cancelScheduledValues(t);
      gAct.setValueAtTime(1, t);
      gStb.setValueAtTime(0, t);
    }
  }

  function peekNextAutoIndex(): number {
    if (!PL.length) return -1;
    if (repeat === 2) return cur;
    if (shuffle && PL.length > 1) {
      if (queuedShuffleNext >= 0 && queuedShuffleNext < PL.length && queuedShuffleNext !== cur) {
        return queuedShuffleNext;
      }
      let r = cur;
      while (r === cur) r = Math.floor(Math.random() * PL.length);
      queuedShuffleNext = r;
      return r;
    }
    const nx = cur + 1;
    if (nx >= PL.length) {
      return repeat === 1 ? 0 : -1;
    }
    return nx;
  }

  function setDockTitleFor(i: number) {
    const t = PL[i];
    if (!t) return;
    const dTitle = $('#dTitle');
    if (dTitle) {
      dTitle.replaceChildren(
        h('span', { class: 'dt-name', text: t.name }),
        ...(t.artist ? [h('span', { class: 'dt-sep', text: ' · ' }), h('span', { class: 'dt-art', text: t.artist })] : [])
      );
    }
    if (t.id != null) {
      savedLastTrackId = String(t.id);
      try {
        localStorage.setItem(LAST_TRACK_KEY, savedLastTrackId);
      } catch (_e) {}
      saveSoon();
    }
  }

  function maybePreloadStandby() {
    if (!PL.length || cur < 0 || xfadeActive || !standbyAudio) return;
    if (!S.play.gapless && !(S.play.xfade > 0)) return;
    const dur = audio.duration;
    if (!dur || !isFinite(dur) || dur < 4) return;
    const rem = dur - audio.currentTime;
    const lead = Math.max(12, (S.play.xfade || 0) + 4);
    if (rem > lead) return;
    const nx = peekNextAutoIndex();
    if (nx < 0 || !PL[nx] || nx === cur) return;
    if (preloadedIdx !== nx || standbyAudio.src !== PL[nx].url) {
      preloadedIdx = nx;
      standbyAudio.src = PL[nx].url;
      standbyAudio.currentTime = 0;
      try {
        standbyAudio.load();
      } catch (_e) {}
    }
  }

  async function triggerDeckHandoff(nx: number, fadeSec: number): Promise<boolean> {
    if (!PL[nx] || !ctx || !N.gA || !N.gB || !standbyAudio) return false;
    clearTimeout(xfadeTimer);
    queuedShuffleNext = -1;
    const outEl = audio;
    const inEl = standbyAudio;
    const outGain = activeDeck === 'A' ? N.gA.gain : N.gB.gain;
    const inGain = activeDeck === 'A' ? N.gB.gain : N.gA.gain;
    if (preloadedIdx !== nx || inEl.src !== PL[nx].url) {
      inEl.src = PL[nx].url;
    }
    inEl.currentTime = 0;
    const baseRate = clamp(S.play.rate || 1, 0.5, 1.5);
    const effRate = S.play.hz432 ? baseRate * (432 / 440) : baseRate;
    const keepP = S.play.hz432 ? false : !!S.play.keepPitch;
    (inEl as any).preservesPitch = keepP;
    (inEl as any).webkitPreservesPitch = keepP;
    if (Math.abs(inEl.playbackRate - effRate) > 1e-4) inEl.playbackRate = effRate;

    try {
      if (ctx.state !== 'running') await ctx.resume();
      const t0 = ctx.currentTime;
      const dur = clamp(fadeSec, 0.01, 12);
      outGain.cancelScheduledValues(t0);
      inGain.cancelScheduledValues(t0);
      if (dur >= 0.15) {
        const steps = 64;
        const cOut = new Float32Array(steps);
        const cIn = new Float32Array(steps);
        for (let k = 0; k < steps; k++) {
          const ph = (k / (steps - 1)) * Math.PI * 0.5;
          cOut[k] = Math.cos(ph);
          cIn[k] = Math.sin(ph);
        }
        outGain.setValueCurveAtTime(cOut, t0, dur);
        inGain.setValueCurveAtTime(cIn, t0, dur);
      } else {
        outGain.setValueAtTime(1, t0);
        inGain.setValueAtTime(0, t0);
        outGain.linearRampToValueAtTime(0, t0 + dur);
        inGain.linearRampToValueAtTime(1, t0 + dur);
      }

      activeDeck = activeDeck === 'A' ? 'B' : 'A';
      audio = inEl;
      standbyAudio = outEl;
      preloadedIdx = -1;
      cur = nx;
      xfadeActive = dur >= 0.15;
      await inEl.play();
      setDockTitleFor(nx);
      renderList();
      updateEngineSpecUi();
      syncMediaSession(true);

      xfadeTimer = setTimeout(() => {
        xfadeActive = false;
        try {
          if (outEl !== audio) outEl.pause();
        } catch (_e) {}
      }, Math.round(dur * 1000) + 60);
      return true;
    } catch (_e) {
      resetDeckGainsImmediate();
      return false;
    }
  }

  function paintJackStatus() {
    if (!jackStatusEl) return;
    const srTxt = ctx && ctx.sampleRate ? +(ctx.sampleRate / 1000).toFixed(1) + ' kHz' : '48 kHz';
    const ditherOn = !!(FX_CONN.dither && ditherReady);
    const parts: string[] = [];
    if (NATIVE) {
      if (jackHw.jackConnected) {
        parts.push((jackHw.portType === 'usb_dac_jack' ? 'DAC USB-C / Jack conectado' : 'Jack 3.5 mm conectado') + (jackHw.deviceName && !jackHw.deviceName.includes('Jack') ? ' (' + jackHw.deviceName + ')' : ''));
        parts.push('Reloj DAC ' + srTxt);
        parts.push((jackHw.bitDepth || 24) + '-bit' + (ditherOn ? ' TPDF' : ''));
      } else {
        parts.push('En espera de Jack 3.5 mm · ' + jackHw.deviceName);
        parts.push('Reloj actual ' + srTxt);
        if (ditherOn) parts.push('24-bit TPDF');
      }
    } else {
      parts.push(S.jack.hiRes ? 'Salida Directa Hi-Res activa' : 'Salida estándar del sistema');
      if (jackHw.deviceName && jackHw.deviceName !== 'Salida del sistema / Jack') parts.push(jackHw.deviceName);
      parts.push('Reloj DAC ' + srTxt);
      parts.push(ditherOn ? '24-bit TPDF activo' : '32-bit Float');
    }
    jackStatusEl.textContent = parts.join(' · ');
  }

  function updateEngineSpecUi() {
    const specEl = $('#dSpec');
    if (!specEl) return;
    const parts: string[] = [];
    const t = PL[cur];
    if (t && t.fmt) parts.push(t.fmt);
    if (t && t.kbps && t.kbps > 0) parts.push(t.kbps + ' kbps');
    if (S.jack.hiRes && (jackHw.jackConnected || (ctx && ctx.sampleRate >= 88200))) {
      parts.push(jackHw.jackConnected ? 'Jack Hi-Res' : 'Hi-Res');
    }
    if (ctx && ctx.sampleRate) parts.push(+(ctx.sampleRate / 1000).toFixed(1) + ' kHz DAC');
    if (FX_CONN.dither && ditherReady) parts.push('24-bit TPDF');
    parts.push(eq64Ready ? '64-bit EQ' : '32-bit Float');
    specEl.textContent = parts.join(' · ');
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    let n = 0;
    for (const f of Array.from(files)) {
      if (!isAudioFile(f)) continue;
      PL.push({
        id: 'local_' + Date.now() + '_' + n,
        name: f.name.replace(/\.[^.]+$/, ''),
        artist: '',
        fmt: detectFileFormat(f),
        duration: 0,
        dateAdded: Date.now() / 1000,
        url: URL.createObjectURL(f),
        rawFile: f,
      });
      n++;
    }
    renderList();
    if (!n) {
      toast('No encontré archivos de audio compatibles');
      return;
    }
    toast(n + ' pista' + (n > 1 ? 's' : '') + ' lista' + (n > 1 ? 's' : '') + ' en máxima calidad');
    if (cur < 0) loadTrack(0, false);
  }

  function syncMediaSession(force: boolean) {
    const t = PL[cur];
    if (!t || !audio) return;
    const now = performance.now();
    if (!force && now - lastNotifSync < 2500) return;
    lastNotifSync = now;
    const playing = userWantsPlaying || !audio.paused;
    if (NATIVE && window.AndroidBridge?.updatePlaybackState) {
      try {
        window.AndroidBridge.updatePlaybackState(
          t.name || 'Estudio Master Hi-Res',
          t.artist || 'Estudio Master Hi-Res',
          playing,
          Math.floor((audio.currentTime || 0) * 1000),
          Math.floor((audio.duration || t.duration || 0) * 1000)
        );
      } catch (_e) {}
    }
    if ('mediaSession' in navigator) {
      try {
        if (force || !navigator.mediaSession.metadata || navigator.mediaSession.metadata.title !== t.name) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: t.name || 'Estudio Master Hi-Res',
            artist: t.artist || 'Estudio Master Hi-Res',
            album: 'Estudio Master Hi-Res',
            artwork: [
              { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            ],
          });
        }
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
        if (audio.duration && isFinite(audio.duration) && typeof navigator.mediaSession.setPositionState === 'function') {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: Math.min(audio.currentTime || 0, audio.duration),
          });
        }
      } catch (_e) {}
    }
  }

  function loadTrack(i: number, play: boolean) {
    if (!PL[i]) return;
    resetDeckGainsImmediate();
    queuedShuffleNext = -1;
    const sameUrl = cur === i && audio.src === PL[i].url;
    cur = i;
    if (!sameUrl) {
      audio.src = PL[i].url;
    }
    setDockTitleFor(i);
    updateEngineSpecUi();
    renderList();
    if (play) playNow();
    else syncMediaSession(true);
  }

  async function playNow() {
    userWantsPlaying = true;
    clearTimeout(resumeT);
    try {
      if (ctx && ctx.state !== 'running') await ctx.resume();
      await audio.play();
      updateEngineSpecUi();
      syncMediaSession(true);
    } catch (_e) {
      const t = PL[cur];
      if (t && t.rawFile && !t.decodedFallback) {
        const ok = await tryDecodeFallback(t);
        if (ok) return;
      }
      userWantsPlaying = false;
      toast('No se pudo reproducir esta pista');
    }
  }

  function pauseByUser() {
    userWantsPlaying = false;
    clearTimeout(resumeT);
    resetDeckGainsImmediate();
    audio.pause();
    const ic = $('#playIcon');
    if (ic) ic.innerHTML = '<path d="M8 5v14l11-7z"/>';
    $('#bPlay')?.setAttribute('aria-label', 'Reproducir');
    syncMediaSession(true);
  }

  function nextTrack(auto: boolean) {
    if (!PL.length) return;
    if (auto) {
      const nx = peekNextAutoIndex();
      if (nx < 0) {
        userWantsPlaying = false;
        syncMediaSession(true);
        return;
      }
      if (S.play.gapless && nx !== cur && preloadedIdx === nx) {
        triggerDeckHandoff(nx, 0.012).then((ok) => {
          if (!ok) loadTrack(nx, true);
        });
        return;
      }
      loadTrack(nx, true);
      return;
    }
    let i: number;
    if (shuffle && PL.length > 1) {
      do {
        i = Math.floor(Math.random() * PL.length);
      } while (i === cur);
    } else {
      i = (cur + 1) % PL.length;
    }
    loadTrack(i, true);
  }

  function prevTrack() {
    if (!PL.length) return;
    if (audio.currentTime > 3) {
      resetDeckGainsImmediate();
      audio.currentTime = 0;
      syncMediaSession(true);
      return;
    }
    loadTrack((cur - 1 + PL.length) % PL.length, true);
  }

  function applyNativeSortAndRebuild(reason: string) {
    const prevTrackObj = cur >= 0 ? PL[cur] : null;
    const prevCount = PL.length;
    const sorted = nativeRaw.slice().sort((a, b) => {
      if (sortMode === 'az') return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' });
      return (b.dateAdded || 0) - (a.dateAdded || 0);
    });
    PL.length = 0;
    for (const item of sorted) PL.push(item);
    if (prevTrackObj) {
      const idx = PL.findIndex((x) => String(x.id) === String(prevTrackObj.id) || x.url === prevTrackObj.url);
      cur = idx >= 0 ? idx : PL.length ? 0 : -1;
    } else if (PL.length) {
      const savedIdx = savedLastTrackId ? PL.findIndex((x) => String(x.id) === String(savedLastTrackId)) : -1;
      loadTrack(savedIdx >= 0 ? savedIdx : 0, false);
    } else {
      cur = -1;
      const dTitle = $('#dTitle');
      if (dTitle) dTitle.textContent = 'Sin pista';
      updateEngineSpecUi();
    }
    renderList();
    if (reason === 'observer' && PL.length > prevCount && prevCount > 0) {
      const diff = PL.length - prevCount;
      toast(diff === 1 ? 'Nueva canción detectada y añadida' : '+' + diff + ' canciones nuevas detectadas');
    }
  }

  window.__onNativeTracks = (tracksInput: unknown, reason?: string) => {
    try {
      const arr = typeof tracksInput === 'string' ? JSON.parse(tracksInput) : tracksInput;
      if (!Array.isArray(arr)) return;
      hasPerm = true;
      nativeRaw = arr.map((t: any) => ({
        id: t.id,
        name: t.name || 'Sin título',
        artist: t.artist || '',
        fmt: t.fmt || '',
        kbps: +t.kbps || 0,
        duration: +t.duration || 0,
        dateAdded: +t.dateAdded || 0,
        url: t.url,
      }));
      applyNativeSortAndRebuild(reason || 'init');
      updPermBanner();
    } catch (_e) {}
  };

  window.__onNativePermission = (granted: boolean) => {
    hasPerm = !!granted;
    updPermBanner();
    renderList();
  };

  window.__nativeCmd = (cmd: string, arg?: number) => {
    if (!PL.length) return;
    if (cmd === 'play') {
      if (cur < 0) loadTrack(0, true);
      else playNow();
    } else if (cmd === 'pause' || cmd === 'pause_user') {
      pauseByUser();
    } else if (cmd === 'toggle' || cmd === 'toggle_user') {
      if (!userWantsPlaying || audio.paused) {
        if (cur < 0) loadTrack(0, true);
        else playNow();
      } else {
        pauseByUser();
      }
    } else if (cmd === 'next') {
      nextTrack(false);
    } else if (cmd === 'prev') {
      prevTrack();
    } else if (cmd === 'seek') {
      if (arg !== undefined && isFinite(+arg)) {
        audio.currentTime = clamp(+arg / 1000, 0, audio.duration || 0);
        syncMediaSession(true);
      }
    }
  };

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => window.__nativeCmd?.('play'));
      navigator.mediaSession.setActionHandler('pause', () => window.__nativeCmd?.('pause_user'));
      navigator.mediaSession.setActionHandler('previoustrack', () => window.__nativeCmd?.('prev'));
      navigator.mediaSession.setActionHandler('nexttrack', () => window.__nativeCmd?.('next'));
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (d && typeof d.seekTime === 'number') {
          audio.currentTime = d.seekTime;
          syncMediaSession(true);
        }
      });
    } catch (_e) {}
  }

  let countBadge: HTMLElement | null = null;
  let permBox: HTMLElement | null = null;
  let batBtn: HTMLElement | null = null;

  function updPermBanner() {
    if (permBox) permBox.hidden = hasPerm;
    if (batBtn && NATIVE && window.AndroidBridge?.isIgnoringBatteryOptimizations) {
      try {
        batBtn.hidden = !!window.AndroidBridge.isIgnoringBatteryOptimizations();
      } catch (_e) {}
    }
  }

  function renderList() {
    const l = $('#plist');
    if (!l) return;
    l.replaceChildren();
    if (countBadge) countBadge.textContent = PL.length ? PL.length + ' pista' + (PL.length === 1 ? '' : 's') : '0 pistas';
    if (NATIVE && !hasPerm) {
      l.append(h('div', { class: 'empty', text: 'Concede permiso de audio para mostrar automáticamente todas tus canciones.' }));
      return;
    }
    if (!PL.length) {
      l.append(
        h('div', {
          class: 'empty',
          text: NATIVE
            ? 'No se encontraron canciones en la memoria del teléfono. Descarga música (FLAC, WAV, M4A, OPUS, MP3) y aparecerá aquí sola.'
            : 'Añade archivos FLAC, WAV, AIFF, M4A, OPUS o MP3 para escuchar en 32-bit Float, o descarga abajo tu proyecto APK Nativo.',
        })
      );
      return;
    }
    const q = normStr(searchQ.trim());
    let shown = 0;
    PL.forEach((t, i) => {
      if (q && !normStr(t.name + ' ' + t.artist).includes(q)) return;
      shown++;
      const subParts: string[] = [];
      if (t.artist) subParts.push(t.artist);
      if (t.fmt) subParts.push(t.fmt);
      l.append(
        h(
          'button',
          { class: 'pitem', type: 'button', 'aria-current': String(i === cur), onclick: () => loadTrack(i, true) },
          h('span', { class: 'num', text: String(i + 1).padStart(2, '0') }),
          h(
            'span',
            { class: 'pmeta' },
            h('span', { class: 'pt', text: t.name }),
            subParts.length ? h('span', { class: 'pa', text: subParts.join(' · ') }) : null
          ),
          t.duration > 0 ? h('span', { class: 'pdur num', text: mmss(t.duration) }) : null
        )
      );
    });
    if (!shown) {
      l.append(h('div', { class: 'empty', text: 'Ninguna canción coincide con “' + searchQ.trim() + '”.' }));
    }
  }

  /* ---------- presets de referencia mundial ---------- */
  function applyData(data: Record<string, any>, { reset = false } = {}) {
    ORDER.forEach((k) => {
      if (S.locks[k]) return;
      if (reset) resetSec(k);
      if (data && data[k]) SEC[k].set(S, data[k]);
    });
    syncAll();
    commit();
    persistNow();
  }

  const pre = h('div', { class: 'pane' });
  const secSel = h('select', { class: 'field', id: 'secSel', 'aria-label': 'Sección' }) as HTMLSelectElement;
  secSel.append(h('option', { value: '__all__', text: 'Todas las secciones guardadas' }));
  ORDER.forEach((k) => secSel.append(h('option', { value: k, text: SEC[k].n })));
  const lists = { fact: h('div'), mine: h('div'), sec: h('div') };

  function saveSection(key: string) {
    const list = store.sec[key] || (store.sec[key] = []);
    const name = SEC[key].n + ' · ' + stamp();
    list.unshift({ name, ts: Date.now(), data: SEC[key].get(S) });
    list.length = Math.min(list.length, 40);
    if (secSel.value !== '__all__') secSel.value = key;
    if (persistNow()) toast('Guardado: ' + name);
    renderPresets();
  }
  function saveAllPreset(name: string) {
    name = (name || '').trim() || 'Ajuste ' + stamp();
    store.presets.unshift({ name, ts: Date.now(), data: getFull() });
    store.presets.length = Math.min(store.presets.length, 60);
    if (persistNow()) toast('Guardado todo: ' + name);
    renderPresets();
  }
  const ramp = (n: number, fn: (i: number) => number) => Array.from({ length: n }, (_, i) => r1(fn(i)));
  const FACT: Array<[string, string, Record<string, any>]> = [
    ['Plano Bit-Perfect', 'Respuesta neutra 0 dB de referencia', {}],
    [
      'Harman Reference Hi-Fi',
      'Curva audiófila mundial para audífonos + Crossfeed suave',
      {
        cl16: { cl: [3.2, 3.8, 2.4, 0.5, -0.6, -1.0, 0, 0.8, 2.2, 3.0, 2.1, 0.8, 1.4, 2.2, 2.0, 1.2], propQ16: true },
        xfeed: { on: true, mix: 24, fc: 700 },
        master: { ceil: -0.2, autoHead: true },
      },
    ],
    [
      'Mastering Analógico 4×',
      'Válvula triodo sutil, compresión glue y apertura M/S',
      {
        cl16: { cl: [1.5, 1.8, 1.0, 0, -0.8, -0.6, 0, 0.6, 1.2, 1.5, 1.0, 1.2, 1.8, 2.4, 2.2, 1.5], propQ16: true },
        sat: { on: true, drive: 14, mix: 16, mode: 1 },
        comp: { on: true, th: -18, ratio: 2.2, attack: 22, release: 190, knee: 8, makeup: 1.8 },
        wid: { on: true, w: 18 },
        master: { ceil: -0.2, autoHead: true },
      },
    ],
    ['Graves potentes', 'Realce limpio de 25 a 160 Hz', { eq30: { eq: ramp(30, (i) => Math.max(0, 6 - i * 0.42)) }, tone: { bass: 3 } }],
    ['Voz clara Studio', 'Presencia nítida y control de sibilancia', { cl16: { cl: [0, -1, -1, 0, 0, -1.5, 0, 1.5, 2.5, 3, 2, 0.5, 0, 1, 0.5, 0] }, voice: { vPres: { g: 3 }, vSib: { g: -2 }, vWarm: { g: 1 } } }],
    ['Rock en vivo', 'Pegada de consola, caja, guitarra y aire', { eq30: { eq: ramp(30, (i) => (Math.abs(i - 14) < 6 ? -1.5 : (Math.abs(i - 14) / 14) * 5)) }, drums: { kick: { g: 2.5 }, snareC: { g: 2 } }, guitar: { gPres: { g: 2.5 } }, sat: { on: true, drive: 16, mix: 14, mode: 2 }, comp: { on: true, th: -18, ratio: 3, attack: 12, release: 180, knee: 6, makeup: 3 } }],
    ['Electrónica Club', 'Subgraves profundos, curva en V y ancho M/S', { eq30: { eq: ramp(30, (i) => (Math.abs(i - 14.5) / 14.5) * 6 - 1) }, tone: { bass: 3, treb: 2 }, sat: { on: true, drive: 18, mix: 15, mode: 0 }, wid: { on: true, w: 30 } }],
    ['Cine Espacial 3D', 'Escena binaural HRTF y sala acústica HD', { rev: { on: true, mix: 22, decay: 2.8, size: 70, damp: 38, pre: 18 }, sp: { on: true, mix: 48, rot: 0, dist: 1.6, az: 0, el: 8 }, wid: { on: true, w: 36 }, sub: { on: true, freq: 42, g: 4.5, q: 1.2 } }],
  ];

  const twoStep = (btn: HTMLElement, label: string, fn: () => void) => {
    let armed: any = 0;
    btn.addEventListener('click', () => {
      if (armed) {
        clearTimeout(armed);
        armed = 0;
        btn.textContent = btn.dataset.t || '';
        fn();
        return;
      }
      btn.textContent = label;
      armed = setTimeout(() => {
        armed = 0;
        btn.textContent = btn.dataset.t || '';
      }, 3000);
    });
  };
  function prRow(name: string, sub: string, apply: () => void, del?: () => void, upd?: () => void) {
    const a = h('button', { class: 'btn sm', type: 'button', text: 'Aplicar', onclick: apply });
    const r = h('div', { class: 'prrow' }, h('div', { class: 'prn' }, h('b', { text: name }), sub ? h('small', { text: sub }) : null), a);
    if (upd) {
      const u = h('button', { class: 'btn sm ghost', type: 'button', text: 'Actualizar' });
      u.dataset.t = 'Actualizar';
      twoStep(u, '¿Sobrescribir?', upd);
      r.append(u);
    }
    if (del) {
      const d = h('button', { class: 'btn sm ghost', type: 'button', text: 'Borrar' });
      d.dataset.t = 'Borrar';
      twoStep(d, '¿Seguro?', del);
      r.append(d);
    }
    return r;
  }
  function renderPresets() {
    lists.fact.replaceChildren(
      ...FACT.map(([n, s, d]) =>
        prRow(n, s, () => {
          applyData(d, { reset: true });
          toast('Aplicado: ' + n);
        })
      )
    );
    lists.mine.replaceChildren(
      ...(store.presets.length
        ? store.presets.map((p, i) =>
            prRow(
              p.name,
              Object.keys(p.data || {}).length + ' secciones',
              () => {
                applyData(p.data || {}, { reset: true });
                toast('Aplicado: ' + p.name);
              },
              () => {
                store.presets.splice(i, 1);
                persistNow();
                renderPresets();
                toast('Ajuste borrado');
              },
              () => {
                store.presets[i] = { name: p.name, ts: Date.now(), data: getFull() };
                persistNow();
                renderPresets();
                toast('Actualizado: ' + p.name);
              }
            )
          )
        : [h('div', { class: 'empty', text: 'Aún no guardaste ajustes completos.' })])
    );
    const selVal = secSel.value || '__all__';
    if (selVal === '__all__') {
      const allItems: Array<{ k: string; idx: number; p: any }> = [];
      ORDER.forEach((k) => {
        (store.sec[k] || []).forEach((p, idx) => allItems.push({ k, idx, p }));
      });
      allItems.sort((a, b) => (b.p.ts || 0) - (a.p.ts || 0));
      lists.sec.replaceChildren(
        ...(allItems.length
          ? allItems.map(({ k, idx, p }) =>
              prRow(
                p.name,
                SEC[k].n,
                () => {
                  if (S.locks[k]) {
                    toast(SEC[k].n + ' está bloqueado');
                    return;
                  }
                  SEC[k].set(S, p.data);
                  syncAll();
                  commit();
                  persistNow();
                  toast('Aplicado: ' + p.name);
                },
                () => {
                  store.sec[k].splice(idx, 1);
                  persistNow();
                  renderPresets();
                  toast('Ajuste borrado');
                },
                () => {
                  store.sec[k][idx] = { name: p.name, ts: Date.now(), data: SEC[k].get(S) };
                  persistNow();
                  renderPresets();
                  toast('Actualizado: ' + p.name);
                }
              )
            )
          : [h('div', { class: 'empty', text: 'Sin ajustes por sección guardados aún.' })])
      );
    } else {
      const k = selVal;
      const ls = store.sec[k] || [];
      lists.sec.replaceChildren(
        ...(ls.length
          ? ls.map((p, i) =>
              prRow(
                p.name,
                SEC[k].n,
                () => {
                  if (S.locks[k]) {
                    toast(SEC[k].n + ' está bloqueado');
                    return;
                  }
                  SEC[k].set(S, p.data);
                  syncAll();
                  commit();
                  persistNow();
                  toast('Aplicado: ' + p.name);
                },
                () => {
                  ls.splice(i, 1);
                  persistNow();
                  renderPresets();
                  toast('Ajuste borrado');
                },
                () => {
                  ls[i] = { name: p.name, ts: Date.now(), data: SEC[k].get(S) };
                  persistNow();
                  renderPresets();
                  toast('Actualizado: ' + p.name);
                }
              )
            )
          : [h('div', { class: 'empty', text: 'Sin ajustes guardados para esta sección.' })])
      );
    }
  }
  secSel.addEventListener('change', renderPresets);

  /* ---------- construcción de paneles ---------- */
  const main = $('#main')!;
  const dockEl = $('#playerDock') || $('.dock');
  const panes: Record<string, HTMLElement> = {};
  function mkPane(id: string) {
    const p = h('section', { class: 'pane', role: 'tabpanel' });
    p.dataset.id = id;
    p.hidden = true;
    panes[id] = p;
    main.append(p);
    return p;
  }

  /* Música (ÚNICO apartado donde vive el reproductor .dock) */
  {
    const p = mkPane('music');
    if (dockEl) p.append(dockEl);

    countBadge = h('span', { class: 'mini num', text: '0 pistas' });
    const sIn = h('input', {
      type: 'search',
      class: 'field',
      placeholder: 'Buscar canción o artista...',
      'aria-label': 'Buscar en tu música',
    }) as HTMLInputElement;
    const sClr = h('button', {
      type: 'button',
      class: 'sclr',
      'aria-label': 'Limpiar búsqueda',
      text: '×',
      hidden: true,
      onclick: () => {
        sIn.value = '';
        searchQ = '';
        sClr.hidden = true;
        renderList();
      },
    });
    sIn.addEventListener('input', () => {
      searchQ = sIn.value;
      sClr.hidden = !searchQ;
      renderList();
    });
    const searchWrap = h('div', { class: 'sbox' }, sIn, sClr);

    const rep = h('button', {
      class: 'chip',
      type: 'button',
      text: REP[repeat],
      'aria-pressed': String(repeat > 0),
      onclick: () => {
        repeat = (repeat + 1) % 3;
        savedRepeat = repeat;
        rep.textContent = REP[repeat];
        rep.setAttribute('aria-pressed', String(repeat > 0));
        persistNow();
      },
    });
    const shf = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Aleatorio',
      'aria-pressed': String(shuffle),
      onclick: () => {
        shuffle = !shuffle;
        savedShuffle = shuffle;
        shf.setAttribute('aria-pressed', String(shuffle));
        persistNow();
      },
    });
    const sortBtn = h('button', {
      class: 'chip',
      type: 'button',
      text: sortMode === 'recent' ? 'Orden: Recientes' : 'Orden: A–Z',
      'aria-pressed': String(sortMode === 'az'),
      onclick: () => {
        sortMode = sortMode === 'recent' ? 'az' : 'recent';
        savedSortMode = sortMode;
        sortBtn.textContent = sortMode === 'recent' ? 'Orden: Recientes' : 'Orden: A–Z';
        sortBtn.setAttribute('aria-pressed', String(sortMode === 'az'));
        persistNow();
        if (NATIVE) applyNativeSortAndRebuild('sort');
        else {
          PL.sort((a, b) =>
            sortMode === 'az' ? String(a.name).localeCompare(String(b.name), 'es') : (b.dateAdded || 0) - (a.dateAdded || 0)
          );
          renderList();
        }
      },
    });

    const controlsRow = h('div', { class: 'chips' });
    if (NATIVE) {
      hasPerm = !!(window.AndroidBridge?.hasMusicPermission && window.AndroidBridge.hasMusicPermission());
      permBox = h(
        'div',
        { style: 'margin-bottom:8px', hidden: hasPerm },
        h('button', {
          class: 'btn pri',
          type: 'button',
          text: 'Permitir acceso a tu música',
          onclick: () => {
            try {
              window.AndroidBridge?.requestMusicPermission?.();
            } catch (_e) {}
          },
        })
      );
      batBtn = h('button', {
        class: 'chip',
        type: 'button',
        text: '2° plano sin límite',
        onclick: () => {
          try {
            window.AndroidBridge?.openBatterySettings?.();
          } catch (_e) {}
        },
      });
      controlsRow.append(sortBtn, rep, shf, batBtn);
    } else {
      const fileIn = h('input', {
        type: 'file',
        id: 'file',
        accept: 'audio/*,.flac,.wav,.wave,.aif,.aiff,.aifc,.m4a,.alac,.aac,.opus,.ogg,.oga,.mp3,.weba,.webm,.caf',
        multiple: true,
        class: 'vh',
      }) as HTMLInputElement;
      fileIn.addEventListener('change', () => {
        addFiles(fileIn.files);
        fileIn.value = '';
      });
      const add = h('label', { class: 'btn pri', for: 'file', style: 'display:inline-flex;align-items:center' }, 'Añadir música');
      controlsRow.append(fileIn, add, sortBtn, rep, shf);
    }

    const setRangeFill = (el: HTMLInputElement) => {
      const mn = +el.min || 0;
      const mx = +el.max || 1;
      el.style.setProperty('--p', clamp(((+el.value - mn) / (mx - mn || 1)) * 100, 0, 100).toFixed(1) + '%');
    };
    const vol = h('input', {
      type: 'range',
      id: 'vol',
      class: 'rfull',
      min: 0,
      max: 100,
      step: 1,
      value: S.playerVol,
      'aria-label': 'Volumen de monitoreo 32-bit',
    }) as HTMLInputElement;
    setRangeFill(vol);
    vol.addEventListener('input', () => {
      S.playerVol = +vol.value;
      setRangeFill(vol);
      commit();
    });
    vol.addEventListener('change', () => persistNow());
    syncers.push(() => {
      vol.value = String(S.playerVol);
      setRangeFill(vol);
    });
    const c1 = h(
      'div',
      { class: 'card' },
      h('div', { class: 'chead' }, h('h2', { text: 'Tu música' }), countBadge),
      permBox,
      searchWrap,
      controlsRow,
      h('div', { id: 'plist', class: 'plist', style: 'margin-top:8px' }),
      h('div', { class: 'prow', style: 'border:0' }, h('label', { class: 'pl', for: 'vol', text: 'Volumen (32-bit sin pérdida)' }), vol)
    );
    p.append(c1);

    if (!NATIVE) {
      const apkCard = h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'chead' },
          h('h2', { text: 'App Independiente Android (.apk)' }),
          h('span', { class: 'apk-badge', text: 'Master Hi-Res' })
        ),
        h('p', {
          class: 'hint',
          text: 'Se instala como aplicación independiente (com.estudiomaster.hires) con icono de cristal traslúcido, sin actualizar ni borrar tu Estudio EQ anterior.',
        }),
        h(
          'div',
          { class: 'chips' },
          h('a', {
            class: 'btn pri',
            href: '/api/estudio-master-hires-android.zip',
            download: 'Estudio-Master-Hi-Res-Android-GitHub.zip',
            text: 'Descargar proyecto Android (.zip)',
          })
        ),
        h(
          'details',
          { class: 'adv', style: 'margin-top:8px' },
          h('summary', { text: 'Pasos para obtener tu Estudio-Master-Hi-Res.apk sin afectar tu otra app' }),
          h(
            'ol',
            { class: 'apk-steps' },
            h('li', { text: 'Crea un repositorio NUEVO en GitHub (ej. estudio-master-hires) y exporta este proyecto desde el menú superior o sube el ZIP descargado.' }),
            h('li', { text: 'GitHub Actions compilará automáticamente la nueva app independiente en ~3 minutos.' }),
            h('li', { text: 'Entra a Releases en tu repositorio y descarga Estudio-Master-Hi-Res.apk: se instalará aparte junto a tu otra app.' })
          )
        )
      );
      p.append(apkCard);
    }

    /* Puerto Jack 3.5 mm · Salida Hi-Res Directa */
    {
      const jackHead = h('div', { class: 'chead' }, h('h2', { text: 'Puerto Jack 3.5 mm · Hi-Res' }));
      const jackSw = h(
        'button',
        {
          class: 'sw',
          role: 'switch',
          type: 'button',
          'aria-label': 'Activar Modo Directo Hi-Res para puerto Jack 3.5 mm',
          'aria-checked': String(!!S.jack.hiRes),
          onclick: () => {
            S.jack.hiRes = !S.jack.hiRes;
            syncAll();
            persistNow();
            rebuildEngineSampleRate(true);
          },
        },
        h('i')
      );
      jackHead.append(jackSw);

      jackStatusEl = h('p', { class: 'hint num', style: 'color:var(--acc);margin-bottom:8px' });

      const rateOpts: Array<[number, string]> = [
        [0, 'Auto Máx DAC'],
        [48000, '48 kHz'],
        [96000, '96 kHz Hi-Res'],
        [192000, '192 kHz Ultra'],
      ];
      const rateRow = h('div', { class: 'chips', style: 'margin-bottom:8px' });
      const rateBtns = rateOpts.map(([hz, lbl]) =>
        h('button', {
          class: 'chip',
          type: 'button',
          text: lbl,
          'aria-pressed': String((S.jack.rate || 0) === hz),
          onclick: () => {
            if (!S.jack.hiRes) S.jack.hiRes = true;
            S.jack.rate = hz;
            syncAll();
            persistNow();
            rebuildEngineSampleRate(true);
          },
        })
      );
      rateRow.append(...rateBtns);

      const ditherChip = h('button', {
        class: 'chip',
        type: 'button',
        text: 'Dithering Analógico 24-bit TPDF',
        'aria-pressed': String(!!S.jack.dither24),
        onclick: () => {
          S.jack.dither24 = !S.jack.dither24;
          syncAll();
          applyAll(true);
          persistNow();
          toast(
            S.jack.dither24
              ? 'Dithering analógico 24-bit TPDF activo en salida Jack'
              : 'Dithering 24-bit desactivado (Bypass 0% carga)'
          );
        },
      });

      syncers.push(() => {
        jackSw.setAttribute('aria-checked', String(!!S.jack.hiRes));
        rateOpts.forEach(([hz], idx) => {
          rateBtns[idx].setAttribute('aria-pressed', String((S.jack.rate || 0) === hz));
        });
        ditherChip.setAttribute('aria-pressed', String(!!S.jack.dither24));
        paintJackStatus();
      });

      const jackCard = h(
        'div',
        { class: 'card' },
        jackHead,
        jackStatusEl,
        rateRow,
        h('div', { class: 'chips', style: 'margin-bottom:6px' }, ditherChip),
        h('p', {
          class: 'mini',
          text: 'Detecta la conexión física al puerto Jack 3.5 mm o adaptador DAC USB-C, desbloquea el reloj de salida de 96 / 192 kHz sin compresión de agudos y aplica dithering triangular de 24 bits para eliminar cualquier grano digital en pasajes suaves.',
        })
      );
      p.append(jackCard);
    }

    const playCard = card('play', 'Transición Gapless y Reproducción');
    const gaplessChip = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Gapless (0 ms)',
      'aria-pressed': String(!!S.play.gapless),
      onclick: () => {
        S.play.gapless = !S.play.gapless;
        syncAll();
        commit();
        persistNow();
        toast(S.play.gapless ? 'Transición sin pausa (Gapless) activa' : 'Gapless desactivado');
      },
    });
    const pitchChip = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Conservar tono',
      'aria-pressed': String(!!S.play.keepPitch),
      onclick: () => {
        S.play.keepPitch = !S.play.keepPitch;
        syncAll();
        commit();
        persistNow();
      },
    });
    const hz432Chip = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Afinación 432 Hz',
      'aria-pressed': String(!!S.play.hz432),
      onclick: () => {
        S.play.hz432 = !S.play.hz432;
        syncAll();
        commit();
        persistNow();
        toast(S.play.hz432 ? 'Afinación orgánica 432 Hz activa' : 'Afinación original 440 Hz (1.0×)');
      },
    });
    syncers.push(() => {
      gaplessChip.setAttribute('aria-pressed', String(!!S.play.gapless));
      pitchChip.setAttribute('aria-pressed', String(!!S.play.keepPitch));
      hz432Chip.setAttribute('aria-pressed', String(!!S.play.hz432));
    });
    playCard.body.append(
      h('div', { class: 'chips', style: 'margin-bottom:6px' }, gaplessChip, pitchChip, hz432Chip),
      row('play.xfade', 'Fundido cruzado (Crossfade)', { min: 0, max: 12, step: 0.5, fine: 0.5, unit: 's' }),
      row('play.rate', 'Velocidad de reproducción', { min: 0.5, max: 1.5, step: 0.01, fine: 0.01, unit: '×' }),
      h('p', {
        class: 'mini',
        text: 'Doble lector en memoria: enlaza álbumes sin silencio (0 s) o mezcla suavemente en curva igual-potencia. En 1.0× y sin 432 Hz permanece 100% bit-perfect.',
      })
    );

    const io = card('master', 'Mastering · Entrada y salida');
    const autoHeadBtn = h('button', {
      class: 'chip',
      type: 'button',
      text: 'Auto-Headroom inteligente',
      'aria-pressed': String(!!S.master.autoHead),
      onclick: () => {
        S.master.autoHead = !S.master.autoHead;
        syncAll();
        commit();
        persistNow();
        toast(S.master.autoHead ? 'Auto-Headroom activo (evita saturación)' : 'Auto-Headroom desactivado');
      },
    });
    syncers.push(() => autoHeadBtn.setAttribute('aria-pressed', String(!!S.master.autoHead)));
    io.body.append(
      h('div', { class: 'chips', style: 'margin-bottom:6px' }, autoHeadBtn),
      row('master.pre', 'Preamplificador', { min: -12, max: 12, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('master.vol', 'Salida maestra', { min: -12, max: 12, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('master.ceil', 'Techo Brickwall True-Peak', { min: -6.0, max: -0.1, step: 0.1, fine: 0.1, unit: 'dBFS' }),
      h('p', { class: 'mini', text: 'Limitador maestro Brickwall con anticipación de 2.5 ms y filtro subsónico DC a 12 Hz para máxima fidelidad sin distorsión.' })
    );
    p.append(
      playCard.c,
      io.c,
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Motor Mastering Ultra 64-bit' })),
        h('p', {
          class: 'hint',
          text: 'Cascada EQ en doble precisión IEEE-754 (64-bit Float64) con Bypass de Carga Cero en bandas en 0 dB, sobremuestreo 4× anti-aliasing y decodificación lossless (FLAC, WAV, AIFF, ALAC, OPUS).',
        }),
        h('p', {
          class: 'hint',
          text: 'Cada sección tiene su propio espacio limpio sin superponer el reproductor encima de tus bandas o efectos.',
        })
      )
    );
  }

  /* EQ 30 */
  mkPane('eq30').append(
    eqTab({
      key: 'eq30',
      arr: 'eq',
      rk: 'r30',
      qk: 'q30',
      pqk: 'propQ30',
      freqs: BANDS30,
      names: null,
      title: 'EQ de 30 bandas',
      hint: '1/3 de octava ISO, de 25 Hz a 20 kHz. Q Proporcional adapta suavemente la campana según la ganancia como en consolas de mastering.',
    })
  );

  /* Claridad 16 */
  mkPane('cl16').append(
    eqTab({
      key: 'cl16',
      arr: 'cl',
      rk: 'r16',
      qk: 'q16',
      pqk: 'propQ16',
      freqs: BANDS16,
      names: NAMES16,
      title: '16 bandas de claridad',
      hint: 'Bandas musicales de fase limpia: graves firmes, medios sin barro y aire cristalino hasta 16 kHz.',
    })
  );

  /* Instrumentos */
  {
    const p = mkPane('inst');
    p.append(
      h('p', {
        class: 'hint',
        text: 'Ecualización paramétrica dedicada por instrumento. Abre “Frecuencia y Q” para afinar exactamente el armónico deseado.',
      })
    );
    INST.forEach((g) => {
      const { c, body } = card(g.grp, g.name);
      g.items.forEach(([id, nm]) => {
        body.append(
          row('inst.' + id + '.g', nm, { min: -18, max: 18, step: 0.1, fine: 0.1, unit: 'dB' }),
          h(
            'details',
            { class: 'adv' },
            h('summary', { text: 'Frecuencia y Q · ' + nm }),
            row('inst.' + id + '.f', 'Frecuencia', { min: 20, max: 20000, step: 1, fine: 1, unit: 'Hz', log: true }),
            row('inst.' + id + '.q', 'Q', { min: 0.3, max: 12, step: 0.05, fine: 0.05, unit: 'Q' })
          )
        );
      });
      p.append(c);
    });
  }

  /* Efectos */
  let reduc: HTMLElement | null = null;
  let mbReduc: HTMLElement | null = null;
  let deReduc: HTMLElement | null = null;
  let radar: HTMLCanvasElement | null = null;
  {
    const p = mkPane('fx');
    const tone = card('tone', FXN.tone);
    tone.body.append(
      row('fx.tone.bass', 'Graves (repisa)', { min: -24, max: 24, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.tone.bassF', 'Frecuencia de graves', { min: 30, max: 400, step: 1, fine: 1, unit: 'Hz', log: true }),
      row('fx.tone.treb', 'Agudos (repisa)', { min: -24, max: 24, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.tone.trebF', 'Frecuencia de agudos', { min: 2000, max: 16000, step: 10, fine: 10, unit: 'Hz', log: true }),
      row('fx.tone.lc', 'Corte de graves (pasa altos)', { min: 20, max: 500, step: 1, fine: 1, unit: 'Hz', log: true }),
      row('fx.tone.hc', 'Corte de agudos (pasa bajos)', { min: 2000, max: 20000, step: 10, fine: 10, unit: 'Hz', log: true })
    );

    const mbcomp = card('mbcomp', FXN.mbcomp, { on: true });
    mbReduc = h('span', { class: 'mini num', text: 'Graves 0.0 · Medios 0.0 · Agudos 0.0 dB' });
    mbcomp.body.append(
      mbReduc,
      row('fx.mbcomp.lowX', 'Cruce graves / medios', { min: 60, max: 400, step: 1, fine: 1, unit: 'Hz', log: true }),
      row('fx.mbcomp.highX', 'Cruce medios / agudos', { min: 1200, max: 8000, step: 10, fine: 10, unit: 'Hz', log: true }),
      row('fx.mbcomp.lowTh', 'Umbral graves', { min: -60, max: 0, step: 0.5, fine: 0.1, unit: 'dB' }),
      row('fx.mbcomp.midTh', 'Umbral medios', { min: -60, max: 0, step: 0.5, fine: 0.1, unit: 'dB' }),
      row('fx.mbcomp.highTh', 'Umbral agudos', { min: -60, max: 0, step: 0.5, fine: 0.1, unit: 'dB' }),
      row('fx.mbcomp.ratio', 'Proporción multibanda', { min: 1, max: 12, step: 0.1, fine: 0.1, unit: ': 1' }),
      row('fx.mbcomp.lowG', 'Ganancia banda graves', { min: -12, max: 12, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.mbcomp.midG', 'Ganancia banda medios', { min: -12, max: 12, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.mbcomp.highG', 'Ganancia banda agudos', { min: -12, max: 12, step: 0.1, fine: 0.1, unit: 'dB' }),
      h('p', { class: 'mini', text: 'Controla los bombos y subgraves de forma independiente sin apagar la voz ni los platillos.' })
    );

    const deess = card('deess', FXN.deess, { on: true });
    deReduc = h('span', { class: 'mini num', text: 'Atenuación sibilante 0.0 dB' });
    deess.body.append(
      deReduc,
      row('fx.deess.freq', 'Frecuencia vocal (S / Sh)', { min: 3500, max: 11000, step: 50, fine: 10, unit: 'Hz', log: true }),
      row('fx.deess.th', 'Sensibilidad (umbral)', { min: -55, max: 0, step: 0.5, fine: 0.1, unit: 'dB' }),
      row('fx.deess.amt', 'Suavizado dinámico', { min: 1, max: 16, step: 0.2, fine: 0.1, unit: ': 1' }),
      h('p', { class: 'mini', text: 'Domina únicamente los chispazos de las “S” fuertes conservando todo el brillo cuando no hay sibilancia.' })
    );

    const comp = card('comp', FXN.comp, { on: true });
    reduc = h('span', { class: 'mini num', text: 'Reducción 0.0 dB' });
    comp.body.append(
      reduc,
      row('fx.comp.th', 'Umbral', { min: -100, max: 0, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.comp.ratio', 'Proporción', { min: 1, max: 20, step: 0.1, fine: 0.1, unit: ': 1' }),
      row('fx.comp.attack', 'Ataque', { min: 0, max: 1000, step: 1, fine: 1, unit: 'ms' }),
      row('fx.comp.release', 'Liberación', { min: 0, max: 1000, step: 1, fine: 1, unit: 'ms' }),
      row('fx.comp.knee', 'Rodilla', { min: 0, max: 40, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.comp.makeup', 'Ganancia de compensación', { min: 0, max: 24, step: 0.1, fine: 0.1, unit: 'dB' })
    );

    const sat = card('sat', FXN.sat, { on: true });
    const satModes = [
      [0, 'Cinta cálida'],
      [1, 'Válvula Triodo'],
      [2, 'Consola Punch'],
    ] as Array<[number, string]>;
    const satChips = h('div', { class: 'chips', style: 'margin-bottom:6px' });
    const satBtns = satModes.map(([m, lbl]) =>
      h('button', {
        class: 'chip',
        type: 'button',
        text: lbl,
        'aria-pressed': String((S.fx.sat.mode | 0) === m),
        onclick: () => {
          S.fx.sat.mode = m;
          syncAll();
          commit();
          persistNow();
        },
      })
    );
    satChips.append(...satBtns);
    syncers.push(() => {
      satBtns.forEach((b, idx) => b.setAttribute('aria-pressed', String((S.fx.sat.mode | 0) === idx)));
    });
    sat.body.append(
      satChips,
      row('fx.sat.drive', 'Empuje armónico', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.sat.mix', 'Mezcla paralela', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      h('p', { class: 'mini', text: 'Sobremuestreo 4× y curva de 32,768 puntos sin aliasing digital.' })
    );

    const airexc = card('airexc', FXN.airexc, { on: true });
    airexc.body.append(
      row('fx.airexc.freq', 'Banda de aire superior', { min: 5000, max: 15000, step: 100, fine: 20, unit: 'Hz', log: true }),
      row('fx.airexc.drive', 'Síntesis armónica 4×', { min: 0, max: 100, step: 0.5, fine: 0.1, unit: '%' }),
      row('fx.airexc.mix', 'Brillo sedoso (Mezcla)', { min: 0, max: 100, step: 0.5, fine: 0.1, unit: '%' }),
      h('p', { class: 'mini', text: 'Reconstruye armónicos cristalinos en 4× oversampling sin levantar el soplido de fondo como un EQ normal.' })
    );

    const bmono = card('bmono', FXN.bmono, { on: true });
    bmono.body.append(
      row('fx.bmono.freq', 'Corte subgrave elíptico', { min: 35, max: 220, step: 1, fine: 1, unit: 'Hz' }),
      row('fx.bmono.mono', 'Centrado mono en subgraves', { min: 0, max: 100, step: 1, fine: 1, unit: '%' }),
      h('p', { class: 'mini', text: 'Alinea la fase por debajo de la frecuencia elegida para que los dos audífonos o bocinas empujen al unísono con el doble de firmeza.' })
    );

    const xfeed = card('xfeed', FXN.xfeed, { on: true });
    xfeed.body.append(
      row('fx.xfeed.mix', 'Mezcla natural', { min: 0, max: 100, step: 1, fine: 1, unit: '%' }),
      row('fx.xfeed.fc', 'Sombra acústica', { min: 350, max: 1400, step: 10, fine: 10, unit: 'Hz' }),
      h('p', { class: 'mini', text: 'Simula monitores de estudio frente a ti (retardo interaural de 0.28 ms) eliminando la fatiga en audífonos.' })
    );

    const wid = card('wid', FXN.wid, { on: true });
    wid.body.append(
      row('fx.wid.w', 'Ancho Mid/Side', { min: -100, max: 200, step: 1, fine: 1, unit: '%' }),
      h('p', { class: 'mini', text: '0 conserva el estéreo original. Negativo centra a mono; positivo expande la escena.' })
    );

    const rev = card('rev', FXN.rev, { on: true });
    rev.body.append(
      row('fx.rev.mix', 'Mezcla', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.rev.decay', 'Duración', { min: 0.1, max: 10, step: 0.01, fine: 0.01, unit: 's' }),
      row('fx.rev.pre', 'Pre-retardo', { min: 0, max: 500, step: 1, fine: 1, unit: 'ms' }),
      row('fx.rev.damp', 'Absorción de agudos', { min: 0, max: 100, step: 1, fine: 1, unit: '%' }),
      row('fx.rev.size', 'Tamaño de sala', { min: 0, max: 100, step: 1, fine: 1, unit: '%' }),
      h('p', { class: 'mini', text: 'Convolución estéreo HD con reflexiones tempranas discretas y limpieza de graves a 65 Hz.' })
    );

    const dly = card('dly', FXN.dly, { on: true });
    dly.body.append(
      row('fx.dly.time', 'Tiempo', { min: 1, max: 2000, step: 1, fine: 1, unit: 'ms' }),
      row('fx.dly.fb', 'Repeticiones', { min: 0, max: 95, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.dly.mix', 'Mezcla', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.dly.tone', 'Tono de repeticiones', { min: 500, max: 20000, step: 10, fine: 10, unit: 'Hz', log: true })
    );

    const sp = card('sp', FXN.sp, { on: true });
    radar = h('canvas', {
      class: 'radar',
      width: 264,
      height: 264,
      role: 'img',
      'aria-label': 'Posición del sonido alrededor de ti, vista desde arriba',
    }) as HTMLCanvasElement;
    sp.body.append(
      radar,
      row('fx.sp.mix', 'Mezcla 3D', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.sp.az', 'Ángulo (0° al frente)', { min: -180, max: 180, step: 1, fine: 1, unit: '°' }),
      row('fx.sp.el', 'Altura', { min: -90, max: 90, step: 1, fine: 1, unit: '°' }),
      row('fx.sp.dist', 'Distancia', { min: 0.5, max: 10, step: 0.1, fine: 0.1, unit: 'm' }),
      row('fx.sp.rot', 'Giro automático (8D)', { min: -60, max: 60, step: 0.1, fine: 0.1, unit: 'rpm' }),
      h('p', { class: 'mini', text: 'Motor posicional binaural HRTF; ideal con audífonos.' })
    );
    p.append(tone.c, mbcomp.c, deess.c, comp.c, sat.c, airexc.c, bmono.c, xfeed.c, wid.c, rev.c, dly.c, sp.c);
  }

  /* Vibración */
  const VIBK = ['sub', 'glass', 'harm', 'trem', 'vibr', 'hap'];
  function applyKeys(keys: string[], data: Record<string, any>) {
    keys.forEach((k) => {
      if (S.locks[k]) return;
      resetSec(k);
      if (data[k]) SEC[k].set(S, data[k]);
    });
    syncAll();
    commit();
    persistNow();
  }
  {
    const p = mkPane('vib');
    const VP: Array<[string, string, Record<string, any>]> = [
      ['Apagar todo', 'Todo en cero', {}],
      ['Vidrios suaves', 'Vibración leve en ventanas', { sub: { on: true, freq: 55, g: 5, q: 1.2 }, glass: { on: true, freq: 90, g: 3, q: 5 }, harm: { on: true, freq: 100, drive: 15, mix: 10 } }],
      ['Vidrios fuertes', 'Subgraves y resonancia marcados', { sub: { on: true, freq: 48, g: 9, q: 1.4 }, glass: { on: true, freq: 80, g: 6, q: 7 }, harm: { on: true, freq: 110, drive: 30, mix: 22 }, hap: { on: true, thr: 55, dur: 40, gap: 60, shake: 40 } }],
      ['Terremoto', 'Máximo temblor, usar con cuidado', { sub: { on: true, freq: 40, g: 14, q: 1.6 }, glass: { on: true, freq: 70, g: 9, q: 9 }, harm: { on: true, freq: 120, drive: 45, mix: 35 }, trem: { on: true, rate: 7, depth: 25, shape: 0 }, hap: { on: true, thr: 40, dur: 70, gap: 40, shake: 80 } }],
    ];
    p.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Temblor y vibración' })),
        h('p', { class: 'hint', text: 'Graves profundos para hacer vibrar vidrios, puertas y el propio teléfono. Todo empieza apagado y en 0.' }),
        h('p', { class: 'hint', text: 'Precaución: sube el volumen poco a poco. El limitador Brickwall protege la salida contra recortes digitales.' }),
        h(
          'div',
          { class: 'chips' },
          ...VP.map(([n, d, data]) =>
            h('button', {
              class: 'btn',
              type: 'button',
              text: n,
              title: d,
              onclick: () => {
                applyKeys(VIBK, data);
                toast('Aplicado: ' + n);
              },
            })
          )
        )
      )
    );
    const sub = card('sub', FXN.sub, { on: true });
    sub.body.append(
      row('fx.sub.g', 'Ganancia', { min: -12, max: 24, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.sub.freq', 'Frecuencia central', { min: 20, max: 150, step: 0.1, fine: 0.1, unit: 'Hz' }),
      row('fx.sub.q', 'Ancho (Q)', { min: 0.3, max: 12, step: 0.05, fine: 0.05, unit: 'Q' })
    );
    const glass = card('glass', FXN.glass, { on: true });
    glass.body.append(
      row('fx.glass.g', 'Ganancia', { min: 0, max: 24, step: 0.1, fine: 0.1, unit: 'dB' }),
      row('fx.glass.freq', 'Frecuencia de resonancia', { min: 40, max: 250, step: 0.1, fine: 0.1, unit: 'Hz' }),
      row('fx.glass.q', 'Estrechez (Q)', { min: 1, max: 20, step: 0.1, fine: 0.1, unit: 'Q' }),
      h('p', { class: 'mini', text: 'Mueve la resonancia entre 60 y 120 Hz hasta encontrar la frecuencia exacta de la sala.' })
    );
    const harm = card('harm', FXN.harm, { on: true });
    harm.body.append(
      row('fx.harm.freq', 'Corte de graves', { min: 40, max: 250, step: 1, fine: 1, unit: 'Hz' }),
      row('fx.harm.drive', 'Empuje armónico 4×', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.harm.mix', 'Mezcla', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      h('p', { class: 'mini', text: 'Síntesis de armónicos pares en 4× oversampling para percibir subgraves profundos incluso en altavoces compactos.' })
    );
    const trem = card('trem', FXN.trem, { on: true });
    trem.body.append(
      row('fx.trem.rate', 'Velocidad', { min: 0.1, max: 20, step: 0.1, fine: 0.1, unit: 'Hz' }),
      row('fx.trem.depth', 'Profundidad', { min: 0, max: 100, step: 0.1, fine: 0.1, unit: '%' }),
      row('fx.trem.shape', 'Forma de onda', { min: 0, max: 2, step: 1, fine: 1, unit: '' }),
      h('p', { class: 'mini', text: '0 senoidal, 1 triangular, 2 cuadrada.' })
    );
    const vibr = card('vibr', FXN.vibr, { on: true });
    vibr.body.append(
      row('fx.vibr.rate', 'Velocidad', { min: 0.1, max: 12, step: 0.1, fine: 0.1, unit: 'Hz' }),
      row('fx.vibr.depth', 'Profundidad', { min: 0, max: 3, step: 0.01, fine: 0.01, unit: 'ms' })
    );
    const hap = card('hap', FXN.hap, { on: true });
    hap.body.append(
      row('fx.hap.thr', 'Umbral de graves', { min: 0, max: 100, step: 1, fine: 1, unit: '%' }),
      row('fx.hap.dur', 'Duración del pulso', { min: 5, max: 200, step: 1, fine: 1, unit: 'ms' }),
      row('fx.hap.gap', 'Pausa entre pulsos', { min: 20, max: 500, step: 1, fine: 1, unit: 'ms' }),
      row('fx.hap.shake', 'Temblor de pantalla', { min: 0, max: 100, step: 1, fine: 1, unit: '%' }),
      h('p', { class: 'mini', text: 'Sincroniza el motor háptico del teléfono con cada golpe real de subgraves (20–150 Hz).' })
    );
    p.append(sub.c, glass.c, harm.c, trem.c, vibr.c, hap.c);
  }

  let lastVib = 0;
  let warnedVib = false;
  let shakeAmt = 0;
  const hapEls = [$('#viz'), main];
  function hapticTick(now: number) {
    const hp = S.fx.hap;
    const clr = () => {
      shakeAmt = 0;
      hapEls.forEach((e) => {
        if (e) e.style.transform = '';
      });
    };
    if (!hp.on || !ctx || !freqData || audio.paused) {
      if (shakeAmt) clr();
      return;
    }
    const bin = ctx.sampleRate / 2 / freqData.length;
    const a = Math.max(1, Math.floor(20 / bin));
    const b = Math.ceil(150 / bin);
    let m = 0;
    let n = 0;
    for (let k = a; k <= b && k < freqData.length; k++) {
      m += freqData[k];
      n++;
    }
    const lvl = n ? m / n / 255 : 0;
    const thr = hp.thr / 100;
    if (lvl > thr) {
      const amt = (lvl - thr) / (1 - thr + 1e-6);
      if (!document.hidden && hp.shake > 0) {
        shakeAmt = ((amt * hp.shake) / 100) * 6;
        hapEls.forEach((e) => {
          if (e)
            e.style.transform =
              'translate(' + ((Math.random() * 2 - 1) * shakeAmt).toFixed(1) + 'px,' + ((Math.random() * 2 - 1) * shakeAmt).toFixed(1) + 'px)';
        });
      }
      const durMs = Math.round(hp.dur * (0.5 + amt * 0.5));
      if (NATIVE && window.AndroidBridge?.vibrate) {
        if (now - lastVib > hp.gap + hp.dur) {
          lastVib = now;
          try {
            window.AndroidBridge.vibrate(durMs);
          } catch (_e) {}
        }
      } else if (typeof navigator.vibrate === 'function') {
        if (now - lastVib > hp.gap + hp.dur) {
          lastVib = now;
          try {
            navigator.vibrate(durMs);
          } catch (_e) {}
        }
      } else if (!warnedVib) {
        warnedVib = true;
        toast('Este navegador no permite vibrar el teléfono; queda el temblor de pantalla.');
      }
    } else if (shakeAmt) clr();
  }

  /* Géneros actualizados con curvas de referencia mundial */
  {
    const p = mkPane('gen');
    const ip = (pts: Array<[number, number]>, k: number) =>
      Array.from({ length: 30 }, (_, i) => {
        let v = pts[pts.length - 1][1];
        if (i <= pts[0][0]) v = pts[0][1];
        else
          for (let j = 0; j < pts.length - 1; j++) {
            const [a, x] = pts[j];
            const [b, y] = pts[j + 1];
            if (i >= a && i <= b) {
              v = x + ((y - x) * (i - a)) / (b - a);
              break;
            }
          }
        return clamp(r1(v * k), -24, 24);
      });
    type StyleFn = (k: number, g: (v: number) => number, m: (v: number) => number, w: (v: number) => number) => Record<string, any>;
    const GEN: Array<{ name: string; desc: string; list: Array<[string, string, StyleFn]> }> = [
      {
        name: 'Hi-Fi & Audiófilo',
        desc: 'Curvas de referencia mundial para escucha crítica, FLAC/WAV, jazz y música acústica.',
        list: [
          ['Harman Target Studio', 'Equilibrio mundial de referencia + Crossfeed natural', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 3.2], [4, 3.5], [8, 1.2], [12, -0.8], [16, 0.2], [21, 2.4], [25, 2.0], [29, 1.4]], k) }, xfeed: { on: true, mix: m(25), fc: 700 }, master: { autoHead: true, ceil: -0.2 }, voice: { vPres: { g: g(1) } } })],
          ['Jazz & Sala Acústica', 'Contrabajo orgánico, válvula cálida y escena íntima', (k, g, m, w) => ({ eq30: { eq: ip([[0, 1], [4, 2.2], [9, 1.4], [14, -0.5], [20, 1.5], [26, 2.5], [29, 2.2]], k) }, sat: { on: true, drive: m(12), mix: m(14), mode: 1 }, rev: { on: true, mix: m(12), decay: 1.7, size: 48, damp: 42, pre: 14 }, wid: { on: true, w: w(18) }, bass: { bLow: { g: g(1.5) } } })],
          ['Orquesta / Clásica HD', 'Rango dinámico puro sin compresión y gran palco estéreo', (k, _g, m, w) => ({ eq30: { eq: ip([[0, 1.8], [5, 2.0], [12, 0], [19, 1.0], [25, 2.2], [29, 2.8]], k) }, wid: { on: true, w: w(28) }, rev: { on: true, mix: m(15), decay: 2.6, size: 78, damp: 35, pre: 22 }, master: { autoHead: true, ceil: -0.1 } })],
          ['Voz & Podcast Master', 'Inteligibilidad cristalina sin sibilancia ni retumbo', (k, g, _m, _w) => ({ eq30: { eq: ip([[0, -4], [4, -1.5], [9, 1.2], [13, -1.2], [19, 2.8], [23, 2.2], [26, -1], [29, 1]], k) }, tone: { lc: 55 }, voice: { vWarm: { g: g(1.5) }, vPres: { g: g(3) }, vSib: { g: g(-2.5) } }, comp: { on: true, th: -20, ratio: 3, attack: 8, release: 140, knee: 6, makeup: g(2.5) } })],
        ],
      },
      {
        name: 'Electrónica',
        desc: 'Subgraves limpios, medios despejados y brillo abierto para clubes y festivales.',
        list: [
          ['EDM / Festival', 'Bombo y bajos grandes, agudos con chispa', (k, g, m, w) => ({ eq30: { eq: ip([[0, 5], [4, 6], [8, 2], [11, -2], [14, -2.5], [18, -0.5], [22, 1.5], [25, 3], [29, 4]], k) }, tone: { bass: g(2), bassF: 70 }, sub: { on: true, freq: 50, g: g(4), q: 1.2 }, sat: { on: true, drive: m(15), mix: m(12), mode: 2 }, wid: { on: true, w: w(35) }, comp: { on: true, th: -16, ratio: 3, attack: 10, release: 120, knee: 4, makeup: g(2) } })],
          ['House / Deep', 'Groove cálido de cinta con sala suave', (k, g, m, w) => ({ eq30: { eq: ip([[0, 2], [4, 4], [8, 2], [12, -1], [16, 0], [22, 1.5], [26, 3], [29, 3]], k) }, sat: { on: true, drive: m(12), mix: m(12), mode: 0 }, rev: { on: true, mix: m(12), decay: 1.8, size: 55, damp: 40, pre: 12 }, comp: { on: true, th: -18, ratio: 2.5, attack: 15, release: 140, knee: 6, makeup: g(1.5) }, wid: { on: true, w: w(25) } })],
          ['Techno Peak-Time', 'Golpe seco, hi-hats brillantes y eco oscuro', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 3], [5, 5], [9, 0], [13, -2], [18, 1], [23, 3], [27, 2], [29, 2]], k) }, sat: { on: true, drive: m(25), mix: m(20), mode: 2 }, dly: { on: true, time: 375, fb: 25, mix: m(10), tone: 6000 }, comp: { on: true, th: -14, ratio: 4, attack: 6, release: 90, knee: 2, makeup: g(2) } })],
          ['Dubstep / Phonk Bass', 'Subgraves extremos con armónicos 4×', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 8], [4, 9], [7, 3], [11, -3], [15, -2], [22, 2], [27, 3], [29, 3]], k) }, sub: { on: true, freq: 45, g: g(7), q: 1.3 }, glass: { on: true, freq: 85, g: g(4), q: 6 }, harm: { on: true, freq: 110, drive: m(35), mix: m(25) }, comp: { on: true, th: -12, ratio: 5, attack: 4, release: 80, knee: 2, makeup: g(3) } })],
        ],
      },
      {
        name: 'Rock',
        desc: 'Guitarras con presencia, caja con chasquido y bajos firmes.',
        list: [
          ['Rock clásico', 'Equilibrado, con guitarra y válvula al frente', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 0], [3, 2], [7, 2.5], [11, -1], [14, -1], [18, 1], [21, 2.5], [25, 2], [29, 1]], k) }, drums: { kick: { g: g(1.5) }, snareC: { g: g(1.5) } }, guitar: { gPres: { g: g(2) } }, sat: { on: true, drive: m(10), mix: m(12), mode: 1 }, comp: { on: true, th: -20, ratio: 2.5, attack: 20, release: 200, knee: 6, makeup: g(2) } })],
          ['Hard rock / Metal', 'Medios recortados, ataque de consola y pegada', (k, g, m, _w) => ({ eq30: { eq: ip([[0, -3], [4, 3], [8, 1], [12, -3.5], [15, -2], [20, 2.5], [23, 4], [27, 3], [29, 2]], k) }, sat: { on: true, drive: m(25), mix: m(15), mode: 2 }, guitar: { gBody: { g: g(1) }, gPres: { g: g(3) } }, drums: { kick: { g: g(3) }, snareC: { g: g(2) }, hat: { g: g(1) } }, comp: { on: true, th: -16, ratio: 4, attack: 8, release: 120, knee: 3, makeup: g(2) } })],
          ['Indie / Alternativo', 'Aire, sala corta y estéreo abierto', (k, _g, m, w) => ({ eq30: { eq: ip([[0, 0], [2, 1], [6, 1.5], [12, -0.5], [19, 1.5], [24, 1.5], [28, 2], [29, 2]], k) }, rev: { on: true, mix: m(14), decay: 1.6, size: 55, damp: 45, pre: 15 }, wid: { on: true, w: w(20) } })],
          ['Acústico / Balada', 'Cuerpo de guitarra y voz cálida', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 0], [3, 1], [9, 1.5], [14, 0], [20, 1], [26, 2], [29, 2]], k) }, guitar: { gAc: { g: g(2) } }, voice: { vWarm: { g: g(1) }, vPres: { g: g(1.5) } }, rev: { on: true, mix: m(10), decay: 1.4, size: 45, damp: 50, pre: 10 } })],
        ],
      },
      {
        name: 'Reggaetón & Urbano',
        desc: 'Bombo profundo, 808 definidos y voz clara por encima.',
        list: [
          ['Perreo clásico', 'Sub y bombo, voz al frente', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 6], [3, 8], [6, 3], [10, -1.5], [14, -2.5], [19, 0.5], [22, 2.5], [26, 3], [29, 3]], k) }, sub: { on: true, freq: 48, g: g(6), q: 1.4 }, glass: { on: true, freq: 80, g: g(3.5), q: 5 }, drums: { kick: { g: g(3) } }, voice: { vPres: { g: g(2) }, vSib: { g: g(-1.5) } }, comp: { on: true, th: -14, ratio: 4, attack: 6, release: 100, knee: 3, makeup: g(2) }, sat: { on: true, drive: m(12), mix: m(12), mode: 2 } })],
          ['Trap / 808 Moderno', '808 largos, hi-hats nítidos y voz con aire', (k, g, m, w) => ({ eq30: { eq: ip([[0, 7], [3, 9], [7, 2], [11, -2], [15, -2], [21, 1.5], [26, 3], [29, 3]], k) }, sub: { on: true, freq: 42, g: g(8), q: 1.5 }, drums: { hat: { g: g(2) } }, voice: { vAir: { g: g(2) } }, dly: { on: true, time: 333, fb: 20, mix: m(8), tone: 7000 }, wid: { on: true, w: w(25) }, comp: { on: true, th: -14, ratio: 4, attack: 6, release: 100, knee: 3, makeup: g(2) } })],
          ['Dembow de club', 'Bombo y caja con pegada', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 4], [4, 6], [8, 2], [12, -1.5], [18, 1], [23, 3], [27, 3], [29, 2]], k) }, sub: { on: true, freq: 52, g: g(5), q: 1.2 }, drums: { kick: { g: g(3) }, snareC: { g: g(2.5) } }, harm: { on: true, freq: 110, drive: m(20), mix: m(15) }, comp: { on: true, th: -14, ratio: 4, attack: 6, release: 100, knee: 3, makeup: g(2) } })],
          ['Urbano suave / R&B', 'Voz cálida de tubo y sala corta', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 2], [2, 3], [6, 2], [12, -1], [18, 1.5], [24, 2], [29, 2]], k) }, voice: { vWarm: { g: g(2) }, vPres: { g: g(2) } }, sat: { on: true, drive: m(10), mix: m(10), mode: 1 }, rev: { on: true, mix: m(10), decay: 1.5, size: 50, damp: 50, pre: 12 }, sub: { on: true, freq: 55, g: g(3), q: 1.2 } })],
        ],
      },
      {
        name: 'K-pop & Pop',
        desc: 'Voces brillantes y nítidas, graves ajustados y estéreo amplio.',
        list: [
          ['K-pop brillante', 'Voz con aire, agudos pulidos', (k, g, m, w) => ({ eq30: { eq: ip([[0, 1], [4, 2.5], [8, 1], [12, -1.5], [16, 0.5], [20, 2], [23, 3], [26, 3.5], [29, 3]], k) }, voice: { vPres: { g: g(3) }, vAir: { g: g(2.5) }, vSib: { g: g(-1.5) } }, comp: { on: true, th: -18, ratio: 3, attack: 10, release: 130, knee: 5, makeup: g(2) }, wid: { on: true, w: w(40) }, rev: { on: true, mix: m(10), decay: 1.5, size: 50, damp: 45, pre: 10 } })],
          ['Dance-pop', 'Energía, bajo firme y estéreo grande', (k, g, m, w) => ({ eq30: { eq: ip([[0, 2], [3, 4], [6, 3], [12, -1], [17, 0], [22, 2.5], [27, 3.5], [29, 3]], k) }, tone: { bass: g(3) }, comp: { on: true, th: -15, ratio: 4, attack: 8, release: 100, knee: 3, makeup: g(2.5) }, wid: { on: true, w: w(45) }, sat: { on: true, drive: m(8), mix: m(8), mode: 0 } })],
          ['Balada coreana', 'Voz cercana con sala amplia HD', (k, g, m, _w) => ({ eq30: { eq: ip([[0, 0], [3, 1], [8, 1], [14, -1], [20, 1.5], [26, 2.5], [29, 2.5]], k) }, voice: { vWarm: { g: g(1.5) }, vPres: { g: g(2) }, vAir: { g: g(2) } }, rev: { on: true, mix: m(18), decay: 2.4, size: 65, damp: 40, pre: 20 } })],
          ['Hip hop coreano', 'Graves pesados y voz presente', (k, g, _m, _w) => ({ eq30: { eq: ip([[0, 5], [4, 6], [8, 1], [10, -1.5], [16, 0], [20, 2], [26, 2], [29, 2]], k) }, sub: { on: true, freq: 50, g: g(4), q: 1.3 }, voice: { vPres: { g: g(2.5) } }, drums: { hat: { g: g(1.5) } }, comp: { on: true, th: -15, ratio: 3.5, attack: 8, release: 110, knee: 3, makeup: g(2) } })],
        ],
      },
    ];
    let gSel = 0;
    let gk = 100;
    const gChips = h('div', { class: 'chips' });
    const gDesc = h('p', { class: 'hint' });
    const gList = h('div');
    const gr = h('input', {
      type: 'range',
      id: 'gk',
      class: 'rfull',
      min: 0,
      max: 150,
      step: 1,
      value: 100,
      'aria-label': 'Intensidad del género',
    }) as HTMLInputElement;
    gr.style.setProperty('--p', '66.7%');
    const gv = h('span', { class: 'num', text: '100%' });
    gr.addEventListener('input', () => {
      gk = +gr.value;
      gv.textContent = gk + '%';
      gr.style.setProperty('--p', clamp((gk / 150) * 100, 0, 100).toFixed(1) + '%');
    });
    function gRender() {
      gChips.replaceChildren(
        ...GEN.map((g, i) =>
          h('button', {
            class: 'chip',
            type: 'button',
            text: g.name,
            'aria-pressed': String(i === gSel),
            onclick: () => {
              gSel = i;
              gRender();
            },
          })
        )
      );
      const g = GEN[gSel];
      gDesc.textContent = g.desc;
      gList.replaceChildren(
        ...g.list.map(([n, d, fn]) =>
          prRow(n, d, () => {
            const k = gk / 100;
            const gg = (v: number) => r1(v * k);
            const m = (v: number) => clamp(r1(v * k), 0, 100);
            const w = (v: number) => Math.round(v * k);
            applyData(fn(k, gg, m, w), { reset: true });
            toast(g.name + ' · ' + n + ' al ' + gk + '%');
          })
        )
      );
    }
    p.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Género musical' })),
        gChips,
        gDesc,
        h('div', { class: 'prow', style: 'border:0' }, h('div', { class: 'ptop' }, h('label', { class: 'pl', for: 'gk', text: 'Intensidad' }), gv), gr)
      ),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Estilos de referencia' })),
        gList,
        h('p', {
          class: 'mini',
          text: 'Aplicar ajusta todo el estudio respetando las secciones con candado. Luego puedes personalizar en EQ 30, Claridad 16 o Efectos.',
        })
      )
    );
    gRender();
  }

  function drawRadar() {
    if (!radar || document.hidden) return;
    const g = radar.getContext('2d')!;
    const w = radar.width;
    const c = w / 2;
    g.clearRect(0, 0, w, w);
    g.strokeStyle = 'rgba(170,167,192,.35)';
    g.lineWidth = 2;
    [0.33, 0.66, 0.98].forEach((r) => {
      g.beginPath();
      g.arc(c, c, c * r, 0, 7);
      g.stroke();
    });
    g.beginPath();
    g.moveTo(c, 4);
    g.lineTo(c, w - 4);
    g.moveTo(4, c);
    g.lineTo(w - 4, c);
    g.stroke();
    g.fillStyle = fgC;
    g.beginPath();
    g.arc(c, c, 8, 0, 7);
    g.fill();
    const sp = S.fx.sp;
    const a = (spAz * Math.PI) / 180;
    const r = clamp(sp.dist / 10, 0.05, 1) * c * 0.9;
    g.fillStyle = accC;
    g.globalAlpha = sp.on ? 1 : 0.4;
    g.beginPath();
    g.arc(c + Math.sin(a) * r, c - Math.cos(a) * r, 12, 0, 7);
    g.fill();
    g.globalAlpha = 1;
  }

  /* Presets */
  {
    const nameIn = h('input', {
      class: 'field',
      id: 'pname',
      placeholder: 'Nombre del ajuste (opcional)',
      'aria-label': 'Nombre del ajuste',
      maxlength: 40,
    }) as HTMLInputElement;
    pre.dataset.id = 'pre';
    pre.hidden = true;
    pre.setAttribute('role', 'tabpanel');
    panes.pre = pre;
    main.append(pre);
    pre.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Guardar todo' })),
        h('p', { class: 'hint', text: 'Guarda todas las secciones con un toque. El último estado también se recuerda solo al volver.' }),
        nameIn,
        h(
          'div',
          { class: 'chips', style: 'margin-top:8px' },
          h('button', {
            class: 'btn pri',
            type: 'button',
            text: 'Guardar todo',
            onclick: () => {
              saveAllPreset(nameIn.value);
              nameIn.value = '';
            },
          })
        )
      ),
      h('div', { class: 'card' }, h('div', { class: 'chead' }, h('h2', { text: 'Curvas de referencia' })), lists.fact),
      h('div', { class: 'card' }, h('div', { class: 'chead' }, h('h2', { text: 'Mis ajustes' })), lists.mine),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Por sección' })),
        h('p', { class: 'hint', text: 'Guarda y recupera una sola sección, por ejemplo solo el compresor o el crossfeed.' }),
        secSel,
        h('div', { style: 'margin-top:6px' }, lists.sec)
      )
    );
    const lk = h('div', { class: 'chips' });
    ORDER.forEach((k) => {
      const b = h('button', {
        class: 'ib',
        type: 'button',
        onclick: () => {
          S.locks[k] = !S.locks[k];
          if (!S.locks[k]) delete S.locks[k];
          syncAll();
          persistNow();
        },
      });
      syncers.push(() => {
        const l = !!S.locks[k];
        b.setAttribute('aria-pressed', String(l));
        b.innerHTML = (l ? ICON_LOCK : ICON_OPEN) + '<span></span>';
        if (b.lastChild) b.lastChild.textContent = SEC[k].n;
      });
      lk.append(b);
    });
    pre.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Bloqueos' })),
        h('p', { class: 'hint', text: 'Una sección bloqueada no cambia al aplicar un preset, al restablecer ni al editarla.' }),
        lk,
        h(
          'div',
          { class: 'chips', style: 'margin-top:8px' },
          h('button', {
            class: 'btn',
            type: 'button',
            text: 'Desbloquear todo',
            onclick: () => {
              S.locks = {};
              syncAll();
              persistNow();
            },
          })
        )
      )
    );
    const out = h('textarea', { class: 'field', id: 'exp', readonly: true, 'aria-label': 'Datos para respaldo' }) as HTMLTextAreaElement;
    const inp = h('textarea', { class: 'field', id: 'imp', 'aria-label': 'Pegar datos para importar', placeholder: 'Pega aquí un respaldo para importarlo' }) as HTMLTextAreaElement;
    const copy = h('button', {
      class: 'btn',
      type: 'button',
      text: 'Copiar',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(out.value);
          toast('Copiado');
        } catch (_e) {
          out.focus();
          out.select();
          toast('Selecciona y copia el texto');
        }
      },
    });
    pre.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'chead' }, h('h2', { text: 'Respaldo y web' })),
        h('p', { class: 'hint', text: 'Copia tus ajustes para guardarlos o llevarlos a otro dispositivo.' }),
        h(
          'div',
          { class: 'chips' },
          h('button', {
            class: 'btn',
            type: 'button',
            text: 'Exportar',
            onclick: () => {
              out.value = JSON.stringify({ app: 'estudio-eq', v: 2, presets: store.presets, sec: store.sec, current: getFull() }, null, 1);
            },
          }),
          copy
        ),
        out,
        h('div', { style: 'height:8px' }),
        inp,
        h(
          'div',
          { class: 'chips', style: 'margin-top:8px' },
          h('button', {
            class: 'btn',
            type: 'button',
            text: 'Importar',
            onclick: () => {
              try {
                const o = JSON.parse(inp.value);
                let n = 0;
                if (Array.isArray(o.presets))
                  o.presets.forEach((p: any) => {
                    if (p && p.name && p.data) {
                      store.presets.push({ name: String(p.name).slice(0, 40), ts: p.ts || Date.now(), data: p.data });
                      n++;
                    }
                  });
                if (o.sec && typeof o.sec === 'object')
                  for (const k in o.sec)
                    if (SEC[k] && Array.isArray(o.sec[k]))
                      o.sec[k].forEach((p: any) => {
                        if (p && p.name && p.data) {
                          (store.sec[k] || (store.sec[k] = [])).push(p);
                          n++;
                        }
                      });
                if (!n && o.current) {
                  store.presets.push({ name: 'Importado ' + stamp(), ts: Date.now(), data: o.current });
                  n = 1;
                }
                if (!n) {
                  toast('No encontré ajustes en ese texto');
                  return;
                }
                persistNow();
                renderPresets();
                toast(n + ' ajuste' + (n > 1 ? 's' : '') + ' importado' + (n > 1 ? 's' : ''));
              } catch (_e) {
                toast('El texto no es un respaldo válido');
              }
            },
          })
        )
      )
    );
  }

  /* ---------- pestañas, cabecera y dock ---------- */
  const TAB_ICONS: Record<string, string> = {
    music: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
    eq30: '<svg viewBox="0 0 24 24"><path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="9" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="19" cy="8" r="2"/></svg>',
    cl16: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" fill-opacity=".35"/></svg>',
    inst: '<svg viewBox="0 0 24 24"><path d="M9 3v8a3 3 0 0 0 6 0V3M12 14v7M8 21h8"/></svg>',
    fx: '<svg viewBox="0 0 24 24"><path d="M3 7c4 0 6 10 10 10h7M17 14l3 3-3 3M3 17c4 0 6-10 10-10h7M17 4l3 3-3 3"/></svg>',
    vib: '<svg viewBox="0 0 24 24"><path d="M2 12h3l2.5-6 4 12 3.5-9 2.5 3H22"/></svg>',
    gen: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.8"/><path d="M12 6.2a5.8 5.8 0 0 1 5.8 5.8"/></svg>',
    pre: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/><circle cx="6" cy="18" r="1.4"/><circle cx="12" cy="18" r="1.4"/><circle cx="18" cy="18" r="1.4"/></svg>',
  };

  const TABS: Array<[string, string]> = [
    ['music', 'Música'],
    ['eq30', 'EQ 30'],
    ['cl16', 'Claridad 16'],
    ['inst', 'Instrumentos'],
    ['fx', 'Efectos'],
    ['vib', 'Vibración'],
    ['gen', 'Géneros'],
    ['pre', 'Presets'],
  ];
  const tabBar = $('#tabs')!;
  const tabBtns = TABS.map(([id, n]) => {
    const ico = h('span', { class: 'tab-ico', 'aria-hidden': 'true' });
    ico.innerHTML = TAB_ICONS[id] || '';
    const lbl = h('span', { class: 'tab-lbl', text: n });
    const b = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: () => showTab(id) }, ico, lbl);
    b.dataset.id = id;
    tabBar.append(b);
    return b;
  });
  let curTab = 'music';
  function showTab(id: string) {
    curTab = id;
    document.body.dataset.tab = id;
    if (dockEl) (dockEl as HTMLElement).hidden = id !== 'music';
    tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === id)));
    for (const k in panes) panes[k].hidden = k !== id;
    const cs = getComputedStyle(document.body);
    accC = cs.getPropertyValue('--acc').trim() || accC;
    fgC = cs.getPropertyValue('--fg').trim() || fgC;
    numFont = cs.getPropertyValue('--f-num').trim() || numFont;
    syncVizSize();
    vizDirty = true;
    main.scrollTop = 0;
    requestAnimationFrame(() => stripScrollSyncers.forEach((fn) => fn()));
    const t = tabBtns.find((b) => b.dataset.id === id);
    if (t) t.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    if (NATIVE && window.AndroidBridge?.setWindowColors) {
      try {
        if (id === 'eq30') window.AndroidBridge.setWindowColors('#030613', '#06091A');
        else window.AndroidBridge.setWindowColors('#03020A', '#060412');
      } catch (_e) {}
    }
  }

  const byp = $('#bypass')!;
  function paintBypass() {
    byp.setAttribute('aria-checked', String(!S.bypass));
    byp.setAttribute('aria-label', S.bypass ? 'Procesado desactivado, audio original' : 'Procesado de audio activo');
  }
  byp.addEventListener('click', () => {
    S.bypass = !S.bypass;
    paintBypass();
    commit();
    persistNow();
    toast(S.bypass ? 'Audio original, sin procesar' : 'Procesado activo');
  });
  $('#saveAll')!.addEventListener('click', () => saveAllPreset(''));
  {
    const b = $('#resetAll')!;
    b.dataset.t = b.textContent || 'Cero';
    let a: any = 0;
    b.addEventListener('click', () => {
      if (a) {
        clearTimeout(a);
        a = 0;
        b.textContent = b.dataset.t || 'Cero';
        ORDER.forEach((k) => {
          if (!S.locks[k]) resetSec(k);
        });
        S.bypass = false;
        syncAll();
        commit();
        persistNow();
        toast('Todo en cero (menos lo bloqueado)');
        return;
      }
      b.textContent = '¿Seguro?';
      a = setTimeout(() => {
        a = 0;
        b.textContent = b.dataset.t || 'Cero';
      }, 3000);
    });
  }

  const seek = $<HTMLInputElement>('#seek')!;
  const updSeekPct = () => {
    const mx = +seek.max || 1;
    seek.style.setProperty('--p', clamp(((+seek.value || 0) / mx) * 100, 0, 100).toFixed(1) + '%');
  };
  updSeekPct();
  const dTimeEl = $('#dTime');
  let lastTimeSec = -1;
  seek.addEventListener('pointerdown', () => {
    seeking = true;
  });
  ['pointerup', 'pointercancel', 'change'].forEach((ev) =>
    seek.addEventListener(ev, () => {
      seeking = false;
      syncMediaSession(true);
    })
  );
  seek.addEventListener('input', () => {
    audio.currentTime = +seek.value;
    updSeekPct();
    if (dTimeEl) dTimeEl.textContent = mmss(audio.currentTime) + ' / ' + mmss(audio.duration || 0);
  });

  function checkAutoCrossfade(el: HTMLAudioElement) {
    if (el !== audio || rebuildingCtx || !userWantsPlaying || el.paused || seeking || xfadeActive) return;
    maybePreloadStandby();
    const xf = S.play.xfade || 0;
    if (xf <= 0 || repeat === 2) return;
    const dur = el.duration;
    if (!dur || !isFinite(dur) || dur < Math.max(5, xf * 1.6)) return;
    const rem = dur - el.currentTime;
    if (rem <= xf && rem > 0.08) {
      const nx = peekNextAutoIndex();
      if (nx >= 0 && nx !== cur) {
        triggerDeckHandoff(nx, xf);
      }
    }
  }

  function bindDeckEvents(el: HTMLAudioElement) {
    el.addEventListener('play', () => {
      if (el !== audio || rebuildingCtx) return;
      userWantsPlaying = true;
      clearTimeout(resumeT);
      const ic = $('#playIcon');
      if (ic) ic.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
      $('#bPlay')!.setAttribute('aria-label', 'Pausar');
      updateEngineSpecUi();
      syncMediaSession(true);
    });
    el.addEventListener('pause', () => {
      if (el !== audio || rebuildingCtx) return;
      if (userWantsPlaying && !el.ended) {
        if (inPhoneCall()) {
          userWantsPlaying = false;
        } else {
          clearTimeout(resumeT);
          resumeT = setTimeout(() => {
            if (el !== audio || rebuildingCtx || !userWantsPlaying || !el.paused || el.ended || inPhoneCall()) return;
            if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
            el.play().catch(() => {});
          }, 55);
          return;
        }
      }
      const ic = $('#playIcon');
      if (ic) ic.innerHTML = '<path d="M8 5v14l11-7z"/>';
      $('#bPlay')!.setAttribute('aria-label', 'Reproducir');
      syncMediaSession(true);
    });
    el.addEventListener('loadedmetadata', () => {
      if (el !== audio) return;
      const dur = el.duration || 0;
      seek.max = String(dur || 1);
      if (PL[cur] && dur > 0) {
        PL[cur].duration = Math.round(dur);
        if (PL[cur].rawFile && !PL[cur].kbps) {
          PL[cur].kbps = Math.round((PL[cur].rawFile!.size * 8) / (dur * 1000));
        }
        renderList();
      }
      updateEngineSpecUi();
      updSeekPct();
      syncMediaSession(true);
    });
    el.addEventListener('timeupdate', () => {
      if (el !== audio) return;
      if (!seeking) {
        seek.value = String(el.currentTime);
        updSeekPct();
      }
      const sec = el.currentTime | 0;
      if (sec !== lastTimeSec) {
        lastTimeSec = sec;
        if (dTimeEl) dTimeEl.textContent = mmss(sec) + ' / ' + mmss(el.duration || 0);
      }
      checkAutoCrossfade(el);
    });
    el.addEventListener('ended', () => {
      if (el !== audio || rebuildingCtx) return;
      if (repeat === 2) {
        el.currentTime = 0;
        playNow();
      } else nextTrack(true);
    });
    el.addEventListener('error', async () => {
      if (el !== audio || rebuildingCtx) return;
      if (el.src) {
        const t = PL[cur];
        if (t && t.rawFile && !t.decodedFallback) {
          const ok = await tryDecodeFallback(t);
          if (ok) return;
        }
        userWantsPlaying = false;
        toast('Formato no compatible con este dispositivo');
      }
    });
  }

  function rebuildEngineSampleRate(announce = false) {
    const desired = computeDesiredSampleRate();
    if (ctx) {
      const effectiveTarget = desired || jackHw.nativeRate || 48000;
      if (desired === lastTargetRate && Math.abs(ctx.sampleRate - effectiveTarget) < 100) {
        applyAll(true);
        updateEngineSpecUi();
        paintJackStatus();
        return;
      }
    }
    const oldCtx = ctx;
    const oldA = deckA;
    const oldB = deckB;
    const curSrc = audio ? audio.src : '';
    const curPos = audio ? audio.currentTime || 0 : 0;
    const shouldResume = !!(userWantsPlaying && curSrc);

    rebuildingCtx = true;
    clearTimeout(resumeT);
    clearTimeout(xfadeTimer);
    clearTimeout(irT);
    xfadeActive = false;
    preloadedIdx = -1;

    try {
      N.tLfo?.stop?.();
    } catch (_e) {}
    try {
      N.vLfo?.stop?.();
    } catch (_e) {}

    for (const k in P_CACHE) delete P_CACHE[k];
    (Object.keys(FX_CONN) as Array<keyof typeof FX_CONN>).forEach((k) => {
      FX_CONN[k] = false;
    });
    for (const k in N) delete N[k];
    workletReady = false;
    eq64Ready = false;
    ditherReady = false;
    irKey = '';
    satSig = '';
    airDriveSig = -1;
    harmDrive = -1;
    ceilSig = -999;
    eq64Sig = '';
    lastPanX = NaN;
    lastPanY = NaN;
    lastPanZ = NaN;
    freqData = null;
    vizDirty = true;

    build(desired, bindDeckEvents);

    try {
      if (oldA) {
        oldA.pause();
        oldA.removeAttribute('src');
        oldA.load();
      }
      if (oldB) {
        oldB.pause();
        oldB.removeAttribute('src');
        oldB.load();
      }
    } catch (_e) {}
    if (oldCtx) {
      oldCtx.close().catch(() => {});
    }

    applyAll(true);

    if (curSrc && audio) {
      audio.src = curSrc;
      const restorePos = () => {
        if (curPos > 0) {
          try {
            audio.currentTime = curPos;
          } catch (_e) {}
        }
      };
      if (audio.readyState >= 1) restorePos();
      else audio.addEventListener('loadedmetadata', restorePos, { once: true });
    }

    rebuildingCtx = false;
    updateEngineSpecUi();
    paintJackStatus();

    if (shouldResume && audio) {
      playNow();
    }

    if (announce && ctx) {
      const actualKhz = +(ctx.sampleRate / 1000).toFixed(1);
      if (!S.jack.hiRes) {
        toast('Modo Hi-Res Jack desactivado · Reloj ' + actualKhz + ' kHz');
      } else if (desired > 0 && ctx.sampleRate + 500 < desired) {
        toast('Máximo admitido por este DAC: ' + actualKhz + ' kHz');
      } else {
        toast('Salida Hi-Res activa · Reloj DAC ' + actualKhz + ' kHz');
      }
    }
  }

  window.__onNativeJack = (jackJson: unknown, reason?: string) => {
    const prevConnected = jackHw.jackConnected;
    const parsed = parseNativeJackJson(jackJson);
    if (!parsed) return;
    jackHw = parsed;
    if (S.jack.hiRes && S.jack.rate === 0 && prevConnected !== parsed.jackConnected) {
      rebuildEngineSampleRate(false);
      if (parsed.jackConnected && ctx && reason === 'plug') {
        toast(
          parsed.deviceName +
            ' detectado · Salida Hi-Res ' +
            +(ctx.sampleRate / 1000).toFixed(1) +
            ' kHz / ' +
            parsed.bitDepth +
            '-bit'
        );
      }
    } else {
      applyAll(true);
      updateEngineSpecUi();
      paintJackStatus();
    }
  };

  if (!NATIVE && typeof navigator !== 'undefined' && navigator.mediaDevices) {
    const probeWebAudioOutputs = async () => {
      try {
        if (!navigator.mediaDevices.enumerateDevices) return;
        const devs = await navigator.mediaDevices.enumerateDevices();
        const outs = devs.filter((d) => d.kind === 'audiooutput');
        const wired = outs.find((d) => /headphone|headset|wired|jack|line|usb|external|audifono|auricular/i.test(d.label || ''));
        if (wired && wired.label) {
          jackHw.jackConnected = true;
          jackHw.deviceName = wired.label;
        } else {
          jackHw.deviceName = 'Salida del sistema / Jack';
        }
        updateEngineSpecUi();
        paintJackStatus();
      } catch (_e) {}
    };
    probeWebAudioOutputs();
    try {
      navigator.mediaDevices.addEventListener('devicechange', probeWebAudioOutputs);
    } catch (_e) {}
  }

  refreshNativeJackSync();
  build(computeDesiredSampleRate(), bindDeckEvents);
  updateEngineSpecUi();
  paintJackStatus();

  $('#bPlay')!.addEventListener('click', () => {
    if (!PL.length) {
      showTab('music');
      if (NATIVE && !hasPerm) {
        try {
          window.AndroidBridge?.requestMusicPermission?.();
        } catch (_e) {}
      } else toast(NATIVE ? 'No hay canciones en el teléfono' : 'Añade música primero');
      return;
    }
    if (cur < 0) loadTrack(0, true);
    else if (audio.paused || !userWantsPlaying) playNow();
    else pauseByUser();
  });
  $('#bNext')!.addEventListener('click', () => nextTrack(false));
  $('#bPrev')!.addEventListener('click', prevTrack);

  document.addEventListener(
    'pointerdown',
    () => {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    { passive: true }
  );

  let bgLast = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.2, (now - bgLast) / 1000);
    bgLast = now;
    if (userWantsPlaying && audio && audio.paused && !audio.ended && !inPhoneCall()) {
      if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
      audio.play().catch(() => {});
    }
    if (!audio || audio.paused) return;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    checkAutoCrossfade(audio);
    if (document.hidden) {
      placePan(dt);
      if (S.fx.hap.on) {
        sampleSpectrum();
        hapticTick(now);
      }
    }
  }, 120);

  document.addEventListener('visibilitychange', () => {
    updPermBanner();
    if (document.hidden) persistNow();
    else {
      vizDirty = true;
      bgLast = performance.now();
    }
  });
  window.addEventListener('pagehide', () => persistNow());

  renderList();
  renderPresets();
  syncAll();
  applyAll(true);
  showTab('music');
  updPermBanner();

  if (NATIVE && window.AndroidBridge?.rescanMusic) {
    try {
      window.AndroidBridge.rescanMusic();
    } catch (_e) {}
  }

  const readCompDb = (node: any) => {
    if (!node) return 0;
    const r = node.reduction;
    return Math.abs(typeof r === 'number' ? r : (r && r.value) || 0);
  };

  let last = performance.now();
  let lastCompUi = 0;
  function loop(now: number) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    placePan(dt);
    drawViz(now);
    if (S.fx.hap.on || shakeAmt) hapticTick(now);
    if (curTab === 'fx' && now - lastCompUi > 80) {
      lastCompUi = now;
      if (S.fx.sp.on) drawRadar();
      if (ctx && reduc && S.fx.comp.on) {
        reduc.textContent = 'Reducción ' + readCompDb(N.comp).toFixed(1) + ' dB';
      }
      if (ctx && mbReduc && S.fx.mbcomp.on) {
        mbReduc.textContent =
          'Graves ' +
          readCompDb(N.mbLowC).toFixed(1) +
          ' · Medios ' +
          readCompDb(N.mbMidC).toFixed(1) +
          ' · Agudos ' +
          readCompDb(N.mbHighC).toFixed(1) +
          ' dB';
      }
      if (ctx && deReduc && S.fx.deess.on) {
        deReduc.textContent = 'Atenuación sibilante ' + readCompDb(N.deComp).toFixed(1) + ' dB';
      }
    }
  }
  requestAnimationFrame(loop);
}
