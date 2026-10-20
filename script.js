const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);


// ---------- Theme: white by default, dark on request, remembered between visits ----------

const themeToggle = document.getElementById('theme-toggle');

if (themeToggle) {
  const themeColor = document.querySelector('meta[name="theme-color"]');

  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to white theme' : 'Switch to dark theme');
    if (themeColor) themeColor.content = theme === 'dark' ? '#142024' : '#FFFFFF';
    document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  };

  themeToggle.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('theme', next); } catch (error) { /* private mode: the choice just won't persist */ }
  });
  applyTheme(root.dataset.theme === 'dark' ? 'dark' : 'light');
}


// ---------- Portrait slots: show the photo once its file exists in images/ ----------

document.querySelectorAll('.portrait img').forEach((img) => {
  const reveal = () => {
    if (img.naturalWidth > 0) img.closest('.portrait').classList.add('has-photo');
  };
  if (img.complete) reveal();
  else img.addEventListener('load', reveal);
});


// ---------- Reveals ----------
// Headings marked data-split are broken into words, each in its own mask.
// Everything marked data-reveal gets .is-in when it enters the viewport.

const splitWords = (el) => {
  let index = 0;
  const wrap = (node) => {
    const outer = document.createElement('span');
    outer.className = 'w';
    const inner = document.createElement('span');
    inner.className = 'w__i';
    inner.style.setProperty('--w', index);
    index += 1;
    outer.appendChild(inner);
    inner.appendChild(node);
    return outer;
  };

  Array.from(el.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const fragment = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((token) => {
        if (!token) return;
        if (/^\s+$/.test(token)) fragment.appendChild(document.createTextNode(' '));
        else fragment.appendChild(wrap(document.createTextNode(token)));
      });
      el.replaceChild(fragment, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const next = node.nextSibling;
      el.insertBefore(wrap(node), next);
    }
  });
};

document.querySelectorAll('[data-split]').forEach(splitWords);

document.querySelectorAll('[data-reveal], [data-split]').forEach((el) => {
  if (el.dataset.delay) el.style.setProperty('--d', `${el.dataset.delay}ms`);
  if (el.dataset.reveal === 'stagger') {
    Array.from(el.children).forEach((child, i) => child.style.setProperty('--i', i));
  }
});
document.querySelectorAll('.index__list').forEach((list) => {
  Array.from(list.children).forEach((child, i) => child.style.setProperty('--i', i));
});

const hero = document.querySelector('.hero');
const revealTargets = Array.from(document.querySelectorAll('[data-reveal], [data-split]'));
const inHero = (el) => hero && hero.contains(el);

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
  revealTargets.filter((el) => !inHero(el)).forEach((el) => observer.observe(el));
} else {
  revealTargets.forEach((el) => el.classList.add('is-in'));
}

// The hero runs as one timed sequence once the typeface is ready, so words don't jump mid-reveal.
const startHero = () => {
  revealTargets.filter(inHero).forEach((el) => el.classList.add('is-in'));
};
Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 900))]).then(() => {
  setTimeout(startHero, 0);
});


// ---------- Arcs: draw each path from its real length ----------

