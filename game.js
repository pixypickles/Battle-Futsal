
"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const arena = {
  left: 52, right: W - 52, top: 34, floor: H - 48,
  goalY: 350, goalR: 44
};

const keys = new Set();
const pressed = new Set();

function setKey(code, down) {
  if (down) {
    if (!keys.has(code)) pressed.add(code);
    keys.add(code);
  } else keys.delete(code);
}

addEventListener("keydown", e => {
  setKey(e.code, true);
  if (["ArrowLeft","ArrowRight","KeyJ","KeyK","KeyL","KeyR","Space"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", e => setKey(e.code, false));

document.querySelectorAll("[data-key]").forEach(btn => {
  const code = btn.dataset.key;
  const down = e => { e.preventDefault(); setKey(code, true); };
  const up = e => { e.preventDefault(); setKey(code, false); };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", up);
});

const blueScoreEl = document.getElementById("blueScore");
const redScoreEl = document.getElementById("redScore");
const statusEl = document.getElementById("status");

const GRAVITY = 0.38;
const BALL_GRAVITY = 0.18;
const FLOOR_BOUNCE = 0.36;
const MAX_BALL_SPEED = 12.5;
const KICK_COOLDOWN = 22;
const ATTACK_COOLDOWN = 40;

const rand = (a,b)=>a+Math.random()*(b-a);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const len=(x,y)=>Math.hypot(x,y);

class Player {
  constructor(team, kind, x, ai=false) {
    this.team=team; this.kind=kind; this.x=x; this.y=arena.floor-32;
    this.vx=0; this.vy=0; this.r=24; this.ai=ai;
    this.facing=team==="blue"?1:-1;
    this.onGround=true; this.wall=0; this.wallTimer=0;
    this.jumpBuffer=0; this.kickTimer=0; this.attackTimer=0;
    this.airJumpAvailable=true;
    this.stun=0; this.anim=0; this.pose="idle";
  }
  update() {
    if(this.stun>0){this.stun--; this.vx*=.96;}
    if(this.kickTimer>0)this.kickTimer--;
    if(this.attackTimer>0)this.attackTimer--;
    if(this.jumpBuffer>0)this.jumpBuffer--;

    let move=0, jump=false, kick=false, attack=false;
    if(!this.ai){
      move=(keys.has("ArrowRight")||keys.has("KeyD")?1:0)-(keys.has("ArrowLeft")||keys.has("KeyA")?1:0);
      jump=pressed.has("KeyL")||pressed.has("Space");
      kick=pressed.has("KeyK");
      attack=pressed.has("KeyJ");
    } else {
      const target = predictBall();
      const dx = target.x - this.x;
      move=Math.abs(dx)>42?Math.sign(dx):0;
      const threat = Math.abs(ball.x-this.x)<170 && ball.y<this.y-35;
      jump=(this.onGround && (threat || Math.random()<.008)) || (this.wall && Math.random()<.04);
      kick=Math.abs(ball.x-this.x)<75 && Math.abs(ball.y-this.y)<78 && Math.random()<.14;
      attack=this.y<arena.floor-45 && nearestOpponent(this)<95 && Math.random()<.06;
    }

    if(jump)this.jumpBuffer=20;

    if(this.stun<=0){
      this.vx += move*(this.onGround?.65:.31);
      if(move)this.facing=move;
      this.vx*=this.onGround?.80:.95;
      this.vx=clamp(this.vx,-6.2,6.2);

      if(this.wall && this.jumpBuffer>0){
        this.vy=-17.0;
        this.vx=-this.wall*7.4;
        this.wall=0; this.wallTimer=0; this.jumpBuffer=0;
        this.airJumpAvailable=false;
      } else if(this.onGround && this.jumpBuffer>0){
        this.vy=-18.0; this.onGround=false; this.jumpBuffer=0;
        this.airJumpAvailable=true;
      } else if(!this.onGround && this.jumpBuffer>0 && this.airJumpAvailable){
        // 見えない奥壁を蹴るイメージの空中壁ジャンプ
        this.vy=-16.2;
        this.vx += move*2.6;
        this.airJumpAvailable=false;
        this.jumpBuffer=0;
        this.pose="walljump"; this.anim=12;
      }

      if(kick && this.kickTimer<=0){
        this.kickTimer=KICK_COOLDOWN; this.pose="kick"; this.anim=12;
        kickBall(this);
      }
      if(attack && this.attackTimer<=0){
        this.attackTimer=ATTACK_COOLDOWN; this.pose="attack"; this.anim=14;
        weaponAttack(this);
      }
    }

    this.vy += GRAVITY;
    this.x += this.vx; this.y += this.vy;

    this.onGround=false;
    if(this.y+this.r>=arena.floor){
      this.y=arena.floor-this.r;
      if(this.vy>4.2) this.vy=-Math.min(5.0,this.vy*FLOOR_BOUNCE);
      else {this.vy=0; this.onGround=true;}
      this.airJumpAvailable=true;
      if(this.jumpBuffer>0){this.vy=-18.0;this.onGround=false;this.jumpBuffer=0;}
    }
    if(this.y-this.r<arena.top){
      this.y=arena.top+this.r; this.vy=Math.abs(this.vy)*.45;
    }

    this.wall=0;
    if(this.x-this.r<arena.left){
      this.x=arena.left+this.r;
      if(!this.onGround){this.wall=-1;this.wallTimer=Math.min(24,this.wallTimer+1);this.vy*=.93;}
      this.vx=Math.max(0,this.vx);
    } else if(this.x+this.r>arena.right){
      this.x=arena.right-this.r;
      if(!this.onGround){this.wall=1;this.wallTimer=Math.min(24,this.wallTimer+1);this.vy*=.93;}
      this.vx=Math.min(0,this.vx);
    }

    if(this.anim>0)this.anim--; else this.pose=this.onGround?(Math.abs(this.vx)>1?"run":"idle"):"jump";
  }
  draw(){
    const blue=this.team==="blue";
    const c=blue?"#2db9ff":"#ff5277";
    ctx.save();ctx.translate(this.x,this.y);
    if(this.facing<0)ctx.scale(-1,1);

    // shadow
    ctx.save();ctx.scale(this.facing<0?-1:1,1);ctx.globalAlpha=.2;ctx.fillStyle="#000";
    ctx.beginPath();ctx.ellipse(0,arena.floor-this.y+20,27,7,0,0,Math.PI*2);ctx.fill();ctx.restore();

    // scarf / robe
    ctx.strokeStyle=c;ctx.lineWidth=8;ctx.lineCap="round";
    if(this.kind==="ninja"){
      ctx.beginPath();ctx.moveTo(-7,-28);ctx.quadraticCurveTo(-33,-34,-42,-20);ctx.stroke();
    }

    // body
    ctx.fillStyle=c;ctx.strokeStyle="#eafaff";ctx.lineWidth=3;
    ctx.beginPath();ctx.roundRect(-15,-24,30,39,8);ctx.fill();ctx.stroke();

    // head
    ctx.fillStyle=this.kind==="ninja"?"#132a38":"#f0bf8a";
    ctx.beginPath();ctx.arc(0,-38,15,0,Math.PI*2);ctx.fill();ctx.stroke();
    if(this.kind==="ninja"){ctx.fillStyle="#dff7ff";ctx.fillRect(-10,-41,20,5);}

    // arms and legs
    ctx.strokeStyle="#eafaff";ctx.lineWidth=7;
    let kick=this.pose==="kick";
    let air=!this.onGround;
    ctx.beginPath();
    if(kick){
      ctx.moveTo(-8,8);ctx.lineTo(7,17);
      ctx.moveTo(4,7);ctx.lineTo(32,-2);
    }else if(air){
      ctx.moveTo(-7,9);ctx.lineTo(-18,24);
      ctx.moveTo(5,9);ctx.lineTo(13,25);
    }else{
      ctx.moveTo(-7,10);ctx.lineTo(-10,28);
      ctx.moveTo(7,10);ctx.lineTo(10,28);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-12,-10);ctx.lineTo(-24,-1);
    ctx.moveTo(12,-10);ctx.lineTo(25,-16);
    ctx.stroke();

    if(this.kind==="staff"){
      ctx.strokeStyle="#d29a36";ctx.lineWidth=6;
      ctx.beginPath();ctx.moveTo(-30,-3);ctx.lineTo(34,-25);ctx.stroke();
    } else {
      ctx.fillStyle="#d7e2ea";ctx.beginPath();ctx.moveTo(24,-18);ctx.lineTo(36,-22);ctx.lineTo(29,-12);ctx.closePath();ctx.fill();
    }

    if(this.wall){
      ctx.strokeStyle="rgba(255,255,255,.75)";ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(0,0,32,0,Math.PI*2);ctx.stroke();
    }
    ctx.restore();
  }
}

class Ball {
  constructor(){this.reset();}
  reset(){
    this.x=W/2;this.y=arena.floor-85;this.vx=rand(-2,2);this.vy=-7;this.r=15;this.lastTouch=null;this.wallHits=0;
  }
  update(){
    this.vy+=BALL_GRAVITY;
    this.x+=this.vx;this.y+=this.vy;

    if(this.x-this.r<arena.left){
      if(this.y>arena.goalY-arena.goalR && this.y<arena.goalY+arena.goalR){score("red");return;}
      this.x=arena.left+this.r;this.vx=Math.abs(this.vx)*1.08;this.wallHits++;
    }
    if(this.x+this.r>arena.right){
      if(this.y>arena.goalY-arena.goalR && this.y<arena.goalY+arena.goalR){score("blue");return;}
      this.x=arena.right-this.r;this.vx=-Math.abs(this.vx)*1.08;this.wallHits++;
    }
    if(this.y-this.r<arena.top){this.y=arena.top+this.r;this.vy=Math.abs(this.vy)*.78;}
    if(this.y+this.r>arena.floor){
      this.y=arena.floor-this.r;this.vy=-Math.abs(this.vy)*.72;
      this.vx*=.96;
    }
    const s=len(this.vx,this.vy);
    if(s>MAX_BALL_SPEED){this.vx*=MAX_BALL_SPEED/s;this.vy*=MAX_BALL_SPEED/s;}
  }
  draw(){
    ctx.save();
    ctx.shadowColor="#9cecff";ctx.shadowBlur=18;
    ctx.fillStyle="#f4fbff";ctx.strokeStyle="#2bc1ff";ctx.lineWidth=4;
    ctx.beginPath();ctx.arc(this.x,this.y,this.r,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.strokeStyle="#175b78";ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(this.x,this.y,this.r*.55,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }
}

let blueScore=0, redScore=0;
const players=[
  new Player("blue","ninja",155,false),
  new Player("blue","staff",270,true),
  new Player("red","staff",450,true),
  new Player("red","ninja",565,true)
];
const ball=new Ball();

function nearestOpponent(p){
  let best=null,bd=1e9;
  for(const q of players) if(q.team!==p.team){
    const d=len(q.x-p.x,q.y-p.y);if(d<bd){bd=d;best=q;}
  }
  return best;
}
function predictBall(){
  const t=clamp((arena.floor-ball.y)/Math.max(1,ball.vy+7),6,36);
  return {x:clamp(ball.x+ball.vx*t,arena.left+30,arena.right-30),y:arena.floor-40};
}
function kickBall(p){
  const dx=ball.x-p.x,dy=ball.y-p.y,d=len(dx,dy);
  if(d<78){
    const air=!p.onGround;
    const power=air?10.2:8.4;
    const lift=air?-6.2:-8.8; // 低速で大きな弧を描く
    ball.vx=p.facing*power + p.vx*.55;
    ball.vy=lift + (air?p.vy*.18:0);
    ball.lastTouch=p.team;ball.wallHits=0;
  }
}
function weaponAttack(p){
  if(p.kind==="ninja"){
    projectiles.push({x:p.x+p.facing*25,y:p.y-12,vx:p.facing*12,life:70,team:p.team});
  }else{
    for(const q of players){
      if(q.team===p.team)continue;
      const dx=q.x-p.x,dy=q.y-p.y;
      if(Math.abs(dx)<88 && Math.abs(dy)<75){
        q.vy=Math.max(q.vy,9.5);q.stun=14;q.vx+=p.facing*2;
      }
    }
  }
}
const projectiles=[];
function updateProjectiles(){
  for(let i=projectiles.length-1;i>=0;i--){
    const k=projectiles[i];k.x+=k.vx;k.life--;
    for(const p of players){
      if(p.team===k.team)continue;
      if(len(p.x-k.x,p.y-k.y)<25){p.stun=18;p.vx+=Math.sign(k.vx)*2.5;projectiles.splice(i,1);break;}
    }
    if(i<projectiles.length && projectiles[i]===k && (k.life<=0||k.x<arena.left||k.x>arena.right))projectiles.splice(i,1);
  }
}
function separatePlayers(){
  for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++){
    const a=players[i],b=players[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.max(.01,len(dx,dy)),min=46;
    if(d<min){const push=(min-d)*.5,nx=dx/d,ny=dy/d;a.x-=nx*push;b.x+=nx*push;a.y-=ny*push*.35;b.y+=ny*push*.35;}
  }
}
function score(team){
  if(team==="blue")blueScore++;else redScore++;
  blueScoreEl.textContent=blueScore;redScoreEl.textContent=redScore;
  statusEl.textContent=(team==="blue"?"BLUE":"RED")+" GOAL!";
  ball.reset();
  players.forEach((p,i)=>{p.x=[155,270,450,565][i];p.y=arena.floor-32;p.vx=p.vy=0;p.airJumpAvailable=true;});
  setTimeout(()=>statusEl.textContent="A: 武器　B: キック　C: ジャンプ",700);
}

function drawArena(){
  ctx.clearRect(0,0,W,H);
  const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,"#0d2d43");g.addColorStop(1,"#06131c");
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  // height bands
  const bands=[
    {y:arena.floor-150,c:"#188ee5"},
    {y:arena.floor-330,c:"#25d8d0"},
    {y:arena.goalY,c:"#f6d43a"},
    {y:arena.top+150,c:"#d9df6b"}
  ];
  ctx.lineWidth=2;
  bands.forEach((b,i)=>{
    ctx.strokeStyle=b.c;ctx.globalAlpha=.34;
    ctx.beginPath();ctx.moveTo(arena.left,b.y);ctx.lineTo(arena.right,b.y);ctx.stroke();
    ctx.globalAlpha=.8;ctx.fillStyle=b.c;ctx.font="12px system-ui";ctx.fillText(["LOW","MID","GOAL","HIGH"][i],arena.left+8,b.y-7);
  });
  ctx.globalAlpha=1;

  // arena box
  ctx.strokeStyle="#74d7ef";ctx.lineWidth=4;
  ctx.strokeRect(arena.left,arena.top,arena.right-arena.left,arena.floor-arena.top);
  ctx.beginPath();ctx.moveTo(arena.left,arena.top);ctx.quadraticCurveTo(W/2,4,arena.right,arena.top);ctx.stroke();

  // trampoline floor
  ctx.strokeStyle="#7af5e5";ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(arena.left,arena.floor);ctx.lineTo(arena.right,arena.floor);ctx.stroke();

  drawGoal(arena.left,arena.goalY,"#25baff","BLUE");
  drawGoal(arena.right,arena.goalY,"#ff4b70","RED");
}
function drawGoal(x,y,c,label){
  ctx.save();ctx.strokeStyle=c;ctx.shadowColor=c;ctx.shadowBlur=18;ctx.lineWidth=9;
  ctx.beginPath();ctx.arc(x,y,arena.goalR,Math.PI/2,Math.PI*1.5);ctx.stroke();
  ctx.shadowBlur=0;ctx.fillStyle=c;ctx.font="bold 15px system-ui";ctx.textAlign=x< W/2?"left":"right";
  ctx.fillText(label+" GOAL",x+(x<W/2?18:-18),y+arena.goalR+28);ctx.restore();
}
function drawProjectiles(){
  ctx.strokeStyle="#d7e2ea";ctx.lineWidth=3;
  projectiles.forEach(k=>{ctx.beginPath();ctx.moveTo(k.x-10*Math.sign(k.vx),k.y);ctx.lineTo(k.x+6*Math.sign(k.vx),k.y);ctx.stroke();});
}

function update(){
  if(pressed.has("KeyR")){blueScore=redScore=0;blueScoreEl.textContent=0;redScoreEl.textContent=0;ball.reset();players.forEach((p,i)=>{p.x=[155,270,450,565][i];p.y=arena.floor-32;p.vx=p.vy=0;p.airJumpAvailable=true;});}
  players.forEach(p=>p.update());
  separatePlayers();
  updateProjectiles();
  ball.update();
  pressed.clear();
}
function draw(){
  drawArena();ball.draw();drawProjectiles();
  players.sort((a,b)=>a.y-b.y).forEach(p=>p.draw());
}
let last=performance.now(),acc=0;
function loop(t){
  acc+=Math.min(50,t-last);last=t;
  while(acc>=1000/60){update();acc-=1000/60;}
  draw();requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
