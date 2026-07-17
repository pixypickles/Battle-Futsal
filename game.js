(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const blueScoreEl = document.getElementById('blueScore');
  const redScoreEl = document.getElementById('redScore');
  const timerEl = document.getElementById('timer');
  const messageEl = document.getElementById('message');

  const W = 720, H = 1080;
  const FIELD = { r: 310 };
  const GOAL = { y: 286, radius: 43, height: 158 };
  const effects = [];
  let shake = 0, hitStop = 0;
  const input = { x:0, y:0, a:false, b:false, c:false };
  let last = performance.now(), gameTime = 120, running = true;
  let blueScore = 0, redScore = 0;

  const len = (x,y) => Math.hypot(x,y);
  const norm = (x,y) => { const l=Math.hypot(x,y)||1; return {x:x/l,y:y/l}; };
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);

  // Oblique camera: world Y goes into screen depth, Z goes upward.
  function project(x,y,z=0){
    const depth = (y + FIELD.r) / (FIELD.r*2); // 0 back, 1 front
    const s = 0.78 + depth*0.22;
    return { x: W/2 + x*s, y: 245 + (y+FIELD.r)*0.86 - z*0.92, s };
  }

  class Actor {
    constructor(x,y,team,isPlayer=false){
      Object.assign(this,{x,y,team,isPlayer,vx:0,vy:0,r:23,stun:0,coolA:0,coolB:0,guard:false,hasBall:false});
      this.speed = isPlayer ? 225 : 205;
      this.facing = team==='blue' ? -Math.PI/2 : Math.PI/2;
    }
    update(dt){
      this.stun=Math.max(0,this.stun-dt); this.coolA=Math.max(0,this.coolA-dt); this.coolB=Math.max(0,this.coolB-dt); this.guard=false;
      if(this.stun>0){ this.vx*=Math.pow(.03,dt); this.vy*=Math.pow(.03,dt); }
      else if(this.isPlayer) this.playerControl(); else this.aiControl();
      this.x+=this.vx*dt; this.y+=this.vy*dt; constrainActor(this);
    }
    playerControl(){
      const m=Math.min(1,len(input.x,input.y));
      if(m>.08){ const n=norm(input.x,input.y); this.vx=n.x*this.speed*m; this.vy=n.y*this.speed*m; this.facing=Math.atan2(n.y,n.x); }
      else { this.vx*=.82; this.vy*=.82; }
      if(this.hasBall){ if(input.a)this.pass(); if(input.b)this.shoot(); if(input.c)this.guardBall(); }
      else { if(input.a)this.slash(); if(input.b)this.bash(); if(input.c)this.guard=true; }
    }
    aiControl(){
      const opponent=this.team==='blue'?enemy:player;
      let tx=ball.x, ty=ball.y;
      if(this.hasBall){ ty=this.team==='blue'?-230:230; tx=0; if(Math.abs(this.y-ty)<150)this.shoot(); }
      else if(opponent.hasBall){ tx=opponent.x; ty=opponent.y; if(dist(this,opponent)<96)this.slash(); }
      const n=norm(tx-this.x,ty-this.y); this.vx=n.x*this.speed; this.vy=n.y*this.speed; this.facing=Math.atan2(n.y,n.x);
    }
    slash(){ if(this.coolA>0||this.stun>0)return; this.coolA=.48; strike(this,91,.58,430,'SLASH'); pokeBall(this,185); }
    bash(){ if(this.coolB>0||this.stun>0)return; this.coolB=1.05; this.vx+=Math.cos(this.facing)*330; this.vy+=Math.sin(this.facing)*330; strike(this,78,.82,620,'BASH'); pokeBall(this,280); }
    pass(){ if(!this.hasBall||this.coolA>0)return; this.coolA=.34; releaseBall(this,460,80); }
    shoot(){
      if(!this.hasBall||this.coolB>0)return;
      this.coolB=.9;
      const ty=this.team==='blue'?-GOAL.y:GOAL.y;
      const desired=Math.atan2(ty-this.y,-this.x);
      const delta=angleDiff(desired,this.facing);
      // Only mild aim assist. Facing the ring still matters.
      this.facing += Math.max(-.18,Math.min(.18,delta*.28));
      if(!this.isPlayer) this.facing += (Math.random()-.5)*.20;
      releaseBall(this,610,455);
    }
    guardBall(){ this.guard=true; this.vx*=.54; this.vy*=.54; }
  }

  const ball={x:0,y:0,z:12,vx:0,vy:0,vz:0,r:14,owner:null,prevY:0};
  const player=new Actor(0,170,'blue',true), enemy=new Actor(0,-170,'red',false);

  function angleDiff(a,b){ return Math.atan2(Math.sin(a-b),Math.cos(a-b)); }
  function strike(attacker,range,stun,force,label){
    const target=attacker===player?enemy:player, dx=target.x-attacker.x, dy=target.y-attacker.y, d=Math.hypot(dx,dy);
    const forward=(dx*Math.cos(attacker.facing)+dy*Math.sin(attacker.facing))/(d||1);
    if(d<range+target.r&&forward>.18&&!target.guard){
      target.stun=Math.max(target.stun,stun);
      const n=norm(dx,dy);
      target.vx=n.x*force; target.vy=n.y*force;
      target.x+=n.x*12; target.y+=n.y*12;
      if(target.hasBall)dropBall(target,force*.95);
      effects.push({x:target.x,y:target.y,z:38,t:.28,label});
      shake=Math.max(shake,label==='BASH'?16:10);
      hitStop=Math.max(hitStop,label==='BASH'?.075:.045);
    }
  }
  function pokeBall(actor,speed){
    if(ball.owner||ball.z>24||dist(actor,ball)>82)return;
    const f=(ball.x-actor.x)*Math.cos(actor.facing)+(ball.y-actor.y)*Math.sin(actor.facing); if(f<0)return;
    ball.vx+=Math.cos(actor.facing)*speed; ball.vy+=Math.sin(actor.facing)*speed; ball.vz=Math.max(ball.vz,55);
  }
  function dropBall(actor,force=230){ actor.hasBall=false; ball.owner=null; ball.x=actor.x+Math.cos(actor.facing)*32; ball.y=actor.y+Math.sin(actor.facing)*32; ball.z=16; ball.vx=Math.cos(actor.facing)*force; ball.vy=Math.sin(actor.facing)*force; ball.vz=80; }
  function releaseBall(actor,speed,lift){ actor.hasBall=false; ball.owner=null; ball.x=actor.x+Math.cos(actor.facing)*35; ball.y=actor.y+Math.sin(actor.facing)*35; ball.z=18; ball.vx=Math.cos(actor.facing)*speed; ball.vy=Math.sin(actor.facing)*speed; ball.vz=lift; }

  function constrainActor(a){ const d=Math.hypot(a.x,a.y), max=FIELD.r-a.r; if(d>max){ a.x=a.x/d*max; a.y=a.y/d*max; a.vx*=.25; a.vy*=.25; } }

  function updateBall(dt){
    if(ball.owner){ const a=ball.owner; ball.x=a.x+Math.cos(a.facing)*30; ball.y=a.y+Math.sin(a.facing)*30; ball.z=14; ball.vx=a.vx; ball.vy=a.vy; ball.vz=0; return; }
    ball.prevY=ball.y;
    ball.x+=ball.vx*dt; ball.y+=ball.vy*dt; ball.z+=ball.vz*dt; ball.vz-=850*dt;
    if(ball.z<=ball.r){ ball.z=ball.r; if(ball.vz<0)ball.vz*=-.42; ball.vx*=Math.pow(.12,dt); ball.vy*=Math.pow(.12,dt); }
    const d=Math.hypot(ball.x,ball.y), max=FIELD.r-ball.r;
    if(d>max){ const nx=ball.x/d, ny=ball.y/d, dot=ball.vx*nx+ball.vy*ny; ball.x=nx*max; ball.y=ny*max; ball.vx-=1.75*dot*nx; ball.vy-=1.75*dot*ny; }

    checkRingGoal(-GOAL.y,'blue'); checkRingGoal(GOAL.y,'red');
    for(const a of [player,enemy]) if(a.stun<=0&&ball.z<34&&dist(a,ball)<a.r+ball.r+7&&len(ball.vx,ball.vy)<430){ a.hasBall=true; ball.owner=a; ball.vx=ball.vy=ball.vz=0; break; }
  }
  function checkRingGoal(goalY,team){
    const crossed = goalY<0 ? (ball.prevY>goalY && ball.y<=goalY) : (ball.prevY<goalY && ball.y>=goalY);
    if(!crossed)return;
    const inside=Math.hypot(ball.x,ball.z-GOAL.height)<GOAL.radius-ball.r*.72;
    const usefulArc=ball.vz<170; // very steep rising shots do not count as clean ring entries
    if(inside && usefulArc && (team==='blue'?ball.vy<0:ball.vy>0)) score(team);
  }

  function score(team){ if(!running)return; team==='blue'?blueScore++:redScore++; blueScoreEl.textContent=blueScore; redScoreEl.textContent=redScore; flash(team==='blue'?'RING GOAL!':'ENEMY GOAL'); resetPositions(); }
  function resetPositions(){ Object.assign(player,{x:0,y:170,vx:0,vy:0,stun:0,hasBall:false}); Object.assign(enemy,{x:0,y:-170,vx:0,vy:0,stun:0,hasBall:false}); Object.assign(ball,{x:0,y:0,z:14,vx:0,vy:0,vz:0,owner:null,prevY:0}); effects.length=0; shake=0; hitStop=0; }
  function flash(text){ messageEl.textContent=text; messageEl.hidden=false; clearTimeout(flash.t); flash.t=setTimeout(()=>messageEl.hidden=true,850); }

  function update(dt){
    if(hitStop>0){ hitStop-=dt; updateEffects(dt); return; }
    if(!running)return; gameTime=Math.max(0,gameTime-dt); if(gameTime<=0){running=false;flash(blueScore===redScore?'DRAW':blueScore>redScore?'YOU WIN':'YOU LOSE');}
    player.update(dt); enemy.update(dt); updateBall(dt); updateEffects(dt);
    const dx=enemy.x-player.x,dy=enemy.y-player.y,d=Math.hypot(dx,dy)||1,o=player.r+enemy.r-d; if(o>0){const nx=dx/d,ny=dy/d;player.x-=nx*o*.5;player.y-=ny*o*.5;enemy.x+=nx*o*.5;enemy.y+=ny*o*.5;}
    const sec=Math.ceil(gameTime); timerEl.textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  }

  function updateEffects(dt){
    for(let i=effects.length-1;i>=0;i--){ effects[i].t-=dt; effects[i].z+=75*dt; if(effects[i].t<=0)effects.splice(i,1); }
    shake=Math.max(0,shake-42*dt);
  }

  function draw(){
    ctx.save();
    if(shake>0)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
    ctx.clearRect(-30,-30,W+60,H+60); const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#182a34'); g.addColorStop(1,'#0b1218'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    drawArena();
    // back-to-front painter order
    const items=[{y:-GOAL.y-2,fn:()=>drawGoal(-GOAL.y,'red')},{y:player.y,fn:()=>drawActor(player)},{y:enemy.y,fn:()=>drawActor(enemy)},{y:ball.y,fn:drawBall},{y:GOAL.y+2,fn:()=>drawGoal(GOAL.y,'blue')}];
    items.sort((a,b)=>a.y-b.y).forEach(i=>i.fn());
    drawEffects();
    ctx.restore();
  }

  function drawArena(){
    const c=project(0,0,0), rx=FIELD.r*.99, ry=FIELD.r*.86;
    ctx.save(); ctx.beginPath(); ctx.ellipse(c.x,c.y,rx,ry,0,0,Math.PI*2); ctx.fillStyle='#24434a'; ctx.fill();
    ctx.strokeStyle='#d9e4e7'; ctx.lineWidth=5; ctx.stroke();
    ctx.globalAlpha=.25; ctx.lineWidth=24; ctx.strokeStyle='#8fa9b2'; ctx.beginPath(); ctx.ellipse(c.x,c.y+7,rx,ry,0,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha=1;
    ctx.setLineDash([14,14]); ctx.lineWidth=3; ctx.beginPath(); const l=project(-FIELD.r,0),r=project(FIELD.r,0);ctx.moveTo(l.x,l.y);ctx.lineTo(r.x,r.y);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath(); ctx.ellipse(c.x,c.y,70,60,0,0,Math.PI*2); ctx.stroke(); ctx.restore();
  }

  function drawGoal(y,team){
    const base=project(0,y,0), top=project(0,y,GOAL.height), scale=top.s;
    const rx=GOAL.radius*scale, ry=GOAL.radius*.92;
    ctx.save();
    ctx.strokeStyle=team==='blue'?'#69c6ff':'#ff7f7f'; ctx.lineCap='round';
    ctx.globalAlpha=.25; ctx.lineWidth=20; ctx.beginPath(); ctx.ellipse(top.x,top.y,rx,ry,0,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=1; ctx.lineWidth=8; ctx.beginPath(); ctx.moveTo(base.x,base.y);ctx.lineTo(top.x,top.y+ry);ctx.stroke();
    ctx.lineWidth=10; ctx.beginPath(); ctx.ellipse(top.x,top.y,rx,ry,0,0,Math.PI*2);ctx.stroke();
    ctx.globalAlpha=.2;ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.ellipse(top.x,top.y,rx-7,ry-7,0,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  function drawActor(a){
    const p=project(a.x,a.y,0), s=p.s;
    ctx.save(); ctx.translate(p.x,p.y); ctx.scale(s,s);
    ctx.fillStyle='rgba(0,0,0,.28)';ctx.beginPath();ctx.ellipse(0,8,28,12,0,0,Math.PI*2);ctx.fill();
    ctx.rotate(a.facing+Math.PI/2);
    ctx.strokeStyle='#071014';ctx.lineWidth=4;ctx.fillStyle=a.team==='blue'?'#62b8f5':'#ef6b6b';ctx.beginPath();ctx.roundRect(-20,-38,40,45,13);ctx.fill();ctx.stroke();
    ctx.fillStyle='#dce5e8';ctx.beginPath();ctx.arc(0,-44,16,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#26333a';ctx.fillRect(-12,-48,24,6);
    ctx.fillStyle='#d6a54d';ctx.fillRect(18,-27,8,47);ctx.strokeRect(18,-27,8,47);ctx.fillStyle='#aab9c0';ctx.beginPath();ctx.roundRect(-34,-28,17,36,6);ctx.fill();ctx.stroke();
    if(a.guard){ctx.strokeStyle='#fff';ctx.globalAlpha=.6;ctx.lineWidth=6;ctx.beginPath();ctx.arc(-9,-10,42,-1.1,1.1);ctx.stroke();}
    if(a.stun>0){ctx.fillStyle='#ffe368';ctx.beginPath();ctx.arc(-12,-68,5,0,7);ctx.arc(4,-74,5,0,7);ctx.arc(17,-65,5,0,7);ctx.fill();}
    ctx.restore();
  }

  function drawEffects(){
    for(const e of effects){
      const p=project(e.x,e.y,e.z);
      const k=Math.max(0,e.t/.28);
      ctx.save();ctx.translate(p.x,p.y);ctx.globalAlpha=k;
      ctx.strokeStyle='#fff';ctx.lineWidth=5;
      for(let i=0;i<7;i++){const a=i*Math.PI*2/7;ctx.beginPath();ctx.moveTo(Math.cos(a)*18,Math.sin(a)*18);ctx.lineTo(Math.cos(a)*(46+(1-k)*24),Math.sin(a)*(46+(1-k)*24));ctx.stroke();}
      ctx.font='900 22px system-ui';ctx.textAlign='center';ctx.fillStyle='#ffe86f';ctx.fillText(e.label,0,-38-(1-k)*18);ctx.restore();
    }
  }

  function drawBall(){
    const shadow=project(ball.x,ball.y,0), p=project(ball.x,ball.y,ball.z);
    ctx.save();ctx.fillStyle='rgba(0,0,0,.3)';ctx.beginPath();ctx.ellipse(shadow.x,shadow.y,16*p.s,7*p.s,0,0,7);ctx.fill();
    ctx.translate(p.x,p.y);ctx.fillStyle='#f5f2de';ctx.strokeStyle='#15191b';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,ball.r*p.s,0,7);ctx.fill();ctx.stroke();ctx.restore();
  }

  function resize(){ const rect=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1); canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const scale=Math.min(canvas.width/W,canvas.height/H),ox=(canvas.width-W*scale)/2,oy=(canvas.height-H*scale)/2;ctx.setTransform(scale,0,0,scale,ox,oy); }
  function loop(now){const dt=Math.min(.033,(now-last)/1000);last=now;update(dt);draw();requestAnimationFrame(loop);}

  const stick=document.getElementById('stick'),knob=document.getElementById('stickKnob');let stickPointer=null;
  function moveStick(e){const r=stick.getBoundingClientRect();let x=e.clientX-(r.left+r.width/2),y=e.clientY-(r.top+r.height/2),max=r.width*.32,l=Math.hypot(x,y);if(l>max){x=x/l*max;y=y/l*max;}knob.style.transform=`translate(${x}px,${y}px)`;input.x=x/max;input.y=y/max;}
  stick.addEventListener('pointerdown',e=>{stickPointer=e.pointerId;stick.setPointerCapture(e.pointerId);moveStick(e)});stick.addEventListener('pointermove',e=>{if(e.pointerId===stickPointer)moveStick(e)});const stop=e=>{if(e.pointerId!==stickPointer)return;stickPointer=null;input.x=input.y=0;knob.style.transform='translate(0,0)'};stick.addEventListener('pointerup',stop);stick.addEventListener('pointercancel',stop);
  function bind(id,key){const el=document.getElementById(id),down=e=>{e.preventDefault();input[key]=true;el.classList.add('active')},up=e=>{e.preventDefault();input[key]=false;el.classList.remove('active')};el.addEventListener('pointerdown',down);['pointerup','pointercancel','pointerleave'].forEach(t=>el.addEventListener(t,up));}
  bind('btnA','a');bind('btnB','b');bind('btnC','c');
  const keys=new Set();addEventListener('keydown',e=>{keys.add(e.code);if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault()});addEventListener('keyup',e=>keys.delete(e.code));setInterval(()=>{input.x=(keys.has('ArrowRight')||keys.has('KeyD')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')?1:0);input.y=(keys.has('ArrowDown')||keys.has('KeyS')?1:0)-(keys.has('ArrowUp')||keys.has('KeyW')?1:0);input.a=keys.has('KeyJ');input.b=keys.has('KeyK');input.c=keys.has('KeyL')},16);
  document.getElementById('restartBtn').addEventListener('click',()=>{blueScore=redScore=0;gameTime=120;running=true;blueScoreEl.textContent='0';redScoreEl.textContent='0';messageEl.hidden=true;resetPositions()});
  addEventListener('resize',resize);resize();resetPositions();requestAnimationFrame(loop);
})();
