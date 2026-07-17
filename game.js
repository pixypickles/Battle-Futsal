(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const blueScoreEl = document.getElementById('blueScore');
  const redScoreEl = document.getElementById('redScore');
  const timerEl = document.getElementById('timer');
  const messageEl = document.getElementById('message');

  const W = 720;
  const H = 1080;
  const FIELD = { cx: W / 2, cy: H / 2, rx: 326, ry: 500 };
  const GOAL_Y = 78;
  const GOAL_HALF = 95;

  const input = { x: 0, y: 0, a: false, b: false, c: false };
  let last = performance.now();
  let gameTime = 120;
  let running = true;
  let blueScore = 0;
  let redScore = 0;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const len = (x, y) => Math.hypot(x, y);
  const norm = (x, y) => {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  class Actor {
    constructor(x, y, team, isPlayer = false) {
      this.x = x; this.y = y; this.vx = 0; this.vy = 0;
      this.team = team; this.isPlayer = isPlayer;
      this.r = 25; this.speed = isPlayer ? 230 : 205;
      this.facing = team === 'blue' ? -Math.PI / 2 : Math.PI / 2;
      this.stun = 0; this.coolA = 0; this.coolB = 0; this.guard = false;
      this.hasBall = false;
    }

    update(dt) {
      this.stun = Math.max(0, this.stun - dt);
      this.coolA = Math.max(0, this.coolA - dt);
      this.coolB = Math.max(0, this.coolB - dt);
      this.guard = false;

      if (this.stun > 0) {
        this.vx *= Math.pow(0.03, dt);
        this.vy *= Math.pow(0.03, dt);
      } else if (this.isPlayer) {
        this.playerControl(dt);
      } else {
        this.aiControl(dt);
      }

      this.x += this.vx * dt;
      this.y += this.vy * dt;
      constrainActor(this);
    }

    playerControl(dt) {
      const m = Math.min(1, len(input.x, input.y));
      if (m > .08) {
        const n = norm(input.x, input.y);
        this.vx = n.x * this.speed * m;
        this.vy = n.y * this.speed * m;
        this.facing = Math.atan2(n.y, n.x);
      } else {
        this.vx *= Math.pow(.0008, dt);
        this.vy *= Math.pow(.0008, dt);
      }

      if (this.hasBall) {
        if (input.a) this.pass();
        if (input.b) this.shoot();
        if (input.c) this.guardBall();
      } else {
        if (input.a) this.slash();
        if (input.b) this.bash();
        if (input.c) this.guard = true;
      }
    }

    aiControl(dt) {
      const opponent = this.team === 'blue' ? enemy : player;
      let tx = ball.x, ty = ball.y;

      if (this.hasBall) {
        tx = FIELD.cx;
        ty = this.team === 'blue' ? FIELD.cy - 380 : FIELD.cy + 380;
        if (Math.abs(this.y - ty) < 250 && Math.abs(this.x - FIELD.cx) < 130) this.shoot();
        if (dist(this, opponent) < 85 && this.coolB <= 0) this.bash();
      } else if (opponent.hasBall) {
        tx = opponent.x; ty = opponent.y;
        if (dist(this, opponent) < 105) this.slash();
      } else if (ball.owner == null) {
        tx = ball.x; ty = ball.y;
      }

      const n = norm(tx - this.x, ty - this.y);
      this.vx = n.x * this.speed;
      this.vy = n.y * this.speed;
      this.facing = Math.atan2(n.y, n.x);
    }

    slash() {
      if (this.coolA > 0 || this.stun > 0) return;
      this.coolA = .48;
      strike(this, 90, .42, 230);
      pokeBall(this, 165);
    }

    bash() {
      if (this.coolB > 0 || this.stun > 0) return;
      this.coolB = 1.05;
      this.vx += Math.cos(this.facing) * 260;
      this.vy += Math.sin(this.facing) * 260;
      strike(this, 72, .6, 370);
      pokeBall(this, 230);
    }

    pass() {
      if (!this.hasBall || this.coolA > 0) return;
      this.coolA = .35;
      releaseBall(this, 500, .05);
    }

    shoot() {
      if (!this.hasBall || this.coolB > 0) return;
      this.coolB = .8;
      const targetY = this.team === 'blue' ? FIELD.cy - FIELD.ry - 120 : FIELD.cy + FIELD.ry + 120;
      const angle = Math.atan2(targetY - this.y, FIELD.cx - this.x);
      this.facing = angle;
      releaseBall(this, 760, 0);
    }

    guardBall() {
      this.guard = true;
      this.vx *= .54;
      this.vy *= .54;
    }
  }

  const ball = { x: W/2, y: H/2, vx: 0, vy: 0, r: 16, owner: null };
  const player = new Actor(W/2, H/2 + 250, 'blue', true);
  const enemy = new Actor(W/2, H/2 - 250, 'red', false);

  function strike(attacker, range, stun, force) {
    const target = attacker === player ? enemy : player;
    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const d = Math.hypot(dx, dy);
    const forward = (dx * Math.cos(attacker.facing) + dy * Math.sin(attacker.facing)) / (d || 1);
    if (d < range + target.r && forward > .25) {
      if (target.guard) return;
      target.stun = stun;
      const n = norm(dx, dy);
      target.vx += n.x * force;
      target.vy += n.y * force;
      if (target.hasBall) dropBall(target, force * .8);
    }
  }

  function pokeBall(actor, speed) {
    if (ball.owner || dist(actor, ball) > 82) return;
    const forward = (ball.x - actor.x) * Math.cos(actor.facing) + (ball.y - actor.y) * Math.sin(actor.facing);
    if (forward < 0) return;
    ball.vx += Math.cos(actor.facing) * speed;
    ball.vy += Math.sin(actor.facing) * speed;
  }

  function dropBall(actor, force = 230) {
    actor.hasBall = false;
    ball.owner = null;
    ball.x = actor.x + Math.cos(actor.facing) * 32;
    ball.y = actor.y + Math.sin(actor.facing) * 32;
    ball.vx = Math.cos(actor.facing) * force;
    ball.vy = Math.sin(actor.facing) * force;
  }

  function releaseBall(actor, speed, spread) {
    actor.hasBall = false;
    ball.owner = null;
    const angle = actor.facing + (Math.random() - .5) * spread;
    ball.x = actor.x + Math.cos(angle) * 36;
    ball.y = actor.y + Math.sin(angle) * 36;
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
  }

  function constrainActor(a) {
    const dx = (a.x - FIELD.cx) / (FIELD.rx - a.r);
    const dy = (a.y - FIELD.cy) / (FIELD.ry - a.r);
    const q = dx*dx + dy*dy;
    if (q > 1) {
      const s = 1 / Math.sqrt(q);
      a.x = FIELD.cx + dx * s * (FIELD.rx - a.r);
      a.y = FIELD.cy + dy * s * (FIELD.ry - a.r);
      a.vx *= .25; a.vy *= .25;
    }
  }

  function updateBall(dt) {
    if (ball.owner) {
      const a = ball.owner;
      ball.x = a.x + Math.cos(a.facing) * 31;
      ball.y = a.y + Math.sin(a.facing) * 31;
      ball.vx = a.vx; ball.vy = a.vy;
      return;
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vx *= Math.pow(.055, dt);
    ball.vy *= Math.pow(.055, dt);

    const dx = (ball.x - FIELD.cx) / (FIELD.rx - ball.r);
    const dy = (ball.y - FIELD.cy) / (FIELD.ry - ball.r);
    if (dx*dx + dy*dy > 1) {
      const n = norm((ball.x - FIELD.cx)/(FIELD.rx*FIELD.rx), (ball.y-FIELD.cy)/(FIELD.ry*FIELD.ry));
      const dot = ball.vx*n.x + ball.vy*n.y;
      ball.vx -= 1.75 * dot * n.x;
      ball.vy -= 1.75 * dot * n.y;
      ball.x -= n.x * 8; ball.y -= n.y * 8;
    }

    // Gate goal: ball must pass the horizontal sensor above/below the oval centerline.
    if (ball.y < FIELD.cy - FIELD.ry + GOAL_Y && Math.abs(ball.x - FIELD.cx) < GOAL_HALF && ball.vy < 0) score('blue');
    if (ball.y > FIELD.cy + FIELD.ry - GOAL_Y && Math.abs(ball.x - FIELD.cx) < GOAL_HALF && ball.vy > 0) score('red');

    for (const a of [player, enemy]) {
      if (a.stun <= 0 && dist(a, ball) < a.r + ball.r + 6 && len(ball.vx, ball.vy) < 420) {
        a.hasBall = true;
        ball.owner = a;
        ball.vx = ball.vy = 0;
        break;
      }
    }
  }

  function score(team) {
    if (!running) return;
    if (team === 'blue') blueScore++; else redScore++;
    blueScoreEl.textContent = blueScore;
    redScoreEl.textContent = redScore;
    flash(team === 'blue' ? 'GOAL!' : 'ENEMY GOAL');
    resetPositions();
  }

  function resetPositions() {
    player.x = W/2; player.y = H/2 + 250; player.vx = player.vy = 0; player.stun = 0; player.hasBall = false;
    enemy.x = W/2; enemy.y = H/2 - 250; enemy.vx = enemy.vy = 0; enemy.stun = 0; enemy.hasBall = false;
    ball.x = W/2; ball.y = H/2; ball.vx = ball.vy = 0; ball.owner = null;
  }

  function flash(text) {
    messageEl.textContent = text;
    messageEl.hidden = false;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => messageEl.hidden = true, 850);
  }

  function update(dt) {
    if (!running) return;
    gameTime = Math.max(0, gameTime - dt);
    if (gameTime <= 0) {
      running = false;
      flash(blueScore === redScore ? 'DRAW' : blueScore > redScore ? 'YOU WIN' : 'YOU LOSE');
    }

    player.update(dt);
    enemy.update(dt);
    updateBall(dt);

    // Separate actors.
    const dx = enemy.x - player.x, dy = enemy.y - player.y;
    const d = Math.hypot(dx,dy) || 1;
    const overlap = player.r + enemy.r - d;
    if (overlap > 0) {
      const nx = dx/d, ny = dy/d;
      player.x -= nx*overlap*.5; player.y -= ny*overlap*.5;
      enemy.x += nx*overlap*.5; enemy.y += ny*overlap*.5;
    }

    const sec = Math.ceil(gameTime);
    timerEl.textContent = `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = '#172a33';
    ctx.fillRect(0,0,W,H);

    // Field
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(FIELD.cx, FIELD.cy, FIELD.rx, FIELD.ry, 0, 0, Math.PI*2);
    ctx.fillStyle = '#213c43';
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#d7e1e5';
    ctx.stroke();
    ctx.setLineDash([16,16]);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(FIELD.cx-FIELD.rx+30, FIELD.cy); ctx.lineTo(FIELD.cx+FIELD.rx-30, FIELD.cy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(FIELD.cx, FIELD.cy, 82, 0, Math.PI*2); ctx.stroke();
    ctx.restore();

    drawGoal(FIELD.cy - FIELD.ry + GOAL_Y, 'blue');
    drawGoal(FIELD.cy + FIELD.ry - GOAL_Y, 'red');
    drawActor(player);
    drawActor(enemy);
    drawBall();
  }

  function drawGoal(y, team) {
    ctx.save();
    ctx.strokeStyle = team === 'blue' ? '#74c7ff' : '#ff8585';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(FIELD.cx-GOAL_HALF, y);
    ctx.lineTo(FIELD.cx+GOAL_HALF, y);
    ctx.stroke();
    ctx.globalAlpha = .22;
    ctx.lineWidth = 32;
    ctx.stroke();
    ctx.restore();
  }

  function drawActor(a) {
    ctx.save();
    ctx.translate(a.x,a.y);
    ctx.rotate(a.facing);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.26)';
    ctx.beginPath(); ctx.ellipse(-3,14,29,18,0,0,Math.PI*2); ctx.fill();

    // body and helmet
    ctx.fillStyle = a.team === 'blue' ? '#62b8f5' : '#ef6b6b';
    ctx.strokeStyle = '#071014'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(-21,-21,42,48,14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#dbe5e8';
    ctx.beginPath(); ctx.arc(0,-24,17,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#26333a'; ctx.fillRect(1,-31,14,6);

    // shield + sword, kept intentionally simple.
    ctx.fillStyle = '#d6a54d';
    ctx.fillRect(18,-5,45,7);
    ctx.strokeRect(18,-5,45,7);
    ctx.fillStyle = '#aab9c0';
    ctx.beginPath(); ctx.roundRect(-38,-16,17,35,6); ctx.fill(); ctx.stroke();

    if (a.guard) {
      ctx.strokeStyle = '#fff'; ctx.globalAlpha = .55; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(-10,0,43,-1.2,1.2); ctx.stroke();
    }
    if (a.stun > 0) {
      ctx.fillStyle = '#ffe368';
      ctx.beginPath(); ctx.arc(-12,-54,5,0,Math.PI*2); ctx.arc(4,-60,5,0,Math.PI*2); ctx.arc(17,-50,5,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function drawBall() {
    ctx.save();
    ctx.translate(ball.x,ball.y);
    ctx.fillStyle = '#f5f2de';
    ctx.strokeStyle = '#15191b'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0,0,ball.r,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-10,-3); ctx.lineTo(9,8); ctx.moveTo(4,-12); ctx.lineTo(-4,12); ctx.stroke();
    ctx.restore();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width*dpr);
    canvas.height = Math.round(rect.height*dpr);
    const scale = Math.min(canvas.width/W, canvas.height/H);
    const ox = (canvas.width-W*scale)/2;
    const oy = (canvas.height-H*scale)/2;
    ctx.setTransform(scale,0,0,scale,ox,oy);
  }

  function loop(now) {
    const dt = Math.min(.033, (now-last)/1000);
    last = now;
    update(dt); draw();
    requestAnimationFrame(loop);
  }

  // Touch stick
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stickKnob');
  let stickPointer = null;
  function moveStick(e) {
    const r = stick.getBoundingClientRect();
    let x = e.clientX - (r.left+r.width/2);
    let y = e.clientY - (r.top+r.height/2);
    const max = r.width*.32;
    const l = Math.hypot(x,y);
    if (l > max) { x=x/l*max; y=y/l*max; }
    knob.style.transform = `translate(${x}px,${y}px)`;
    input.x = x/max; input.y = y/max;
  }
  stick.addEventListener('pointerdown', e => { stickPointer=e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
  stick.addEventListener('pointermove', e => { if(e.pointerId===stickPointer) moveStick(e); });
  const stopStick = e => { if(e.pointerId!==stickPointer) return; stickPointer=null; input.x=input.y=0; knob.style.transform='translate(0,0)'; };
  stick.addEventListener('pointerup', stopStick); stick.addEventListener('pointercancel', stopStick);

  function bindButton(id, key) {
    const el = document.getElementById(id);
    const down = e => { e.preventDefault(); input[key]=true; el.classList.add('active'); };
    const up = e => { e.preventDefault(); input[key]=false; el.classList.remove('active'); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
  }
  bindButton('btnA','a'); bindButton('btnB','b'); bindButton('btnC','c');

  // Keyboard for desktop testing.
  const keys = new Set();
  addEventListener('keydown', e => { keys.add(e.code); if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault(); });
  addEventListener('keyup', e => keys.delete(e.code));
  setInterval(() => {
    input.x = (keys.has('ArrowRight')||keys.has('KeyD')?1:0) - (keys.has('ArrowLeft')||keys.has('KeyA')?1:0);
    input.y = (keys.has('ArrowDown')||keys.has('KeyS')?1:0) - (keys.has('ArrowUp')||keys.has('KeyW')?1:0);
    input.a = keys.has('KeyJ'); input.b = keys.has('KeyK'); input.c = keys.has('KeyL');
  }, 16);

  document.getElementById('restartBtn').addEventListener('click', () => {
    blueScore=redScore=0; gameTime=120; running=true; blueScoreEl.textContent='0'; redScoreEl.textContent='0'; messageEl.hidden=true; resetPositions();
  });

  addEventListener('resize', resize);
  resize(); resetPositions(); requestAnimationFrame(loop);
})();