function drawArcs(container, { duration, stagger, delay }) {
  // Only paths that are laid out (the map keeps a hidden variant for the other screen size).
  const paths = Array.from(container.querySelectorAll('.arcs path')).filter((path) => path.getTotalLength() > 0);
  if (reducedMotion) {
    container.classList.add('is-drawn');
    return;
  }
  paths.forEach((path, i) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    path.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(0.4, 0, 0.2, 1) ${delay + i * stagger}ms`;
  });
  // Flush the starting state before changing it, so the transition runs.
  void container.getBoundingClientRect();
  paths.forEach((path) => { path.style.strokeDashoffset = '0'; });
  container.classList.add('is-drawn');
}

// Prepare the labelled map so its arcs start hidden, then draw them when it scrolls into view.
const map = document.getElementById('map');
if (map) {
  const paths = Array.from(map.querySelectorAll('.arcs path')).filter((path) => path.getTotalLength() > 0);
  if (!reducedMotion) {
    paths.forEach((path) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
    });
  }
  const show = () => {
    map.classList.add('is-in');
    drawArcs(map, { duration: 1500, stagger: 80, delay: 100 });
  };
  if ('IntersectionObserver' in window) {
    const mapObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        show();
        mapObserver.disconnect();
      }
    }, { threshold: 0.3 });
    mapObserver.observe(map);
  } else {
    show();
  }
}


// ---------- In brief: three verbs choose the proof panel ----------
// The panels cycle on their own once the section is in view, until someone picks a verb.
// They pause while the pointer or focus is on the section.

const brief = document.getElementById('brief-body');
const proof = document.getElementById('proof');
const verbs = Array.from(document.querySelectorAll('.verb'));

if (brief && proof && verbs.length) {
  const panels = Array.from(proof.querySelectorAll('.proof__panel'));
  let cycling = !reducedMotion;

  const showVerb = (name) => {
    verbs.forEach((verb) => verb.setAttribute('aria-pressed', String(verb.dataset.verb === name)));
    panels.forEach((panel) => { panel.hidden = panel.dataset.verb !== name; });
    if (cycling) {
      // Restart the underline timer on the newly active verb.
      brief.classList.remove('is-cycling');
      void brief.offsetWidth;
      brief.classList.add('is-cycling');
    }
  };

  brief.addEventListener('animationend', (event) => {
    if (!cycling || event.animationName !== 'verb-timer') return;
    const current = verbs.findIndex((verb) => verb.getAttribute('aria-pressed') === 'true');
    showVerb(verbs[(current + 1) % verbs.length].dataset.verb);
  });

  verbs.forEach((verb) => {
    verb.addEventListener('click', () => {
      cycling = false;
      brief.classList.remove('is-cycling');
      showVerb(verb.dataset.verb);
    });
  });

  if (cycling && 'IntersectionObserver' in window) {
    const briefObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        if (cycling) brief.classList.add('is-cycling');
        briefObserver.disconnect();
      }
    }, { threshold: 0.4 });
    briefObserver.observe(brief);
  } else if (cycling) {
    brief.classList.add('is-cycling');
  }
}


// ---------- Numbers count up the first time they are seen ----------

const easeOut = (t) => 1 - Math.pow(1 - t, 4);

const countUp = (el) => {
  const text = el.textContent.trim();
  const match = text.match(/^([^\d]*)([\d,.]+)(.*)$/);
  if (!match) return;
  const [, prefix, numberText, suffix] = match;
  const decimals = (numberText.split('.')[1] || '').length;
  const grouped = numberText.includes(',');
  const target = parseFloat(numberText.replace(/,/g, ''));
  const format = (value) => {
    const fixed = value.toFixed(decimals);
    return grouped ? Number(fixed).toLocaleString('en-US', { minimumFractionDigits: decimals }) : fixed;
  };
  const duration = 1500;
  let start = null;
  const frame = (now) => {
    if (start === null) start = now;
    const progress = clamp((now - start) / duration, 0, 1);
    el.textContent = prefix + format(target * easeOut(progress)) + suffix;
    if (progress < 1) requestAnimationFrame(frame);
    else el.textContent = text;
  };
  el.textContent = prefix + format(0) + suffix;
  requestAnimationFrame(frame);
};

if (!reducedMotion && 'IntersectionObserver' in window) {
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      countUp(entry.target);
      countObserver.unobserve(entry.target);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll('[data-count]').forEach((el) => countObserver.observe(el));
}


// ---------- Isometric scenes for the two cases ----------
// Each scene is a list of boxes (x, y, w, d, height) on an isometric grid. Boxes grow
// from the floor in sequence once the scene scrolls into view; labels and traces follow.

const ISO_C = Math.cos(Math.PI / 6);
const ISO_S = 24;
const isoPoint = (x, y, z) => [(x - y) * ISO_C * ISO_S, (x + y) * 0.5 * ISO_S - z * ISO_S];
const svgNS = 'http://www.w3.org/2000/svg';
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const isoScenes = {
  growth: {
    floor: { x: 0, y: 0, w: 9, d: 4, grid: true },
    boxes: [
      { x: 1.2, y: 1.2, w: 1.6, d: 1.6, h: 1.68, delay: 200 },                 // 4,000 of 9,500
      { x: 5.6, y: 1.2, w: 1.6, d: 1.6, h: 4.0, delay: 600, accent: true },
    ],
    labels: [
      { at: [2, 2, 1.68], dy: -30, value: '4,000+', text: 'before', delay: 1200 },
      { at: [6.4, 2, 4.0], dy: -30, value: '9,500+', text: 'after four months', delay: 1900 },
    ],
    traces: [{ from: [2, 2, 1.68], to: [6.4, 2, 4.0], delay: 1700 }],
  },
  room: {
    floor: { x: 0, y: 0, w: 10, d: 8, grid: true, part: 'floor' },
    boxes: [
      { x: 1, y: 0.2, w: 8, d: 0.3, h: 1.5, delay: 150, part: 'sponsors' },     // logo wall
      { x: 3, y: 1.3, w: 4, d: 1.4, h: 0.5, delay: 450, part: 'panel', accent: true },
      { x: 0.4, y: 3.2, w: 1.2, d: 1.2, h: 1.1, delay: 750, part: 'sponsors' },
      { x: 0.4, y: 5.0, w: 1.2, d: 1.2, h: 1.1, delay: 850, part: 'sponsors' },
      { x: 2.6, y: 3.4, w: 4.8, d: 3.2, h: 0.9, delay: 1100, part: 'seats' },
      { x: 8.4, y: 3.2, w: 1.2, d: 1.2, h: 1.1, delay: 950, part: 'sponsors' },
      { x: 8.4, y: 5.0, w: 1.2, d: 1.2, h: 1.1, delay: 1050, part: 'sponsors' },
    ],
    labels: [
      { at: [5, 0.35, 1.5], dy: -12, text: 'Sponsor logos', delay: 1600, part: 'sponsors' },
      { at: [5, 2, 0.5], dy: -10, text: 'Panel', delay: 1700, part: 'panel' },
      { at: [5, 5, 0.9], dy: -10, value: '200', text: 'CEOs', delay: 1900, part: 'seats' },
      { at: [5, 10.6, 0], dy: 18, text: 'Registrations from the social campaign', delay: 2400, part: 'campaign' },
    ],
    traces: [{ from: [5, 10.4, 0], to: [5, 6.7, 0], delay: 2200, part: 'campaign' }],
  },
};

function buildIso(host, scene) {
  const svg = document.createElementNS(svgNS, 'svg');
  const el = (name, attrs = {}, parent = svg) => {
    const node = document.createElementNS(svgNS, name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    parent.appendChild(node);
    return node;
  };
  const pts = (list) => list.map((p) => isoPoint(...p).map((n) => n.toFixed(2)).join(',')).join(' ');

  const makeBox = (b, floor) => {
    const g = el('g', { class: floor ? 'is-floor' : (b.accent ? 'is-accent' : '') });
    if (b.part) g.dataset.part = b.part;
    const faces = ['f-r', 'f-l', 't'].map((cls) => el('polygon', { class: cls === 't' ? 'f-t' : cls }, g));
    const draw = (h) => {
      const { x, y, w, d } = b;
      faces[0].setAttribute('points', pts([[x + w, y, 0], [x + w, y + d, 0], [x + w, y + d, h], [x + w, y, h]]));
      faces[1].setAttribute('points', pts([[x, y + d, 0], [x + w, y + d, 0], [x + w, y + d, h], [x, y + d, h]]));
      faces[2].setAttribute('points', pts([[x, y, h], [x + w, y, h], [x + w, y + d, h], [x, y + d, h]]));
    };
    return { g, draw };
  };

  // Floor plate and its grid.
  const floor = makeBox({ ...scene.floor }, true);
  floor.draw(0.08);
  if (scene.floor.grid) {
    const grid = el('g', { class: 'grid' });
    if (scene.floor.part) grid.dataset.part = scene.floor.part;
    for (let i = 1; i < scene.floor.w; i += 1) el('line', { x1: isoPoint(i, 0, 0.08)[0], y1: isoPoint(i, 0, 0.08)[1], x2: isoPoint(i, scene.floor.d, 0.08)[0], y2: isoPoint(i, scene.floor.d, 0.08)[1] }, grid);
    for (let i = 1; i < scene.floor.d; i += 1) el('line', { x1: isoPoint(0, i, 0.08)[0], y1: isoPoint(0, i, 0.08)[1], x2: isoPoint(scene.floor.w, i, 0.08)[0], y2: isoPoint(scene.floor.w, i, 0.08)[1] }, grid);
  }

  // Traces sit on the floor, under the boxes.
  const traces = scene.traces.map((t) => {
    const [x1, y1] = isoPoint(...t.from);
    const [x2, y2] = isoPoint(...t.to);
    const line = el('line', { class: 'trace', x1, y1, x2, y2 });
    if (t.part) line.dataset.part = t.part;
    return { line, delay: t.delay };
  });

  // Boxes back to front.
  const boxes = [...scene.boxes].sort((a, b) => (a.x + a.y) - (b.x + b.y)).map((b) => ({ ...makeBox(b), spec: b }));
  boxes.forEach((b) => b.draw(b.spec.h));            // full size first, to measure the scene

  const labels = scene.labels.map((l) => {
    const [x, y] = isoPoint(...l.at);
    const nodes = [];
    if (l.value) nodes.push(el('text', { class: 'v', x, y: y + l.dy - 2, 'text-anchor': 'middle' }));
    nodes.push(el('text', { x, y: y + l.dy + (l.value ? 14 : 0), 'text-anchor': 'middle' }));
    if (l.value) nodes[0].textContent = l.value;
    nodes[nodes.length - 1].textContent = l.text;
    nodes.forEach((n) => { if (l.part) n.dataset.part = l.part; });
    return { nodes, delay: l.delay };
  });

  host.appendChild(svg);
  const box = svg.getBBox();
  const pad = 16;
  svg.setAttribute('viewBox', `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
  const fit = () => svg.style.setProperty('--k', svg.clientWidth / (box.width + pad * 2) || 1);
  fit();
  window.addEventListener('resize', fit);

  const play = () => {
    if (reducedMotion) {
      traces.forEach((t) => t.line.classList.add('is-on'));
      labels.forEach((l) => l.nodes.forEach((n) => n.classList.add('is-on')));
      return;
    }
    boxes.forEach((b) => b.draw(0.001));
    const start = performance.now();
    const frame = (now) => {
      let busy = false;
      boxes.forEach((b) => {
        const p = clamp((now - start - (b.spec.delay || 0)) / 900, 0, 1);
        if (p < 1) busy = true;
        b.draw(Math.max(0.001, b.spec.h * easeInOut(p)));
      });
      if (busy) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    traces.forEach((t) => setTimeout(() => t.line.classList.add('is-on'), t.delay));
    labels.forEach((l) => setTimeout(() => l.nodes.forEach((n) => n.classList.add('is-on')), l.delay));
  };

  boxes.forEach((b) => b.draw(0.001));
  if ('IntersectionObserver' in window && !reducedMotion) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { play(); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(host);
  } else {
    boxes.forEach((b) => b.draw(b.spec.h));
    play();
  }
}

[['iso-growth', 'growth'], ['plan', 'room']].forEach(([id, name]) => {
  const host = document.getElementById(id);
  if (host) buildIso(host, isoScenes[name]);
});


// ---------- Event figure: hovering or focusing a step lights its point on the plan; clicking pins it ----------

const planStage = document.getElementById('plan-stage');
const plan = document.getElementById('plan');

if (planStage && plan) {
  const steps = Array.from(document.querySelectorAll('.steps button'));
  const captions = Array.from(planStage.querySelectorAll('.stage__caption'));
  let pinned = 'all';

  const showFocus = (name) => {
    plan.dataset.focus = name;
    captions.forEach((caption) => { caption.hidden = caption.dataset.focus !== name; });
    steps.forEach((step) => step.setAttribute('aria-pressed', String(step.dataset.focus === pinned)));
  };

  steps.forEach((step) => {
    const name = step.dataset.focus;
    step.addEventListener('mouseenter', () => showFocus(name));
    step.addEventListener('focus', () => showFocus(name));
    step.addEventListener('mouseleave', () => showFocus(pinned));
    step.addEventListener('blur', () => showFocus(pinned));
    step.addEventListener('click', () => {
      pinned = pinned === name ? 'all' : name;
      showFocus(pinned);
    });
  });
}


// ---------- Hero portrait as particles ----------
// The cut-out photo is sampled onto a grid; each opaque sample becomes a dot that is
// pushed away by the pointer and springs back home. Dots are drawn from a few
// pre-rendered sprites so the frame stays cheap. Reduced motion keeps the plain photo.

const particles = document.getElementById('particles');

if (particles && !reducedMotion && window.HTMLCanvasElement) {
  const canvas = particles.querySelector('canvas');
  const source = particles.querySelector('img');
  const ctx = canvas.getContext('2d');
  const COLS = 120;                       // dots across the portrait
  const BUCKETS = 6;                      // luminance steps, darkest first

  // [colour, dot size] per luminance bucket. On white, dark pixels make the big dots;
  // on the dark theme, the light pixels do.
  const palettes = {
    light: [['#2E2410', 1.0], ['#5A4118', 0.92], ['#8A6626', 0.84], ['#B8904A', 0.74], ['#D2B682', 0.6], ['#E8DCC2', 0.46]],
    dark: [['#2A3D43', 0.46], ['#6E5424', 0.6], ['#8A6626', 0.72], ['#B8904A', 0.82], ['#D6B98C', 0.92], ['#F0DDB8', 1.0]],
  };

  let dpr = 1;
  let width = 0;
  let height = 0;
  let cell = 0;
  let count = 0;
  let home;
  let pos;
  let vel;
  let tone;
  let phase;
  let sprites = [];
  let running = false;
  let visible = false;
  let lastTime = 0;
  let clock = 0;
  const pointer = { x: -1e4, y: -1e4, active: false };

  const buildSprites = () => {
    const theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
    sprites = palettes[theme].map(([colour, scale]) => {
      const radius = cell * 0.46 * scale * dpr;
      const size = Math.ceil(radius * 2) + 2;
      const sprite = document.createElement('canvas');
      sprite.width = size;
      sprite.height = size;
      const sctx = sprite.getContext('2d');
      sctx.fillStyle = colour;
      sctx.beginPath();
      sctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
      sctx.fill();
      return { image: sprite, half: size / 2 };
    });
  };

  const build = () => {
    const rect = particles.getBoundingClientRect();
    if (rect.width < 10) return false;
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    cell = width / COLS;
    const rows = Math.round(height / cell);

    // Sample the photo at one pixel per dot: full width, sitting on the bottom edge.
    const sample = document.createElement('canvas');
    sample.width = COLS;
    sample.height = rows;
    const sctx = sample.getContext('2d');
    const drawHeight = source.naturalHeight * (COLS / source.naturalWidth);
    sctx.drawImage(source, 0, rows - drawHeight, COLS, drawHeight);
    const data = sctx.getImageData(0, 0, COLS, rows).data;

    const hx = [];
    const hy = [];
    const tn = [];
    const fadeRows = Math.round(rows * 0.1);   // the cut edge at the bottom dissolves rather than stopping flat
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const i = (y * COLS + x) * 4;
        if (data[i + 3] < 110) continue;
        if (y > rows - fadeRows && Math.random() > (rows - y) / fadeRows) continue;
        const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        hx.push((x + 0.5) * cell);
        hy.push((y + 0.5) * cell);
        tn.push(Math.min(BUCKETS - 1, Math.floor(luminance / (256 / BUCKETS))));
      }
    }
    count = hx.length;
    home = new Float32Array(count * 2);
    pos = new Float32Array(count * 2);
    vel = new Float32Array(count * 2);
    tone = new Uint8Array(count);
    phase = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      home[i * 2] = hx[i];
      home[i * 2 + 1] = hy[i];
      // Start scattered around the portrait; the springs pull everything into place.
      pos[i * 2] = hx[i] + (Math.random() - 0.5) * width * 0.7;
      pos[i * 2 + 1] = hy[i] + (Math.random() - 0.5) * height * 0.7;
      tone[i] = tn[i];
      phase[i] = Math.random() * Math.PI * 2;
    }
    buildSprites();
    return true;
  };

  const frame = (now) => {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 16.7, 2);
    lastTime = now;
    clock += dt;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const radius = Math.min(width, height) * 0.24;
    const radius2 = radius * radius;
    const spring = 0.055 * dt;
    const friction = Math.pow(0.84, dt);
    const push = 2.4 * dt;

    for (let i = 0; i < count; i += 1) {
      const ix = i * 2;
      const iy = ix + 1;
      let x = pos[ix];
      let y = pos[iy];
      let vx = vel[ix];
      let vy = vel[iy];

      if (pointer.active) {
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < radius2) {
          const d = Math.sqrt(d2) || 1;
          const force = (1 - d / radius) * push;
          vx += (dx / d) * force;
          vy += (dy / d) * force;
        }
      }

      // Home drifts by half a pixel so the portrait breathes while nothing is touching it.
      const targetX = home[ix] + Math.sin(clock * 0.02 + phase[i]) * 0.5;
      const targetY = home[iy] + Math.cos(clock * 0.017 + phase[i]) * 0.5;
      vx += (targetX - x) * spring;
      vy += (targetY - y) * spring;
      vx *= friction;
      vy *= friction;
      x += vx * dt;
      y += vy * dt;

      pos[ix] = x;
      pos[iy] = y;
      vel[ix] = vx;
      vel[iy] = vy;

      const sprite = sprites[tone[i]];
      ctx.drawImage(sprite.image, x * dpr - sprite.half, y * dpr - sprite.half);
    }
    requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || !visible || !count) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  };
  const stop = () => { running = false; };

  const init = () => {
    try {
      if (!build()) return;
    } catch (error) {
      return;                               // e.g. a tainted canvas: the photo stays visible instead
    }
    particles.classList.add('is-live');

    const onPointer = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const margin = Math.min(width, height) * 0.24;
      pointer.active = x > -margin && x < width + margin && y > -margin && y < height + margin;
      pointer.x = x;
      pointer.y = y;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('pointerup', () => { pointer.active = false; }, { passive: true });
    document.addEventListener('pointerleave', () => { pointer.active = false; });

    // Only animate while the hero is on screen and the tab is visible.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) start();
        else stop();
      }, { threshold: 0.05 }).observe(particles);
    } else {
      visible = true;
      start();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else start();
    });

    document.addEventListener('themechange', buildSprites);

    let lastWidth = width;
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (Math.abs(particles.getBoundingClientRect().width - lastWidth) < 2) return;
        stop();
        if (build()) { lastWidth = width; start(); }
      }, 150);
    });
  };

  if (source.complete && source.naturalWidth) init();
  else source.addEventListener('load', init, { once: true });
}


