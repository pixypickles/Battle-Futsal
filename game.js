
"use strict";

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    r=Math.min(r,w/2,h/2);
    this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);
    this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);
    this.arcTo(x,y,x+w,y,r);return this;
  };
}


const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const arena = {
  left: 52, right: W - 52, top: 34, floor: H - 48,
  goalY: 455, goalR: 44
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

const GRAVITY = 0.31;
const BALL_GRAVITY = 0.10;
const FLOOR_BOUNCE = 0.36;
const MAX_BALL_SPEED = 9.2;
const KICK_COOLDOWN = 12;
const ATTACK_COOLDOWN = 22;

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
    this.stun=0; this.hitFlash=0; this.anim=0; this.pose="idle"; this.downHeld=false; this.attackType="thrust";
  }
  update() {
    if(this.stun>0){this.stun--; this.vx*=.96;} if(this.hitFlash>0)this.hitFlash--;
    if(this.kickTimer>0)this.kickTimer--;
    if(this.attackTimer>0)this.attackTimer--;
    if(this.jumpBuffer>0)this.jumpBuffer--;

    let move=0, jump=false, kick=false, attack=false;
    if(!this.ai){
      move=(keys.has("ArrowRight")||keys.has("KeyD")?1:0)-(keys.has("ArrowLeft")||keys.has("KeyA")?1:0);
      this.downHeld=keys.has("ArrowDown")||keys.has("KeyS");
      jump=pressed.has("KeyL")||pressed.has("Space");
      kick=(!this.onGround && keys.has("KeyK")) || pressed.has("KeyK");
      attack=(!this.onGround && keys.has("KeyJ")) || pressed.has("KeyJ");
    } else {
      const target = predictBall();
      const dx = target.x - this.x;
      move=Math.abs(dx)>42?Math.sign(dx):0;
      const threat = Math.abs(ball.x-this.x)<170 && ball.y<this.y-35;
      jump=(this.onGround && (threat || Math.random()<.008)) || (this.wall && Math.random()<.04);
      kick=Math.abs(ball.x-this.x)<112 && Math.abs(ball.y-this.y)<105 && Math.random()<.22;
      {
        const opp=nearestOpponentObj(this);
        this.downHeld=!!opp && !this.onGround && opp.y>this.y+24 && Math.abs(opp.x-this.x)<105;
        attack=this.y<arena.floor-45 && nearestOpponent(this)<135 && Math.random()<.13;
      }
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
      const impact=Math.abs(this.vx);
      this.x=arena.left+this.r;
      if(impact>9){
        this.vx=0;
        this.vy=Math.max(-1.8,Math.min(this.vy,4.5));
        this.stun=Math.max(this.stun,25);this.hitFlash=10;
        hitBursts.push({x:this.x,y:this.y,life:18,color:"#ffffff"});
      }else{
        if(!this.onGround){this.wall=-1;this.wallTimer=Math.min(24,this.wallTimer+1);this.vy*=.93;}
        this.vx=0;
      }
    } else if(this.x+this.r>arena.right){
      const impact=Math.abs(this.vx);
      this.x=arena.right-this.r;
      if(impact>9){
        this.vx=0;
        this.vy=Math.max(-1.8,Math.min(this.vy,4.5));
        this.stun=Math.max(this.stun,25);this.hitFlash=10;
        hitBursts.push({x:this.x,y:this.y,life:18,color:"#ffffff"});
      }else{
        if(!this.onGround){this.wall=1;this.wallTimer=Math.min(24,this.wallTimer+1);this.vy*=.93;}
        this.vx=0;
      }
    }

    // Safety clamp: a player can never leave the visible arena.
    this.x=clamp(this.x,arena.left+this.r,arena.right-this.r);
    this.y=clamp(this.y,arena.top+this.r,arena.floor-this.r);

    if(this.anim>0)this.anim--; else this.pose=this.onGround?(Math.abs(this.vx)>1?"run":"idle"):"jump";
  }

  draw(){
    drawCharacter(this);
  }
}


