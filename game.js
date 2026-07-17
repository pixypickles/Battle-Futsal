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
  const GRAVITY = 850;
  const effects = [];
  const CLASS_ORDER = ['knight','mace','monk','ninja'];
  const CLASS_DATA = {
    knight:{label:'KNIGHT',speed:225},
    mace:{label:'MACE',speed:194},
    monk:{label:'MONK',speed:218},
    ninja:{label:'NINJA',speed:248}
  };
  let selectedClass = 'knight';
  const trails = [];
  const input = { x:0, y:0, a:false, b:false, c:false };
  let shake = 0, hitStop = 0;
  let last = performance.now(), gameTime = 120, running = true;
  let blueScore = 0, redScore = 0;

  const len = (x,y) => Math.hypot(x,y);
  const norm = (x,y) => { const l=Math.hypot(x,y)||1; return {x:x/l,y:y/l}; };
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

  function project(x,y,z=0){
    const depth = (y + FIELD.r) / (FIELD.r*2);
    const s = 0.78 + depth*0.22;
    return { x: W/2 + x*s, y: 245 + (y+FIELD.r)*0.86 - z*0.92, s };
  }

  class Actor {
    constructor(x,y,team,isPlayer=false,role='striker',classType='knight'){
      Object.assign(this,{x,y,team,isPlayer,role,classType,vx:0,vy:0,r:23,stun:0,coolA:0,coolB:0,guard:false,hasBall:false,holdA:false,holdB:false,chargeA:0,chargeB:0,attackAnim:0,dashCool:0});
      this.speed = CLASS_DATA[classType].speed + (isPlayer?0:(role==='support'?-12:-7));
      this.facing = team==='blue' ? -Math.PI/2 : Math.PI/2;
      this.aiThink = Math.random()*.15;
    }
    update(dt){
      this.stun=Math.max(0,this.stun-dt);
      this.coolA=Math.max(0,this.coolA-dt);
      this.coolB=Math.max(0,this.coolB-dt);
      this.attackAnim=Math.max(0,this.attackAnim-dt);
      this.dashCool=Math.max(0,this.dashCool-dt);
      this.guard=false;
      if(this.stun>0){
        this.holdB=false; this.chargeB=0;
        this.vx*=Math.pow(.03,dt); this.vy*=Math.pow(.03,dt);
      } else if(this.isPlayer) this.playerControl(dt);
      else this.aiControl(dt);
      this.x+=this.vx*dt; this.y+=this.vy*dt;
      constrainActor(this);
    }
    playerControl(dt){
      const m=Math.min(1,len(input.x,input.y));
      const charging=this.hasBall&&this.holdB;
      const moveScale=charging?.58:1;
      if(m>.08){
        const n=norm(input.x,input.y);
        this.vx=n.x*this.speed*m*moveScale;
        this.vy=n.y*this.speed*m*moveScale;
        this.facing=Math.atan2(n.y,n.x);
      } else { this.vx*=.82; this.vy*=.82; }

      if(this.hasBall){
        if(input.a){ this.holdA=true; this.chargeA=Math.min(.85,this.chargeA+dt); }
        else if(this.holdA){ this.pass(this.chargeA); this.holdA=false; this.chargeA=0; }

        if(input.b){ this.holdB=true; this.chargeB=Math.min(.62,this.chargeB+dt); }
        else if(this.holdB){ this.shoot(this.chargeB); this.holdB=false; this.chargeB=0; }

        if(input.c)this.guardBall();
      } else {
        this.holdA=this.holdB=false; this.chargeA=this.chargeB=0;
        if(input.a)this.slash();
        if(input.b){ if(canDirectKick(this)) this.directKick(); else this.bash(); }
        if(input.c){
          if(this.classType==='monk'||this.classType==='ninja') this.mobilitySkill();
          else this.guard=true;
        }
      }
    }
    aiControl(dt){
      this.aiThink-=dt;
      const mates=actors.filter(a=>a.team===this.team&&a!==this);
      const foes=actors.filter(a=>a.team!==this.team);
      const ballOwner=ball.owner;
      const ownGoalY=this.team==='blue'?GOAL.y:-GOAL.y;
      const attackGoalY=this.team==='blue'?-GOAL.y:GOAL.y;
      const attackDir=this.team==='blue'?-1:1;
      let tx=this.x, ty=this.y;

      if(this.hasBall){
        const nearest=nearestActor(this,foes);
        const danger=nearest?dist(this,nearest):999;
        const shotDist=Math.hypot(this.x,attackGoalY-this.y);
        const openMate=bestOpenPassTarget(this,mates,foes);

        // AI should shoot decisively when it has a reasonable lane. Full charge is reserved
        // for genuinely open chances, so it does not stand still waiting to be hit.
        const inScoringZone=this.team==='blue'?this.y<72:this.y>-72;
        if(shotDist<265 && inScoringZone && (danger>58 || shotDist<175)){
          this.chargeB=Math.min(.62,this.chargeB+dt);
          this.holdB=true;
          this.vx*=.68; this.vy*=.68;
          const needed=danger>150?.42:danger>95?.24:.08;
          if(this.chargeB>=needed){
            this.facing=Math.atan2(attackGoalY-this.y,-this.x);
            this.shoot(this.chargeB); this.holdB=false; this.chargeB=0;
          }
          return;
        }

        // Pass before being surrounded, preferably to the player or a clearly advanced mate.
        if((danger<92 || Math.abs(this.x)>225) && openMate){
          this.facing=Math.atan2(openMate.y-this.y,openMate.x-this.x);
          this.pass(danger<65?.08:.22);
          return;
        }

        // Carry diagonally toward goal instead of running straight into the defender.
        const avoid=nearest?Math.sign(this.x-nearest.x||1)*72:0;
        tx=clamp(-this.x*.30+avoid,-155,155);
        ty=attackGoalY*.86;
      } else if(ballOwner && ballOwner.team===this.team){
        // Support the carrier from the goal-side/front side. This creates a passing lane and
        // makes the support AI physically screen defenders instead of trailing behind.
        const carrier=ballOwner;
        const threat=nearestActor(carrier,foes);
        if(this.role==='support'){
          if(threat && dist(threat,carrier)<175){
            const towardGoal={x:-carrier.x,y:attackGoalY-carrier.y};
            const g=norm(towardGoal.x,towardGoal.y);
            tx=carrier.x+g.x*72;
            ty=carrier.y+g.y*72;
            // If a defender is already close, attack it directly and clear the shooting lane.
            if(dist(this,threat)<112){
              this.facing=Math.atan2(threat.y-this.y,threat.x-this.x);
              if(this.coolB<=0)this.bash(); else this.slash();
            }
          } else {
            // Move into an open diagonal passing position ahead of the carrier.
            tx=clamp(carrier.x+(carrier.x<=0?105:-105),-220,220);
            ty=clamp(carrier.y+attackDir*115,-245,245);
          }
        } else {
          tx=clamp(carrier.x+(carrier.x<=0?95:-95),-220,220);
          ty=clamp(carrier.y+attackDir*125,-245,245);
        }
      } else if(ballOwner && ballOwner.team!==this.team){
        const carrier=ballOwner;
        // Defend from the goal side, so the AI cuts off the shot instead of chasing from behind.
        const goalSide=norm(-carrier.x,ownGoalY-carrier.y);
        const interceptX=carrier.x+goalSide.x*62;
        const interceptY=carrier.y+goalSide.y*62;
        if(this.role==='support'){
          tx=interceptX; ty=interceptY;
          if(dist(this,carrier)<108){
            this.facing=Math.atan2(carrier.y-this.y,carrier.x-this.x);
            if(this.coolB<=0)this.bash(); else this.slash();
          }
        } else {
          tx=carrier.x; ty=carrier.y;
          if(dist(this,carrier)<96){ this.facing=Math.atan2(carrier.y-this.y,carrier.x-this.x); this.slash(); }
        }
      } else {
        const teammates=actors.filter(a=>a.team===this.team);
        const nearestToBall=nearestActor(ball,teammates);
        const ballSpeed=Math.hypot(ball.vx,ball.vy);
        // The closest teammate always commits to the loose ball. Support also commits when the
        // ball is slow or in its own half, preventing the ally from watching recoverable balls.
        const ownHalf=this.team==='blue'?ball.y>0:ball.y<0;
        if(nearestToBall===this || (this.role==='support'&&(ballSpeed<185||ownHalf))){
          const lead=.16;
          tx=ball.x+ball.vx*lead; ty=ball.y+ball.vy*lead;
        } else {
          tx=clamp(ball.x*.42,-150,150);
          ty=clamp(ball.y-attackDir*105,-230,230);
        }
      }

      const dx=tx-this.x,dy=ty-this.y;
      const distance=Math.hypot(dx,dy);
      if(distance>9){
        const n=norm(dx,dy);
        this.vx=n.x*this.speed; this.vy=n.y*this.speed;
        this.facing=Math.atan2(n.y,n.x);
      } else { this.vx*=.72; this.vy*=.72; }

      if(this.role==='support' && !ballOwner && dist(this,ball)<88 && !ball.owner && ball.z<30){
        this.facing=Math.atan2(ball.y-this.y,ball.x-this.x);
        this.slash();
      }
      // Emergency goal-line behavior: face the ball and guard when the carrier is about to shoot.
      if(Math.abs(this.y-ownGoalY)<92 && this.role==='support'){
        const threat=ball.owner&&ball.owner.team!==this.team?ball.owner:ball;
        this.facing=Math.atan2(threat.y-this.y,threat.x-this.x);
        this.guard=true;
      }
    }
    slash(){
      if(this.coolA>0||this.stun>0)return;
      this.attackAnim=.30;
      if(this.classType==='mace'){ this.coolA=.82; strike(this,100,.58,560,'MACE'); pokeBall(this,360); }
      else if(this.classType==='monk'){ this.coolA=.54; strike(this,132,.72,250,'SWEEP'); pokeBall(this,285); }
      else if(this.classType==='ninja'){ this.coolA=.30; this.attackAnim=.20; strike(this,82,.46,175,'CUT'); pokeBall(this,170); }
      else { this.coolA=.56; strike(this,96,1.12,165,'SLASH'); pokeBall(this,195); }
    }
    bash(){
      if(this.coolB>0||this.stun>0)return;
      if(this.classType==='mace'){ this.coolB=1.32; this.vx+=Math.cos(this.facing)*250; this.vy+=Math.sin(this.facing)*250; strike(this,92,.28,920,'CRUSH'); pokeBall(this,430); }
      else if(this.classType==='monk'){ this.coolB=.90; this.vx+=Math.cos(this.facing)*300; this.vy+=Math.sin(this.facing)*300; strike(this,108,.38,460,'THRUST'); pokeBall(this,330); }
      else if(this.classType==='ninja'){ this.shuriken(); }
      else { this.coolB=1.05; this.vx+=Math.cos(this.facing)*330; this.vy+=Math.sin(this.facing)*330; strike(this,78,.34,720,'BASH'); pokeBall(this,280); }
    }
    shuriken(){
      this.coolB=.78;
      const foes=actors.filter(a=>a.team!==this.team&&a.stun<=0);
      let target=null,best=195;
      for(const f of foes){
        const d=dist(this,f),ang=Math.abs(angleDiff(Math.atan2(f.y-this.y,f.x-this.x),this.facing));
        if(d<best&&ang<.55){best=d;target=f;}
      }
      if(target){
        const n=norm(target.x-this.x,target.y-this.y); target.stun=Math.max(target.stun,.42); target.vx=n.x*210; target.vy=n.y*210;
        if(target.hasBall)dropBall(target,185); effects.push({x:target.x,y:target.y,z:38,t:.28,label:'SHURIKEN'});
      } else effects.push({x:this.x+Math.cos(this.facing)*90,y:this.y+Math.sin(this.facing)*90,z:32,t:.18,label:'MISS'});
    }
    mobilitySkill(){
      if(this.dashCool>0)return;
      this.dashCool=this.classType==='ninja'?.62:.86;
      const power=this.classType==='ninja'?520:390;
      this.vx=Math.cos(this.facing)*power; this.vy=Math.sin(this.facing)*power;
      effects.push({x:this.x,y:this.y,z:24,t:.18,label:this.classType==='ninja'?'DASH':'STEP'});
    }
    pass(charge=0){
      if(!this.hasBall||this.coolA>0)return;
      this.coolA=.34;
      const lob=Math.min(1,charge/.5);
      let target=bestPassTarget(this);
      if(target && !this.isPlayer){ this.facing=Math.atan2(target.y-this.y,target.x-this.x); }
      releaseBall(this,430+lob*65,55+lob*245);
    }
    shoot(charge=0){
      if(!this.hasBall||this.coolB>0)return;
      this.coolB=.58;
      releaseShot(this,Math.min(1,charge/.52),false);
    }
    directKick(){
      if(this.coolB>0||ball.owner||dist(this,ball)>72||ball.z<18||ball.z>96)return;
      this.coolB=.72;
      releaseShot(this,.66,true);
      effects.push({x:ball.x,y:ball.y,z:ball.z,t:.28,label:'DIRECT'});
      shake=Math.max(shake,8);
    }
    guardBall(){ this.guard=true; this.vx*=.54; this.vy*=.54; }
  }

  const ball={x:0,y:0,z:14,vx:0,vy:0,vz:0,r:14,owner:null,prevY:0,wallTouch:0,shotAssist:0,targetY:0,shotTime:0,goalEligible:false,shotOriginY:0};
  const player=new Actor(-72,175,'blue',true,'striker','knight');
  const ally=new Actor(78,148,'blue',false,'support','mace');
  const enemy=new Actor(-72,-170,'red',false,'striker','ninja');
  const enemy2=new Actor(82,-145,'red',false,'support','monk');
  const actors=[player,ally,enemy,enemy2];

  function nearestActor(origin,list){
    let best=null,bestD=Infinity;
    for(const a of list){ const d=dist(origin,a); if(d<bestD){bestD=d;best=a;} }
    return best;
  }
  function bestPassTarget(actor){
    const mates=actors.filter(a=>a.team===actor.team&&a!==actor&&a.stun<=0);
    return nearestActor({x:actor.x,y:actor.y+(actor.team==='blue'?-110:110)},mates);
  }
  function bestOpenPassTarget(actor,mates,foes){
    let best=null,bestScore=-Infinity;
    const attackDir=actor.team==='blue'?-1:1;
    for(const mate of mates){
      if(mate.stun>0)continue;
      const nearestFoe=nearestActor(mate,foes);
      const space=nearestFoe?dist(mate,nearestFoe):260;
      const progress=(mate.y-actor.y)*attackDir;
      const range=dist(actor,mate);
      if(range>360)continue;
      const playerBonus=mate.isPlayer?42:0;
      const score=space*.72+progress*.48-range*.18+playerBonus;
      if(score>bestScore){bestScore=score;best=mate;}
    }
    return best;
  }
  function angleDiff(a,b){ return Math.atan2(Math.sin(a-b),Math.cos(a-b)); }

  function strike(attacker,range,stun,force,label){
    const targets=actors.filter(a=>a.team!==attacker.team);
    let target=null,best=Infinity;
    for(const candidate of targets){
      const dx=candidate.x-attacker.x,dy=candidate.y-attacker.y,d=Math.hypot(dx,dy);
      const forward=(dx*Math.cos(attacker.facing)+dy*Math.sin(attacker.facing))/(d||1);
      if(d<range+candidate.r&&forward>.18&&d<best){target=candidate;best=d;}
    }
    if(!target||target.guard)return;
    const dx=target.x-attacker.x,dy=target.y-attacker.y;
    target.stun=Math.max(target.stun,stun);
    target.holdB=false; target.chargeB=0;
    const n=norm(dx,dy);
    target.vx=n.x*force; target.vy=n.y*force;
    target.x+=n.x*12; target.y+=n.y*12;
    if(target.hasBall)dropBall(target,force*.95);
    effects.push({x:target.x,y:target.y,z:38,t:.28,label});
    shake=Math.max(shake,label==='BASH'?18:8);
    hitStop=Math.max(hitStop,label==='BASH'?.080:.065);
  }
  function pokeBall(actor,speed){
    if(ball.owner||ball.z>24||dist(actor,ball)>82)return;
    const f=(ball.x-actor.x)*Math.cos(actor.facing)+(ball.y-actor.y)*Math.sin(actor.facing); if(f<0)return;
    ball.vx+=Math.cos(actor.facing)*speed; ball.vy+=Math.sin(actor.facing)*speed; ball.vz=Math.max(ball.vz,55);
  }
  function canDirectKick(actor){ return !ball.owner && ball.z>=18 && ball.z<=96 && dist(actor,ball)<76; }
  function dropBall(actor,force=230){
    actor.hasBall=false; ball.owner=null;
    ball.x=actor.x+Math.cos(actor.facing)*32; ball.y=actor.y+Math.sin(actor.facing)*32; ball.z=16;
    ball.vx=Math.cos(actor.facing)*force; ball.vy=Math.sin(actor.facing)*force; ball.vz=80;
    ball.shotAssist=0; ball.shotTime=0; ball.goalEligible=false;
  }
  function releaseBall(actor,speed,lift){
    actor.hasBall=false; ball.owner=null;
    ball.x=actor.x+Math.cos(actor.facing)*35; ball.y=actor.y+Math.sin(actor.facing)*35; ball.z=18;
    ball.vx=Math.cos(actor.facing)*speed; ball.vy=Math.sin(actor.facing)*speed; ball.vz=lift;
    ball.shotAssist=0; ball.shotTime=0; ball.goalEligible=false;
  }

  function releaseShot(actor,charge=0,direct=false){
    const goalY=actor.team==='blue'?-GOAL.y:GOAL.y;
    const desired=Math.atan2(goalY-actor.y,-actor.x);
    const launchAssist=direct?.50:(.08+charge*.20);
    let shotAngle=actor.facing+angleDiff(desired,actor.facing)*launchAssist;
    if(!actor.isPlayer)shotAngle+=(Math.random()-.5)*(.10*(1-charge));

    const startZ=direct?Math.max(22,ball.z):18;
    const startX=direct?ball.x:actor.x+Math.cos(shotAngle)*35;
    const startY=direct?ball.y:actor.y+Math.sin(shotAngle)*35;
    const planarDistance=Math.hypot(-startX,goalY-startY);
    const flight=clamp(.62+planarDistance/900,.62,1.12);
    const speed=clamp(planarDistance/flight,430,650)+(direct?45:0)+charge*35;
    let vx=Math.cos(shotAngle)*speed, vy=Math.sin(shotAngle)*speed;
    const requiredSign=goalY<actor.y?-1:1;
    if(Math.sign(vy)!==requiredSign||Math.abs(vy)<120){
      shotAngle=actor.facing+angleDiff(desired,actor.facing)*(.30+charge*.25);
      vx=Math.cos(shotAngle)*speed; vy=Math.sin(shotAngle)*speed;
    }
    const travel=Math.max(.60,Math.abs((goalY-startY)/(vy||1)));
    const vz=(GOAL.height-startZ+.5*GRAVITY*travel*travel)/travel;

    actor.hasBall=false; ball.owner=null;
    ball.x=startX; ball.y=startY; ball.z=startZ;
    ball.vx=vx; ball.vy=vy; ball.vz=clamp(vz,390,555);
    ball.shotAssist=direct?.55:charge;
    ball.targetY=goalY;
    ball.shotTime=1.6;
    ball.shotOriginY=startY;
    const advancedEnough=actor.team==='blue'?startY<72:startY>-72;
    ball.goalEligible=direct||advancedEnough||planarDistance<238;
    actor.facing=shotAngle;
    trails.length=0;
  }

  function constrainActor(a){
    const d=Math.hypot(a.x,a.y), max=FIELD.r-a.r;
    if(d>max){ a.x=a.x/d*max; a.y=a.y/d*max; a.vx*=.25; a.vy*=.25; }
  }

  function updateBall(dt){
    if(ball.owner){
      const a=ball.owner;
      ball.x=a.x+Math.cos(a.facing)*30; ball.y=a.y+Math.sin(a.facing)*30; ball.z=14;
      ball.vx=a.vx; ball.vy=a.vy; ball.vz=0; ball.shotTime=0;
      return;
    }
    ball.prevY=ball.y;
    ball.wallTouch=Math.max(0,ball.wallTouch-dt);
    ball.shotTime=Math.max(0,ball.shotTime-dt);

    if(ball.shotTime>0){
      trails.push({x:ball.x,y:ball.y,z:ball.z,t:.22});
      if(trails.length>14)trails.shift();
    }

    if(ball.shotAssist>0 && ball.z>ball.r+5){
      const movingTowardGoal=(ball.targetY<0&&ball.vy<0)||(ball.targetY>0&&ball.vy>0);
      if(movingTowardGoal){
        const speed=Math.hypot(ball.vx,ball.vy);
        const current=Math.atan2(ball.vy,ball.vx);
        const desired=Math.atan2(ball.targetY-ball.y,-ball.x);
        const maxTurn=(.10+ball.shotAssist*1.28)*dt;
        const turn=clamp(angleDiff(desired,current),-maxTurn,maxTurn);
        const next=current+turn;
        ball.vx=Math.cos(next)*speed; ball.vy=Math.sin(next)*speed;
      }
    }

    ball.x+=ball.vx*dt; ball.y+=ball.vy*dt; ball.z+=ball.vz*dt; ball.vz-=GRAVITY*dt;
    // Defensive cap: a numerical spike can no longer send the visible ball off-screen.
    if(ball.z>245){ ball.z=245; if(ball.vz>0)ball.vz=0; }

    if(ball.z<=ball.r){
      ball.z=ball.r;
      if(ball.vz<0)ball.vz*=-.36;
      ball.vx*=Math.pow(.09,dt); ball.vy*=Math.pow(.09,dt);
      if(Math.hypot(ball.vx,ball.vy)<18){ ball.vx=0; ball.vy=0; ball.shotAssist=0; ball.shotTime=0; }
    }

    const d=Math.hypot(ball.x,ball.y), max=FIELD.r-ball.r;
    if(d>max){
      const nx=ball.x/d, ny=ball.y/d;
      const tx=-ny, ty=nx;
      const vn=ball.vx*nx+ball.vy*ny;
      const vt=ball.vx*tx+ball.vy*ty;
      ball.x=nx*(max-2); ball.y=ny*(max-2);
      const bouncedN=vn>0?-vn*.42:vn;
      const draggedT=vt*(ball.wallTouch>0?.48:.66);
      ball.vx=bouncedN*nx+draggedT*tx;
      ball.vy=bouncedN*ny+draggedT*ty;
      ball.wallTouch=.16;
    }

    checkRingGoal(-GOAL.y,'blue');
    checkRingGoal(GOAL.y,'red');

    const ballSpeed=len(ball.vx,ball.vy);
    for(const a of actors){
      if(a.stun>0||ball.z>=38)continue;
      const pickupRange=a.r+ball.r+(ballSpeed<220?24:13);
      if(dist(a,ball)>=pickupRange)continue;
      const toward=(ball.x-a.x)*a.vx+(ball.y-a.y)*a.vy;
      if(ballSpeed<360 && (ballSpeed<210 || toward>0)){
        a.hasBall=true; ball.owner=a; ball.vx=ball.vy=ball.vz=0; ball.z=14; ball.shotAssist=0; ball.shotTime=0; trails.length=0;
        break;
      }
      if(ballSpeed>=360 && ball.z<25){ ball.vx*=.28; ball.vy*=.28; ball.vz=Math.max(ball.vz,45); }
    }
  }

  function checkRingGoal(goalY,team){
    const crossed = goalY<0 ? (ball.prevY>goalY && ball.y<=goalY) : (ball.prevY<goalY && ball.y>=goalY);
    if(!crossed)return;
    const inside=Math.hypot(ball.x,ball.z-GOAL.height)<GOAL.radius-ball.r*.72;
    const usefulArc=ball.vz<190;
    if(inside && usefulArc && ball.goalEligible && (team==='blue'?ball.vy<0:ball.vy>0)) score(team);
    else if(inside && !ball.goalEligible) effects.push({x:ball.x,y:ball.y,z:ball.z,t:.28,label:'TOO FAR'});
  }

  function score(team){
    if(!running)return;
    team==='blue'?blueScore++:redScore++;
    blueScoreEl.textContent=blueScore; redScoreEl.textContent=redScore;
    flash(team==='blue'?'RING GOAL!':'ENEMY GOAL');
    resetPositions();
  }

  function resetPositions(){
    const starts=[[-72,175],[78,148],[-72,-170],[82,-145]];
    actors.forEach((a,i)=>Object.assign(a,{x:starts[i][0],y:starts[i][1],vx:0,vy:0,stun:0,hasBall:false,holdA:false,holdB:false,chargeA:0,chargeB:0,facing:a.team==='blue'?-Math.PI/2:Math.PI/2}));
    Object.assign(ball,{x:0,y:0,z:14,vx:0,vy:0,vz:0,owner:null,prevY:0,wallTouch:0,shotAssist:0,targetY:0,shotTime:0,goalEligible:false,shotOriginY:0});
    effects.length=0; trails.length=0; shake=0; hitStop=0;
  }
  function flash(text){
    messageEl.textContent=text; messageEl.hidden=false;
    clearTimeout(flash.t); flash.t=setTimeout(()=>messageEl.hidden=true,850);
  }

  function resolveActorCollisions(){
    for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
      const a=actors[i],b=actors[j];
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,o=a.r+b.r-d;
      if(o>0){const nx=dx/d,ny=dy/d;a.x-=nx*o*.5;a.y-=ny*o*.5;b.x+=nx*o*.5;b.y+=ny*o*.5;}
    }
  }

  function update(dt){
    if(hitStop>0){ hitStop-=dt; updateEffects(dt); return; }
    if(!running)return;
    gameTime=Math.max(0,gameTime-dt);
    if(gameTime<=0){running=false;flash(blueScore===redScore?'DRAW':blueScore>redScore?'YOU WIN':'YOU LOSE');}
    actors.forEach(a=>a.update(dt));
    updateBall(dt); updateEffects(dt); resolveActorCollisions();
    const sec=Math.ceil(gameTime);
    timerEl.textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  }

  function updateEffects(dt){
    for(let i=effects.length-1;i>=0;i--){ effects[i].t-=dt; effects[i].z+=75*dt; if(effects[i].t<=0)effects.splice(i,1); }
    for(let i=trails.length-1;i>=0;i--){ trails[i].t-=dt; if(trails[i].t<=0)trails.splice(i,1); }
    shake=Math.max(0,shake-42*dt);
  }

  function draw(){
    ctx.save();
    if(shake>0)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);
    ctx.clearRect(-30,-30,W+60,H+60);
    const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#182a34'); g.addColorStop(1,'#0b1218');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    drawArena(); drawTrails();
    const items=[
      {y:-GOAL.y-2,fn:()=>drawGoal(-GOAL.y,'red')},
      ...actors.map(a=>({y:a.y,fn:()=>drawActor(a)})),
      {y:ball.y,fn:drawBall},
      {y:GOAL.y+2,fn:()=>drawGoal(GOAL.y,'blue')}
    ];
    items.sort((a,b)=>a.y-b.y).forEach(i=>i.fn());
    drawEffects();
    ctx.restore();
  }

  function drawArena(){
    const c=project(0,0,0), rx=FIELD.r*.99, ry=FIELD.r*.86;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(c.x,c.y,rx,ry,0,0,Math.PI*2); ctx.fillStyle='#24434a'; ctx.fill();
    ctx.strokeStyle='#d9e4e7'; ctx.lineWidth=5; ctx.stroke();
    ctx.globalAlpha=.25; ctx.lineWidth=24; ctx.strokeStyle='#8fa9b2'; ctx.beginPath(); ctx.ellipse(c.x,c.y+7,rx,ry,0,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha=1;
    ctx.setLineDash([14,14]); ctx.lineWidth=3; ctx.beginPath(); const l=project(-FIELD.r,0),r=project(FIELD.r,0);ctx.moveTo(l.x,l.y);ctx.lineTo(r.x,r.y);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath(); ctx.ellipse(c.x,c.y,70,60,0,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([8,10]); ctx.globalAlpha=.48; ctx.strokeStyle='#ffe36b';
    for(const sy of [-72,72]){ const a=project(-286,sy),b=project(286,sy);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke(); }
    ctx.setLineDash([]);ctx.globalAlpha=1;
    ctx.restore();
  }

  function drawGoal(y,team){
    const base=project(0,y,0), top=project(0,y,GOAL.height), scale=top.s;
    const rx=GOAL.radius*scale, ry=GOAL.radius*.92;
    ctx.save();
    ctx.strokeStyle=team==='blue'?'#69c6ff':'#ff7f7f'; ctx.lineCap='round';
    const charging=player.hasBall&&player.holdB&&((team==='red'&&player.team==='blue')||(team==='blue'&&player.team==='red'));
    ctx.globalAlpha=charging?.38:.25; ctx.lineWidth=charging?28:20; ctx.beginPath(); ctx.ellipse(top.x,top.y,rx,ry,0,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=1; ctx.lineWidth=8;
    if(charging){ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=22+player.chargeB*26;}
    ctx.beginPath(); ctx.moveTo(base.x,base.y);ctx.lineTo(top.x,top.y+ry);ctx.stroke();
    ctx.lineWidth=10; ctx.beginPath(); ctx.ellipse(top.x,top.y,rx,ry,0,0,Math.PI*2);ctx.stroke();
    ctx.globalAlpha=.2;ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.ellipse(top.x,top.y,rx-7,ry-7,0,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  function drawActor(a){
    const p=project(a.x,a.y,0), s=p.s;
    ctx.save(); ctx.translate(p.x,p.y); ctx.scale(s,s);
    ctx.fillStyle='rgba(0,0,0,.28)';ctx.beginPath();ctx.ellipse(0,8,28,12,0,0,Math.PI*2);ctx.fill();
    ctx.rotate(a.facing+Math.PI/2);
    ctx.strokeStyle='#071014';ctx.lineWidth=4;
    ctx.fillStyle=a.team==='blue'?(a.isPlayer?'#62b8f5':'#88d2ff'):(a.role==='support'?'#ff9292':'#ef6b6b');
    ctx.beginPath();ctx.roundRect(-20,-38,40,45,13);ctx.fill();ctx.stroke();
    ctx.fillStyle='#dce5e8';ctx.beginPath();ctx.arc(0,-44,16,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#26333a';ctx.fillRect(-12,-48,24,6);
    // Each class has a distinct silhouette and attack animation.
    ctx.save();
    ctx.translate(18,-22);
    const progress=a.attackAnim>0?1-a.attackAnim/.30:0;
    const swing=-1.18+(1-Math.pow(1-clamp(progress,0,1),2))*2.38;
    const weaponAngle=a.attackAnim>0?swing:.16;
    ctx.rotate(weaponAngle);
    if(a.classType==='mace'){
      ctx.fillStyle='#6f4528';ctx.fillRect(-5,-6,10,58);ctx.strokeRect(-5,-6,10,58);
      ctx.fillStyle='#9ba8ad';ctx.beginPath();ctx.arc(0,-12,18,0,Math.PI*2);ctx.fill();ctx.stroke();
    } else if(a.classType==='monk'){
      ctx.fillStyle='#cfab69';ctx.fillRect(-5,-64,10,116);ctx.strokeRect(-5,-64,10,116);
    } else if(a.classType==='ninja'){
      ctx.fillStyle='#d9e2e6';ctx.beginPath();ctx.moveTo(-7,-38);ctx.lineTo(7,-38);ctx.lineTo(4,12);ctx.lineTo(-4,12);ctx.closePath();ctx.fill();ctx.stroke();
    } else {
      ctx.fillStyle='#6f4528';ctx.fillRect(-5,-3,10,17);ctx.strokeRect(-5,-3,10,17);
      ctx.fillStyle='#ead8a7';ctx.beginPath();ctx.roundRect(-7,-52,14,52,5);ctx.fill();ctx.stroke();
      ctx.fillStyle='#d6a54d';ctx.fillRect(-13,-5,26,7);ctx.strokeRect(-13,-5,26,7);
    }
    if(a.attackAnim>0){ctx.globalAlpha=.34*(1-progress);ctx.strokeStyle='#fff3b0';ctx.lineWidth=a.classType==='monk'?8:12;ctx.beginPath();ctx.arc(0,1,a.classType==='monk'?76:58,-1.18,swing);ctx.stroke();}
    ctx.restore();
    if(a.classType==='knight'||a.classType==='mace'){ctx.fillStyle='#aab9c0';ctx.beginPath();ctx.roundRect(-34,-28,17,36,6);ctx.fill();ctx.stroke();}
    ctx.save();ctx.rotate(-(a.facing+Math.PI/2));ctx.font='800 10px system-ui';ctx.textAlign='center';ctx.fillStyle='rgba(255,255,255,.8)';ctx.fillText(CLASS_DATA[a.classType].label,0,24);ctx.restore();
    if(a.role==='support'){ctx.strokeStyle='#ffe36b';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,-12,27,0,Math.PI*2);ctx.stroke();}
    if(a.guard){ctx.strokeStyle='#fff';ctx.globalAlpha=.6;ctx.lineWidth=6;ctx.beginPath();ctx.arc(-9,-10,42,-1.1,1.1);ctx.stroke();}
    if(a.stun>0){ctx.save();ctx.rotate(-(a.facing+Math.PI/2));ctx.fillStyle='#ffe368';for(let i=0;i<3;i++){const ang=performance.now()*.006+i*Math.PI*2/3;ctx.beginPath();ctx.arc(Math.cos(ang)*22,-72+Math.sin(ang)*7,5,0,Math.PI*2);ctx.fill();}ctx.font='900 12px system-ui';ctx.textAlign='center';ctx.fillText('STUN',0,-91);ctx.restore();}
    if(a.isPlayer&&a.hasBall&&(a.holdA||a.holdB)){
      const q=Math.min(1,(a.holdB?a.chargeB/.52:a.chargeA/.5));
      ctx.rotate(-(a.facing+Math.PI/2));
      ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(-32,-88,64,8);
      ctx.fillStyle=a.holdB?'#ffe36b':'#b9ecff';ctx.fillRect(-30,-86,60*q,4);
    }
    ctx.restore();
  }

  function drawTrails(){
    for(const t of trails){
      const p=project(t.x,t.y,t.z);
      ctx.save();ctx.globalAlpha=clamp(t.t/.22,0,.42);ctx.fillStyle='#fff3a5';ctx.beginPath();ctx.arc(p.x,p.y,6*p.s,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  }

  function drawEffects(){
    for(const e of effects){
      const p=project(e.x,e.y,e.z), k=Math.max(0,e.t/.28);
      ctx.save();ctx.translate(p.x,p.y);ctx.globalAlpha=k;ctx.strokeStyle='#fff';ctx.lineWidth=5;
      for(let i=0;i<7;i++){const a=i*Math.PI*2/7;ctx.beginPath();ctx.moveTo(Math.cos(a)*18,Math.sin(a)*18);ctx.lineTo(Math.cos(a)*(46+(1-k)*24),Math.sin(a)*(46+(1-k)*24));ctx.stroke();}
      ctx.font='900 22px system-ui';ctx.textAlign='center';ctx.fillStyle='#ffe86f';ctx.fillText(e.label,0,-38-(1-k)*18);ctx.restore();
    }
  }

  function drawBall(){
    const shadow=project(ball.x,ball.y,0), p=project(ball.x,ball.y,ball.z);
    const altitude=Math.max(0,ball.z-ball.r);
    const heightScale=1+Math.min(1.05,altitude/175)*.68;
    const shadowScale=Math.max(.38,1-altitude/250);
    const shadowAlpha=Math.max(.08,.30-altitude/720);
    const visualRadius=ball.r*p.s*heightScale;
    ctx.save();
    ctx.fillStyle=`rgba(0,0,0,${shadowAlpha})`;ctx.beginPath();ctx.ellipse(shadow.x,shadow.y,16*p.s*shadowScale,7*p.s*shadowScale,0,0,7);ctx.fill();
    ctx.translate(p.x,p.y);ctx.fillStyle='#f5f2de';ctx.strokeStyle='#15191b';ctx.lineWidth=Math.max(3,4*heightScale);ctx.beginPath();ctx.arc(0,0,visualRadius,0,7);ctx.fill();ctx.stroke();
    ctx.globalAlpha=Math.min(.42,altitude/260);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(-visualRadius*.22,-visualRadius*.22,visualRadius*.46,Math.PI*1.05,Math.PI*1.62);ctx.stroke();
    ctx.restore();
  }

  function resize(){
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);
    canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
    const scale=Math.min(canvas.width/W,canvas.height/H),ox=(canvas.width-W*scale)/2,oy=(canvas.height-H*scale)/2;
    ctx.setTransform(scale,0,0,scale,ox,oy);
  }
  function loop(now){const dt=Math.min(.033,(now-last)/1000);last=now;update(dt);draw();requestAnimationFrame(loop);}

  const stick=document.getElementById('stick'),knob=document.getElementById('stickKnob');let stickPointer=null;
  function moveStick(e){const r=stick.getBoundingClientRect();let x=e.clientX-(r.left+r.width/2),y=e.clientY-(r.top+r.height/2),max=r.width*.32,l=Math.hypot(x,y);if(l>max){x=x/l*max;y=y/l*max;}knob.style.transform=`translate(${x}px,${y}px)`;input.x=x/max;input.y=y/max;}
  stick.addEventListener('pointerdown',e=>{stickPointer=e.pointerId;stick.setPointerCapture(e.pointerId);moveStick(e)});
  stick.addEventListener('pointermove',e=>{if(e.pointerId===stickPointer)moveStick(e)});
  const stop=e=>{if(e.pointerId!==stickPointer)return;stickPointer=null;input.x=input.y=0;knob.style.transform='translate(0,0)'};
  stick.addEventListener('pointerup',stop);stick.addEventListener('pointercancel',stop);
  function bind(id,key){const el=document.getElementById(id),down=e=>{e.preventDefault();input[key]=true;el.classList.add('active')},up=e=>{e.preventDefault();input[key]=false;el.classList.remove('active')};el.addEventListener('pointerdown',down);['pointerup','pointercancel','pointerleave'].forEach(t=>el.addEventListener(t,up));}
  bind('btnA','a');bind('btnB','b');bind('btnC','c');
  const keys=new Set();
  addEventListener('keydown',e=>{keys.add(e.code);if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault()});
  addEventListener('keyup',e=>keys.delete(e.code));
  setInterval(()=>{input.x=(keys.has('ArrowRight')||keys.has('KeyD')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')?1:0);input.y=(keys.has('ArrowDown')||keys.has('KeyS')?1:0)-(keys.has('ArrowUp')||keys.has('KeyW')?1:0);input.a=keys.has('KeyJ');input.b=keys.has('KeyK');input.c=keys.has('KeyL')},16);
  const classBtn=document.getElementById('classBtn');
  function applyPlayerClass(type){
    selectedClass=type; player.classType=type; player.speed=CLASS_DATA[type].speed; classBtn.textContent=CLASS_DATA[type].label; resetPositions(); flash(CLASS_DATA[type].label);
  }
  classBtn.addEventListener('click',()=>{const i=(CLASS_ORDER.indexOf(selectedClass)+1)%CLASS_ORDER.length;applyPlayerClass(CLASS_ORDER[i]);});
  document.getElementById('restartBtn').addEventListener('click',()=>{blueScore=redScore=0;gameTime=120;running=true;blueScoreEl.textContent='0';redScoreEl.textContent='0';messageEl.hidden=true;resetPositions()});
  addEventListener('resize',resize);resize();resetPositions();requestAnimationFrame(loop);
})();