// ---------- Experience: each role opens for its detail ----------

document.querySelectorAll('.role__toggle').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    const role = toggle.closest('.role');
    const open = !role.classList.contains('is-open');
    role.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    requestFrame();                       // the timeline follows the new height
    setTimeout(requestFrame, 600);
  });
});


// ---------- Scroll-linked behaviour ----------
// One handler, run at most once per frame: header, page tone, the portrait's drift,
// and the timeline down the experience list.

const topBar = document.getElementById('top');
const heroFigure = document.getElementById('hero-figure');
const roles = document.getElementById('roles');
const roleItems = roles ? Array.from(roles.querySelectorAll('.role')) : [];
const toneSections = Array.from(document.querySelectorAll('[data-tone]'));

let lastY = window.scrollY;
let ticking = false;

const onFrame = () => {
  ticking = false;
  const y = window.scrollY;
  const vh = window.innerHeight;

  // Header: tucks away while reading down, returns on the way back up.
  if (topBar) {
    topBar.classList.toggle('is-scrolled', y > 24);
    if (y > 160 && y > lastY + 4) topBar.classList.add('is-hidden');
    else if (y < lastY - 4 || y <= 160) topBar.classList.remove('is-hidden');
  }
  lastY = y;

  // Page tone: follow whichever section holds the middle of the viewport.
  const middle = y + vh * 0.5;
  const current = toneSections.find((section) => {
    const sectionTop = section.offsetTop;
    return middle >= sectionTop && middle < sectionTop + section.offsetHeight;
  });
  if (current) root.style.setProperty('--page', `var(--${current.dataset.tone})`);

  // Hero: the portrait drifts a little slower than the page.
  if (!reducedMotion && heroFigure && y < vh * 1.2) {
    heroFigure.style.transform = `translate3d(0, ${y * 0.08}px, 0)`;
  }

  // Experience: the line fills to where you have read, and each role's dot lights as it passes.
  if (roles && roleItems.length) {
    const rect = roles.getBoundingClientRect();
    const progress = clamp((vh * 0.6 - rect.top) / rect.height, 0, 1);
    roles.style.setProperty('--progress', `${progress * 100}%`);
    roleItems.forEach((role) => {
      role.classList.toggle('is-passed', role.getBoundingClientRect().top + 30 < vh * 0.6);
    });
  }
};

