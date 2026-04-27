/* Geo-Pac — a cartographic riff on Pac-Man.
   Pellets = data points · Ghosts = clouds · Player = satellite (terracotta).
   Single-file, no deps. Touch + keyboard + swipe controls. */
(function(){
  'use strict';

  const COLORS = {
    bg:        '#000000',         // pure black canvas
    wall:      '#00f0ff',         // bright cyan walls — max contrast on black
    wallFill:  '#000000',         // same as bg — no wall fill, only outlines
    wallDim:   '#7a4a2a',
    pellet:    '#ffffff',         // pure white pellets — max contrast
    power:     '#ffe44a',         // bright yellow power pellets
    player:    '#ffd24a',
    cloud1:    '#7ec8ff',         // saturated sky blue
    cloud2:    '#ffd070',         // saturated amber
    cloud3:    '#a8e070',         // saturated green
    cloud4:    '#ff5a4a',         // hot terracotta-red
    text:      '#fdf8ee',
    textDim:   '#c8a87a'
  };

  // 19 cols × 21 rows. 1=wall, 0=pellet, 2=power, 3=empty, 4=tunnel, 5=ghost-house
  // Classic symmetric maze — every pellet reachable, all corridors connected.
  const RAW_MAP = [
    "1111111111111111111",
    "1200000000100000021",
    "1011101110101110101",
    "1000000000000000001",
    "1011101010101011101",
    "1000000010100000001",
    "1110101110101110111",
    "4000000000000000004",
    "1110101155551110111",
    "1000001155551000001",
    "1110101155551110111",
    "4000000000000000004",
    "1110101110101110111",
    "1000000010100000001",
    "1011101010101011101",
    "1000000000000000001",
    "1011111101111110101",
    "1000000000000000101",
    "1011110111110111101",
    "1200000000000000021",
    "1111111111111111111"
  ];
  const COLS = RAW_MAP[0].length, ROWS = RAW_MAP.length;

  function buildBoard() {
    return RAW_MAP.map(r => r.split('').map(Number));
  }

  let canvas, ctx, host, scoreEl, livesEl, statusEl, raf;
  let CELL = 28;
  let board = [];
  let pelletsLeft = 0;
  let score = 0;
  let lives = 3;
  let best = parseInt(localStorage.getItem('geopac-best') || '0', 10);
  let frightened = 0;
  let running = false;
  let paused = false;
  let lastT = 0;
  const player = { x: 9, y: 15, dx: 0, dy: 0, nx: 0, ny: 0, t: 0, mouth: 0 };
  const ghosts = [];

  function reset(level) {
    board = buildBoard();
    pelletsLeft = 0;
    for (let y=0; y<ROWS; y++) for (let x=0; x<COLS; x++) {
      if (board[y][x] === 0 || board[y][x] === 2) pelletsLeft++;
    }
    player.x = 9; player.y = 13; player.dx = 0; player.dy = 0; player.nx = 0; player.ny = 0; player.t = 0;
    ghosts.length = 0;
    const colors = [COLORS.cloud1, COLORS.cloud2, COLORS.cloud3, COLORS.cloud4];
    // staggered house positions and release timers — each ghost waits before leaving
    const houseSpots = [[7,9],[8,9],[10,9],[11,9]];
    const releaseDelays = [0, 4, 8, 12]; // seconds
    for (let i=0; i<4; i++) {
      ghosts.push({
        x: houseSpots[i][0], y: houseSpots[i][1],
        dx: 0, dy: -1, t: 0, color: colors[i],
        speed: 0.055 + (level||0)*0.004,
        scared: 0, eaten: false,
        released: false, releaseAt: releaseDelays[i],
        elapsed: 0,
        randomness: 0.25 + i*0.15  // each ghost has different chase/wander mix
      });
    }
    frightened = 0;
  }

  function isWall(x, y) {
    if (y < 0 || y >= ROWS) return true;
    const xx = ((x % COLS) + COLS) % COLS;
    return board[y][xx] === 1;
  }
  function cellAt(x, y) {
    if (y < 0 || y >= ROWS) return 1;
    const xx = ((x % COLS) + COLS) % COLS;
    return board[y][xx];
  }

  function tryTurn(e, dir) {
    e.nx = dir.x; e.ny = dir.y;
  }

  const KEY_DIRS = {
    ArrowUp:    {x:0,y:-1}, ArrowDown:  {x:0,y:1},
    ArrowLeft:  {x:-1,y:0}, ArrowRight: {x:1,y:0},
    KeyW:{x:0,y:-1}, KeyS:{x:0,y:1}, KeyA:{x:-1,y:0}, KeyD:{x:1,y:0}
  };

  function onKey(ev) {
    if (!running) return;
    if (ev.code === 'Space' || ev.code === 'KeyP') { paused = !paused; ev.preventDefault(); return; }
    if (ev.code === 'Escape') { close(); ev.preventDefault(); return; }
    const d = KEY_DIRS[ev.code];
    if (d) { tryTurn(player, d); ev.preventDefault(); }
  }

  // Touch swipe
  let touchStart = null;
  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e) {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16) { touchStart = null; return; }
    if (Math.abs(dx) > Math.abs(dy)) tryTurn(player, {x: dx>0?1:-1, y:0});
    else tryTurn(player, {x:0, y: dy>0?1:-1});
    touchStart = null;
  }

  function step(dt) {
    if (paused) return;
    // player movement: try queued direction at cell center
    const PSPEED = 0.075;
    const isCenter = Math.abs(player.t) < 0.05;
    if (isCenter) {
      // snap
      player.t = 0;
      // try queued direction
      if (player.nx || player.ny) {
        if (!isWall(player.x + player.nx, player.y + player.ny)) {
          player.dx = player.nx; player.dy = player.ny;
        }
      }
      // can we keep going?
      if (isWall(player.x + player.dx, player.y + player.dy)) {
        player.dx = 0; player.dy = 0;
      }
    }
    if (player.dx || player.dy) {
      player.t += PSPEED;
      player.mouth = (player.mouth + 0.15) % 1;
      if (player.t >= 1) {
        player.x += player.dx; player.y += player.dy;
        player.x = ((player.x % COLS) + COLS) % COLS;
        player.t = 0;
        // eat
        const c = cellAt(player.x, player.y);
        if (c === 0) { board[player.y][player.x] = 3; pelletsLeft--; score += 10; }
        else if (c === 2) {
          board[player.y][player.x] = 3; pelletsLeft--; score += 50;
          frightened = 6.0; // seconds
          ghosts.forEach(g => { if (!g.eaten) g.scared = frightened; });
        }
      }
    }

    // ghosts
    ghosts.forEach(g => {
      g.elapsed += dt;
      if (g.scared > 0) g.scared -= dt;
      // staggered release: stay in house bobbing until releaseAt
      if (!g.released) {
        if (g.elapsed >= g.releaseAt) {
          g.released = true;
          // exit upward through house gap
          g.x = 9; g.y = 9; g.dx = 0; g.dy = -1; g.t = 0;
        } else {
          // bob in place
          g.t = (Math.sin(g.elapsed*3)+1)*0.05;
          return;
        }
      }
      const speed = g.eaten ? g.speed*1.7 : (g.scared > 0 ? g.speed*0.55 : g.speed);
      // step in fixed-size increments so we never skip past a wall
      let increment = speed * 60 * dt;
      while (increment > 0) {
        const take = Math.min(increment, 1 - g.t);
        g.t += take;
        increment -= take;
        if (g.t >= 0.9999) {
          g.x += g.dx; g.y += g.dy;
          g.x = ((g.x % COLS) + COLS) % COLS;
          g.t = 0;
          // arrived at integer cell — pick next direction
          const opts = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].filter(d => {
            if (d.x === -g.dx && d.y === -g.dy) return false;  // no reverse
            const nc = cellAt(g.x+d.x, g.y+d.y);
            return nc !== 1;  // wall blocks; ghost-house (5) is passable
          });
          if (opts.length === 0) {
            // dead end: reverse
            g.dx = -g.dx; g.dy = -g.dy;
          } else if (opts.length === 1) {
            g.dx = opts[0].x; g.dy = opts[0].y;
          } else {
            // junction: pick by target with personality
            let target = {x: player.x, y: player.y};
            if (g.scared > 0) target = {x: g.x + (g.x-player.x), y: g.y + (g.y-player.y)};
            if (g.eaten) target = {x: 9, y: 9};
            // re-enter check
            if (g.eaten && Math.abs(g.x-9) <= 2 && Math.abs(g.y-9) <= 1) g.eaten = false;
            // randomness: each ghost wanders some fraction of the time
            if (Math.random() < g.randomness && g.scared <= 0 && !g.eaten) {
              const pick = opts[Math.floor(Math.random()*opts.length)];
              g.dx = pick.x; g.dy = pick.y;
            } else {
              let best = opts[0], bestD = 1e9;
              opts.forEach(o => {
                const nx = g.x + o.x, ny = g.y + o.y;
                const d = (nx-target.x)*(nx-target.x)+(ny-target.y)*(ny-target.y);
                if (d < bestD) { bestD = d; best = o; }
              });
              g.dx = best.x; g.dy = best.y;
            }
          }
          // safety: if chosen direction lands in wall (shouldn't happen but defensive)
          if (cellAt(g.x+g.dx, g.y+g.dy) === 1) {
            const safe = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].find(d => cellAt(g.x+d.x, g.y+d.y) !== 1);
            if (safe) { g.dx = safe.x; g.dy = safe.y; } else { g.dx = 0; g.dy = 0; }
          }
        }
      }
      // collision
      const dist = Math.abs((g.x + g.dx*g.t) - (player.x + player.dx*player.t)) +
                   Math.abs((g.y + g.dy*g.t) - (player.y + player.dy*player.t));
      if (dist < 0.7) {
        if (g.scared > 0 && !g.eaten) {
          g.eaten = true; g.scared = 0; score += 200;
        } else if (!g.eaten) {
          lives--;
          if (lives <= 0) { gameOver(); }
          else {
            player.x = 9; player.y = 13; player.dx=0; player.dy=0; player.nx=0; player.ny=0; player.t=0;
            ghosts.forEach((gg,i)=>{ gg.x=8+i*0.5; gg.y=9; gg.t=0; gg.scared=0; gg.eaten=false; });
          }
        }
      }
    });

    if (pelletsLeft <= 0) {
      // next level
      score += 500;
      reset(1);
    }

    if (statusEl) {
      scoreEl.textContent = String(score);
      livesEl.textContent = '●'.repeat(Math.max(0, lives));
    }
  }

  function gameOver() {
    running = false;
    if (score > best) { best = score; localStorage.setItem('geopac-best', String(score)); }
    statusEl.innerHTML = `<div style="font-family:'Source Serif 4',serif;font-size:22px;color:#fdf8ee;margin-bottom:6px;">Mission ended.</div><div style="font-family:'Source Sans 3',sans-serif;font-size:13px;color:#c8a87a;">Score <b style="color:#fdf8ee;">${score}</b> · Best <b style="color:#fdf8ee;">${best}</b></div><button id="geopac-restart" style="pointer-events:auto;margin-top:14px;background:${COLORS.player};color:#1a1410;border:0;border-radius:6px;padding:10px 20px;font-family:'Source Sans 3',sans-serif;font-weight:700;font-size:14px;cursor:pointer;">Play again</button>`;
    statusEl.style.pointerEvents = 'auto';
    statusEl.style.background = 'rgba(0,0,16,0.78)';
    document.getElementById('geopac-restart').onclick = () => start();
  }

  function draw() {
    const W = COLS*CELL, H = ROWS*CELL;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // size canvas to display * dpr for crisp rendering
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.aspectRatio = `${W} / ${H}`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0,0,W,H);

    // Ghost house cells (c=5) get a dim fill, drawn first
    for (let y=0; y<ROWS; y++) {
      for (let x=0; x<COLS; x++) {
        if (board[y][x] === 5) {
          ctx.fillStyle = COLORS.wallDim;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(x*CELL, y*CELL, CELL, CELL);
          ctx.globalAlpha = 1;
        }
      }
    }

    // walls — bright cyan, thick lines, no glow
    ctx.strokeStyle = COLORS.wall;
    ctx.lineWidth = 5;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    for (let y=0; y<ROWS; y++) {
      for (let x=0; x<COLS; x++) {
        if (board[y][x] === 1) {
          if (!isWall(x, y-1)) { ctx.moveTo(x*CELL, y*CELL); ctx.lineTo((x+1)*CELL, y*CELL); }
          if (!isWall(x, y+1)) { ctx.moveTo(x*CELL, (y+1)*CELL); ctx.lineTo((x+1)*CELL, (y+1)*CELL); }
          if (!isWall(x-1, y)) { ctx.moveTo(x*CELL, y*CELL); ctx.lineTo(x*CELL, (y+1)*CELL); }
          if (!isWall(x+1, y)) { ctx.moveTo((x+1)*CELL, y*CELL); ctx.lineTo((x+1)*CELL, (y+1)*CELL); }
        }
      }
    }
    ctx.stroke();

    // pellets — small data-point dots
    for (let y=0; y<ROWS; y++) for (let x=0; x<COLS; x++) {
      const c = board[y][x];
      if (c === 0) {
        ctx.fillStyle = COLORS.pellet;
        ctx.beginPath();
        ctx.arc(x*CELL+CELL/2, y*CELL+CELL/2, 4, 0, Math.PI*2);
        ctx.fill();
      } else if (c === 2) {
        ctx.fillStyle = COLORS.power;
        ctx.beginPath();
        ctx.arc(x*CELL+CELL/2, y*CELL+CELL/2, 9 + Math.sin(performance.now()*0.005)*1.8, 0, Math.PI*2);
        ctx.fill();
      }
    }

    // player — Earth (blue oceans + green continents) with mouth chomp
    const px = (player.x + player.dx*player.t)*CELL + CELL/2;
    const py = (player.y + player.dy*player.t)*CELL + CELL/2;
    const ang = Math.atan2(player.dy, player.dx);
    const m = (Math.sin(player.mouth*Math.PI*2)+1)*0.22 + 0.05;
    const r = CELL*0.42;

    // clip to mouth-shaped pie so continents only show on visible part
    ctx.save();
    ctx.beginPath();
    if (player.dx || player.dy) {
      ctx.arc(px, py, r, ang+m, ang-m+Math.PI*2);
      ctx.lineTo(px, py);
      ctx.closePath();
    } else {
      ctx.arc(px, py, r, 0, Math.PI*2);
    }
    ctx.clip();

    // ocean — deep blue base + lighter highlight
    ctx.fillStyle = '#1f5f8c';
    ctx.fillRect(px-r, py-r, r*2, r*2);
    ctx.fillStyle = '#3a86b8';
    ctx.beginPath();
    ctx.arc(px - r*0.25, py - r*0.25, r*0.7, 0, Math.PI*2);
    ctx.fill();

    // continents — small irregular green blobs that "rotate" with the player's travel
    const phase = player.x*0.4 + player.y*0.3 + player.t;
    ctx.fillStyle = '#3d7a3a';
    const blobs = [
      [Math.cos(phase)*r*0.35, Math.sin(phase*0.7)*r*0.3, r*0.32],
      [Math.cos(phase+2.1)*r*0.4, Math.sin(phase*0.7+1.4)*r*0.35, r*0.26],
      [Math.cos(phase+4.0)*r*0.3, Math.sin(phase*0.7+3.0)*r*0.4, r*0.22]
    ];
    blobs.forEach(([dx,dy,br]) => {
      ctx.beginPath();
      ctx.ellipse(px+dx, py+dy, br, br*0.75, phase*0.3, 0, Math.PI*2);
      ctx.fill();
    });
    // brighter green highlight
    ctx.fillStyle = '#5fa055';
    ctx.beginPath();
    ctx.ellipse(px+blobs[0][0]*0.6, py+blobs[0][1]*0.6, blobs[0][2]*0.5, blobs[0][2]*0.35, phase*0.3, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();

    // crisp outline
    ctx.strokeStyle = '#0d3a5a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (player.dx || player.dy) {
      ctx.arc(px, py, r, ang+m, ang-m+Math.PI*2);
      ctx.lineTo(px, py);
      ctx.closePath();
    } else {
      ctx.arc(px, py, r, 0, Math.PI*2);
    }
    ctx.stroke();

    // ghosts — clouds
    ghosts.forEach(g => {
      const gx = (g.x + g.dx*g.t)*CELL + CELL/2;
      const gy = (g.y + g.dy*g.t)*CELL + CELL/2;
      const r = CELL*0.42;
      const fill = g.eaten ? '#d9c7a4' : (g.scared > 0 ? (Math.floor(g.scared*4)%2 ? '#5b554c' : '#fdf8ee') : g.color);
      ctx.fillStyle = fill;
      // cloud body: 3 puffs + flat bottom
      ctx.beginPath();
      ctx.arc(gx - r*0.45, gy - r*0.05, r*0.55, Math.PI, 0);
      ctx.arc(gx, gy - r*0.25, r*0.6, Math.PI, 0);
      ctx.arc(gx + r*0.45, gy - r*0.05, r*0.55, Math.PI, 0);
      ctx.lineTo(gx + r, gy + r*0.4);
      // wavy bottom
      const waves = 4;
      for (let i = waves; i >= 0; i--) {
        const wx = gx + r - (i*(2*r)/waves);
        const wy = gy + r*0.4 + (i%2 ? -r*0.18 : 0);
        ctx.lineTo(wx, wy);
      }
      ctx.closePath();
      ctx.fill();
      if (!g.eaten) {
        // eyes
        ctx.fillStyle = '#fdf8ee';
        ctx.beginPath(); ctx.arc(gx-r*0.2, gy-r*0.05, r*0.18, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx+r*0.2, gy-r*0.05, r*0.18, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#211f1c';
        const ex = g.scared>0?0:Math.sign(g.dx)*r*0.05;
        const ey = g.scared>0?0:Math.sign(g.dy)*r*0.05;
        ctx.beginPath(); ctx.arc(gx-r*0.2+ex, gy-r*0.05+ey, r*0.08, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx+r*0.2+ex, gy-r*0.05+ey, r*0.08, 0, Math.PI*2); ctx.fill();
      }
    });

    if (paused) {
      ctx.fillStyle = 'rgba(33,31,28,0.55)';
      ctx.fillRect(0,0,W,H);
      ctx.fillStyle = COLORS.bg;
      ctx.font = '600 22px "Source Serif 4", serif';
      ctx.textAlign = 'center';
      ctx.fillText('Paused — press P to resume', W/2, H/2);
    }
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastT)/1000);
    lastT = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    score = 0; lives = 3; reset(0);
    running = true; paused = false; lastT = performance.now();
    statusEl.textContent = '';
    statusEl.style.background = 'transparent';
    statusEl.style.pointerEvents = 'none';
    raf = requestAnimationFrame(loop);
  }

  function close() {
    running = false; paused = false;
    if (raf) cancelAnimationFrame(raf);
    if (host) host.style.display = 'none';
    document.body.style.overflow = '';
    window.removeEventListener('keydown', onKey);
  }

  function open() {
    if (!host) build();
    host.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    start();
  }

  function build() {
    host = document.createElement('div');
    host.id = 'geopac-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.85);display:none;align-items:center;justify-content:center;padding:16px;';
    host.innerHTML = `
      <div style="background:${COLORS.bg};border:1px solid #d9c7a4;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,0.35);max-width:520px;width:100%;padding:20px;font-family:'Source Sans 3',system-ui,sans-serif;color:${COLORS.text};">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;gap:12px;">
          <div>
            <div style="font-family:'Source Serif 4',serif;font-weight:700;font-size:20px;letter-spacing:-0.01em;">Geo-Pac</div>
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${COLORS.textDim};font-weight:600;margin-top:2px;">An easter egg · arrows or swipe</div>
          </div>
          <button id="geopac-close" aria-label="Close" style="background:transparent;border:1px solid #d9c7a4;border-radius:6px;width:34px;height:34px;cursor:pointer;font-size:18px;color:${COLORS.textDim};line-height:1;">×</button>
        </div>
        <div style="display:flex;gap:14px;font-size:12px;color:${COLORS.textDim};margin-bottom:10px;font-family:'JetBrains Mono',monospace;">
          <div>Score <b id="geopac-score" style="color:${COLORS.text};font-size:14px;">0</b></div>
          <div>Lives <b id="geopac-lives" style="color:${COLORS.player};font-size:14px;">●●●</b></div>
          <div style="margin-left:auto;">Best <b style="color:${COLORS.text};">${best}</b></div>
        </div>
        <div style="position:relative;background:${COLORS.bg};border-radius:8px;overflow:hidden;border:1px solid #d9c7a4;">
          <canvas id="geopac-canvas" style="display:block;width:100%;height:auto;touch-action:none;"></canvas>
          <div id="geopac-status" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px;flex-wrap:wrap;">
          <div style="font-size:11px;color:${COLORS.textDim};line-height:1.5;">Eat <span style="color:${COLORS.pellet};">data points</span>. Avoid <span style="color:${COLORS.cloud4};">clouds</span>. Big <span style="color:${COLORS.power};">moss dots</span> turn the tables briefly.</div>
          <div id="geopac-pad" style="display:none;gap:4px;">
            <button data-d="up"    style="${dpadBtn()}">↑</button>
            <button data-d="left"  style="${dpadBtn()}">←</button>
            <button data-d="down"  style="${dpadBtn()}">↓</button>
            <button data-d="right" style="${dpadBtn()}">→</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    canvas = host.querySelector('#geopac-canvas');
    ctx = canvas.getContext('2d');
    scoreEl = host.querySelector('#geopac-score');
    livesEl = host.querySelector('#geopac-lives');
    statusEl = host.querySelector('#geopac-status');
    statusEl.style.pointerEvents = 'none';
    statusEl.style.background = 'transparent';
    statusEl.style.color = '#fdf8ee';
    host.querySelector('#geopac-close').onclick = close;
    host.addEventListener('click', (e) => { if (e.target === host) close(); });
    canvas.addEventListener('touchstart', onTouchStart, {passive:true});
    canvas.addEventListener('touchend', onTouchEnd, {passive:true});

    // mobile pad
    const isTouch = matchMedia('(hover: none)').matches || ('ontouchstart' in window);
    if (isTouch) {
      const pad = host.querySelector('#geopac-pad');
      pad.style.display = 'grid';
      pad.style.gridTemplateColumns = 'repeat(3,40px)';
      pad.style.gridTemplateRows = 'repeat(2,40px)';
      // re-arrange children to a + shape: blank up blank | left down right
      pad.innerHTML = `
        <span></span>
        <button data-d="up"    style="${dpadBtn()}">↑</button>
        <span></span>
        <button data-d="left"  style="${dpadBtn()}">←</button>
        <button data-d="down"  style="${dpadBtn()}">↓</button>
        <button data-d="right" style="${dpadBtn()}">→</button>
      `;
      pad.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          const d = {up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}}[b.dataset.d];
          tryTurn(player, d);
        });
      });
    }
  }

  function dpadBtn() {
    return `width:40px;height:40px;background:${COLORS.bg};border:1px solid #d9c7a4;border-radius:6px;font-size:18px;color:${COLORS.text};cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit;`;
  }

  // public API
  window.GeoPac = { open, close };
})();
