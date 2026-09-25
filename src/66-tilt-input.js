/* Device gravity projected into screen axes. No heading/magnetometer is needed.
   Keep this controller pure so calibration, rotation and stale input are testable. */
const TiltInput = (() => {
  const clamp=v=>Math.max(-1,Math.min(1,v));
  function create(){
    let baseline=null,latest=null,angle=0,last=-Infinity,roll=0,pull=0;
    function sample(beta,gamma,screenAngle,now){
      if(![beta,gamma,screenAngle,now].every(Number.isFinite))return false;
      const b=beta*Math.PI/180,g=gamma*Math.PI/180,a=screenAngle*Math.PI/180;
      const x=-Math.cos(b)*Math.sin(g),y=Math.sin(b),z=Math.cos(b)*Math.cos(g);
      return project(x,y,z,screenAngle,now);
    }
    function sampleGravity(x,y,z,screenAngle,now){
      if(![x,y,z,screenAngle,now].every(Number.isFinite)||Math.hypot(x,y,z)<2)return false;
      return project(-x,-y,-z,screenAngle,now);
    }
    function project(x,y,z,screenAngle,now){
      const a=screenAngle*Math.PI/180;
      const sx=x*Math.cos(a)-y*Math.sin(a),sy=x*Math.sin(a)+y*Math.cos(a);
      latest={roll:Math.atan2(-sx,Math.hypot(sy,z)),pull:Math.atan2(sy,z)};
      if(angle!==screenAngle){baseline=null;roll=pull=0;}angle=screenAngle;last=now;
      if(!baseline)baseline={...latest};return true;
    }
    function recenter(){baseline=latest?{...latest}:null;roll=pull=0;}
    function reset(){baseline=latest=null;last=-Infinity;roll=pull=0;}
    const axis=d=>{const deg=Math.atan2(Math.sin(d),Math.cos(d))*180/Math.PI;return clamp(Math.sign(deg)*Math.max(0,Math.abs(deg)-2.5)/22);};
    function step(dt,now){
      if(!latest||now-last>600){roll=pull=0;return {roll:0,pull:0,fresh:false};}
      const t=1-Math.exp(-Math.min(dt,.1)*8);
      roll+=(axis(latest.roll-baseline.roll)-roll)*t;pull+=(axis(latest.pull-baseline.pull)-pull)*t;
      return {roll,pull,fresh:true};
    }
    return {sample,sampleGravity,recenter,reset,step};
  }
  return {create};
})();