const requestFrame = () => {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(onFrame);
  }
};

window.addEventListener('scroll', requestFrame, { passive: true });
window.addEventListener('resize', requestFrame);
requestFrame();


// ---------- Inertia scrolling on desktop ----------
// Wheel input moves a target; the page eases toward it. Touch, keyboard and the
// scrollbar keep native behaviour, and anything that scrolls the page from outside
// (an anchor, the browser's own find) re-syncs the target.

if (finePointer && !reducedMotion) {
  root.classList.add('smooth');

  let target = window.scrollY;
  let current = window.scrollY;
  let animating = false;
  let lastTime = 0;

  const maxScroll = () => root.scrollHeight - window.innerHeight;

  const step = (now) => {
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;
    const k = 1 - Math.pow(0.88, dt / 16.7);
    current += (target - current) * k;
    if (Math.abs(target - current) < 0.4) {
      current = target;
      animating = false;
    }
    window.scrollTo(0, current);
    if (animating) requestAnimationFrame(step);
  };

  const start = () => {
    if (animating) return;
    animating = true;
    lastTime = performance.now();
    requestAnimationFrame(step);
  };

  window.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;                                      // pinch zoom
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;     // sideways, e.g. the map
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    target = clamp(target + event.deltaY * unit, 0, maxScroll());
    start();
  }, { passive: false });

  window.addEventListener('scroll', () => {
    if (!animating) target = current = window.scrollY;
  }, { passive: true });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href');
    const destination = id === '#' ? document.body : document.querySelector(id);
    if (!destination) return;
    event.preventDefault();
    target = clamp(destination.getBoundingClientRect().top + window.scrollY - 72, 0, maxScroll());
    if (id !== '#home') history.pushState(null, '', id);
    start();
  });
}
