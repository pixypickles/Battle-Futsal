(() => {
'use strict';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const W=960,H=540, M=42, FLOOR=H-62;
const TEAM={BLUE:0,RED:1};
const keys=new Set();
let score=[0,0], last=performance.now(), flash=0, message='AIRBALL!', shake=0;
const input={x:0,y:0,a:false,b:false,c:false,aTap:false,bTap:false,cTap:false};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const norm=(x,y)=>{const d=Math.hypot(x,y)||1;return{x:x/d,y:y/d}};
const rnd=(a,b)=>a+Math.random()*(b-a);

const classData={
 ninja:{label:'NINJA',speed:220,jump:420,air:0.9,color:'#5bc8ff'},
 staff:{label:'STAFF',speed:205,jump:395,air:0.72,color:'#e3c96c'},
 gauntlet:{label:'GAUNTLET',speed:195,jump:405,air:0.78,color:'#ff9b72'}
};
function makePlayer(team,cls,x,y,human=false){return {team,cls,x,y,z:0,vx:0,vy:0,vz:0,face:team===0?1:-1,human,onGround:true,wallReady:true,attackCd:0,tossCd:0,stun:0,anim:0,hasBall:false,id:players.length};}
const players=[];
players.push(makePlayer(TEAM.BLUE,'ninja',250,270,true));
players.push(makePlayer(TEAM.BLUE,'staff',180,165));
players.push(makePlayer(TEAM.BLUE,'gauntlet',180,375));
players.push(makePlayer(TEAM.RED,'ninja',710,270));
players.push(makePlayer(TEAM.RED,'staff',780,165));
players.push(makePlayer(TEAM.RED,'gauntlet',780,375));
const human=players[0];
const ball={x:W/2,y:H/2,z:0,vx:0,vy:0,vz:0,owner:null,lastToss:null,lastTouch:null,kickTeam:null,kickTimer:0,trails:[]};
const projectiles=[];
const effects=[];
const rings=[];
for(const team of [0,1]) for(const yy of [185,355]) rings.push({team,x:team===0?78:882,y:yy,z:170,r:30});

function reset(afterGoal=false){
  const pos=[[250,270],[180,165],[180,375],[710,270],[780,165],[780,375]];
  players.forEach((p,i)=>{p.x=pos[i][0];p.y=pos[i][1];p.z=0;p.vx=p.vy=p.vz=0;p.stun=0;p.hasBall=false;p.onGround=true;});
  Object.assign(ball,{x:W/2,y:H/2,z:0,vx:0,vy:0,vz:0,owner:null,lastToss:null,lastTouch:null,kickTeam:null,kickTimer:0,trails:[]});
  if(afterGoal){flash=1;}
}
function possess(p){players.forEach(q=>q.hasBall=false);p.hasBall=true;ball.owner=p;ball.z=0;ball.vx=ball.vy=ball.vz=0;ball.lastTouch=p;}
function releaseBall(){if(ball.owner) ball.owner.hasBall=false;ball.owner=null;}
function toss(p){if(!p.hasBall||p.tossCd>0||p.stun>0)return; releaseBall(); ball.lastToss=p; ball.lastTouch=p; ball.kickTeam=null; ball.x=p.x+p.face*22;ball.y=p.y;ball.z=18;ball.vx=p.face*125;ball.vy=clamp(p.vy*.35,-70,70);ball.vz=335;p.tossCd=.55;effects.push({type:'text',x:p.x,y:p.y,z:48,t:0.5,text:'TOSS!',team:p.team});}
function jump(p){if(p.stun>0)return; const nearWall=p.x<M+30||p.x>W-M-30||p.y<M+25||p.y>FLOOR-10;
  if(p.onGround){p.vz=classData[p.cls].jump;p.onGround=false;p.wallReady=true;effects.push({type:'dust',x:p.x,y:p.y,z:0,t:.25});}
  else if(nearWall&&p.wallReady){const n=wallNormal(p);p.vx+=n.x*(p.cls==='ninja'?265:220);p.vy+=n.y*(p.cls==='ninja'?265:220);p.vz=p.cls==='ninja'?460:425;p.wallReady=false;effects.push({type:'burst',x:p.x,y:p.y,z:p.z,t:.35});}
  else tryKick(p);
}
function wallNormal(p){let candidates=[{d:p.x-M,x:1,y:0},{d:W-M-p.x,x:-1,y:0},{d:p.y-M,x:0,y:1},{d:FLOOR-p.y,x:0,y:-1}];return candidates.sort((a,b)=>a.d-b.d)[0];}
function tryKick(p){if(p.z<55||ball.owner||dist(p,ball)>60||Math.abs((p.z+28)-ball.z)>80)return false; if(ball.lastToss===p){effects.push({type:'text',x:p.x,y:p.y,z:p.z+35,t:.7,text:'SELF TOSS ×',team:p.team});return false;}
  const targets=rings.filter(r=>r.team!==p.team); let target=targets.sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
  const d=norm(target.x-p.x,target.y-p.y); releaseBall();ball.x=p.x+d.x*25;ball.y=p.y+d.y*25;ball.z=p.z+24;ball.vx=d.x*430;ball.vy=d.y*430;ball.vz=(target.z-ball.z)*2.0+105;ball.kickTeam=p.team;ball.kickTimer=1.2;ball.lastTouch=p;p.vz+=50;shake=.12;effects.push({type:'kick',x:ball.x,y:ball.y,z:ball.z,t:.4});return true;
}
function attack(p){if(p.attackCd>0||p.stun>0)return;p.attackCd=p.cls==='ninja'?1.0:.65;p.anim=.28;
  if(p.cls==='ninja'){
    projectiles.push({x:p.x+p.face*20,y:p.y,z:p.z+36,vx:p.face*520,vy:0,t:1.1,team:p.team,owner:p});
  } else {
    const range=p.cls==='staff'?82:58; const airborne=p.cls==='gauntlet';
    for(const q of players){if(q.team===p.team||q.stun>0)continue;const dz=Math.abs(q.z-p.z);if(dist(p,q)<range && (p.cls==='staff'?p.z<35:dz<70)){const d=norm(q.x-p.x,q.y-p.y);q.vx+=d.x*(p.cls==='staff'?130:190);q.vy+=d.y*(p.cls==='staff'?130:190);q.vz+=airborne?110:35;q.stun=p.cls==='staff'?.42:.3;drop(q);effects.push({type:'hit',x:q.x,y:q.y,z:q.z+30,t:.3});}}
    if(ball.owner&&ball.owner.team!==p.team&&dist(p,ball.owner)<range)drop(ball.owner);
  }
}
function drop(p){if(!p.hasBall)return;releaseBall();ball.x=p.x;ball.y=p.y;ball.z=p.z+25;ball.vx=p.vx*.5;ball.vy=p.vy*.5;ball.vz=120;}

function ai(p,dt){if(p.stun>0)return {x:0,y:0,a:false,b:false,c:false};
  let tx=ball.owner?ball.owner.x:ball.x, ty=ball.owner?ball.owner.y:ball.y;
  let a=false,b=false,c=false;
  if(p.hasBall){const mate=players.filter(q=>q.team===p.team&&q!==p).sort((q,r)=>Math.hypot(q.x-(p.team===0?700:260),q.y-270)-Math.hypot(r.x-(p.team===0?700:260),r.y-270))[0];
    tx=p.team===0?430:530;ty=mate?mate.y:270;if(Math.random()<dt*2.2)b=true;
  } else if(!ball.owner&&ball.z>55){
    tx=ball.x;ty=ball.y; if(dist(p,ball)<100 && Math.abs(p.z+28-ball.z)<95)c=true;
  } else if(p.cls==='gauntlet'){
    const enemyRings=rings.filter(r=>r.team===p.team); const r=enemyRings[(p.id+1)%2]; tx=r.x+(p.team===0?55:-55);ty=r.y;
    const enemy=players.find(q=>q.team!==p.team&&dist(q,p)<65);if(enemy)a=true;
  } else if(p.cls==='staff'){
    tx=ball.owner?ball.owner.x:ball.x;ty=ball.owner?ball.owner.y:ball.y; if(dist(p,{x:tx,y:ty})<78)a=true;
  } else {
    tx=ball.x+(p.team===0?45:-45);ty=ball.y;if(ball.z>45&&dist(p,ball)<150)c=true;if(Math.random()<dt*.7)a=true;
  }
  const d=norm(tx-p.x,ty-p.y);return{x:d.x,y:d.y,a,b,c};
}
function updatePlayer(p,dt){p.attackCd=Math.max(0,p.attackCd-dt);p.tossCd=Math.max(0,p.tossCd-dt);p.stun=Math.max(0,p.stun-dt);p.anim=Math.max(0,p.anim-dt);
  let ctl=p.human?readInput():ai(p,dt);if(p.stun>0)ctl={x:0,y:0,a:false,b:false,c:false};
  const cd=classData[p.cls], control=p.onGround?1:cd.air, targetX=ctl.x*cd.speed*control,targetY=ctl.y*cd.speed*control;
  const accel=p.onGround?10:4.8;p.vx=lerp(p.vx,targetX,clamp(accel*dt,0,1));p.vy=lerp(p.vy,targetY,clamp(accel*dt,0,1));
  if(Math.abs(ctl.x)>.1)p.face=Math.sign(ctl.x);
  p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vz-=860*dt;
  if(p.z<=0){p.z=0;p.vz=0;p.onGround=true;p.wallReady=true;}else p.onGround=false;
  let bounced=false;if(p.x<M){p.x=M;p.vx=Math.abs(p.vx)*.35;bounced=true}if(p.x>W-M){p.x=W-M;p.vx=-Math.abs(p.vx)*.35;bounced=true}if(p.y<M){p.y=M;p.vy=Math.abs(p.vy)*.35;bounced=true}if(p.y>FLOOR){p.y=FLOOR;p.vy=-Math.abs(p.vy)*.35;bounced=true}
  if(ctl.a)attack(p);if(ctl.b)toss(p);if(ctl.c)jump(p);
  if(p.hasBall){ball.x=p.x+p.face*18;ball.y=p.y+10;ball.z=8;}
}
function readInput(){let x=input.x,y=input.y;if(keys.has('a')||keys.has('arrowleft'))x-=1;if(keys.has('d')||keys.has('arrowright'))x+=1;if(keys.has('w')||keys.has('arrowup'))y-=1;if(keys.has('s')||keys.has('arrowdown'))y+=1;const n=Math.hypot(x,y);if(n>1){x/=n;y/=n}const out={x,y,a:input.aTap||keys.has('j'),b:input.bTap||keys.has('k'),c:input.cTap||keys.has('l')};input.aTap=input.bTap=input.cTap=false;return out;}
function updateBall(dt){if(ball.owner)return;ball.kickTimer=Math.max(0,ball.kickTimer-dt);ball.trails.push({x:ball.x,y:ball.y,z:ball.z,t:.25});if(ball.trails.length>18)ball.trails.shift();ball.trails.forEach(t=>t.t-=dt);
  ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;ball.z+=ball.vz*dt;ball.vz-=720*dt;ball.vx*=Math.pow(.995,dt*60);ball.vy*=Math.pow(.995,dt*60);
  if(ball.z<0){ball.z=0;ball.vz=Math.abs(ball.vz)*.42;if(Math.abs(ball.vz)<35)ball.vz=0;ball.vx*=.91;ball.vy*=.91;}
  if(ball.x<M){ball.x=M;ball.vx=Math.abs(ball.vx)*.72}if(ball.x>W-M){ball.x=W-M;ball.vx=-Math.abs(ball.vx)*.72}if(ball.y<M){ball.y=M;ball.vy=Math.abs(ball.vy)*.72}if(ball.y>FLOOR){ball.y=FLOOR;ball.vy=-Math.abs(ball.vy)*.72}
  for(const p of players){if(p.stun<=0&&ball.z<34&&dist(p,ball)<28&&Math.hypot(ball.vx,ball.vy)<260){possess(p);break;}}
  checkGoals();
}
function checkGoals(){if(ball.kickTimer<=0||ball.kickTeam==null)return;for(const r of rings){if(r.team===ball.kickTeam)continue;const dx=ball.x-r.x,dy=ball.y-r.y,dz=ball.z-r.z;if(Math.hypot(dx,dy)<r.r-5&&Math.abs(dz)<24){score[ball.kickTeam]++;scoreEl.textContent=`BLUE ${score[0]} - ${score[1]} RED`;message='GOAL!';flash=1;shake=.35;setTimeout(()=>reset(true),650);ball.kickTimer=0;return;}}
}
function updateProjectiles(dt){for(let i=projectiles.length-1;i>=0;i--){const k=projectiles[i];k.x+=k.vx*dt;k.y+=k.vy*dt;k.t-=dt;let hit=false;for(const p of players){if(p.team===k.team)continue;if(Math.hypot(p.x-k.x,p.y-k.y)<24&&Math.abs((p.z+30)-k.z)<55){p.stun=.28;p.vx+=Math.sign(k.vx)*85;drop(p);effects.push({type:'hit',x:p.x,y:p.y,z:p.z+35,t:.3});hit=true;break;}}if(k.t<=0||hit||k.x<0||k.x>W)projectiles.splice(i,1);}
}
function update(dt){players.forEach(p=>updatePlayer(p,dt));updateBall(dt);updateProjectiles(dt);effects.forEach(e=>e.t-=dt);for(let i=effects.length-1;i>=0;i--)if(effects[i].t<=0)effects.splice(i,1);flash=Math.max(0,flash-dt*1.4);shake=Math.max(0,shake-dt);}

function shadow(x,y,z,size=14){ctx.save();ctx.globalAlpha=clamp(.5-z/500,.12,.5);ctx.fillStyle='#000';ctx.beginPath();ctx.ellipse(x,y+12,size*(1-z/800),size*.35*(1-z/800),0,0,Math.PI*2);ctx.fill();ctx.restore();}
function drawArena(){const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#192b3e');g.addColorStop(1,'#0c1725');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);ctx.strokeStyle='#82d8ff55';ctx.lineWidth=3;ctx.strokeRect(M,M,W-M*2,FLOOR-M);ctx.setLineDash([10,10]);ctx.beginPath();ctx.moveTo(W/2,M);ctx.lineTo(W/2,FLOOR);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle='#ffffff22';ctx.beginPath();ctx.arc(W/2,(M+FLOOR)/2,72,0,Math.PI*2);ctx.stroke();
  for(const r of rings)drawRing(r);
}
function drawRing(r){shadow(r.x,r.y,r.z,25);const sy=r.y-r.z*.52;ctx.save();ctx.translate(r.x,sy);ctx.strokeStyle=r.team===0?'#63cfff':'#ff6c82';ctx.lineWidth=8;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=18;ctx.beginPath();ctx.ellipse(0,0,r.r,r.r*.45,0,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#dff8ff88';ctx.lineWidth=2;ctx.stroke();ctx.restore();ctx.strokeStyle='#ffffff2c';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(r.x,r.y);ctx.lineTo(r.x,sy+10);ctx.stroke();}
function drawPlayer(p){const sy=p.y-p.z*.52;shadow(p.x,p.y,p.z,17);ctx.save();ctx.translate(p.x,sy);const bob=p.onGround?Math.sin(performance.now()/90+p.id)*Math.min(2,Math.hypot(p.vx,p.vy)/90):0;ctx.translate(0,bob);ctx.globalAlpha=p.stun>0?.65:1;ctx.fillStyle=p.team===0?'#4faef4':'#e75067';ctx.strokeStyle='#e9f7ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-20,8,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(0,15);ctx.lineTo(-8,30);ctx.moveTo(0,15);ctx.lineTo(9,30);ctx.moveTo(0,-5);ctx.lineTo(-13,9);ctx.moveTo(0,-5);ctx.lineTo(13*p.face,7);ctx.stroke();
  ctx.fillStyle=classData[p.cls].color;ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.fillText(classData[p.cls].label,0,-38);
  if(p.cls==='ninja'){ctx.strokeStyle='#f4f7ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(9*p.face,2);ctx.lineTo(22*p.face,-5);ctx.stroke();ctx.fillStyle='#f4f7ff';ctx.beginPath();ctx.moveTo(22*p.face,-5);ctx.lineTo(14*p.face,-8);ctx.lineTo(16*p.face,0);ctx.fill();}
  if(p.cls==='staff'){ctx.strokeStyle='#d6b66a';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-22*p.face,14);ctx.lineTo(28*p.face,5);ctx.stroke();}
  if(p.cls==='gauntlet'){ctx.fillStyle='#ffbe8e';ctx.beginPath();ctx.arc(16*p.face,7,7,0,Math.PI*2);ctx.fill();}
  if(p.stun>0){ctx.fillStyle='#ffe76b';ctx.font='16px sans-serif';ctx.fillText('✦',-11,-48);ctx.fillText('✦',12,-53);}
  if(p.hasBall){ctx.fillStyle='#fff';ctx.font='10px system-ui';ctx.fillText('BALL',0,44);}
  ctx.restore();}
function drawBall(){if(ball.owner)return;for(const t of ball.trails){if(t.t<=0)continue;ctx.save();ctx.globalAlpha=t.t*.8;ctx.fillStyle='#bdefff';ctx.beginPath();ctx.arc(t.x,t.y-t.z*.52,5+t.z*.02,0,Math.PI*2);ctx.fill();ctx.restore();}
  shadow(ball.x,ball.y,ball.z,18);ctx.strokeStyle='#ffdf52aa';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(ball.x,ball.y+12,22,8,0,0,Math.PI*2);ctx.stroke();const sy=ball.y-ball.z*.52;const s=12+ball.z*.045;ctx.save();ctx.translate(ball.x,sy);ctx.shadowColor='#fff';ctx.shadowBlur=16;ctx.fillStyle='#fff4bd';ctx.strokeStyle='#172333';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,s,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#5ec7ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,s*.55,0,Math.PI*2);ctx.stroke();ctx.restore();if(ball.lastToss){ctx.fillStyle='#fff';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText(`TOSS: ${ball.lastToss.team===0?'BLUE':'RED'} ${classData[ball.lastToss.cls].label}`,ball.x,sy-s-12);}}
function drawProjectiles(){for(const k of projectiles){const sy=k.y-k.z*.52;ctx.save();ctx.translate(k.x,sy);ctx.rotate(performance.now()/60);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-12,0);ctx.lineTo(12,0);ctx.moveTo(0,-12);ctx.lineTo(0,12);ctx.stroke();ctx.restore();ctx.strokeStyle='#ffffff66';ctx.beginPath();ctx.moveTo(k.x-Math.sign(k.vx)*34,sy);ctx.lineTo(k.x,sy);ctx.stroke();}}
function drawEffects(){for(const e of effects){const sy=e.y-e.z*.52;ctx.save();ctx.globalAlpha=clamp(e.t*3,0,1);if(e.type==='text'){ctx.fillStyle=e.team===0?'#7dd8ff':'#ff8797';ctx.font='bold 18px system-ui';ctx.textAlign='center';ctx.fillText(e.text,e.x,sy);}else{ctx.strokeStyle=e.type==='kick'?'#fff3a4':'#fff';ctx.lineWidth=4;ctx.beginPath();ctx.arc(e.x,sy,(1-e.t)*45+8,0,Math.PI*2);ctx.stroke();}ctx.restore();}}
function draw(){ctx.save();if(shake>0)ctx.translate(rnd(-5,5)*shake/.35,rnd(-4,4)*shake/.35);drawArena();const sorted=[...players].sort((a,b)=>(a.y-a.z*.2)-(b.y-b.z*.2));sorted.forEach(drawPlayer);drawProjectiles();drawBall();drawEffects();ctx.restore();if(flash>0){ctx.fillStyle=`rgba(255,255,255,${flash*.35})`;ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='bold 46px system-ui';ctx.fillText(message,W/2,82);}
  ctx.fillStyle='#dbeeff';ctx.font='13px system-ui';ctx.textAlign='left';ctx.fillText('A 武器  /  B トス  /  C ジャンプ・空中キック',54,26);ctx.textAlign='right';ctx.fillText('壁際で空中C → 壁ジャンプ',W-54,26);
}
function loop(t){const dt=Math.min(.033,(t-last)/1000);last=t;update(dt);draw();requestAnimationFrame(loop);}requestAnimationFrame(loop);

window.addEventListener('keydown',e=>{keys.add(e.key.toLowerCase());if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))e.preventDefault();});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
function bindButton(id,prop){const el=document.getElementById(id);const down=e=>{e.preventDefault();input[prop]=true;input[prop+'Tap']=true;el.classList.add('pressed')};const up=e=>{e.preventDefault();input[prop]=false;el.classList.remove('pressed')};el.addEventListener('pointerdown',down);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('pointerleave',up);}
bindButton('btnA','a');bindButton('btnB','b');bindButton('btnC','c');
const stick=document.getElementById('stick'),knob=document.getElementById('knob');let stickId=null;
function moveStick(e){const r=stick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;let dx=e.clientX-cx,dy=e.clientY-cy;const max=r.width*.34,d=Math.hypot(dx,dy);if(d>max){dx*=max/d;dy*=max/d}input.x=dx/max;input.y=dy/max;knob.style.transform=`translate(${dx}px,${dy}px)`;}
stick.addEventListener('pointerdown',e=>{stickId=e.pointerId;stick.setPointerCapture(e.pointerId);moveStick(e)});stick.addEventListener('pointermove',e=>{if(e.pointerId===stickId)moveStick(e)});function endStick(e){if(e.pointerId!==stickId)return;stickId=null;input.x=input.y=0;knob.style.transform='translate(0,0)'}stick.addEventListener('pointerup',endStick);stick.addEventListener('pointercancel',endStick);
reset();
})();
