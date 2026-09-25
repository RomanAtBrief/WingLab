/* Animated 3D water density, shared by both rendering backends. Metres/seconds.
   Ballistic advection + participating spray, not a fluid pressure solver. */
const WaterfallField = (() => {
  const glsl = `
float wfHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float wfNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(wfHash(i),wfHash(i+vec3(1,0,0)),f.x),mix(wfHash(i+vec3(0,1,0)),wfHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(wfHash(i+vec3(0,0,1)),wfHash(i+vec3(1,0,1)),f.x),mix(wfHash(i+vec3(0,1,1)),wfHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
// shape = height, lip distance from river, half-width, impact distance.
vec2 wfDensity(vec3 p,vec4 s,float time){
  float drop=clamp((s.x-p.y)/s.x,0.0,1.0),age=sqrt(drop),curve=mix(s.y,s.w,age);
  float flight=sqrt(2.0*s.x/9.81)*age;
  float strands=wfNoise(vec3(p.x*.13,flight*3.2-time*3.2,0.7));
  float churn=wfNoise(vec3(p.x*.37,flight*9.0-time*9.0,p.z*.19));
  float width=s.z*(.83+.12*sin(p.x*.047)+.10*drop);
  float edge=1.0-smoothstep(width*.75,width,abs(p.x));
  float thickness=2.8+drop*6.0;
  float dz=(p.z-curve-2.0*sin(p.x*.08+flight*2.0-time*1.8))/thickness;
  float channels=.18+.82*smoothstep(.23,.72,wfNoise(vec3(p.x*.12,0.7,2.1)));
  float sheet=exp(-dz*dz)*edge*channels*(.022+.14*strands*strands+.025*churn)*smoothstep(-1.0,5.0,p.y)*(1.0-smoothstep(s.x-1.0,s.x+2.0,p.y));
  // Air entrainment expands towards impact. Noise moves upward and downwind.
  vec3 mq=vec3(p.x/(s.z*1.32),(p.y-20.0)/44.0,(p.z-s.w-10.0)/62.0);
  float cloud=exp(-dot(mq,mq)*1.9);
  float billow=wfNoise(p*.035-vec3(time*.10,time*.17,time*.04));
  float detail=wfNoise(p*.12+vec3(time*.1,-time*.22,0));
  float mist=cloud*max(0.0,billow*.8+detail*.3-.22)*.075;
  // Detached droplets follow the same fall time as the curtain, outside its core.
  vec3 cell=vec3(p.x*.52,(flight-time)*13.0,p.z*.52);
  vec3 id=floor(cell);vec3 jitter=vec3(wfHash(id+1.1),wfHash(id+3.7),wfHash(id+7.9));
  vec3 f=fract(cell)-mix(vec3(.18),vec3(.82),jitter);
  float dropParticle=(1.0-smoothstep(.10,.32,length(f)))*step(.84,wfHash(floor(cell)));
  float spray=exp(-dz*dz*.055)*edge*dropParticle*.035*drop*smoothstep(3.0,18.0,p.y)*(1.0-smoothstep(s.x-5.0,s.x,p.y));
  float foam=exp(-pow((p.z-s.w)/58.0,2.0))*exp(-pow(p.x/(s.z*1.3),4.0))*exp(-pow((p.y-1.2)/1.8,2.0))*(.12+.18*churn);
  return vec2(sheet+spray+foam,mist);
}
vec2 wfBox(vec3 ro,vec3 rd,vec3 lo,vec3 hi){vec3 inv=1.0/(rd+vec3(1e-7));vec3 a=(lo-ro)*inv,b=(hi-ro)*inv;vec3 mn=min(a,b),mx=max(a,b);return vec2(max(max(mn.x,mn.y),mn.z),min(min(mx.x,mx.y),mx.z));}
`;
  // A deliberately small mechanical translation keeps density/animation identical.
  // Only this pure arithmetic kernel is translated, not general application GLSL.
  function wgsl(){
    let s=glsl.replace(/vec([234])\b/g,'vec$1f').replace(/\bfloat\b/g,'f32');
    s=s.replace(/(f32|vec[234]f)\s+(\w+)\(([^)]*)\)\{/g,(_,ret,name,args)=>'fn '+name+'('+args.split(',').map(a=>{const [type,n]=a.trim().split(/\s+/);return n+': '+type;}).join(',')+')->'+ret+'{');
    s=s.replace(/\b(f32|vec[234]f)\s+([^;]+);/g,(_,type,decl)=>{
      let depth=0,parts=[],start=0;for(let i=0;i<decl.length;i++){if(decl[i]==='(')depth++;if(decl[i]===')')depth--;if(decl[i]===','&&!depth){parts.push(decl.slice(start,i));start=i+1;}}parts.push(decl.slice(start));
      return parts.map(p=>'var '+p.trim().replace(/^(\w+)\s*=/,'$1: '+type+' =')+';').join('');
    });
    return s.replace('fn wfHash(p: vec3f)->f32{','fn wfHash(p0: vec3f)->f32{var p=p0;');
  }
  function glFalls(){return [600,4100,8200].map((x,i)=>{const phase=x*Math.PI*2/14000,z=1300*Math.sin(phase)+350*Math.sin(phase*2),slope=(1300*Math.cos(phase)+700*Math.cos(phase*2))*Math.PI*2/14000,n=Math.hypot(1,slope),side=i%2?-1:1;return {x,z,nx:-slope/n*side,nz:1/n*side,height:320,lip:330,width:i?58:85,end:240};});}
  function heroes(river,heightAt){
    let bend=0;for(let i=1;i<river.n;i++)if(Math.abs(river.cv[i])>Math.abs(river.cv[bend]))bend=i;
    const out=[];
    for(let k=0;k<3;k++){
      const i=(bend+20+k*Math.floor(river.n/3))%river.n;
      // Pick a continuous rock rim with enough fall height; try either bank.
      let best=null;
      for(const side of [1,-1])for(let lip=265;lip<=380;lip+=15){
        const nx=-river.tz[i]*side,nz=river.tx[i]*side,x=river.px[i],z=river.pz[i];
        const h=heightAt(x+nx*lip,z+nz*lip);
        if(h<180||h>390)continue;
        const f={x,z,nx,nz,height:h+3,lip,width:k?58:80,end:60};let clear=true;
        for(let t=.06;t<1;t+=.04){const d=lip+(f.end-lip)*t,y=f.height*(1-t*t);if(y<heightAt(x+nx*d,z+nz*d)+2){clear=false;break;}}
        if(clear&&(!best||h>best.height))best=f;
      }if(best)out.push(best);
    }return out;
  }
  return {glsl,wgsl,glFalls,heroes};
})();
