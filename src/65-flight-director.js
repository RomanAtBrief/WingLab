/* Assisted scenic navigation and a bank-to-turn flight-game controller.
   Lesson aerodynamics remain separate; this is not a certified flight simulator. */
const FlightDirector = (() => {
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
  const angle=a=>Math.atan2(Math.sin(a),Math.cos(a));
  const state={mode:'auto',x:0,z:0,alt:1000,heading:0,bank:0,pitch:0,speed:40,verticalSpeed:0,rollRate:0,pitchRate:0,aileron:0,elevator:0,rudder:0,throttle:.8,phase:'Cloud cruise',clearance:false,elapsed:0};
  const stick={roll:0,pull:0};const keys=new Set();let route=[],target=0,place='',ready=false,requestedAlt=1000,altitudeTarget=false,lap=0;
  function configure(name,points,alt){
    if(!points||points.length<2)return;
    route=points;place=name;target=1;lap=0;Object.assign(state,{x:points[0].x,z:points[0].z,alt,heading:Math.atan2(points[1].z-points[0].z,points[1].x-points[0].x),bank:0,pitch:0,rollRate:0,pitchRate:0,aileron:0,elevator:0,rudder:0,verticalSpeed:0,elapsed:0});requestedAlt=alt;altitudeTarget=false;ready=true;keys.clear();
  }
  function setMode(mode){if(mode!=='auto'&&mode!=='manual')return;state.mode=mode;state.phase=mode==='manual'?'Manual flight':'Joining scenic route';clearKeys();requestedAlt=state.alt;altitudeTarget=false;
    if(mode==='auto'&&route.length){let best=Infinity,bestIndex=0,bestLap=lap;
      for(const l of route.periodX?[lap-1,lap,lap+1]:[0])route.forEach((p,i)=>{const d=(p.x+l*(route.periodX||0)-state.x)**2+(p.z-state.z)**2;if(d<best){best=d;bestIndex=i;bestLap=l;}});
      target=(bestIndex+2)%route.length;lap=bestLap+(bestIndex+2>=route.length?1:0);
    }
  }
  function waypoint(){const p=route[target];return {x:p.x+lap*(route.periodX||0),z:p.z};}
  // Sample clearance along the actual river ahead, rather than a straight ray
  // through the cliff on the outside of a bend.
  function routeAhead(distance){
    let x=state.x,z=state.z,i=target,l=lap;
    for(let n=0;n<route.length;n++){
      const p=route[i],px=p.x+l*(route.periodX||0),dx=px-x,dz=p.z-z,len=Math.hypot(dx,dz);
      if(len>=distance&&len>0)return {x:x+dx*distance/len,z:z+dz*distance/len,dx:dx/len,dz:dz/len};
      distance-=len;x=px;z=p.z;i=(i+1)%route.length;if(i===0)l++;
    }
    return {x,z,dx:Math.cos(state.heading),dz:Math.sin(state.heading)};
  }
  function setAltitude(value){if(Number.isFinite(value)){requestedAlt=clamp(value,30,16000);altitudeTarget=true;}}
  function setThrottle(value){if(Number.isFinite(value))state.throttle=clamp(value,0,1);}
  function key(k,on){if(on)keys.add(k.toLowerCase());else keys.delete(k.toLowerCase());}
  function clearKeys(){keys.clear();stick.roll=stick.pull=0;}
  function setStick(roll,pull){stick.roll=Number.isFinite(roll)?clamp(roll,-1,1):0;stick.pull=Number.isFinite(pull)?clamp(pull,-1,1):0;}
  function step(dt,airspeed,size,heightAt=()=>0){
    if(!ready||dt<=0)return state;
    dt=Math.min(dt,.15);state.elapsed+=dt;const oldAlt=state.alt,oldBank=state.bank,oldPitch=state.pitch;
    let turn=0,goalAlt=requestedAlt,rollEffort=0,pitchEffort=0;
    if(state.mode==='auto'){
      state.speed=mix(state.speed,clamp(airspeed*.32,22,place==='canyon'?38:48),1-Math.exp(-dt*1.2));
      let p=waypoint(),dist=Math.hypot(p.x-state.x,p.z-state.z);
      for(let j=0;j<route.length&&dist<Math.max(48,state.speed*1.8);j++){target=(target+1)%route.length;if(target===0)lap++;p=waypoint();dist=Math.hypot(p.x-state.x,p.z-state.z);}
      const aim=Math.atan2(p.z-state.z,p.x-state.x),error=angle(aim-state.heading);
      turn=clamp(error*.8,-.32,.32);
      const bankTarget=clamp(turn*1.4,-.44,.44);
      rollEffort=clamp((bankTarget-state.bank)*3,-1,1);state.bank=mix(state.bank,bankTarget,1-Math.exp(-dt*2.8));
      if(place==='canyon'){goalAlt=105+18*Math.sin(state.elapsed*.028);state.phase='River canyon';}
      else{const q=Math.sin(state.elapsed*Math.PI*2/210+1.2),v=clamp((q+.25)/.95,0,1),smooth=v*v*(3-2*v);goalAlt=145+2850*smooth;state.phase=state.alt>2780?'Above the cloud tops':state.alt>850?'Through the clouds':state.alt<350?'Island channels':goalAlt<state.alt?'Coastal descent':'Climbing to cloud';}
    }else{
      const roll=keys.has('arrowright')||keys.has('arrowleft')?(keys.has('arrowright')?1:0)-(keys.has('arrowleft')?1:0):stick.roll,pull=keys.has('arrowup')||keys.has('arrowdown')?(keys.has('arrowup')?1:0)-(keys.has('arrowdown')?1:0):stick.pull;
      state.throttle=clamp(state.throttle+((keys.has('w')?1:0)-(keys.has('s')?1:0))*.32*dt,0,1);
      const desiredSpeed=clamp(airspeed*.58*(.42+.92*state.throttle),22,160);
      state.speed=clamp(state.speed+(clamp((desiredSpeed-state.speed)*.7,-14,10)-Math.sin(state.pitch)*4.9)*dt,18,170);
      const bankTarget=roll*.95;
      if(pull)altitudeTarget=false;
      const pitchTarget=pull*(pull<0?.70:.44)+(altitudeTarget&&!pull?clamp(Math.atan2(requestedAlt-state.alt,state.speed*4),-.65,.40):0);
      // Damped angular acceleration gives the controls weight and a smooth return to level.
      rollEffort=clamp((bankTarget-state.bank)*2.6-state.rollRate*1.05,-1,1);
      pitchEffort=clamp((pitchTarget-state.pitch)*3.6-state.pitchRate*1.2+pull*.12,-1,1);
      state.rollRate=clamp(state.rollRate+((bankTarget-state.bank)*7-state.rollRate*3.6)*dt,-1.25,1.25);
      state.pitchRate=clamp(state.pitchRate+((pitchTarget-state.pitch)*6-state.pitchRate*3.8)*dt,-.75,.65);
      state.bank=clamp(state.bank+state.rollRate*dt,-1.05,1.05);
      state.pitch=clamp(state.pitch+state.pitchRate*dt,-.78,.52);
      // Coordinated turn: banking redirects lift; higher speed means a wider turn.
      turn=9.81*Math.tan(state.bank)/Math.max(state.speed,18);
      state.phase='Manual flight';
      goalAlt=state.alt+state.speed*Math.sin(state.pitch)*4;
    }
    state.heading=angle(state.heading+turn*dt);
    const dx=Math.cos(state.heading),dz=Math.sin(state.heading),side=Math.max(size*.6,10),clear=Math.max(35,size*.85);
    let ground=0;
    for(const ahead of [0,state.speed*2,state.speed*5]){const p=state.mode==='auto'&&place==='canyon'?routeAhead(ahead):{x:state.x+dx*ahead,z:state.z+dz*ahead,dx,dz};for(const wing of [-side,0,side])ground=Math.max(ground,heightAt(p.x-p.dz*wing,p.z+p.dx*wing)||0);}
    const floor=ground+clear;state.clearance=goalAlt<floor;goalAlt=Math.max(goalAlt,floor);
    if(state.mode==='auto')state.alt+=clamp((goalAlt-state.alt)*.32,-52,32)*dt;
    else{
      let climb=state.speed*Math.sin(state.pitch);
      if(state.clearance){climb=Math.max(climb,clamp((floor-state.alt)*1.6,0,45));state.pitch=Math.max(state.pitch,Math.atan2(climb,state.speed));pitchEffort=Math.max(pitchEffort,.55);}
      state.alt=clamp(state.alt+climb*dt,30,16000);
    }
    const horizontal=state.speed*Math.cos(state.pitch);
    state.x+=dx*horizontal*dt;state.z+=dz*horizontal*dt;
    const actualFloor=Math.max(0,heightAt(state.x,state.z)||0)+clear;
    state.alt=Math.max(state.alt,actualFloor);state.verticalSpeed=(state.alt-oldAlt)/dt;
    if(state.mode==='auto'){
      const targetPitch=clamp(Math.atan2(state.verticalSpeed,Math.max(state.speed,1)),-.12,.18);
      pitchEffort=clamp((targetPitch-state.pitch)*5,-1,1);
      state.pitch=mix(state.pitch,targetPitch,1-Math.exp(-dt*2));
      state.rollRate=(state.bank-oldBank)/dt;state.pitchRate=(state.pitch-oldPitch)/dt;
    }
    state.aileron=mix(state.aileron,rollEffort,1-Math.exp(-dt*9));
    state.elevator=mix(state.elevator,pitchEffort,1-Math.exp(-dt*9));
    state.rudder=mix(state.rudder,clamp(state.bank*.55+state.aileron*.12,-.7,.7),1-Math.exp(-dt*5));
    return state;
  }
  return {state,configure,setMode,setAltitude,setThrottle,key,clearKeys,setStick,step,get targetAltitude(){return altitudeTarget?requestedAlt:null;},get ready(){return ready;}};
})();
