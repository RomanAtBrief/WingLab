/* Spring-fed canyon cascades. Ribbons follow the generated rock surface and end
   in the river; world coordinates remain fixed as the flight origin moves. */
const GWaterfalls = (() => {
  let pipe,buffer,bind,count=0,cascadeCount=0,terrain=null;
  function buildCascades(river,heightAt){
    const out=[];let bend=0;
    for(let i=1;i<river.n;i++)if(Math.abs(river.cv[i])>Math.abs(river.cv[bend]))bend=i;
    for(let k=0;k<18;k++){
      const i=(bend+90+k*1700)%river.n,side=k%2?1:-1;
      const nx=-river.tz[i]*side,nz=river.tx[i]*side,cx=river.px[i],cz=river.pz[i];
      const at=d=>({x:cx+nx*d,z:cz+nz*d});
      let start=0;
      // Locate a steep, exposed lower cliff, not a flat plateau or tributary bed.
      for(let d=150;d<310;d+=5){const p=at(d),q=at(d-35),h=heightAt(p.x,p.z);if(h>80&&h<245&&h-heightAt(q.x,q.z)>48){start=d;break;}}
      if(!start)continue;
      const points=[];let previous=Infinity,valid=true;
      for(let d=start;d>=74;d-=3){const p=at(d),h=Math.max(0,heightAt(p.x,p.z));if(h>previous+8){valid=false;break;}previous=h;points.push({...p,y:h+2.2});}
      if(valid&&points.length>12&&points.at(-1).y<3)out.push({points,nx,nz,width:5+k%3*1.5});
    }
    return out;
  }
  function rebuild(){
    const cascades=buildCascades(GTerrain.R.river,GTerrain.heightAt),data=[];cascadeCount=cascades.length;
    function vertex(p,u,v,kind,nx,nz){data.push(p.x,p.y,p.z,u,v,kind,nx,0,nz);}
    for(const c of cascades){
      let length=0;
      for(let i=0;i<c.points.length-1;i++){
        const a=c.points[i],b=c.points[i+1],next=length+Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
        for(const [which,side] of [[0,-1],[1,-1],[0,1],[0,1],[1,-1],[1,1]]){
          const p=which?b:a,w=c.width*(1+.15*Math.sin(i*.7));
          vertex({x:p.x-c.nz*side*w/2,y:p.y,z:p.z+c.nx*side*w/2},side,which?next:length,0,-c.nx,-c.nz);
        }length=next;
      }
      const end=c.points.at(-1);
      // Shallow foam fan on the receiving water, plus a restrained spray veil.
      for(const kind of [1,2])for(const [u,v] of [[-1,-1],[1,-1],[-1,1],[-1,1],[1,-1],[1,1]])vertex(end,u,v,kind,c.nx,c.nz);
    }
    buffer?.destroy();count=data.length/9;
    buffer=G.buf(Math.max(36,data.length*4),GPUBufferUsage.VERTEX,new Float32Array(data));
  }
  function init(){
    const blend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}};
    pipe=G.render({label:'canyon-cascades',targets:[{format:'rgba16float',blend}],depth:{compare:'greater',write:false},cull:'none',buffers:[{arrayStride:36,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x2'},{shaderLocation:2,offset:20,format:'float32'},{shaderLocation:3,offset:24,format:'float32x3'}]}],code:`${G.COMMON}
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var auxT:texture_2d<f32>;
@group(0) @binding(2) var aux2T:texture_2d<f32>;
@group(0) @binding(3) var smpA:sampler;
@group(0) @binding(4) var terrainShade:texture_2d<f32>;
${GTerrain.canyonProfileWGSL}
// Match terrain's cubic interpolation, not the CPU collision block maxima.
fn auxB(uv:vec2f)->vec4f{
  let n=vec2f(textureDimensions(auxT));let st=uv*n-.5;let i=floor(st);let a=st-i;let a2=a*a;let a3=a2*a;
  let w0=(-a3+3.0*a2-3.0*a+1.0)/6.0;let w1=(3.0*a3-6.0*a2+4.0)/6.0;let w2=(-3.0*a3+3.0*a2+3.0*a+1.0)/6.0;let w3=a3/6.0;
  let g0=w0+w1;let g1=w2+w3;let p0=(i-.5+w1/g0)/n;let p1=(i+1.5+w3/g1)/n;
  return g0.y*(g0.x*textureSampleLevel(auxT,smpA,p0,0.0)+g1.x*textureSampleLevel(auxT,smpA,vec2f(p1.x,p0.y),0.0))+g1.y*(g0.x*textureSampleLevel(auxT,smpA,vec2f(p0.x,p1.y),0.0)+g1.x*textureSampleLevel(auxT,smpA,p1,0.0));
}
struct VO { @builtin(position) pos:vec4f,@location(0) uv:vec2f,@location(1) wp:vec3f,@location(2) @interpolate(flat) kind:f32,@location(3) normal:vec3f };
@vertex fn vs(@location(0) p:vec3f,@location(1) uv:vec2f,@location(2) kind:f32,@location(3) normal:vec3f)->VO{
  var xz=p.xz-F.terrOff;xz-=round(xz/F.tile)*F.tile;
  let uvWorld=p.xz/F.tile;let h=canyonH(auxB(uvWorld),textureSampleLevel(aux2T,smpA,uvWorld,0.0));
  var wp=vec3f(xz.x,max(F.water,h)+1.1-F.planeAlt,xz.y);
  if(kind>1.5){let right=normalize(cross(F.camPos-wp,vec3f(0,1,0)));wp+=right*uv.x*9.0+vec3f(0,(uv.y+1.0)*6.0,0);}
  else if(kind>.5){wp+=vec3f(uv.x*12.0,0,uv.y*12.0);}
  var o:VO;o.pos=F.viewProj*vec4f(wp,1);o.uv=uv;o.wp=wp;o.kind=kind;o.normal=normal;return o;
}
@fragment fn fs(i:VO)->@location(0) vec4f{
  var alpha=0.0;var albedo=vec3f(.78,.85,.83);
  if(i.kind<.5){
    let flow=i.uv.y-F.time*19.0;
    let streams=.5+.5*sin(i.uv.x*25.0+2.0*vnoise2(vec2f(i.uv.x*9.0,flow*.08)));
    let churn=vnoise2(vec2f(i.uv.x*6.0,flow*.23));
    alpha=(1.0-smoothstep(.52,1.0,abs(i.uv.x)))*(.35+.4*streams+.15*churn)*smoothstep(0.0,9.0,i.uv.y);
    albedo=mix(vec3f(.32,.48,.46),vec3f(.88,.92,.88),.55+.25*streams+.2*churn);
  }else{
    let r=length(i.uv);let n=vnoise2(i.uv*7.0+vec2f(F.time*.4,-F.time*.7));
    alpha=(1.0-smoothstep(.2,1.0,r))*(.3+.35*n)*select(.7,.25,i.kind>1.5);
  }
  alpha*=1.0-smoothstep(2400.0,4200.0,distance(i.wp,F.camPos));
  if(alpha<.004){discard;}
  let sun=max(.0,dot(i.normal,F.sunDir))*.6+.18;
  let shade=textureSampleLevel(terrainShade,smpA,(i.wp.xz+F.terrOff)/F.tile,0.0);
  let daylight=F.sunE*(vec3f(.11,.14,.18)*shade.g+F.lightTint*sun*max(F.sunDir.y,.12)*shade.r);
  let col=albedo*daylight/PI;
  return vec4f(col*alpha,alpha);
}`});
    bind=null;
  }
  const hook={name:'canyon-cascades',pre(){
    if(GTerrain.place?.key!=='canyon'||!GTerrain.cpuReady){terrain=null;count=0;cascadeCount=0;return;}
    if(terrain!==GTerrain.R.river){terrain=GTerrain.R.river;rebuild();bind=G.bind(pipe,0,[GR.frameBuf,GTerrain.R.aux.createView(),GTerrain.R.aux2.createView(),G.sampler('linRepeat'),GTerrain.R.shV]);}
  },forward(pass){if(!count)return;pass.setPipeline(pipe);pass.setBindGroup(0,bind);pass.setVertexBuffer(0,buffer);pass.draw(count);}};
  return {init,hook,buildCascades,get count(){return cascadeCount;}};
})();
