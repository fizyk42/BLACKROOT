// Time of day, sun/moon, weather and the atmosphere that ties the look together.

import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/util.js';
import { preset } from '../core/settings.js';

const SKY_VERT = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
uniform float uSunSize;
uniform float uStars;
uniform float uHaze;

float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.71,0.113,0.419)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }

void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  float t = clamp(h*1.6+0.06, 0.0, 1.0);
  col = mix(uHorizon, uZenith, pow(t, 0.72));
  if (h < 0.0) col = mix(uHorizon, uGround, clamp(-h*3.0,0.0,1.0));

  // sun / moon disc plus a broad glow
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColour * pow(sd, 900.0/max(uSunSize,0.05)) * 3.0;
  col += uSunColour * pow(sd, 6.0) * 0.28 * uHaze;

  // stars, only where the sky is dark and above the horizon
  if (uStars > 0.01 && h > 0.0) {
    vec3 g = floor(d*260.0);
    float s = hash(g);
    float star = smoothstep(0.9975, 1.0, s) * uStars * (0.4+0.6*h);
    col += vec3(star)*vec3(0.9,0.94,1.0);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export const WEATHERS = {
  clear: { label: 'Clear', cloud: 0.05, fog: 0.00016, rain: 0, wet: 0, sunMul: 1.0, ambMul: 1.0, hazeMul: 1.0 },
  overcast: { label: 'Overcast', cloud: 0.85, fog: 0.00060, rain: 0, wet: 0.15, sunMul: 0.35, ambMul: 1.25, hazeMul: 0.5 },
  rain: { label: 'Rain', cloud: 1.0, fog: 0.00110, rain: 1, wet: 1.0, sunMul: 0.22, ambMul: 1.1, hazeMul: 0.35 },
  fog: { label: 'Fog', cloud: 0.6, fog: 0.00420, rain: 0, wet: 0.35, sunMul: 0.42, ambMul: 1.4, hazeMul: 0.2 },
};

export class Sky {
  constructor(scene, renderer, camera) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;

    this.hours = 8.5;         // 0..24
    this.dayLength = 24 * 60; // one in-game day = 24 real minutes
    this.paused = false;

    this.weather = 'clear';
    this.nextWeather = 'clear';
    this.weatherBlend = 1;
    this.weatherTimer = 180;
    this.wetness = 0;
    this.autoWeather = true;

    const geo = new THREE.SphereGeometry(1, 32, 20);
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x2f6ea8) },
      uHorizon: { value: new THREE.Color(0xbcd3e0) },
      uGround: { value: new THREE.Color(0x1a1c1f) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColour: { value: new THREE.Color(0xfff0d0) },
      uSunSize: { value: 1.0 },
      uStars: { value: 0.0 },
      uHaze: { value: 1.0 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = preset().shadows;
    const ss = preset().shadowSize;
    this.sun.shadow.mapSize.set(ss, ss);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    const ext = 120;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd8f0, 0x53504a, 0.85);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(this.ambient);

    scene.fog = new THREE.FogExp2(0xbcd3e0, 0.00016);

    this.buildRain();
    this.nightAmount = 0;
  }

  buildRain() {
    const n = preset().rainParticles;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const spd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 34;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
      spd[i] = 26 + Math.random() * 18;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainSpeeds = spd;
    this.rainGeo = geo;
    const mat = new THREE.PointsMaterial({
      color: 0xaecbdc, size: 0.11, transparent: true, opacity: 0.0,
      sizeAttenuation: true, depthWrite: false,
    });
    this.rainMat = mat;
    this.rain = new THREE.Points(geo, mat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  setWeather(name, instant = false) {
    if (!WEATHERS[name]) return;
    this.nextWeather = name;
    if (instant) { this.weather = name; this.weatherBlend = 1; }
    else this.weatherBlend = 0;
    this.weatherTimer = 220 + Math.random() * 260;
  }

  currentWeatherParams() {
    const a = WEATHERS[this.weather], b = WEATHERS[this.nextWeather];
    const t = this.weatherBlend;
    return {
      cloud: lerp(a.cloud, b.cloud, t),
      fog: lerp(a.fog, b.fog, t),
      rain: lerp(a.rain, b.rain, t),
      wet: lerp(a.wet, b.wet, t),
      sunMul: lerp(a.sunMul, b.sunMul, t),
      ambMul: lerp(a.ambMul, b.ambMul, t),
      hazeMul: lerp(a.hazeMul, b.hazeMul, t),
      label: t > 0.5 ? b.label : a.label,
    };
  }

  update(dt, cameraPos) {
    if (!this.paused) this.hours = (this.hours + (dt / this.dayLength) * 24) % 24;

    if (this.autoWeather) {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0 && this.weatherBlend >= 1) {
        const pool = ['clear', 'clear', 'clear', 'overcast', 'overcast', 'rain', 'fog'];
        this.setWeather(pool[Math.floor(Math.random() * pool.length)]);
      }
    }
    if (this.weatherBlend < 1) {
      this.weatherBlend = Math.min(1, this.weatherBlend + dt / 25);
      if (this.weatherBlend >= 1) this.weather = this.nextWeather;
    }
    const W = this.currentWeatherParams();

    // Sun position: rises roughly ENE, sets WNW.
    const ang = ((this.hours - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(ang);
    const azim = Math.cos(ang);
    const dir = new THREE.Vector3(azim * 0.85, elev, azim * 0.28 + 0.35).normalize();
    const night = clamp(-elev * 3.2 + 0.35, 0, 1);
    this.nightAmount = night;

    const isMoon = elev < -0.04;
    const sunDir = isMoon ? dir.clone().negate() : dir;
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uSunSize.value = isMoon ? 0.35 : 1.0;
    this.uniforms.uStars.value = clamp(night * 1.25 - 0.15, 0, 1) * (1 - W.cloud * 0.9);
    this.uniforms.uHaze.value = W.hazeMul;

    // Palette through the day.
    const dawn = clamp(1 - Math.abs(this.hours - 6.6) / 1.9, 0, 1);
    const dusk = clamp(1 - Math.abs(this.hours - 18.9) / 2.2, 0, 1);
    const golden = Math.max(dawn, dusk);

    const zenithDay = new THREE.Color(0x2c6fae);
    const zenithNight = new THREE.Color(0x050a16);
    const horizDay = new THREE.Color(0xc7dbe8);
    const horizNight = new THREE.Color(0x0d1826);
    const goldenC = new THREE.Color(0xff9a4a);

    const zen = zenithDay.clone().lerp(zenithNight, night);
    const hor = horizDay.clone().lerp(horizNight, night).lerp(goldenC, golden * 0.75);
    // Overcast flattens everything toward grey.
    const grey = new THREE.Color(0x9aa5ad).lerp(new THREE.Color(0x11151a), night);
    zen.lerp(grey, W.cloud * 0.8);
    hor.lerp(grey, W.cloud * 0.7);

    this.uniforms.uZenith.value.copy(zen);
    this.uniforms.uHorizon.value.copy(hor);
    this.uniforms.uGround.value.copy(hor).multiplyScalar(0.35);

    const sunColour = isMoon
      ? new THREE.Color(0xa8c0e0)
      : new THREE.Color(0xfff4dc).lerp(new THREE.Color(0xffb066), golden);
    this.uniforms.uSunColour.value.copy(sunColour);

    // Lights.
    const sunUp = Math.max(0, elev);
    this.sun.position.copy(sunDir).multiplyScalar(180).add(cameraPos);
    this.sun.target.position.copy(cameraPos);
    this.sun.target.updateMatrixWorld();
    this.sun.color.copy(sunColour);
    this.sun.intensity = (isMoon ? 0.28 : lerp(0.15, 3.1, Math.pow(sunUp, 0.6))) * W.sunMul;
    this.sun.castShadow = preset().shadows && this.sun.intensity > 0.22;

    this.hemi.intensity = lerp(1.05, 0.22, night) * W.ambMul;
    this.hemi.color.copy(hor).lerp(new THREE.Color(0xffffff), 0.25);
    this.hemi.groundColor.setHex(night > 0.5 ? 0x14161a : 0x5a564d);
    this.ambient.intensity = lerp(0.10, 0.30, night) * W.ambMul;

    // Fog matches the horizon so the world dissolves believably.
    const fogCol = hor.clone().lerp(new THREE.Color(0x0b1118), night * 0.55);
    this.scene.fog.color.copy(fogCol);
    this.scene.background = null;
    const base = 1 / Math.max(150, preset().drawDistance * 1.35);
    this.scene.fog.density = damp(this.scene.fog.density, Math.max(base * 0.55, W.fog), 1.6, dt);

    // Rain.
    const rainAmt = W.rain;
    this.rainMat.opacity = rainAmt * 0.55;
    this.rain.visible = rainAmt > 0.02;
    if (this.rain.visible) {
      const p = this.rainGeo.attributes.position;
      const arr = p.array;
      for (let i = 0; i < this.rainSpeeds.length; i++) {
        arr[i * 3 + 1] -= this.rainSpeeds[i] * dt;
        if (arr[i * 3 + 1] < -2) {
          arr[i * 3] = (Math.random() - 0.5) * 80;
          arr[i * 3 + 1] = 30 + Math.random() * 8;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 80;
        }
      }
      p.needsUpdate = true;
      this.rain.position.set(cameraPos.x, 0, cameraPos.z);
    }
    this.wetness = damp(this.wetness, W.wet, 0.25, dt);

    this.mesh.position.copy(cameraPos);
    this.mesh.scale.setScalar(Math.max(600, preset().drawDistance * 1.4));

    this.weatherLabel = W.label;
    return { night, wetness: this.wetness, weather: W.label };
  }

  setTime(h) { this.hours = ((h % 24) + 24) % 24; }
}