function lerp(a,b,t){ return a+(b-a)*t; }
function easeOut(t){ return 1-Math.pow(1-t,3); }
function limb(x,y,len1,a1,len2,a2,width,color){
  const x1=x+Math.cos(a1)*len1, y1=y+Math.sin(a1)*len1;
  const x2=x1+Math.cos(a2)*len2, y2=y1+Math.sin(a2)*len2;
  ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap="round";
  ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.fillStyle=color; ctx.beginPath(); ctx.arc(x2,y2,width*.46,0,Math.PI*2); ctx.fill();
  return {x:x2,y:y2,kx:x1,ky:y1};
}
function poseFor(p){
  const air=!p.onGround;
  const phase=(performance.now()/120)%6.28;
  const t=p.anim>0 ? 1-p.anim/14 : 1;
  const pose={
    bodyRot:0, hipY:0, headY:0,
    armF1:-0.35,armF2:0.1,armB1:-2.8,armB2:-3.0,
    legF1:1.2,legF2:1.45,legB1:1.9,legB2:1.55,
    scarf:0.25
  };
  if(p.pose==="run"){
    const s=Math.sin(phase*1.7);
    pose.bodyRot=s*.06;
    pose.armF1=-.4-s*.7; pose.armF2=.2-s*.35;
    pose.armB1=-2.7+s*.7; pose.armB2=-3.0+s*.35;
    pose.legF1=1.25+s*.65; pose.legF2=1.55+s*.45;
    pose.legB1=1.9-s*.65; pose.legB2=1.55-s*.45;
    pose.hipY=Math.abs(s)*2;
  } else if(p.pose==="kick"){
    const k=easeOut(clamp(t,0,1));
    pose.bodyRot=-.20*k;
    pose.armF1=-.55; pose.armF2=-.15;
    pose.armB1=-2.55; pose.armB2=-2.8;
    if(air){
      pose.legF1=lerp(1.25,-0.08,k);
      pose.legF2=lerp(1.45,-0.02,k);
      pose.legB1=2.0; pose.legB2=1.35;
    }else{
      pose.legF1=lerp(1.35,-0.03,k);
      pose.legF2=lerp(1.6,0.02,k);
      pose.legB1=1.92; pose.legB2=1.52;
      pose.hipY=3;
    }
  } else if(p.pose==="attack"){
    const k=easeOut(clamp(t,0,1));
    if(p.attackType==="down"){
      pose.bodyRot=.32*k;
      pose.armF1=lerp(-1.05,1.35,k);pose.armF2=lerp(-.75,1.48,k);
      pose.armB1=lerp(-2.1,1.78,k);pose.armB2=lerp(-2.35,1.48,k);
      pose.legF1=.95;pose.legF2=1.55;pose.legB1=2.15;pose.legB2=1.35;
    }else{
      pose.bodyRot=-.20*k;
      pose.armF1=lerp(-1.2,-.02,k);pose.armF2=lerp(-.8,-.02,k);
      pose.armB1=lerp(-2.0,-.12,k);pose.armB2=lerp(-2.35,-.04,k);
      pose.legF1=1.18;pose.legF2=1.48;pose.legB1=1.95;pose.legB2=1.55;
    }
  } else if(p.stun>0){
    pose.bodyRot=.55;
    pose.armF1=.7;pose.armF2=1.15;pose.armB1=2.3;pose.armB2=1.95;
    pose.legF1=.75;pose.legF2=1.05;pose.legB1=2.35;pose.legB2=2.0;
  } else if(p.wall){
    pose.bodyRot=-p.wall*.25;
    pose.armF1=-.2;pose.armF2=.45;pose.armB1=-2.85;pose.armB2=-2.35;
    pose.legF1=.65;pose.legF2=1.2;pose.legB1=2.45;pose.legB2=1.95;
  } else if(air){
    if(p.vy<0){
      pose.bodyRot=-.08;
      pose.armF1=-.55;pose.armF2=-.15;pose.armB1=-2.55;pose.armB2=-2.9;
      pose.legF1=.9;pose.legF2=1.55;pose.legB1=2.1;pose.legB2=1.25;
    }else{
      pose.bodyRot=.10;
      pose.armF1=-.25;pose.armF2=.3;pose.armB1=-2.9;pose.armB2=-2.6;
      pose.legF1=1.05;pose.legF2=1.55;pose.legB1=2.0;pose.legB2=1.4;
    }
  } else {
    const b=Math.sin(phase)*.03;
    pose.bodyRot=b;pose.hipY=Math.sin(phase)*1.2;
  }
  return pose;
}
function drawCharacter(p){
  const team=p.team==="blue"?"#2e9eea":"#db4059";
  const trim=p.team==="blue"?"#bcecff":"#ffd2d9";
  const skin="#dfb17c";
  const outline="#07111c";
  const air=!p.onGround;
  const run=Math.sin(performance.now()/85+p.x*.03);
  const attack=p.pose==="attack";
  const kick=p.pose==="kick";
  const hurt=p.stun>0;

  ctx.save();
  ctx.translate(p.x,p.y);
  if(p.facing<0)ctx.scale(-1,1);
  if(p.hitFlash>0){ctx.shadowColor="#fff";ctx.shadowBlur=22;}

  // Shadow
  ctx.save();
  ctx.globalAlpha=.20;ctx.fillStyle="#000";
  ctx.beginPath();ctx.ellipse(0,arena.floor-p.y+25,27,7,0,0,Math.PI*2);ctx.fill();
  ctx.restore();

  let bodyRot=0;
  if(hurt)bodyRot=.55;
  else if(attack && p.attackType==="down")bodyRot=.24;
  else if(attack)bodyRot=-.14;
  else if(air)bodyRot=p.vy<0?-.08:.08;
  ctx.rotate(bodyRot);

  // Legs: clear, chunky silhouette like the early prototype.
  ctx.strokeStyle=outline;ctx.lineWidth=10;ctx.lineCap="round";
  ctx.beginPath();
  if(kick){
    ctx.moveTo(-7,8);ctx.lineTo(-13,27);
    ctx.moveTo(7,7);ctx.lineTo(37,-1);
  }else if(hurt){
    ctx.moveTo(-7,8);ctx.lineTo(-27,18);
    ctx.moveTo(7,8);ctx.lineTo(24,24);
  }else if(air){
    ctx.moveTo(-7,8);ctx.lineTo(-18,28);
    ctx.moveTo(7,8);ctx.lineTo(15,26);
  }else{
    ctx.moveTo(-7,8);ctx.lineTo(-10+run*5,29);
    ctx.moveTo(7,8);ctx.lineTo(11-run*5,29);
  }
  ctx.stroke();

  // Robe/body
  ctx.fillStyle=team;ctx.strokeStyle=outline;ctx.lineWidth=4;
  ctx.beginPath();ctx.roundRect(-18,-30,36,45,11);ctx.fill();ctx.stroke();

  // Crossed robe lapel
  ctx.strokeStyle=trim;ctx.lineWidth=5;
  ctx.beginPath();ctx.moveTo(-12,-25);ctx.lineTo(9,7);ctx.stroke();
  ctx.beginPath();ctx.moveTo(12,-25);ctx.lineTo(-3,-1);ctx.stroke();

  // Belt and hanging sash
  ctx.fillStyle=outline;ctx.fillRect(-18,3,36,7);
  ctx.strokeStyle=team;ctx.lineWidth=6;
  ctx.beginPath();ctx.moveTo(-8,10);ctx.quadraticCurveTo(-22,22,-28,13);ctx.stroke();

  // Head
  ctx.fillStyle=skin;ctx.strokeStyle=outline;ctx.lineWidth=4;
  ctx.beginPath();ctx.arc(0,-45,17,0,Math.PI*2);ctx.fill();ctx.stroke();

  // Hair/top knot — monk, not ninja
  ctx.fillStyle="#3c281d";
  ctx.beginPath();ctx.arc(0,-50,15,Math.PI,Math.PI*2);ctx.lineTo(14,-42);
  ctx.quadraticCurveTo(4,-32,-14,-41);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.arc(0,-64,7,0,Math.PI*2);ctx.fill();

  // Headband and eyes
  ctx.fillStyle=team;ctx.fillRect(-15,-50,30,6);
  ctx.fillStyle=outline;
  ctx.fillRect(3,-45,4,3);

  // Arms and both hands on staff
  ctx.strokeStyle=skin;ctx.lineWidth=9;ctx.lineCap="round";
  let leftHand={x:-18,y:-12}, rightHand={x:19,y:-12};
  if(attack && p.attackType==="down"){
    leftHand={x:-7,y:-23};rightHand={x:8,y:-21};
  }else if(attack){
    leftHand={x:2,y:-11};rightHand={x:28,y:-10};
  }else if(kick){
    leftHand={x:-22,y:-12};rightHand={x:22,y:-18};
  }
  ctx.beginPath();ctx.moveTo(-12,-18);ctx.lineTo(leftHand.x,leftHand.y);ctx.stroke();
  ctx.beginPath();ctx.moveTo(12,-18);ctx.lineTo(rightHand.x,rightHand.y);ctx.stroke();

  // Long staff, visibly held with both hands.
  ctx.strokeStyle=outline;ctx.lineWidth=10;ctx.lineCap="round";
  ctx.beginPath();
  if(attack && p.attackType==="down"){
    ctx.moveTo(1,-62);ctx.lineTo(10,72);
  }else if(attack){
    ctx.moveTo(-45,-10);ctx.lineTo(92,-10);
  }else{
    ctx.moveTo(-53,-5);ctx.lineTo(57,-20);
  }
  ctx.stroke();
  ctx.strokeStyle="#c98a32";ctx.lineWidth=6;
  ctx.beginPath();
  if(attack && p.attackType==="down"){
    ctx.moveTo(1,-62);ctx.lineTo(10,72);
  }else if(attack){
    ctx.moveTo(-45,-10);ctx.lineTo(92,-10);
  }else{
    ctx.moveTo(-53,-5);ctx.lineTo(57,-20);
  }
  ctx.stroke();

  // Hands on top of staff so the grip reads clearly.
  ctx.fillStyle=skin;ctx.strokeStyle=outline;ctx.lineWidth=2;
  for(const h of [leftHand,rightHand]){
    ctx.beginPath();ctx.arc(h.x,h.y,5,0,Math.PI*2);ctx.fill();ctx.stroke();
  }

  if(hurt){
    ctx.strokeStyle="#ffd94a";ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(0,-72,14,0,Math.PI*1.55);ctx.stroke();
  }
  ctx.restore();
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
  new Player("blue","staff",155,false),
  new Player("blue","staff",270,true),
  new Player("red","staff",450,true),
  new Player("red","staff",565,true)
];
const ball=new Ball();

