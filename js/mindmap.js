export class MindMap {
  constructor(svgEl, onNodeClick) {
    this.svg = svgEl;
    this.onNodeClick = onNodeClick;
    this.nodes = [];
    this.links = [];
    this.dragging = null;
    this.animFrame = null;
    this.alpha = 1;
    this.W = 0;
    this.H = 0;
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this._panning = false;
    this._panStart = null;
    this._bindDrag();
    this._bindZoom();
  }

  setData(notes, aiLinks = []) {
    const W = this.svg.clientWidth || 800;
    const H = this.svg.clientHeight || 600;
    this.W = W;
    this.H = H;

    this.nodes = notes.map((n, i) => ({
      id: n.id,
      label: n.title || 'Untitled',
      tags: n.tags || [],
      contentLen: (n.content || '').length,
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: H / 2 + (Math.random() - 0.5) * H * 0.5,
      vx: 0,
      vy: 0,
    }));

    // Build links from shared tags + AI links
    const edgeSet = new Set();
    for (let i = 0; i < notes.length; i++) {
      for (let j = i + 1; j < notes.length; j++) {
        const sharedTags = (notes[i].tags || []).filter(t =>
          (notes[j].tags || []).includes(t)
        );
        if (sharedTags.length > 0) {
          const key = `${notes[i].id}-${notes[j].id}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            this.links.push({ source: notes[i].id, target: notes[j].id, label: sharedTags[0] });
          }
        }
      }
    }

    // AI-generated links
    for (const l of aiLinks) {
      const s = notes[l.source]?.id;
      const t = notes[l.target]?.id;
      if (!s || !t) continue;
      const key = [s, t].sort().join('-');
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        this.links.push({ source: s, target: t, label: l.label || '' });
      }
    }

    this.alpha = 1;
    this._stopSim();
    this._runSim();
  }

  _stopSim() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
  }

  _runSim() {
    const tick = () => {
      if (this.alpha < 0.01) { this._render(); return; }
      this._applyForces();
      this._render();
      this.alpha *= 0.97;
      this.animFrame = requestAnimationFrame(tick);
    };
    this.animFrame = requestAnimationFrame(tick);
  }

  _applyForces() {
    const repK = 8000;
    const springK = 0.08;
    const restLen = 180;
    const center = { x: this.W / 2, y: this.H / 2 };

    // Repulsion between all node pairs
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (repK / (dist * dist)) * this.alpha;
        const fx = f * dx / dist;
        const fy = f * dy / dist;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Attraction along edges
    for (const link of this.links) {
      const a = this.nodes.find(n => n.id === link.source);
      const b = this.nodes.find(n => n.id === link.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = springK * (dist - restLen) * this.alpha;
      const fx = f * dx / dist;
      const fy = f * dy / dist;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Centering gravity
    for (const n of this.nodes) {
      n.vx += (center.x - n.x) * 0.002 * this.alpha;
      n.vy += (center.y - n.y) * 0.002 * this.alpha;
    }

    // Integrate + damp
    const pad = 60;
    for (const n of this.nodes) {
      if (n === this.dragging) continue;
      n.vx *= 0.85;
      n.vy *= 0.85;
      n.x = Math.max(pad, Math.min(this.W - pad, n.x + n.vx));
      n.y = Math.max(pad, Math.min(this.H - pad, n.y + n.vy));
    }
  }

  zoom(delta) {
    this.scale = Math.max(0.2, Math.min(4, this.scale + delta));
    this._render();
  }

  resetZoom() {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this._render();
  }

  _render() {
    const svg = this.svg;
    svg.innerHTML = '';

    // Resolve theme colors (SVG presentation attributes can't use var())
    const css = getComputedStyle(document.documentElement);
    const cAccent = css.getPropertyValue('--accent').trim() || '#fff';
    const cPanel  = css.getPropertyValue('--panel').trim() || '#171717';
    const cText   = css.getPropertyValue('--text').trim() || '#ececec';
    const cMuted  = css.getPropertyValue('--text-muted').trim() || '#9b9b9b';

    // Defs
    const defs = this._el('defs');
    const marker = this._el('marker', {
      id: 'arrow', markerWidth: '8', markerHeight: '8',
      refX: '28', refY: '4', orient: 'auto',
    });
    const path = this._el('path', { d: 'M0,0 L0,8 L8,4 z', fill: cAccent, opacity: '0.5' });
    marker.appendChild(path);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Root group — all content lives here for zoom/pan
    const root = this._el('g', { transform: `translate(${this.tx},${this.ty}) scale(${this.scale})` });

    // Links
    for (const link of this.links) {
      const a = this.nodes.find(n => n.id === link.source);
      const b = this.nodes.find(n => n.id === link.target);
      if (!a || !b) continue;

      const line = this._el('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: cAccent, 'stroke-opacity': '0.35',
        'stroke-width': '1.5', 'marker-end': 'url(#arrow)',
      });
      root.appendChild(line);

      if (link.label) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const txt = this._el('text', {
          x: mx, y: my, fill: cMuted,
          'font-size': '11', 'text-anchor': 'middle',
          'dominant-baseline': 'middle',
        });
        txt.textContent = link.label;
        root.appendChild(txt);
      }
    }

    // Nodes
    for (const node of this.nodes) {
      const r = Math.max(22, Math.min(42, 22 + node.contentLen / 120));
      const g = this._el('g', {
        transform: `translate(${node.x},${node.y})`,
        style: 'cursor:pointer',
        'data-id': node.id,
      });

      const circle = this._el('circle', {
        r, fill: cPanel, stroke: cAccent,
        'stroke-width': '2', 'stroke-opacity': '0.7',
      });

      const label = this._el('text', {
        y: r + 14, fill: cText, 'font-size': '12',
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
      });
      label.textContent = node.label.length > 18
        ? node.label.slice(0, 16) + '…'
        : node.label;

      if (node.tags.length) {
        node.tags.slice(0, 3).forEach((_, i) => {
          const dot = this._el('circle', {
            cx: -8 + i * 8, cy: r - 6, r: '4',
            fill: cAccent, opacity: '0.8',
          });
          g.appendChild(dot);
        });
      }

      g.appendChild(circle);
      g.appendChild(label);

      g.addEventListener('click', (e) => {
        if (this._wasDragging) return;
        this.onNodeClick?.(node.id);
      });

      g.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.dragging = node;
        this._wasDragging = false;
      });

      g.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        this.dragging = node;
        this._wasDragging = false;
      }, { passive: true });

      root.appendChild(g);
    }

    svg.appendChild(root);
  }

  _bindDrag() {
    const svgMove = (clientX, clientY) => {
      const rect = this.svg.getBoundingClientRect();
      // Convert screen coords to node-space coords (undo translate+scale)
      return {
        x: (clientX - rect.left - this.tx) / this.scale,
        y: (clientY - rect.top  - this.ty) / this.scale,
      };
    };

    const move = (clientX, clientY) => {
      if (this.dragging) {
        this._wasDragging = true;
        const pos = svgMove(clientX, clientY);
        this.dragging.x = pos.x;
        this.dragging.y = pos.y;
        this.dragging.vx = 0;
        this.dragging.vy = 0;
        this._render();
      } else if (this._panning && this._panStart) {
        this.tx += clientX - this._panStart.x;
        this.ty += clientY - this._panStart.y;
        this._panStart = { x: clientX, y: clientY };
        this._render();
      }
    };

    // Pan starts on SVG background mousedown (not on a node)
    this.svg.addEventListener('mousedown', (e) => {
      if (e.target === this.svg || e.target.tagName === 'g' && e.target === this.svg.lastChild) {
        this._panning = true;
        this._panStart = { x: e.clientX, y: e.clientY };
      }
    });

    document.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    document.addEventListener('mouseup', () => {
      this.dragging = null;
      this._panning = false;
      this._panStart = null;
    });

    document.addEventListener('touchmove', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      if (this.dragging && !this._wasDragging) {
        this.onNodeClick?.(this.dragging.id);
      }
      this.dragging = null;
    });
  }

  _bindZoom() {
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      const newScale = Math.max(0.2, Math.min(4, this.scale + delta));
      // Zoom toward cursor
      this.tx = mx - (mx - this.tx) * (newScale / this.scale);
      this.ty = my - (my - this.ty) * (newScale / this.scale);
      this.scale = newScale;
      this._render();
    }, { passive: false });
  }

  _el(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  destroy() {
    this._stopSim();
  }
}
