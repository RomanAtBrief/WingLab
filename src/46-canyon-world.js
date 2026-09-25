/* Real mesh canyon for the WebGL compatibility path. All collision, vegetation,
   waterfall occlusion and mesh heights use the same continuous height function. */
const CanyonWorld = (() => {
  const T=THREE, root=new T.Group(), falls=WaterfallField.glFalls();let ready=false,water,clock=0,depthRT,reflectionRT,waterMesh;const mirrorCamera=new T.PerspectiveCamera(),reflectMatrix=new T.Matrix4();
  const clamp=(v)=>Math.max(0,Math.min(1,v)),sm=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
  const hash=(x,z)=>{const a=Math.sin(x*127.1+z*311.7)*43758.5453;return a-Math.floor(a);};
  function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),a=sm(0,1,x-ix),b=sm(0,1,z-iz);return (hash(ix,iz)*(1-a)+hash(ix+1,iz)*a)*(1-b)+(hash(ix,iz+1)*(1-a)+hash(ix+1,iz+1)*a)*b;}
  const river=x=>1300*Math.sin(x*Math.PI*2/14000)+350*Math.sin(x*Math.PI*4/14000);
  function height(x,z){
    const d=Math.abs(z-river(x)),b=noise(x/260,z/260),g=noise(x/69,z/69),s=d+(b-.5)*140*sm(120,260,d)+(g-.5)*32*sm(150,250,d);
    let h=-12+10*clamp(d/108)**2+8*sm(100,126,d);
    h+=(42+22*b)*sm(126,210,s)+(104+50*b)*sm(205,239,s)+18*sm(239,285,s)+(112+35*b)*sm(277,320,s)+28*sm(320,800,s);
    h+=sm(130,260,d)*(noise(x/17,z/17)-.5)*4;
    for(const f of falls){const dx=x-f.x,dz=z-f.z,along=dx*f.nz-dz*f.nx,across=dx*f.nx+dz*f.nz;
      const basin=(1-sm(f.width*2.5,f.width*5.2,Math.abs(along)))*sm(75,160,across)*(1-sm(310,335,across));h=h*(1-basin)-5*basin;}
    return h;
  }
  const heightGLSL=`
float cwHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float cwNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(cwHash(i),cwHash(i+vec2(1,0)),f.x),mix(cwHash(i+vec2(0,1)),cwHash(i+vec2(1)),f.x),f.y);}
float cwHeight(vec2 p){float phase=p.x*6.2831853/14000.0,d=abs(p.y-1300.0*sin(phase)-350.0*sin(phase*2.0)),b=cwNoise(p/260.0),g=cwNoise(p/69.0),s=d+(b-.5)*140.0*smoothstep(120.0,260.0,d)+(g-.5)*32.0*smoothstep(150.0,250.0,d);
float h=-12.0+10.0*pow(clamp(d/108.0,0.0,1.0),2.0)+8.0*smoothstep(100.0,126.0,d);
h+=(42.0+22.0*b)*smoothstep(126.0,210.0,s)+(104.0+50.0*b)*smoothstep(205.0,239.0,s)+18.0*smoothstep(239.0,285.0,s)+(112.0+35.0*b)*smoothstep(277.0,320.0,s)+28.0*smoothstep(320.0,800.0,s);
h+=smoothstep(130.0,260.0,d)*(cwNoise(p/17.0)-.5)*4.0;
${falls.map(f=>`{vec2 off=p-vec2(${f.x.toFixed(5)},${f.z.toFixed(5)});float along=dot(off,vec2(${f.nz.toFixed(8)},${(-f.nx).toFixed(8)})),across=dot(off,vec2(${f.nx.toFixed(8)},${f.nz.toFixed(8)}));float basin=(1.0-smoothstep(${(f.width*2.5).toFixed(3)},${(f.width*5.2).toFixed(3)},abs(along)))*smoothstep(75.0,160.0,across)*(1.0-smoothstep(310.0,335.0,across));h=h*(1.0-basin)-5.0*basin;}`).join('')}
return h;}
`;
  root.visible=false;let pendingTextures=0;const compact=innerWidth<600;const materials=[];
  function init(scene){
    if(ready)return;ready=true;scene.add(root);
    const loader=new T.TextureLoader();const load=name=>{pendingTextures++;const t=loader.load('./assets/'+name,()=>pendingTextures--,undefined,()=>pendingTextures--);t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=8;return t;};
    const map=load('rock-color.jpg');map.colorSpace=T.SRGBColorSpace;
    const mat=new T.MeshStandardMaterial({map,normalMap:load('rock-normal.jpg'),normalScale:new T.Vector2(.45,.45),roughness:.94,vertexColors:true});
    mat.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vRock;varying vec3 vRockN;').replace('#include <begin_vertex>','#include <begin_vertex>\nvRock=position;vRockN=normal;');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vRock;varying vec3 vRockN;').replace('#include <map_fragment>',`#ifdef USE_MAP
vec3 weights=pow(abs(vRockN),vec3(4));weights/=max(dot(weights,vec3(1)),.001);
vec3 stone=texture2D(map,vRock.zy/9.7).rgb*weights.x+texture2D(map,vRock.xz/9.7).rgb*weights.y+texture2D(map,vRock.xy/9.7).rgb*weights.z;
vec3 broad=texture2D(map,vec2(vRock.x*.71+vRock.z*.69,vRock.y)/37.1).rgb;
diffuseColor.rgb*=mix(stone,broad,.32);
#endif`).replace('#include <color_fragment>',`#include <color_fragment>
float warp=sin(vRock.x*.008+sin(vRock.z*.013))*1.8;
float strata=pow(.5+.5*sin(vRock.y*1.42+warp),14.0);
float broken=.5+.5*sin(vRock.x*.051+sin(vRock.z*.037));
diffuseColor.rgb*=1.0-.19*strata*broken;
diffuseColor.rgb*=.91+.09*sin(vRock.y*.23+warp*.15);
`);};
    const rows=compact?70:100,distances=[];for(let i=-80;i<=80;i++){const q=i/80;distances.push(Math.sign(q)*(Math.abs(q)<.65?Math.abs(q)/.65*400:400+(Math.abs(q)-.65)/.35*1600));}
    for(let chunk=-1;chunk<15;chunk++){
      const pos=[],colors=[],uv=[],idx=[];
      for(let a=0;a<=rows;a++)for(let b=0;b<distances.length;b++){
        const x=chunk*1000+a*1000/rows,z=river(x)+distances[b],y=height(x,z),n=noise(x/90,z/90),bed=.5+.5*Math.sin(y*.074+n*1.4);
        pos.push(x,y,z);uv.push((x*.75+z*.35)/9,y/9+Math.abs(distances[b])*.014);
        const c=new T.Color().setRGB(.60+bed*.19,.235+bed*.14,.105+bed*.09);
        const bank=1-sm(8,30,y);c.lerp(new T.Color(.40,.29,.18),bank*.7);if(y>4&&y<55)c.lerp(new T.Color(.12,.16,.055),sm(.42,.72,n)*.6);c.multiplyScalar(.75+.35*n);colors.push(c.r,c.g,c.b);
        if(a<rows&&b<distances.length-1){const i=a*distances.length+b,j=i+distances.length;idx.push(i,i+1,j,i+1,j+1,j);}
      }
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
      const mesh=new T.Mesh(geo,mat);mesh.receiveShadow=true;mesh.castShadow=true;root.add(mesh);
    }
    // River is a real depth-tested surface, with moving small-scale normals.
    water=new T.ShaderMaterial({uniforms:{uTime:{value:0},uOffset:{value:new T.Vector2()},uReflection:{value:null},uReflectMatrix:{value:reflectMatrix},uSun:{value:new T.Vector3(.6,.5,.3)}},vertexShader:`uniform mat4 uReflectMatrix;varying vec4 vReflection;varying vec3 p;varying vec3 wp;void main(){wp=(modelMatrix*vec4(position,1)).xyz;vReflection=uReflectMatrix*vec4(wp,1);p=vec3(wp.x,0,wp.z);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1);}`,fragmentShader:`precision highp float;uniform sampler2D uReflection;varying vec4 vReflection;varying vec3 p;varying vec3 wp;uniform float uTime;uniform vec2 uOffset;uniform vec3 uSun;${heightGLSL}