function nearestOpponent(p){
  let best=null,bd=1e9;
  for(const q of players) if(q.team!==p.team){
    const d=len(q.x-p.x,q.y-p.y);if(d<bd){bd=d;best=q;}
  }
  return best;
}
function nearestOpponentObj(p){
  let best=null,bd=1e9;
  for(const q of players) if(q.team!==p.team){
    const d=len(q.x-p.x,q.y-p.y);
    if(d<bd){bd=d;best=q;}
  }
  return best;
}
function predictBall(){
  const t=clamp((arena.floor-ball.y)/Math.max(1,ball.vy+7),6,36);
  return {x:clamp(ball.x+ball.vx*t,arena.left+30,arena.right-30),y:arena.floor-40};
}
function kickBall(p){
  const air=!p.onGround;
  const kickX=p.x+p.facing*(air?48:42);
  const kickY=p.y+(air?-3:5);
  const dx=ball.x-kickX,dy=ball.y-kickY,d=len(dx,dy);
  const reach=air?132:118;

  // 大きめの扇形判定。少し後ろにあるボールも拾える。
  const forward=(ball.x-p.x)*p.facing;
  if(d<reach && forward>-38){
    const aimX=clamp(dx/Math.max(d,1),-.75,.75);
    const aimY=clamp(dy/Math.max(d,1),-.85,.85);
    const power=air?8.4:7.2;
    ball.vx=p.facing*(power+Math.abs(aimX)*1.4)+p.vx*.65;
    // ボールの位置で軌道が大きく変わる。上を蹴れば下へ、下を蹴れば上へ。
    ball.vy=(air ? aimY*8.0-3.2 : -11.4+aimY*1.8)+p.vy*.20;
    ball.lastTouch=p.team;ball.wallHits=0;
    hitBursts.push({x:ball.x,y:ball.y,life:10,color:"#eefcff"});
  }

  // キックそのものにも対人判定。
  for(const q of players){
    if(q===p || q.team===p.team)continue;
    const qdx=q.x-kickX,qdy=q.y-kickY;
    if(len(qdx,qdy)<(air?88:72) && (q.x-p.x)*p.facing>-30){
      q.vx+=p.facing*(air?5.6:4.2);
      q.vy=air?Math.min(q.vy,-2.2):Math.min(q.vy,-4.0);
      q.stun=Math.max(q.stun,air?12:9);
      q.hitFlash=7;
      hitBursts.push({x:q.x,y:q.y,life:12,color:"#ffd75a"});
      // 空中キック命中時に少し反動を得て、連続空中戦をしやすくする。
      if(air){p.vy-=1.3;p.vx-=p.facing*.8;}
    }
  }
}
function weaponAttack(p){
  const downSmash=!p.onGround && p.downHeld;
  if(downSmash){
    p.attackType="down";
    staffTrails.push({x:p.x,y:p.y+8,dir:p.facing,type:"down",life:13});
    for(const q of players){
      if(q.team===p.team)continue;
      const dx=q.x-p.x,dy=q.y-(p.y+58);
      if(Math.abs(dx)<94 && dy>-38 && dy<148){
        q.vy=18.5;
        q.vx*=0.18;
        q.stun=20;q.hitFlash=9;q.pose="hurt";q.anim=18;
        hitBursts.push({x:q.x,y:q.y,life:17,color:"#ffb347"});
        p.vy-=1.3;
      }
    }
  }else{
    p.attackType="thrust";
    const hitX=p.x+p.facing*76, hitY=p.y-8;
    staffTrails.push({x:p.x+p.facing*26,y:p.y-8,dir:p.facing,type:"thrust",life:11});
    for(const q of players){
      if(q.team===p.team)continue;
      const dx=q.x-hitX,dy=q.y-hitY;
      if(Math.abs(dx)<116 && Math.abs(dy)<66 && (q.x-p.x)*p.facing>-30){
        q.vx=p.facing*15.5;
        q.vy*=0.25;
        q.stun=16;q.hitFlash=9;q.pose="hurt";q.anim=16;
        hitBursts.push({x:q.x,y:q.y,life:16,color:"#fff08a"});
      }
    }
  }
}
const projectiles=[];
const hitBursts=[];
const staffTrails=[];
function updateProjectiles(){
  for(let i=hitBursts.length-1;i>=0;i--){hitBursts[i].life--;if(hitBursts[i].life<=0)hitBursts.splice(i,1);} for(let i=staffTrails.length-1;i>=0;i--){staffTrails[i].life--;if(staffTrails[i].life<=0)staffTrails.splice(i,1);}
  for(let i=projectiles.length-1;i>=0;i--){
    const k=projectiles[i];k.x+=k.vx;k.life--;
    for(const p of players){
      if(p.team===k.team)continue;
      if(len(p.x-k.x,p.y-k.y)<30){p.stun=12;p.hitFlash=7;p.vx+=Math.sign(k.vx)*2.2;hitBursts.push({x:p.x,y:p.y,life:10,color:"#8fe9ff"});projectiles.splice(i,1);break;}
    }
    if(i<projectiles.length && projectiles[i]===k && (k.life<=0||k.x<arena.left||k.x>arena.right))projectiles.splice(i,1);
  }
}
function separatePlayers(){
  for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++){
    const a=players[i],b=players[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.max(.01,len(dx,dy)),min=50;
    if(d<min){
      const overlap=min-d,nx=dx/d,ny=dy/d;
      a.x-=nx*overlap*.52;b.x+=nx*overlap*.52;
      a.y-=ny*overlap*.42;b.y+=ny*overlap*.42;

      // 空中では身体同士がぶつかって弾かれる。
      if(!a.onGround || !b.onGround){
        const rel=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
        if(rel<1.5){
          const impulse=2.3-rel*.35;
          a.vx-=nx*impulse;b.vx+=nx*impulse;
          a.vy-=ny*impulse;b.vy+=ny*impulse;
        }
      }
    }
  }
}
function score(team){
  if(team==="blue")blueScore++;else redScore++;
  blueScoreEl.textContent=blueScore;redScoreEl.textContent=redScore;
  statusEl.textContent=(team==="blue"?"BLUE":"RED")+" GOAL!";
  ball.reset();
  players.forEach((p,i)=>{p.x=[155,270,450,565][i];p.y=arena.floor-32;p.vx=p.vy=0;p.airJumpAvailable=true;});
  setTimeout(()=>statusEl.textContent="長棍を両手持ち｜J: 横突き｜空中で↓＋J: 振り下ろし",700);
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
  hitBursts.forEach(h=>{
    ctx.save();ctx.globalAlpha=h.life/14;ctx.strokeStyle=h.color;ctx.lineWidth=4;
    const r=(15-h.life)*3+5;
    ctx.beginPath();ctx.arc(h.x,h.y,r,0,Math.PI*2);ctx.stroke();ctx.restore();
  });
  staffTrails.forEach(s=>{
    ctx.save();ctx.lineCap="round";
    if(s.type==="down"){
      for(let i=0;i<3;i++){
        ctx.globalAlpha=(s.life/13)*(1-i*.25);ctx.strokeStyle="#ffb347";ctx.lineWidth=12-i*2;
        ctx.beginPath();ctx.moveTo(s.x-36+i*12,s.y-88+i*10);
        ctx.quadraticCurveTo(s.x+8,s.y-12,s.x+20+i*7,s.y+112);ctx.stroke();
      }
    }else{
      for(let i=0;i<3;i++){
        ctx.globalAlpha=(s.life/11)*(1-i*.25);ctx.strokeStyle="#fff08a";ctx.lineWidth=11-i*2;
        ctx.beginPath();ctx.moveTo(s.x-s.dir*(24+i*10),s.y-10+i*5);
        ctx.lineTo(s.x+s.dir*(112-i*8),s.y-10+i*5);ctx.stroke();
      }
    }
    ctx.restore();
  });
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
