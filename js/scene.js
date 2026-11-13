/* ============================================================
 * scene.js — Three.js world (Week 1 coverage)
 * Prefabs, materials, lights, cameras, physics, particles, glTF.
 * Global namespace: WAM3D.scene
 * ============================================================ */
(function (global) {
  'use strict';

  const HOLES = 9;
  const HOLE_XZ = [];
  for (const x of [-3, 0, 3]) for (const z of [-3, 0, 3]) HOLE_XZ.push([x, z]);

  /* ---------------- Materials) ---------------- */
  /* With sRGB output enabled, authored hex colours must be converted to
   * linear space or everything renders washed-out pastel. */
  const col = h => new THREE.Color(h).convertSRGBToLinear();
  const MAT_PRESETS = {
    grass: { color: col(0x2f7d33), roughness: 0.95, metalness: 0.0 },
    wood:  { color: col(0x8d6e63), roughness: 0.85, metalness: 0.05 },
    metal: { color: col(0x9e9e9e), roughness: 0.35, metalness: 0.85 },
    neon:  { color: col(0x18ffff), roughness: 0.25, metalness: 0.1, emissive: col(0x006064) }
  };
  const MOLE_SKINS = {
    brown: { color: col(0x8b5a2b), roughness: 0.9, metalness: 0.0 },
    pink:  { color: col(0xf48fb1), roughness: 0.8, metalness: 0.0 },
    metal: { color: col(0xb0bec5), roughness: 0.35, metalness: 0.85 },
    neon:  { color: col(0x69f0ae), roughness: 0.3, metalness: 0.0, emissive: col(0x004d40) }
  };
  const HAMMER_MATS = {
    wood:  { color: col(0x795548), roughness: 0.85, metalness: 0.0 },
    metal: { color: col(0x78909c), roughness: 0.3, metalness: 0.9 },
    neon:  { color: col(0xff4081), roughness: 0.3, metalness: 0.1, emissive: col(0x880e4f) }
  };

  function makeMat(preset) {
    const p = MAT_PRESETS[preset] || MOLE_SKINS[preset] || HAMMER_MATS[preset] || MAT_PRESETS.grass;
    const opts = { color: col(p.color), roughness: p.roughness, metalness: p.metalness };
    if (p.emissive) opts.emissive = col(p.emissive);
    return new THREE.MeshStandardMaterial(opts);
  }

  /* ---------------- Scene bootstrap ---------------- */
  function create() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x86c8f7);
    scene.fog = new THREE.Fog(0x86c8f7, 30, 70);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // cap for perf
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // filmic colour response + correct sRGB output — the single biggest "next level" win
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.domElement.style.touchAction = 'none';
    document.getElementById('app').appendChild(renderer.domElement);

    const S = {
      scene, renderer,
      materials: { ground: makeMat('grass'), mole: makeMat('brown'), hammer: makeMat('wood') },
      lights: {}, cameras: {}, rigs: {},
      moleProto: null, bombProto: null, gltfMole: null, usingGltf: false,
      podium: null, hammer: null, hammerGroup: null
    };

    buildLights(S);
    buildSky(S);
    buildGroundAndHoles(S);
    buildEnvironment(S);
    buildPodium(S);
    buildHammer(S);
    S.moleProto = buildMoleProto(S);
    S.bombProto = buildBombProto(S);
    buildCameras(S);
    buildParticles(S);
    buildBodies(S);
    return S;
  }

  /* ---------------- Lights) ---------------- */
  function buildLights(S) {
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x2f6322, 0.5);   // sky/ground bounce fill
    const dir = new THREE.DirectionalLight(0xfff2d9, 1.0);             // warm sun
    dir.position.set(6, 14, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -9; dir.shadow.camera.right = 9;
    dir.shadow.camera.top = 9; dir.shadow.camera.bottom = -9;
    dir.shadow.bias = -0.0004;
    const point = new THREE.PointLight(0xffcc80, 0, 30);   // off by default
    point.position.set(-5, 6, -5);
    const spot = new THREE.SpotLight(0xffffff, 0, 40, 0.6, 0.4);
    spot.position.set(0, 14, 0);
    spot.target.position.set(0, 0, 0);
    S.scene.add(ambient, hemi, dir, dir.target, point, spot, spot.target);
    S.lights = { ambient, hemi, dir, point, spot };
  }

  function setLightState(S, st) {
    S.lights.ambient.intensity = st.ambientOn ? st.ambientInt : 0;
    S.lights.hemi.intensity = st.night ? 0.12 : 0.45;
    S.lights.dir.intensity = st.dirOn ? st.dirInt : 0;
    S.lights.point.intensity = st.pointOn ? st.pointInt : 0;
    S.lights.spot.intensity = st.spotOn ? st.spotInt : 0;
    if (st.night) S.scene.background.setHex(0x0b1026); else S.scene.background.setHex(0x86c8f7);
    S.scene.fog.color.copy(S.scene.background);
    if (S.sky) {
      const u = S.sky.material.uniforms;
      if (st.night) { u.top.value.setHex(0x060a1c); u.bottom.value.setHex(0x1c2b52); }
      else { u.top.value.setHex(0x4d9fe8); u.bottom.value.setHex(0xd8f0ff); }
    }
  }

  /* ---------------- Gradient sky dome ---------------- */
  function buildSky(S) {
    const geo = new THREE.SphereGeometry(90, 24, 14);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x4d9fe8) },
        bottom: { value: new THREE.Color(0xd8f0ff) }
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP;' +
        'void main(){ float h = clamp(normalize(vP).y * 1.4 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }'
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.name = 'SkyDome';
    S.scene.add(dome);
    S.sky = dome;
  }

  /* ---------------- Ground + holes ---------------- */
  function grassTexture() {
    // procedural grass: light base so the material colour tints it (chips still work)
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#aeb5a2';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const l = 108 + Math.random() * 40;
      g.strokeStyle = `rgba(${l},${l + 6},${l - 10},0.5)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 4, y - 3 - Math.random() * 4);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    return tex;
  }

  function buildGroundAndHoles(S) {
    const tex = grassTexture();
    S.materials.ground.map = tex;
    S.materials.ground.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 14), S.materials.ground);
    ground.name = 'Ground';
    ground.position.y = -0.26;
    ground.receiveShadow = true;
    S.scene.add(ground);
    S.ground = ground;

    const holeMat = new THREE.MeshStandardMaterial({ color: col(0x1c150e), roughness: 1 });
    const wallMat = new THREE.MeshStandardMaterial({ color: col(0x3a2c1c), roughness: 1, side: THREE.BackSide });
    const rimMat = new THREE.MeshStandardMaterial({ color: col(0x6b4a2f), roughness: 1 });
    const holeGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.05, 28);
    const wallGeo = new THREE.CylinderGeometry(0.88, 0.72, 0.55, 28, 1, true);
    const rimGeo = new THREE.TorusGeometry(0.98, 0.17, 10, 28);
    S.holes = [];
    for (let i = 0; i < HOLES; i++) {
      const [x, z] = HOLE_XZ[i];
      const hole = new THREE.Mesh(holeGeo, holeMat);
      hole.name = 'Hole_' + i;
      hole.position.set(x, 0.025, z);
      hole.receiveShadow = true;
      // open cylinder walls make the hole read as a deep pit, not a sticker
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.name = 'HoleWall_' + i;
      wall.position.set(x, -0.24, z);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.name = 'HoleRim_' + i;
      rim.rotation.x = Math.PI / 2;
      rim.scale.set(1, 1, 0.55);
      rim.position.set(x, 0.06, z);
      rim.receiveShadow = true;
      rim.castShadow = false;
      // a few dirt clods around each rim
      const clods = new THREE.Group();
      clods.name = 'HoleClods_' + i;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + i;
        const clod = new THREE.Mesh(new THREE.SphereGeometry(0.09 + Math.random() * 0.05, 6, 5), rimMat);
        clod.position.set(x + Math.cos(a) * 1.22, 0.04, z + Math.sin(a) * 1.22);
        clod.scale.y = 0.6;
        clods.add(clod);
      }
      S.scene.add(hole, wall, rim, clods);
      S.holes.push({ hole, rim, x, z });
    }
  }

  /* ---------------- Environment dressing: meadow, fence, trees, flora ---------------- */
  function buildEnvironment(S) {
    const env = new THREE.Group();
    env.name = 'Environment';
    // wide meadow under and around the play field
    const meadow = new THREE.Mesh(new THREE.CircleGeometry(46, 40),
      new THREE.MeshStandardMaterial({ color: col(0x3d7a2a), roughness: 1 }));
    meadow.name = 'Meadow';
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.y = -0.28;
    meadow.receiveShadow = true;
    env.add(meadow);

    // wooden fence around the field
    const postMat = new THREE.MeshStandardMaterial({ color: col(0x8a5a33), roughness: 0.9 });
    const railMat = new THREE.MeshStandardMaterial({ color: col(0x9c6b3d), roughness: 0.9 });
    const postGeo = new THREE.BoxGeometry(0.18, 0.75, 0.18);
    const railGeo = new THREE.BoxGeometry(14.6, 0.1, 0.06);
    const F = 7.3;
    for (let side = 0; side < 4; side++) {
      const horiz = side % 2 === 0;
      for (let along = -1.5; along <= 1.5; along++) {
        const px = horiz ? along * 4.6 : (side < 2 ? -F : F);
        const pz = horiz ? (side < 2 ? -F : F) : along * 4.6;
        const post = new THREE.Mesh(postGeo, postMat);
        post.name = 'FencePost';
        post.position.set(px, 0.12, pz);
        post.castShadow = true;
        env.add(post);
      }
      for (const h of [0.28, 0.58]) {
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.name = 'FenceRail';
        rail.position.set(horiz ? 0 : (side < 2 ? -F : F), h, horiz ? (side < 2 ? -F : F) : 0);
        rail.rotation.y = horiz ? 0 : Math.PI / 2;
        rail.castShadow = true;
        env.add(rail);
      }
    }

    // background trees for depth (outside the fence, catch long shadows)
    const trunkMat = new THREE.MeshStandardMaterial({ color: col(0x6d4c33), roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: col(0x2f7d32), roughness: 0.95 });
    const treeSpots = [[-10.5, -9.5, 1.25], [-6.5, -12, 0.9], [7.5, -10.5, 1.1], [11, -8, 0.85], [12.5, -12.5, 1.2], [-12, -13, 1.0]];
    treeSpots.forEach(([x, z, s], i) => {
      const tree = new THREE.Group();
      tree.name = 'Tree_' + i;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.3 * s, 2.2 * s, 8), trunkMat);
      trunk.position.y = 1.1 * s;
      trunk.castShadow = true;
      tree.add(trunk);
      const blobs = [[0, 2.9, 1.15], [0.75, 2.45, 0.85], [-0.7, 2.5, 0.8], [0.1, 3.5, 0.7]];
      for (const [dx, dy, r] of blobs) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(r * s, 10, 8), leafMat);
        b.position.set(dx * s, dy * s, (Math.random() - 0.5) * 0.5);
        b.castShadow = true;
        tree.add(b);
      }
      tree.position.set(x, 0, z);
      env.add(tree);
    });

    // grass tufts (avoid the 3x3 hole grid and the podium corner)
    const tuftMat = new THREE.MeshStandardMaterial({ color: col(0x4d8a2f), roughness: 1 });
    let tuftN = 0;
    for (let i = 0; i < 26; i++) {
      const x = (Math.random() - 0.5) * 13.2, z = (Math.random() - 0.5) * 13.2;
      const nearHole = HOLE_XZ.some(([hx, hz]) => Math.hypot(x - hx, z - hz) < 1.7);
      const nearPodium = Math.hypot(x - 5.2, z - 5.2) < 1.8;
      if (nearHole || nearPodium) continue;
      const tuft = new THREE.Group();
      tuft.name = 'Tuft_' + (tuftN++);
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.42 + Math.random() * 0.25, 5), tuftMat);
        blade.position.set((b - 1) * 0.09, 0.18, 0);
        blade.rotation.z = (b - 1) * 0.3;
        tuft.add(blade);
      }
      tuft.position.set(x, 0, z);
      env.add(tuft);
    }

    // rocks
    const rockMat = new THREE.MeshStandardMaterial({ color: col(0x808a86), roughness: 0.9 });
    const rockSpots = [[-5.6, 5.9, 0.5], [6.1, -5.4, 0.42], [-6.2, -1.2, 0.36], [1.9, 6.3, 0.3], [-2.3, -6.1, 0.45]];
    rockSpots.forEach(([x, z, s], i) => {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.name = 'Rock_' + i;
      rock.position.set(x, s * 0.4, z);
      rock.scale.y = 0.7;
      rock.rotation.y = i * 1.3;
      rock.castShadow = true;
      env.add(rock);
    });

    // flowers
    const stemMat = new THREE.MeshStandardMaterial({ color: col(0x3e7a2c), roughness: 1 });
    const petalColors = [0xf06292, 0xffd54f, 0xba68c8, 0xff8a65];
    let flN = 0;
    for (let i = 0; i < 12; i++) {
      const x = (Math.random() - 0.5) * 13, z = (Math.random() - 0.5) * 13;
      if (HOLE_XZ.some(([hx, hz]) => Math.hypot(x - hx, z - hz) < 1.6)) continue;
      const fl = new THREE.Group();
      fl.name = 'Flower_' + (flN++);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.4, 5), stemMat);
      stem.position.y = 0.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({ color: petalColors[i % 4], roughness: 0.7 }));
      head.position.y = 0.44;
      fl.add(stem, head);
      fl.position.set(x, 0, z);
      env.add(fl);
    }

    // a couple of clouds drifting high (cheap: flattened spheres, no shadow)
    const cloudMat = new THREE.MeshStandardMaterial({ color: col(0xffffff), roughness: 1, fog: false });
    for (let i = 0; i < 3; i++) {
      const cloud = new THREE.Group();
      cloud.name = 'Cloud_' + i;
      for (const [dx, dy, r] of [[0, 0, 1.6], [1.4, -0.2, 1.1], [-1.3, -0.15, 1.0], [0.4, 0.5, 0.9]]) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), cloudMat);
        puff.position.set(dx * 2.2, dy * 1.2, 0);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      cloud.position.set(-14 + i * 13, 14 + i * 1.5, -22 - i * 4);
      env.add(cloud);
    }
    S.environment = env;
    S.scene.add(env);
  }

  /* ---------------- Score podium) ---------------- */
  function buildPodium(S) {
    const g = new THREE.Group();
    g.name = 'ScorePodium';
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), makeMat('wood'));
    base.position.y = 0.25; base.castShadow = true; base.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 1.2), makeMat('metal'));
    top.position.y = 0.67; top.castShadow = true;
    g.add(base, top);
    // corner trim posts + a little flag so the podium reads as a scoreboard stand
    const trimMat = new THREE.MeshStandardMaterial({ color: col(0x5d4037), roughness: 0.9 });
    for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.12), trimMat);
      post.position.set(dx, 0.31, dz);
      post.castShadow = true;
      g.add(post);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), trimMat);
    pole.position.set(-0.66, 1.2, -0.66);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.03),
      new THREE.MeshStandardMaterial({ color: col(0xe53935), roughness: 0.7 }));
    flag.position.set(-0.42, 1.5, -0.66);
    flag.castShadow = true;
    g.add(pole, flag);
    g.position.set(6.3, 0, 6.3);
    g.scale.setScalar(0.85);
    S.scene.add(g);
    S.podium = g;
  }

  /* ---------------- Hammer (physics) ---------------- */
  function buildHammer(S) {
    const grp = new THREE.Group();
    grp.name = 'Hammer';
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.115, 1.7, 10), S.materials.hammer);
    handle.name = 'HammerHandle';
    handle.position.y = 0.85; handle.castShadow = true;
    const headMat = new THREE.MeshStandardMaterial({ color: col(0x78909c), roughness: 0.3, metalness: 0.85 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.44, 0.44), headMat);
    head.name = 'HammerHead';
    head.position.y = 1.75; head.castShadow = true;
    // striking faces + grip band give the mallet a real silhouette
    const faceGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 14);
    const faceL = new THREE.Mesh(faceGeo, headMat);
    faceL.rotation.z = Math.PI / 2; faceL.position.set(-0.44, 1.75, 0); faceL.castShadow = true;
    const faceR = faceL.clone(); faceR.position.x = 0.44;
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 8, 16),
      new THREE.MeshStandardMaterial({ color: col(0x3e2723), roughness: 0.9 }));
    grip.rotation.x = Math.PI / 2; grip.position.y = 0.28;
    grp.add(handle, head, faceL, faceR, grip);
    grp.visible = false;
    S.scene.add(grp);
    S.hammer = grp;
    S.hammerHead = head;
  }

  /* ---------------- Mole prefab) ----------------
   * A proper character: body + belly, snout, ears, eyes with highlights,
   * whiskers and paws. The body keeps S.materials.mole so the skin chips work. */
  function buildMoleProto(S) {
    const g = new THREE.Group();
    g.name = 'MolePrefab';
    const dark = new THREE.MeshStandardMaterial({ color: col(0x4e342e), roughness: 0.95 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 18), S.materials.mole);
    body.name = 'MoleBody';
    body.position.y = 0.18; body.scale.set(1, 1.06, 0.96); body.castShadow = true;
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 18), dark);
    shade.name = 'MoleShade';
    shade.position.set(0, 0.06, -0.3); shade.scale.set(0.92, 0.94, 0.82);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14),
      new THREE.MeshStandardMaterial({ color: col(0xd7ccc8), roughness: 0.9 }));
    belly.name = 'MoleBelly';
    belly.position.set(0, 0.1, 0.3); belly.scale.set(0.78, 0.9, 0.5);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.34, 12),
      new THREE.MeshStandardMaterial({ color: col(0xa1887f), roughness: 0.85 }));
    snout.name = 'MoleSnout';
    snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.42, 0.52);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshStandardMaterial({ color: col(0xff80ab), roughness: 0.6 }));
    nose.name = 'Nose'; nose.position.set(0, 0.44, 0.68);
    const eyeGeo = new THREE.SphereGeometry(0.095, 10, 8);
    const eyeMat = new THREE.MeshStandardMaterial({ color: col(0x14100c), roughness: 0.3 });
    const hlMat = new THREE.MeshBasicMaterial({ color: col(0xffffff) });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.name = 'EyeL'; eyeL.position.set(0.19, 0.6, 0.44);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.name = 'EyeR'; eyeR.position.set(-0.19, 0.6, 0.44);
    const hlL = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 5), hlMat); hlL.position.set(0.22, 0.64, 0.5);
    const hlR = hlL.clone(); hlR.position.x = -0.16;
    const earGeo = new THREE.SphereGeometry(0.14, 8, 7);
    const earL = new THREE.Mesh(earGeo, dark); earL.name = 'EarL'; earL.position.set(0.3, 0.86, 0.02);
    const earR = new THREE.Mesh(earGeo, dark); earR.name = 'EarR'; earR.position.set(-0.3, 0.86, 0.02);
    const pawGeo = new THREE.SphereGeometry(0.15, 8, 7);
    const pawMat = new THREE.MeshStandardMaterial({ color: col(0x8d6e63), roughness: 0.9 });
    const pawL = new THREE.Mesh(pawGeo, pawMat); pawL.name = 'PawL'; pawL.position.set(0.34, 0.02, 0.42); pawL.scale.set(1, 0.7, 1);
    const pawR = new THREE.Mesh(pawGeo, pawMat); pawR.name = 'PawR'; pawR.position.set(-0.34, 0.02, 0.42); pawR.scale.set(1, 0.7, 1);
    g.add(body, shade, belly, snout, nose, eyeL, eyeR, hlL, hlR, earL, earR, pawL, pawR);
    // whiskers: six thin boxes fanned from the snout
    const wMat = new THREE.MeshBasicMaterial({ color: col(0x3e2723) });
    for (let i = 0; i < 3; i++) {
      for (const side of [1, -1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.012), wMat);
        w.name = 'Whisker';
        w.position.set(side * 0.26, 0.38 + i * 0.05, 0.6);
        w.rotation.y = side * (0.5 + i * 0.12);
        g.add(w);
      }
    }
    return g;
  }

  /* ---------------- Bomb prefab ---------------- */
  function buildBombProto(S) {
    const g = new THREE.Group();
    g.name = 'BombPrefab';
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.58, 24, 18),
      new THREE.MeshStandardMaterial({ color: col(0x263238), roughness: 0.3, metalness: 0.35 }));
    body.name = 'BombBody';
    body.position.y = 0.18; body.scale.set(1, 1.08, 1); body.castShadow = true;
    // glossy highlight sells the "cartoon bomb" read
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: col(0xb0c4d4) }));
    hl.position.set(-0.2, 0.42, 0.42); hl.scale.set(1, 1.4, 0.5);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.2, 12),
      new THREE.MeshStandardMaterial({ color: col(0x455a64), roughness: 0.4, metalness: 0.6 }));
    nozzle.name = 'Fuse'; nozzle.position.set(0, 0.86, 0);
    const fuse = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 14, Math.PI * 0.95),
      new THREE.MeshStandardMaterial({ color: col(0xa1887f), roughness: 0.9 }));
    fuse.name = 'FuseArc';
    fuse.position.set(0.08, 0.95, 0); fuse.rotation.set(Math.PI / 2, 0, -0.4);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshStandardMaterial({ color: col(0xffab00), emissive: col(0xff6d00), emissiveIntensity: 2.4 }));
    spark.name = 'Spark'; spark.position.set(0.3, 1.08, 0);
    g.add(body, hl, nozzle, fuse, spark);
    return g;
  }

  /* ---------------- Cameras (cycle with C) ----------------
   * Four views: Top-down, Angled, First-person (hammer view), VR Stereo.
   * All orbit rigs share one yaw/pitch state so transitions feel continuous. */
  function buildCameras(S) {
    const aspect = window.innerWidth / window.innerHeight;
    const mk = (fov, name) => {
      const c = new THREE.PerspectiveCamera(fov, aspect, 0.1, 120);
      c.name = name;
      return c;
    };
    const cams = {
      angled: mk(50, 'CamAngled'),
      top: mk(45, 'CamTop'),
      fpv: mk(60, 'CamFirstPerson'),
      vrL: mk(60, 'CamVrLeft'),
      vrR: mk(60, 'CamVrRight')
    };
    S.cameras = cams;
    S.camOrder = ['angled', 'top', 'fpv', 'vr'];
    S.camIndex = 0;
    S.orbit = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, radius: Math.hypot(9, 9), MAX_YAW: 0.55, MAX_PITCH: 0.3 };
    applyOrbit(S, 0, 0);
  }

  /* Fixed-elevation orbit: the whole 3x3 grid stays framed at every yaw. */
  function applyOrbit(S, yaw, pitch) {
    const pitchAngle = 0.62 + pitch * 0.55;
    const d = S.orbit.radius;
    const pos = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitchAngle) * d,
      Math.sin(pitchAngle) * d,
      Math.cos(yaw) * Math.cos(pitchAngle) * d);
    S.cameras.angled.position.copy(pos);
    S.cameras.angled.lookAt(0, 0.4, 0);
    S.cameras.top.position.set(0.001, 18, 0.001);
    S.cameras.top.lookAt(0, 0, 0);
  }

  function cycleCamera(S) {
    S.camIndex = (S.camIndex + 1) % S.camOrder.length;
    return S.camOrder[S.camIndex];
  }

  function activeCamera(S) {
    const key = S.camOrder[S.camIndex];
    if (key === 'vr') return S.cameras.vrL; // placeholder; stereo handled by renderer
    return S.cameras[key];
  }

  /* First-person (hammer view) camera placement. */
  function placeFpv(S) {
    const c = S.cameras.fpv;
    c.position.set(0, 3.2, 7.6);
    c.lookAt(0, 0.4, 0);
  }

  /* ---------------- Particles) ----------------
   * One pooled system, four emit modes: hit burst, dust puff, confetti, ambient dust. */
  const P_MAX = 220;
  function buildParticles(S) {
    const geo = new THREE.OctahedronGeometry(0.09, 0);   // faceted = catches light like a spark
    const group = new THREE.Group();
    group.name = 'ParticlePool';
    const parts = [];
    for (let i = 0; i < P_MAX; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col(0xffd54f), roughness: 0.35, metalness: 0.2 }));
      m.visible = false;
      m.userData = { vel: new THREE.Vector3(), life: 0, total: 1, spin: Math.random() * 6 + 4, gravity: 14, shrink: true };
      group.add(m);
      parts.push(m);
    }
    S.scene.add(group);
    S.particles = { group, parts, cursor: 0 };
  }

  function emitParticle(S, pos, opts) {
    const P = S.particles;
    const m = P.parts[P.cursor];
    P.cursor = (P.cursor + 1) % P_MAX;
    const o = opts || {};
    m.position.copy(pos);
    const speed = o.speed !== undefined ? o.speed : 4.2;
    const up = o.up !== undefined ? o.up : 2.6;
    const a = Math.random() * Math.PI * 2;
    const h = Math.random() * Math.PI * 0.5;
    m.userData.vel.set(Math.cos(a) * Math.cos(h) * speed * (0.5 + Math.random()),
      up + Math.random() * up,
      Math.sin(a) * Math.cos(h) * speed * (0.5 + Math.random()));
    m.scale.setScalar(o.scale || (0.7 + Math.random() * 0.8));
    m.material.color.setHex(o.color !== undefined ? o.color : 0xffd54f).convertSRGBToLinear();
    if (o.emissive !== undefined) m.material.emissive.setHex(o.emissive).convertSRGBToLinear(); else m.material.emissive.setHex(0x000000);
    m.userData.life = 0;
    m.userData.total = o.life || (0.5 + Math.random() * 0.35);
    m.userData.gravity = o.gravity !== undefined ? o.gravity : 14;
    m.userData.shrink = o.shrink !== false;
    m.visible = true;
    return m;
  }

  const FX = {
    hitBurst(S, pos) {
      const palette = [0xffd54f, 0xfff59d, 0xffe082, 0xffffff];
      for (let i = 0; i < 16; i++) {
        emitParticle(S, pos, { color: palette[i % palette.length], emissive: col(0x553300), speed: 4.4, up: 2.8, life: 0.5 + Math.random() * 0.3 });
      }
    },
    bombBurst(S, pos) {
      for (let i = 0; i < 30; i++) emitParticle(S, pos, { color: i % 2 ? 0xff5722 : 0x212121, emissive: col(0x991200), speed: 6.5, up: 4.5, life: 0.75 });
    },
    dustPuff(S, pos) {
      for (let i = 0; i < 9; i++) emitParticle(S, new THREE.Vector3(pos.x, 0.15, pos.z), { color: col(0x8d6e63), speed: 1.3, up: 0.9, life: 0.6, gravity: 2.4, scale: 0.55 });
    },
    confetti(S) {
      const colors = [0xffd54f, 0xff5252, 0x69f0ae, 0x40c4ff, 0xff4081];
      for (let i = 0; i < 40; i++) {
        emitParticle(S, new THREE.Vector3((Math.random() - 0.5) * 10, 6 + Math.random() * 3, (Math.random() - 0.5) * 8),
          { color: colors[i % colors.length], speed: 0.6, up: -1, life: 2.4, gravity: 3, scale: 0.55 });
      }
    }
  };

  function updateParticles(S, dt) {
    for (const m of S.particles.parts) {
      if (!m.visible) continue;
      const u = m.userData;
      u.life += dt;
      u.vel.y -= u.gravity * dt;
      m.position.addScaledVector(u.vel, dt);
      if (u.life >= u.total || m.position.y < -0.6) { m.visible = false; continue; }
      if (u.shrink) m.scale.multiplyScalar(1 - 2.2 * dt);
      m.rotation.x += u.spin * dt;
      m.rotation.y += u.spin * 0.8 * dt;
    }
  }

  /* ---------------- Rigid bodies: knocked moles + debris) ----------------
   * Minimal ballistic bodies with ground bounce; no physics library needed. */
  function buildBodies(S) {
    S.bodies = [];
  }

  /** Fling a mole group off with velocity; it bounces on the ground plane. */
  function flingBody(S, obj, vel) {
    obj.userData.body = { vel: vel.clone(), alive: true, bounces: 0, spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12) };
    S.bodies.push(obj);
  }

  function updateBodies(S, dt) {
    for (let i = S.bodies.length - 1; i >= 0; i--) {
      const o = S.bodies[i];
      const b = o.userData.body;
      b.vel.y -= 18 * dt;
      o.position.addScaledVector(b.vel, dt);
      o.rotation.x += b.spin.x * dt;
      o.rotation.y += b.spin.y * dt;
      o.rotation.z += b.spin.z * dt;
      if (o.position.y < 0.35 && b.vel.y < 0) {
        o.position.y = 0.35;
        b.vel.y = -b.vel.y * 0.45;      // restitution
        b.vel.x *= 0.75; b.vel.z *= 0.75;
        b.spin.multiplyScalar(0.6);
        b.bounces++;
        if (b.bounces >= 2) b.vel.set(0, 0, 0);
      }
      b.life = (b.life || 0) + dt;
      if (b.life > 2.6) {
        S.scene.remove(o);
        disposeGroup(o);
        S.bodies.splice(i, 1);
      }
    }
  }

  function disposeGroup(g) {
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      }
    });
  }

  /* ---------------- glTF mole ----------------
   * Tries assets/mole.glb; on any failure keeps the primitive prefab).
   * Returns a Promise<boolean> so boot can toast the outcome. */
  function loadGltfMole(S) {
    return new Promise(resolve => {
      if (global.__gltfLoaderFailed || !global.THREE.GLTFLoader) { resolve(false); return; }
      try {
        const loader = new THREE.GLTFLoader();
        loader.load('assets/mole.glb',
          gltf => {
            try {
              const model = gltf.scene;
              model.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
              // Normalize scale to roughly match the primitive mole (height ~1.5).
              const box = new THREE.Box3().setFromObject(model);
              const size = box.getSize(new THREE.Vector3());
              const h = Math.max(size.y, 0.001);
              model.scale.setScalar(1.4 / h);
              model.position.y -= box.min.y * (1.4 / h);
              const wrap = new THREE.Group();
              wrap.name = 'MolePrefabGLTF';
              wrap.add(model);
              S.gltfMole = wrap;
              S.usingGltf = true;
              resolve(true);
            } catch (e) { resolve(false); }
          },
          undefined,
          () => resolve(false));
      } catch (e) { resolve(false); }
    });
  }

  function moleTemplate(S) {
    return (S.usingGltf && S.gltfMole) ? S.gltfMole : S.moleProto;
  }

  global.WAM3D = global.WAM3D || {};
  global.WAM3D.const = { HOLES, HOLE_XZ, MAT_PRESETS, MOLE_SKINS, HAMMER_MATS, P_MAX };
  global.WAM3D.sceneKit = {
    create, makeMat, setLightState, buildCameras, applyOrbit, cycleCamera, activeCamera,
    placeFpv, buildParticles, emitParticle, FX, updateParticles, buildBodies, flingBody, updateBodies,
    disposeGroup, loadGltfMole, moleTemplate
  };
})(window);