void main(){vec2 q=p.xz+uOffset;float depth=max(0.0,-cwHeight(q));
float a=cwNoise(q*.42+vec2(uTime*.45,uTime*.15))-.5,b=cwNoise(q*.83+vec2(-uTime*.25,uTime*.41))-.5,c=cwNoise(q*1.74+vec2(uTime*.62,-uTime*.24))-.5;
vec3 n=normalize(vec3(a*.14+b*.055,1,c*.09+b*.12));vec3 v=normalize(cameraPosition-wp);
float fr=.025+.65*pow(1.0-max(dot(v,n),0.0),5.0);vec3 body=mix(vec3(.075,.27,.22),vec3(.008,.062,.057),smoothstep(0.0,12.0,depth));
float spec=pow(max(dot(reflect(-uSun,n),v),0.0),90.0)*.18;
float foam=smoothstep(.72,.89,cwNoise(q*vec2(.055,.18)-vec2(uTime*.25,0.0)))*(1.0-smoothstep(1.0,5.0,depth));
vec2 reflectionUV=vReflection.xy/vReflection.w+n.xz*.018;vec3 reflected=texture2D(uReflection,clamp(reflectionUV,.002,.998)).rgb;vec3 col=mix(body,reflected,clamp(fr,.06,.65))+spec;col=mix(col,vec3(.43,.56,.50),foam*.7);gl_FragColor=vec4(col,1);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
    const wm=new T.Mesh(new T.PlaneGeometry(20000,12000),water);wm.rotation.x=-Math.PI/2;wm.position.set(7000,.05,0);root.add(wm);waterMesh=wm;
    // Clustered, irregular tree crowns, with trunks and real depth silhouettes.
    const spots=[];for(let i=0;i<(compact?3600:7000);i++){const x=hash(i,2)*16000-1000,side=i%2?1:-1,d=112+hash(i,4)*65,z=river(x)+side*d;if(noise(x/110,z/110)<.37)continue;const y=height(x,z);if(y<3||y>80)continue;spots.push({x,z,y,h:5+hash(i,7)*10});}
    const leafCanvas=document.createElement('canvas');leafCanvas.width=leafCanvas.height=128;const brush=leafCanvas.getContext('2d');
    for(let i=0;i<150;i++){const a=hash(i,11)*Math.PI*2,r=Math.sqrt(hash(i,12))*51,x=64+Math.cos(a)*r,y=64+Math.sin(a)*r;brush.fillStyle=`rgb(${170+Math.floor(hash(i,13)*85)},${180+Math.floor(hash(i,13)*75)},${150+Math.floor(hash(i,13)*100)})`;brush.beginPath();brush.ellipse(x,y,3+hash(i,14)*5,2+hash(i,15)*3,a,0,Math.PI*2);brush.fill();}
    const leafMap=new T.CanvasTexture(leafCanvas);leafMap.colorSpace=T.SRGBColorSpace;
    const lp=[],ln=[],lu=[],li=[];
    for(let i=0;i<(compact?48:70);i++){const az=hash(i,20)*Math.PI*2,y=hash(i,21)*2-1,r=Math.sqrt(1-y*y),normal=new T.Vector3(Math.cos(az)*r,y,Math.sin(az)*r),center=normal.clone().multiplyScalar(.2+.65*hash(i,22));const right=new T.Vector3().crossVectors(normal,new T.Vector3(.13,1,.17)).normalize(),up=new T.Vector3().crossVectors(right,normal),w=.29+.15*hash(i,23);
      for(const [x,v] of [[-1,-1],[1,-1],[-1,1],[1,1]]){const q=center.clone().addScaledVector(right,x*w).addScaledVector(up,v*w);lp.push(q.x,q.y,q.z);ln.push(normal.x,normal.y,normal.z);lu.push((x+1)/2,(v+1)/2);}const j=i*4;li.push(j,j+1,j+2,j+2,j+1,j+3);}
    const leafGeo=new T.BufferGeometry();leafGeo.setAttribute('position',new T.Float32BufferAttribute(lp,3));leafGeo.setAttribute('normal',new T.Float32BufferAttribute(ln,3));leafGeo.setAttribute('uv',new T.Float32BufferAttribute(lu,2));leafGeo.setIndex(li);
    const crowns=new T.InstancedMesh(leafGeo,new T.MeshStandardMaterial({color:0xffffff,map:leafMap,alphaTest:.4,side:T.DoubleSide,roughness:1}),spots.length*3);
    const trunks=new T.InstancedMesh(new T.CylinderGeometry(.22,.45,1,5),new T.MeshStandardMaterial({color:'#514634',roughness:1}),spots.length);
    const ob=new T.Object3D();spots.forEach((p,i)=>{ob.position.set(p.x,p.y+p.h*.35,p.z);ob.scale.set(1,p.h*.7,1);ob.updateMatrix();trunks.setMatrixAt(i,ob.matrix);
      for(let j=0;j<3;j++){ob.position.set(p.x+(hash(i,j+4)-.5)*p.h*.6,p.y+p.h*(.55+j*.13),p.z+(hash(i,j+9)-.5)*p.h*.6);ob.scale.set(p.h*(.29+j*.02),p.h*.36,p.h*.30);ob.rotation.set(hash(i,j)*3,hash(i,j+6)*5,0);ob.updateMatrix();crowns.setMatrixAt(i*3+j,ob.matrix);crowns.setColorAt(i*3+j,new T.Color().setRGB(.08+hash(i,8)*.08,.18+hash(i,9)*.12,.025+hash(i,10)*.05));}});
    crowns.castShadow=crowns.receiveShadow=true;root.add(crowns,trunks);
    falls.forEach((f,k)=>{f.lip=338;f.height=height(f.x+f.nx*f.lip,f.z+f.nz*f.lip)+3;makeFall(f,k);});
  }
  function makeFall(f,k){
    const axis=new T.Vector3(f.nz,0,-f.nx),normal=new T.Vector3(f.nx,0,f.nz),group=new T.Group();group.position.set(f.x,0,f.z);group.rotation.y=Math.atan2(f.nx,f.nz);root.add(group);
    const shape=new T.Vector4(f.height,f.lip,f.width,f.end);
    // Ray-marched 3D volume: a curved curtain, detached droplets and impact mist.
    const material=new T.ShaderMaterial({side:T.BackSide,transparent:true,depthTest:false,depthWrite:false,uniforms:{uDepth:{value:null},uRes:{value:new T.Vector2()},uNearFar:{value:new T.Vector2()},uForward:{value:new T.Vector3()},uShape:{value:shape},uTime:{value:0},uOrigin:{value:new T.Vector3()},uWorld:{value:new T.Vector4(f.x,f.z,f.nx,f.nz)},uSun:{value:new T.Vector3()},uLight:{value:new T.Vector3(1,1,1)}},vertexShader:`varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1);}`,fragmentShader:`precision highp float;
#include <packing>
varying vec3 vLocal;uniform sampler2D uDepth;uniform vec2 uRes,uNearFar;uniform vec3 uForward;uniform vec3 uOrigin,uSun,uLight;uniform vec4 uShape,uWorld;uniform float uTime;${WaterfallField.glsl}${heightGLSL}
void main(){vec3 rd=normalize(vLocal-uOrigin);vec2 hit=wfBox(uOrigin,rd,vec3(-uShape.z*1.6,-3,uShape.w-120.0),vec3(uShape.z*1.6,uShape.x+5.0,uShape.y+20.0));float sceneDepth=texture2D(uDepth,gl_FragCoord.xy/uRes).r;float viewDepth=-perspectiveDepthToViewZ(sceneDepth,uNearFar.x,uNearFar.y);float limit=viewDepth/max(.001,dot(rd,uForward));float a=max(0.0,hit.x),b=min(hit.y,limit);if(b<=a)discard;
float ds=(b-a)/96.0,tr=1.0;vec3 sum=vec3(0);for(int j=0;j<96;j++){vec3 p=uOrigin+rd*(a+(float(j)+.5)*ds);
vec2 den=wfDensity(p,uShape,uTime);float rho=den.x+den.y;if(rho>.0005){float sha=exp(-dot(wfDensity(p+uSun*7.0,uShape,uTime),vec2(1))*7.0);float al=1.0-exp(-rho*ds);vec3 light=vec3(.18,.23,.27)+uLight*(.38+.45*sha);sum+=tr*al*light;tr*=1.0-al;if(tr<.01)break;}}
if(tr>.998)discard;gl_FragColor=vec4(sum/max(1.0-tr,.001),1.0-tr);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
    const geo=new T.BoxGeometry(f.width*3.2,f.height+8,f.lip-f.end+140);geo.translate(0,(f.height+2)/2,(f.lip+f.end-100)/2);
    const volume=new T.Mesh(geo,material);volume.renderOrder=8;group.add(volume);materials.push({material,group});
    // Explicit ballistic particles sparkle outside the dense curtain at close range.
    const count=2400,seed=new Float32Array(count*3);for(let i=0;i<count;i++)seed.set([hash(i,2),hash(i,3),hash(i,4)],i*3);
    const pg=new T.BufferGeometry();pg.setAttribute('position',new T.BufferAttribute(seed,3));
    const pm=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uTime:{value:0},uShape:{value:shape}},vertexShader:`uniform float uTime;uniform vec4 uShape;varying float alpha;void main(){float life=sqrt(2.0*uShape.x/9.81),age=fract(position.y+uTime/life);float y=uShape.x*(1.0-age*age),z=mix(uShape.y,uShape.w,age)+(position.z-.5)*(12.0+age*22.0);vec3 p=vec3((position.x-.5)*uShape.z*2.0,y,z);vec4 v=modelViewMatrix*vec4(p,1);gl_Position=projectionMatrix*v;gl_PointSize=clamp(160.0/max(1.0,-v.z),1.0,3.0);alpha=age*.38;}`,fragmentShader:`varying float alpha;void main(){float a=1.0-smoothstep(.15,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.8,.9,.94,a*alpha);}`});
    const points=new T.Points(pg,pm);points.frustumCulled=false;points.renderOrder=9;group.add(points);materials.push({material:pm,group});
  }
  function renderReflection(renderer,scene,camera){
    if(!root.visible)return;
    if(!reflectionRT)reflectionRT=new T.WebGLRenderTarget(compact?320:640,compact?180:360,{type:T.HalfFloatType});
    mirrorCamera.copy(camera);mirrorCamera.clearViewOffset();mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
    const level=root.position.y+.05,look=new T.Vector3();camera.getWorldDirection(look);look.add(camera.position);look.y=2*level-look.y;
    mirrorCamera.position.copy(camera.position);mirrorCamera.position.y=2*level-camera.position.y;mirrorCamera.up.set(0,-1,0);mirrorCamera.lookAt(look);mirrorCamera.updateMatrixWorld();
    reflectMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1).multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);
    const groups=[...new Set(materials.map(x=>x.group))],vis=groups.map(g=>g.visible),clips=renderer.clippingPlanes,shadows=renderer.shadowMap.autoUpdate;
    groups.forEach(g=>g.visible=false);waterMesh.visible=false;renderer.clippingPlanes=[new T.Plane(new T.Vector3(0,1,0),-level)];renderer.shadowMap.autoUpdate=false;
    renderer.setRenderTarget(reflectionRT);renderer.clear();renderer.render(scene,mirrorCamera);renderer.setRenderTarget(null);
    renderer.clippingPlanes=clips;renderer.shadowMap.autoUpdate=shadows;waterMesh.visible=true;groups.forEach((g,i)=>g.visible=vis[i]);water.uniforms.uReflection.value=reflectionRT.texture;
  }
  function renderDepth(renderer,scene,camera){
    if(!root.visible)return;
    const res=renderer.getDrawingBufferSize(new T.Vector2());
    if(!depthRT){depthRT=new T.WebGLRenderTarget(res.x,res.y,{minFilter:T.NearestFilter,magFilter:T.NearestFilter});depthRT.depthTexture=new T.DepthTexture(res.x,res.y,T.UnsignedIntType);}
    if(depthRT.width!==res.x||depthRT.height!==res.y)depthRT.setSize(res.x,res.y);
    const keep=scene.overrideMaterial,bg=scene.background,groups=[...new Set(materials.map(x=>x.group))],visible=groups.map(g=>g.visible),shadows=renderer.shadowMap.autoUpdate;
    groups.forEach(g=>g.visible=false);scene.overrideMaterial=null;scene.background=new T.Color(1,1,1);renderer.shadowMap.autoUpdate=false;
    renderer.setRenderTarget(depthRT);renderer.clear();renderer.render(scene,camera);renderer.setRenderTarget(null);
    scene.overrideMaterial=keep;scene.background=bg;renderer.shadowMap.autoUpdate=shadows;groups.forEach((g,i)=>g.visible=visible[i]);
    materials.forEach(({material:m,group:g})=>{if(m.uniforms.uDepth){m.uniforms.uDepth.value=depthRT.depthTexture;m.uniforms.uRes.value.copy(res);m.uniforms.uNearFar.value.set(camera.near,camera.far);camera.getWorldDirection(m.uniforms.uForward.value);m.uniforms.uForward.value.applyAxisAngle(new T.Vector3(0,1,0),-g.rotation.y);}});
  }
  function update(nav,camera,env,dt){
    if(!ready)return;root.visible=env.state.place==='canyon';if(!root.visible)return;clock+=dt;
    const lap=Math.floor(nav.x/14000);root.position.set(lap*14000-nav.x,-nav.alt,-nav.z);root.updateMatrixWorld(true);
    water.uniforms.uOffset.value.set(-root.position.x,-root.position.z);water.uniforms.uTime.value=clock;water.uniforms.uSun.value.copy(env.out.lightDir);
    materials.forEach(({material:m,group:g})=>{m.uniforms.uTime.value=clock;if(m.uniforms.uOrigin){m.uniforms.uOrigin.value.copy(camera.position);g.worldToLocal(m.uniforms.uOrigin.value);m.uniforms.uSun.value.copy(env.out.lightDir).applyAxisAngle(new T.Vector3(0,1,0),-g.rotation.y);m.uniforms.uLight.value.set(env.out.lightColor.r,env.out.lightColor.g,env.out.lightColor.b).multiplyScalar(.45);}});
  }
  return {init,update,renderReflection,renderDepth,get ready(){return ready&&pendingTextures===0;},height,river,heightGLSL,root,falls};
})();
