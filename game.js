(()=>{'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d'),scoreEl=document.getElementById('score');
const W=1100,H=700,CX=550,CY=430,ARENA_L=270,ARENA_R=830,ARENA_T=105,ARENA_B=610,CEILING=560,TEAM={BLUE:0,RED:1};
const keys=new Set(),pressed=new Set(),input={x:0,y:0,a:false,b:false,c:false,aTap:false,bTap:false,cTap:false};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t,norm=(x,y)=>{const d=Math.hypot(x,y)||1;return{x:x/d,y:y/d}},rnd=(a,b)=>a+Math.random()*(b-a),d2=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
let last=performance.now(),score=[0,0],shake=0,flash=0,banner='2 vs 2 HEIGHT ARENA',resetTimer=0;
const classData={ninja:{name:'NINJA',speed:188,jump:720,air:.92},staff:{name:'STAFF',speed:170,jump:700,air:.76}};
const players=[];
function add(team,cls,x,y,human=false){const p={id:players.length,team,cls,x,y,z:0,vx:0,vy:0,vz:0,face:team? -1:1,human,onGround:true,wallJump:true,wallCling:0,wallClingCd:0,attackCd:0,tossCd:0,jumpCd:0,jumpBuffer:0,airTime:0,stun:0,anim:0,kickAnim:0,hasBall:false};players.push(p);return p}
const human=add(0,'ninja',405,455,true);add(0,'staff',455,330);add(1,'ninja',695,455);add(1,'staff',645,330);
const ball={x:CX,y:CY,z:24,vx:190,vy:65,vz:70,owner:null,lastTouch:null,trails:[],idle:0,airTime:0,lastX:CX,lastY:CY,lastZ:24,wallHitCd:0};
const projectiles=[],effects=[],ripples=[];
// One large, readable goal on each side. Each team defends the ring nearest its side.
const rings=[{team:0,x:ARENA_L+16,y:CY,z:360,axis:'v',label:'BLUE GOAL'},{team:1,x:ARENA_R-16,y:CY,z:360,axis:'v',label:'RED GOAL'}];
function reset(goal=false){const pos=[[405,455],[455,330],[695,455],[645,330]];players.forEach((p,i)=>Object.assign(p,{x:pos[i][0],y:pos[i][1],z:0,vx:0,vy:0,vz:0,stun:0,hasBall:false,onGround:true,wallJump:true,wallCling:0,wallClingCd:0,jumpCd:0,jumpBuffer:0,airTime:0,kickAnim:0}));Object.assign(ball,{x:CX,y:CY,z:24,vx:(Math.random()<.5?-1:1)*190,vy:rnd(-90,90),vz:85,owner:null,lastTouch:null,trails:[],idle:0,airTime:0,lastX:CX,lastY:CY,lastZ:24,wallHitCd:0});projectiles.length=0;if(goal)flash=1}
function ellipseValue(x,y){const nx=Math.max(0,ARENA_L-x,x-ARENA_R),ny=Math.max(0,ARENA_T-y,y-ARENA_B);return nx+ny>0?1:0}
function confine(o,bounce=.35){let hit=false;if(o.x<ARENA_L){o.x=ARENA_L;if(o.vx<0)o.vx=-o.vx*(1+bounce);hit=true}else if(o.x>ARENA_R){o.x=ARENA_R;if(o.vx>0)o.vx=-o.vx*(1+bounce);hit=true}if(o.y<ARENA_T){o.y=ARENA_T;if(o.vy<0)o.vy=-o.vy*(1+bounce);hit=true}else if(o.y>ARENA_B){o.y=ARENA_B;if(o.vy>0)o.vy=-o.vy*(1+bounce);hit=true}return hit}
function release(){ball.owner=null;players.forEach(q=>q.hasBall=false)}
function nearestEnemyRing(p){return rings.filter(r=>r.team!==p.team).sort((a,b)=>d2(a,p)-d2(b,p))[0]}
function kick(p){if(p.tossCd>0||p.stun>0)return false;const reach=p.z>45?86:70;if(d2(p,ball)>reach||Math.abs((p.z+28)-ball.z)>105)return false;const airborne=p.z>45;let dir;if(airborne){const r=nearestEnemyRing(p);dir=norm(r.x-p.x,r.y-p.y);const time=clamp(d2(p,r)/330,.62,1.15);ball.vx=(r.x-ball.x)/time;ball.vy=(r.y-ball.y)/time;ball.vz=(r.z-ball.z)/time+155*time;effects.push({type:'text',x:p.x,y:p.y,z:p.z+70,t:.55,text:'VOLLEY'});}else{dir=norm(p.face,.12*(p.y<CY?1:-1));ball.vx=dir.x*315+p.vx*.2;ball.vy=dir.y*315+p.vy*.2;ball.vz=430;effects.push({type:'text',x:p.x,y:p.y,z:65,t:.5,text:'LIFT KICK'});}ball.lastTouch=p;ball.airTime=0;ball.idle=0;p.tossCd=.38;p.kickAnim=.30;shake=.1;return true}
function wallNormal(p){const dl=Math.abs(p.x-ARENA_L),dr=Math.abs(ARENA_R-p.x),dt=Math.abs(p.y-ARENA_T),db=Math.abs(ARENA_B-p.y),m=Math.min(dl,dr,dt,db);if(m===dl)return{x:1,y:0};if(m===dr)return{x:-1,y:0};if(m===dt)return{x:0,y:1};return{x:0,y:-1}}
function jump(p){if(p.stun>0||p.jumpCd>0)return;if(p.onGround){p.vz=classData[p.cls].jump;p.onGround=false;p.jumpCd=.18;p.airTime=0;p.wallJump=true;effects.push({type:'dust',x:p.x,y:p.y,z:0,t:.35})}else if((p.x<ARENA_L+16||p.x>ARENA_R-16||p.y<ARENA_T+16||p.y>ARENA_B-16)&&p.wallJump){const n=wallNormal(p);const power=p.cls==='ninja'?340:285;p.vx+=n.x*power;p.vy+=n.y*power;p.vz=p.cls==='ninja'?680:610;p.wallJump=false;p.jumpCd=.22;p.airTime=0;ripples.push({x:p.x,y:p.y,z:p.z,t:.5})}}
function attack(p){if(p.attackCd>0||p.stun>0)return;p.attackCd=p.cls==='ninja'?.9:.66;p.anim=.32;if(p.cls==='ninja'){const target=players.filter(q=>q.team!==p.team).sort((a,b)=>d2(a,p)-d2(b,p))[0];const aim=target&&d2(target,p)<260?norm(target.x-p.x,target.y-p.y):norm(p.face,0);projectiles.push({x:p.x+aim.x*24,y:p.y,z:p.z+42,vx:aim.x*430,vy:aim.y*430,t:1.25,team:p.team,owner:p,rot:0})}else{const range=p.cls==='staff'?98:72;for(const q of players){if(q.team===p.team||d2(p,q)>range||Math.abs(q.z-p.z)>105)continue;const n=norm(q.x-p.x,q.y-p.y);if(p.cls==='staff'&&p.z>35){q.vx+=n.x*45;q.vy+=n.y*45;q.vz=Math.min(q.vz,-470);q.stun=.34;effects.push({type:'text',x:q.x,y:q.y,z:q.z+65,t:.55,text:'SLAM'});}else if(p.cls==='gauntlet'&&p.z>35){const stomp=p.z>q.z+18;q.vx+=n.x*105;q.vy+=n.y*105;q.vz=Math.min(q.vz,-360);q.stun=.28;if(stomp){p.vz=Math.max(p.vz,470);p.wallJump=true;effects.push({type:'text',x:p.x,y:p.y,z:p.z+70,t:.55,text:'STEP!'});} }else{q.vx+=n.x*120;q.vy+=n.y*120;q.stun=.25}effects.push({type:'hit',x:q.x,y:q.y,z:q.z+30,t:.3})}}}
function drop(p){}
function predictLanding(){let x=ball.x,y=ball.y,z=ball.z,vx=ball.vx,vy=ball.vy,vz=ball.vz;for(let i=0;i<90;i++){const h=.035;x+=vx*h;y+=vy*h;z+=vz*h;vz-=560*h;if(z<=0)break;}return{x:clamp(x,ARENA_L+45,ARENA_R-45),y:clamp(y,ARENA_T+45,ARENA_B-45)}}
function ai(p,dt){if(p.stun>0)return{x:0,y:0,a:false,b:false,c:false,cHeld:false};const land=predictLanding();let tx=land.x,ty=land.y,a=false,b=false,c=false;if(ball.z<38){tx=p.x;ty=p.y;const nearest=players.filter(q=>q.team===p.team).sort((u,v)=>d2(u,ball)-d2(v,ball))[0];if(nearest===p&&d2(p,ball)<100)b=true;}else{const lane=(p.id%2===0?-58:58);tx=land.x+lane;ty=land.y+(p.team?1:-1)*30;const arrive=d2(p,land);if(arrive<145&&ball.z>110&&p.onGround)c=true;if(!p.onGround&&d2(p,ball)<95&&Math.abs(p.z+28-ball.z)<110){if(Math.random()<dt*5)b=true;else if(Math.random()<dt*3)a=true;}}const closeEnemy=players.some(q=>q.team!==p.team&&d2(p,q)<85&&Math.abs(p.z-q.z)<100);if(closeEnemy&&Math.random()<dt*2.2)a=true;const n=norm(tx-p.x,ty-p.y);return{x:n.x,y:n.y,a,b,c,cHeld:false}}
function readInput(){let x=input.x,y=input.y;if(keys.has('a')||keys.has('arrowleft'))x--;if(keys.has('d')||keys.has('arrowright'))x++;if(keys.has('w')||keys.has('arrowup'))y--;if(keys.has('s')||keys.has('arrowdown'))y++;const m=Math.hypot(x,y);if(m>1){x/=m;y/=m}const o={x,y,a:input.aTap||pressed.has('j'),b:input.bTap||pressed.has('k'),c:input.cTap||pressed.has('l'),cHeld:input.c||keys.has('l')};pressed.clear();input.aTap=input.bTap=input.cTap=false;return o}
function updatePlayer(p,dt){p.attackCd=Math.max(0,p.attackCd-dt);p.tossCd=Math.max(0,p.tossCd-dt);p.jumpCd=Math.max(0,p.jumpCd-dt);p.jumpBuffer=Math.max(0,p.jumpBuffer-dt);p.wallClingCd=Math.max(0,p.wallClingCd-dt);p.stun=Math.max(0,p.stun-dt);p.anim=Math.max(0,p.anim-dt);p.kickAnim=Math.max(0,p.kickAnim-dt);let c=p.human?readInput():ai(p,dt);if(c.c)p.jumpBuffer=.85;if(c.cHeld)p.jumpBuffer=Math.max(p.jumpBuffer,.18);if(p.stun>0)c={x:0,y:0,a:false,b:false,c:false,cHeld:false};const cd=classData[p.cls],air=p.onGround?1:cd.air,acc=p.onGround?11:5.5;const nearWall=p.x<ARENA_L+18||p.x>ARENA_R-18||p.y<ARENA_T+18||p.y>ARENA_B-18;if(!p.onGround&&nearWall&&p.wallCling<=0&&p.wallClingCd<=0&&p.vz<170){p.wallCling=p.cls==='ninja'?.68:.34;p.wallClingCd=1.05;p.vz=0;p.vx*=.28;p.vy*=.28;ripples.push({x:p.x,y:p.y,z:p.z,t:.35})}if(p.wallCling>0){
  // A buffered or held jump always launches from the wall.
  if(p.jumpBuffer>0&&p.wallJump){
    p.wallCling=0;
    jump(p);
    p.jumpBuffer=0;
    effects.push({type:'text',x:p.x,y:p.y,z:p.z+58,t:.42,text:'WALL JUMP'});
  }else{
    p.wallCling=Math.max(0,p.wallCling-dt);p.vz=0;p.vx*=Math.pow(.72,dt*60);p.vy*=Math.pow(.72,dt*60);
  }
}else{p.vx=lerp(p.vx,c.x*cd.speed*air,clamp(acc*dt,0,1));p.vy=lerp(p.vy,c.y*cd.speed*air,clamp(acc*dt,0,1));}if(Math.abs(c.x)>.12)p.face=Math.sign(c.x);p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;if(!p.onGround&&p.wallCling<=0){p.airTime+=dt;const gravity=p.vz>0?980:820;p.vz-=gravity*dt;if(p.airTime>2.65)p.vz=Math.min(p.vz,-470);}p.vz=clamp(p.vz,-720,760);if(p.z<=0){const impact=Math.max(0,-p.vz);p.z=0;p.wallCling=0;p.wallJump=true;p.airTime=0;const bufferedJump=p.jumpBuffer>0;if(bufferedJump){p.vz=cd.jump;p.onGround=false;p.jumpCd=.18;p.jumpBuffer=0;effects.push({type:'text',x:p.x,y:p.y,z:52,t:.42,text:'BOOST'});ripples.push({x:p.x,y:p.y,z:0,t:.42})}else if(impact>150){p.vz=clamp(impact*.34,125,255);p.onGround=false;effects.push({type:'text',x:p.x,y:p.y,z:45,t:.34,text:'BOING'});ripples.push({x:p.x,y:p.y,z:0,t:.34})}else{p.vz=0;p.onGround=true}}else p.onGround=false;if(p.z>CEILING-35){p.z=CEILING-35;p.vz=-Math.abs(p.vz)*.28;ripples.push({x:p.x,y:p.y,z:CEILING,t:.45})}confine(p,.15);if(c.a)attack(p);if(c.b)kick(p);if(c.c&&(!p.onGround&&p.wallCling<=0&&(p.x<ARENA_L+18||p.x>ARENA_R-18||p.y<ARENA_T+18||p.y>ARENA_B-18)&&p.wallJump)){jump(p);p.jumpBuffer=0}else if(c.c&&p.onGround){jump(p);p.jumpBuffer=0}}
function updateBall(dt){ball.wallHitCd=Math.max(0,ball.wallHitCd-dt);ball.lastX=ball.x;ball.lastY=ball.y;ball.lastZ=ball.z;ball.trails.push({x:ball.x,y:ball.y,z:ball.z,t:.34});if(ball.trails.length>24)ball.trails.shift();ball.trails.forEach(t=>t.t-=dt);ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;ball.z+=ball.vz*dt;ball.airTime+=dt;ball.vz-=560*dt;ball.vx*=Math.pow(.997,dt*60);ball.vy*=Math.pow(.997,dt*60);if(ball.z<0){const impact=Math.abs(ball.vz);ball.z=0;ball.vz=impact*.58;ball.vx*=.992;ball.vy*=.992;if(ball.vz<48)ball.vz=0;else ripples.push({x:ball.x,y:ball.y,z:0,t:.42});ball.idle+=dt}else ball.idle=0;if(ball.z>CEILING){ball.z=CEILING;ball.vz=-Math.abs(ball.vz)*.55;ripples.push({x:ball.x,y:ball.y,z:CEILING,t:.65})}if(confine(ball,.08)){let planar=Math.hypot(ball.vx,ball.vy);if(ball.wallHitCd<=0){const boost=Math.min(1.12,1.045+Math.min(ball.airTime,2)*.02);ball.vx*=boost;ball.vy*=boost;planar=Math.hypot(ball.vx,ball.vy);if(planar>430){ball.vx*=430/planar;ball.vy*=430/planar}ball.vz=Math.max(ball.vz,150);ball.wallHitCd=.14;ripples.push({x:ball.x,y:ball.y,z:ball.z,t:.5})}}if(ball.z<24&&Math.hypot(ball.vx,ball.vy)<55){ball.idle+=dt;if(ball.idle>1.0){const dir=norm(ball.x-CX||1,ball.y-CY||.2);ball.vx=dir.x*175;ball.vy=dir.y*175;ball.vz=55;ball.idle=0}}if(!Number.isFinite(ball.x+ball.y+ball.z)||Math.abs(ball.x)>5000||Math.abs(ball.y)>5000||ball.z>1500){Object.assign(ball,{x:CX,y:CY,z:24,vx:190,vy:60,vz:80,owner:null,lastTouch:null,wallHitCd:0})}checkGoal()}
function checkGoal(){for(const r of rings){const now=d2(ball,r),prev=Math.hypot(ball.lastX-r.x,ball.lastY-r.y);const dz=Math.abs(ball.z-r.z),prevDz=Math.abs(ball.lastZ-r.z);if(now<34&&dz<30&&(prev>=34||prevDz>=30)){const scoring=1-r.team;score[scoring]++;scoreEl.textContent=`BLUE ${score[0]} — ${score[1]} RED`;banner='GOAL!';flash=1;shake=.42;resetTimer=.78;return}}}
function updateProjectiles(dt){for(let i=projectiles.length-1;i>=0;i--){const k=projectiles[i];k.x+=k.vx*dt;k.y+=k.vy*dt;k.rot+=dt*18;k.t-=dt;let hit=false;if(confine(k,.05))hit=true;for(const p of players){if(p.team===k.team||d2(p,k)>30||Math.abs(p.z+35-k.z)>65)continue;p.stun=.3;p.vx+=Math.sign(k.vx)*70;p.vz=Math.min(p.vz,-90);effects.push({type:'hit',x:p.x,y:p.y,z:p.z+35,t:.3});hit=true;break}if(hit||k.t<=0)projectiles.splice(i,1)}}
function separatePlayers(){for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++){const a=players[i],b=players[j];if(Math.abs(a.z-b.z)>82)continue;let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.001,min=64;if(d>=min)continue;const push=(min-d)*.58,nx=dx/d,ny=dy/d;a.x-=nx*push;a.y-=ny*push;b.x+=nx*push;b.y+=ny*push;a.vx-=nx*24;b.vx+=nx*24;a.vy-=ny*24;b.vy+=ny*24;confine(a,.1);confine(b,.1)}}
function update(dt){if(keys.has('r'))reset();players.forEach(p=>updatePlayer(p,dt));separatePlayers();updateBall(dt);updateProjectiles(dt);effects.forEach(e=>e.t-=dt);ripples.forEach(e=>e.t-=dt);for(let i=effects.length-1;i>=0;i--)if(effects[i].t<=0)effects.splice(i,1);for(let i=ripples.length-1;i>=0;i--)if(ripples[i].t<=0)ripples.splice(i,1);flash=Math.max(0,flash-dt*1.4);shake=Math.max(0,shake-dt);if(resetTimer>0&&(resetTimer-=dt)<=0)reset(true)}
function project(x,y,z=0){return{x,y:y-z*.58}}
function shadow(x,y,z,r=24){ctx.save();ctx.globalAlpha=clamp(.42-z/850,.09,.42);ctx.fillStyle='#02050a';ctx.beginPath();ctx.ellipse(x,y+13,r*(1-z/950),r*.34*(1-z/950),0,0,Math.PI*2);ctx.fill();ctx.restore()}
function drawArena(){
  const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#14283a');bg.addColorStop(.58,'#091624');bg.addColorStop(1,'#03080e');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  const floor=ctx.createLinearGradient(0,ARENA_T,0,ARENA_B);floor.addColorStop(0,'#23495c');floor.addColorStop(1,'#102b39');ctx.fillStyle=floor;ctx.fillRect(ARENA_L,ARENA_T,ARENA_R-ARENA_L,ARENA_B-ARENA_T);
  ctx.strokeStyle='#a4e8ff88';ctx.lineWidth=5;ctx.strokeRect(ARENA_L,ARENA_T,ARENA_R-ARENA_L,ARENA_B-ARENA_T);

  // Sparse perspective cage: enough structure to read depth without turning the arena into graph paper.
  ctx.save();ctx.strokeStyle='rgba(215,248,255,.12)';ctx.lineWidth=.7;ctx.setLineDash([4,9]);
  for(let x=ARENA_L+92;x<ARENA_R;x+=92){ctx.beginPath();ctx.moveTo(x,ARENA_B);ctx.lineTo(CX+(x-CX)*.55,ARENA_T);ctx.stroke()}
  ctx.restore();

  // Strong colour-coded altitude ribbons. The yellow ribbon is the exact goal height.
  const bands=[
    {z:120,col:'rgba(69,150,255,.55)',name:'LOW'},
    {z:240,col:'rgba(46,229,216,.53)',name:'MID'},
    {z:360,col:'rgba(255,225,76,.68)',name:'GOAL'},
    {z:480,col:'rgba(255,242,145,.42)',name:'HIGH'}
  ];
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.font='900 11px system-ui';ctx.textAlign='left';
  for(const b of bands){
    const yy=CY-b.z*.58, inset=32+b.z*.055, peak=yy-26;
    ctx.strokeStyle=b.col;ctx.lineWidth=b.z===360?13:9;
    ctx.beginPath();ctx.moveTo(ARENA_L+8,yy+18);ctx.lineTo(CX,peak);ctx.lineTo(ARENA_R-8,yy+18);ctx.stroke();
    ctx.globalAlpha=.36;ctx.beginPath();ctx.moveTo(ARENA_L+inset,yy+48);ctx.lineTo(CX,peak+38);ctx.lineTo(ARENA_R-inset,yy+48);ctx.stroke();ctx.globalAlpha=1;
    ctx.fillStyle=b.col.replace(/,[^)]+\)/,',1)');ctx.fillText(`${b.name} ${b.z}`,ARENA_L+14,yy+8);
  }
  ctx.restore();

  // Arched roof remains purely visual; collision still uses the stable flat ceiling plane.
  ctx.save();ctx.strokeStyle='#9de9ff35';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ARENA_L,ARENA_T);ctx.quadraticCurveTo(CX,42,ARENA_R,ARENA_T);ctx.stroke();ctx.restore();
  rings.forEach(drawRing);ripples.forEach(drawRipple)
}
function drawRipple(e){const p=project(e.x,e.y,e.z),a=clamp(e.t*2,0,1),rad=(1-e.t)*70+14;ctx.save();ctx.globalAlpha=a;ctx.strokeStyle='#b9f4ff';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(p.x,p.y,rad,rad*.45,0,0,Math.PI*2);ctx.stroke();ctx.restore()}
function drawRing(r){shadow(r.x,r.y,r.z,46);const p=project(r.x,r.y,r.z),col=r.team===0?'#45c8ff':'#ff5873';ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle=col+'22';ctx.strokeStyle=col;ctx.shadowColor=col;ctx.shadowBlur=34;ctx.lineWidth=13;ctx.beginPath();ctx.ellipse(0,0,28,52,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#f5fdff';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#06111ccc';ctx.strokeStyle=col+'aa';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(-48,62,96,24,9);ctx.fill();ctx.stroke();ctx.fillStyle='#ffffff';ctx.font='900 11px system-ui';ctx.textAlign='center';ctx.fillText(r.label,0,78);ctx.restore();ctx.strokeStyle=col+'55';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(r.x,r.y);ctx.lineTo(p.x,p.y);ctx.stroke()}
function drawPlayer(p){const q=project(p.x,p.y,p.z),team=p.team===0?'#2e9eea':'#db4059',trim=p.team===0?'#bcecff':'#ffd2d9';shadow(p.x,p.y,p.z,27);ctx.save();ctx.translate(q.x,q.y);ctx.globalAlpha=p.stun>0?.65:1;const run=Math.sin(performance.now()/90+p.id)*Math.min(5,Math.hypot(p.vx,p.vy)/60),attackPose=p.anim>0?1:0,kickPose=p.kickAnim>0?1:0;
// illustrated body silhouette
ctx.strokeStyle='#07111c';ctx.lineWidth=4;ctx.fillStyle=team;ctx.beginPath();ctx.roundRect(-17,-31,34,48,12);ctx.fill();ctx.stroke();ctx.fillStyle=trim;ctx.beginPath();ctx.arc(0,-42,16,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#172531';ctx.beginPath();ctx.arc(0,-42,13,Math.PI,Math.PI*2);ctx.fill();if(p.cls==='ninja'){ctx.fillStyle=team;ctx.fillRect(-16,-47,32,10);ctx.fillStyle='#fff';ctx.fillRect(-7,-44,4,2);ctx.fillRect(3,-44,4,2)}else{ctx.fillStyle='#d6b77e';ctx.beginPath();ctx.arc(0,-43,13,Math.PI,Math.PI*2);ctx.fill();ctx.fillStyle='#402d20';ctx.fillRect(-7,-42,4,2);ctx.fillRect(3,-42,4,2)}
ctx.strokeStyle=trim;ctx.lineWidth=7;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
if(p.onGround&&kickPose){
  const f=p.face;ctx.moveTo(-5*f,-3);ctx.lineTo(-18*f,12);ctx.lineTo(-8*f,25);ctx.moveTo(5*f,-3);ctx.lineTo(23*f,3);ctx.lineTo(40*f,-1);
}else if(p.onGround){
  ctx.moveTo(-9,-5);ctx.lineTo(-15,20+run);
  ctx.moveTo(9,-5);ctx.lineTo(15,20-run);
}else if(kickPose){
  // Clear aerial kick: one leg snaps forward, the support leg tucks behind.
  const f=p.face;
  ctx.moveTo(5*f,-3);ctx.lineTo(23*f,-5);ctx.lineTo(39*f,-8);
  ctx.moveTo(-5*f,-3);ctx.lineTo(-14*f,10);ctx.lineTo(-5*f,22);
}else{
  // Heroic jump silhouette: one leg long, only the rear knee is bent.
  const f=p.face;
  ctx.moveTo(5*f,-3);ctx.lineTo(12*f,13);ctx.lineTo(16*f,28);
  ctx.moveTo(-5*f,-3);ctx.lineTo(-16*f,8);ctx.lineTo(-9*f,20);
}
ctx.moveTo(-13,-18);ctx.lineTo(-24,-2);
ctx.moveTo(13,-18);ctx.lineTo((24+attackPose*10)*p.face,-4);ctx.stroke();
if(p.cls==='ninja'){ctx.strokeStyle='#e9f5ff';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(16*p.face,-13);ctx.lineTo(31*p.face,-22);ctx.stroke();ctx.fillStyle='#e9f5ff';ctx.beginPath();ctx.moveTo(31*p.face,-22);ctx.lineTo(21*p.face,-23);ctx.lineTo(26*p.face,-15);ctx.fill()}else if(p.cls==='staff'){ctx.strokeStyle='#d7ae58';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(-31*p.face,7);ctx.lineTo(34*p.face,-14);ctx.stroke()}else{ctx.strokeStyle='#f4d7bd';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(18*p.face,-8);ctx.lineTo(29*p.face,-4);ctx.stroke();ctx.strokeStyle='#9b5d42';ctx.lineWidth=2;for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo((20+i*3)*p.face,-11+i*2);ctx.lineTo((25+i*3)*p.face,-6+i*2);ctx.stroke()}}
ctx.fillStyle='#f6fbff';ctx.font='900 11px system-ui';ctx.textAlign='center';ctx.fillText(classData[p.cls].name,0,-65);if(p.stun>0){ctx.fillStyle='#ffe55d';ctx.font='20px sans-serif';ctx.fillText('✦  ✦',0,-80)}ctx.restore()}
function drawBall(){for(const t of ball.trails){if(t.t<=0)continue;const p=project(t.x,t.y,t.z);ctx.save();ctx.globalAlpha=t.t*.45;ctx.fillStyle='#d6f5ff';ctx.beginPath();ctx.arc(p.x,p.y,5+t.z*.012,0,Math.PI*2);ctx.fill();ctx.restore()}shadow(ball.x,ball.y,ball.z,22);ctx.save();ctx.strokeStyle='#ffe57688';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(ball.x,ball.y+12,26,9,0,0,Math.PI*2);ctx.stroke();ctx.restore();const p=project(ball.x,ball.y,ball.z),s=15+ball.z*.025;ctx.save();ctx.translate(p.x,p.y);ctx.shadowColor='#c6f5ff';ctx.shadowBlur=22;ctx.fillStyle='#f3fbff';ctx.strokeStyle='#102638';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,s,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#56badb';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,s*.57,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(-s*.7,0);ctx.lineTo(s*.7,0);ctx.stroke();ctx.restore()}
function drawProjectiles(){for(const k of projectiles){const p=project(k.x,k.y,k.z);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(k.rot);ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-13,0);ctx.lineTo(13,0);ctx.moveTo(0,-7);ctx.lineTo(0,7);ctx.stroke();ctx.restore()}}
function drawEffects(){for(const e of effects){const p=project(e.x,e.y,e.z),a=clamp(e.t*3,0,1);ctx.save();ctx.globalAlpha=a;if(e.type==='text'){ctx.fillStyle='#fff5a6';ctx.font='900 18px system-ui';ctx.textAlign='center';ctx.fillText(e.text,p.x,p.y)}else{ctx.strokeStyle=e.type==='hit'?'#ffdd8a':'#c9f7ff';ctx.lineWidth=5;ctx.beginPath();ctx.arc(p.x,p.y,12+(1-e.t)*46,0,Math.PI*2);ctx.stroke()}ctx.restore()}}
function draw(){ctx.save();if(shake>0)ctx.translate(rnd(-5,5)*shake/.42,rnd(-4,4)*shake/.42);drawArena();[...players].sort((a,b)=>(a.y-a.z*.18)-(b.y-b.z*.18)).forEach(drawPlayer);drawProjectiles();drawBall();drawEffects();ctx.restore();ctx.fillStyle='#e8f7ff';ctx.font='13px system-ui';ctx.textAlign='left';ctx.fillText('A 武器　B リフトキック / 空中ボレー　C ジャンプ',34,30);ctx.textAlign='right';ctx.fillText('ジャンプ長押しで着地予約・壁張り付き・床バウンド',W-34,30);if(flash>0){ctx.fillStyle=`rgba(255,255,255,${flash*.28})`;ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff';ctx.font='900 54px system-ui';ctx.textAlign='center';ctx.fillText(banner,CX,100)}}
function loop(t){const dt=Math.min(.033,(t-last)/1000);last=t;update(dt);draw();requestAnimationFrame(loop)}
window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(!keys.has(k))pressed.add(k);keys.add(k);if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))e.preventDefault()});window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
function bind(id,p){const el=document.getElementById(id),down=e=>{e.preventDefault();input[p]=true;input[p+'Tap']=true;el.classList.add('pressed')},up=e=>{e.preventDefault();input[p]=false;el.classList.remove('pressed')};el.addEventListener('pointerdown',down);['pointerup','pointercancel','pointerleave'].forEach(n=>el.addEventListener(n,up))}bind('btnA','a');bind('btnB','b');bind('btnC','c');
const stick=document.getElementById('stick');
const knob=document.getElementById('knob');
let sid=null;
function sm(e){
  const r=stick.getBoundingClientRect();
  const cx=r.left+r.width/2,cy=r.top+r.height/2,max=r.width*.34;
  let dx=e.clientX-cx,dy=e.clientY-cy;
  const d=Math.hypot(dx,dy);
  if(d>max){dx*=max/d;dy*=max/d;}
  input.x=dx/max;input.y=dy/max;
  knob.style.transform=`translate(${dx}px,${dy}px)`;
}
stick.addEventListener('pointerdown',e=>{sid=e.pointerId;stick.setPointerCapture(sid);sm(e);});
stick.addEventListener('pointermove',e=>{if(e.pointerId===sid)sm(e);});
function se(e){
  if(e.pointerId!==sid)return;
  sid=null;input.x=input.y=0;
  knob.style.transform='translate(0,0)';
}
stick.addEventListener('pointerup',se);
stick.addEventListener('pointercancel',se);
reset();requestAnimationFrame(loop);
})();
