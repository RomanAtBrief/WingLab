/* ================= Cascaded shadow maps: 4 stabilised cascades, soft PCF in the lighting pass ================= */
const GShadow = (() => {
  const T = THREE, N = 4;
  let d, tex, views = [], camBuf, RES = 2048, enabled = true;
  const cs = new Float32Array(80), camData = new Float32Array(N * 64), splits = [0, 0, 0, 0], texel = [0, 0, 0, 0];
  const lightVP = [], centers = [], radii = [];
  for (let i = 0; i < N; i++) { lightVP.push(new T.Matrix4()); centers.push(new T.Vector3()); radii.push(1); }
  const V = new T.Matrix4(), Pm = new T.Matrix4(), tmp = new T.Vector3(), up = new T.Vector3(), eye = new T.Vector3();

  function init() {
    d = G.device;
    if (G.S.lite || /lite/.test(location.search)) RES = 1024;
    tex = d.createTexture({ size: [RES, RES, N], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'csm' });
    for (let i = 0; i < N; i++) views.push(tex.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
    camBuf = G.buf(N * 256, GPUBufferUsage.UNIFORM, null, 'shadowCams');
    GR.setInput('csm', tex.createView({ dimension: '2d-array' }));
    GMesh.shadowCams(camBuf);
  }
  // camera: three camera (unjittered); size: aircraft size; hag: height above ground (m); sun: direction toward the light
  function update(cam, size, hag, sun, planeAlt) {
    const dAir = cam.position.length();
    splits[0] = dAir + size * 0.9;
    splits[1] = Math.max(splits[0] * 3, hag * 1.25 + 900);
    splits[2] = splits[1] * 4.5;
    splits[3] = Math.min(splits[2] * 4.5, 60000);
    const fov = cam.fov * Math.PI / 180, tanV = Math.tan(fov / 2), tanH = tanV * cam.aspect;
    const fwd = new T.Vector3(); cam.getWorldDirection(fwd);
    const sd = tmp.copy(sun).normalize();
    up.set(0, 1, 0); if (Math.abs(sd.y) > 0.98) up.set(1, 0, 0);
    let near = 0;
    for (let c = 0; c < N; c++) {
      const far = splits[c];
      let ctr, r;
      if (c === 0) { ctr = new T.Vector3(0, 0, 0); r = size * 0.62; }
      else {
        // bounding sphere of the frustum slice (its size depends only on the split distances, so it is stable)
        const t2 = tanV * tanV + tanH * tanH, zz = Math.min(far, (far + near) * (1 + t2) / 2);
        ctr = cam.position.clone().addScaledVector(fwd, zz);
        r = Math.sqrt((far - zz) ** 2 + far * far * t2);
      }
      r = Math.ceil(r * 16) / 16;
      const tx = 2 * r / RES;
      const back = c === 0 ? 25000 : c === 1 ? 20000 : 30000;
      eye.copy(ctr).addScaledVector(sd, back);
      V.lookAt(eye, ctr, up); V.setPosition(eye); V.invert();
      // snap the centre to whole texels so shadows do not crawl when the camera moves
      const o = ctr.clone().applyMatrix4(V);
      const sx = Math.round(o.x / tx) * tx - o.x, sy = Math.round(o.y / tx) * tx - o.y;
      Pm.makeOrthographic(-r - sx, r - sx, r - sy, -r - sy, 1, back + r * 2, T.WebGPUCoordinateSystem);
      lightVP[c].multiplyMatrices(Pm, V);
      centers[c].copy(ctr); radii[c] = r; texel[c] = tx;
      camData.set(lightVP[c].elements, c * 64);
      near = far * 0.9;
    }
    d.queue.writeBuffer(camBuf, 0, camData);
    for (let c = 0; c < N; c++) cs.set(lightVP[c].elements, c * 16);
    cs.set(splits, 64); cs.set(texel, 68);
    cs[76] = enabled ? 1 : 0; cs[77] = GTerrain.ready ? 1 : 0;
    d.queue.writeBuffer(GR.csBuf, 0, cs);
    for (let c = 1; c < N; c++) GTerrain.selectShadow(c, lightVP[c], planeAlt, centers[c], radii[c], sd);
    if (hag < 1500) GTerrain.selectShadow(0, lightVP[0], planeAlt, centers[0], Math.max(radii[0], 200), sd); else GTerrain.selectShadow(0, null);
  }
  function setCloudMap(x, z, size, on) { cs[72] = x; cs[73] = z; cs[74] = size; cs[75] = on ? 1 : 0; }
  const hook = {
    name: 'shadow',
    shadow(enc) {
      if (!enabled) return;
      for (let c = 0; c < N; c++) {
        const p = enc.beginRenderPass({ label: 'csm' + c, colorAttachments: [], depthStencilAttachment: { view: views[c], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
        GMesh.shadow(p, c);
        GTerrain.drawShadow(p, c, camBuf);
        if (typeof GTrees !== 'undefined' && c > 0 && c < 3) GTrees.drawShadow(p, c, camBuf);
        p.end();
      }
    }
  };
  return { init, update, hook, setCloudMap, splits, get camBuf() { return camBuf; }, lightVP, set enabled(v) { enabled = v; } };
})();
