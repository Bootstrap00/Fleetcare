import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Wireframe "radar core" with an orbiting distress ring and a particle field that follows the pointer.
export default function Hero3D() {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current; let raf, renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100); cam.position.z = 7;
      const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity });
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 3), mat(0x3df5ff, 0.32));
      const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), mat(0xffb800, 0.75));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.012, 8, 180), new THREE.MeshBasicMaterial({ color: 0xffb800 }));
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.008, 8, 180), new THREE.MeshBasicMaterial({ color: 0x3df5ff, transparent: true, opacity: 0.5 }));
      ring.rotation.x = Math.PI / 2.4; ring2.rotation.x = Math.PI / 1.8;
      const N = 900, pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const r = 3.4 + Math.random() * 6, a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1); pos.set([r * Math.sin(b) * Math.cos(a), r * Math.sin(b) * Math.sin(a), r * Math.cos(b)], i * 3); }
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.025, transparent: true, opacity: 0.8 }));
      const group = new THREE.Group(); group.add(core, inner, ring, ring2, pts); scene.add(group);
      let mx = 0, my = 0; const move = e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; };
      addEventListener('pointermove', move);
      const size = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); group.position.x = w > 900 ? 2.4 : 0; group.position.y = w > 900 ? 0 : 1.2; group.scale.setScalar(w > 900 ? 1 : 0.7); };
      size(); addEventListener('resize', size);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, clock = new THREE.Clock();
      const tick = () => {
        const t = clock.getElapsedTime();
        if (!reduce) { core.rotation.y = t * 0.15; core.rotation.x = t * 0.08; inner.rotation.y = -t * 0.3; ring.rotation.z = t * 0.2; ring2.rotation.z = -t * 0.12; pts.rotation.y = t * 0.02; }
        group.rotation.y += (mx * 0.9 - group.rotation.y) * 0.05; group.rotation.x += (my * 0.5 - group.rotation.x) * 0.05;
        renderer.render(scene, cam); raf = requestAnimationFrame(tick);
      };
      tick();
      return () => { cancelAnimationFrame(raf); removeEventListener('pointermove', move); removeEventListener('resize', size); renderer.dispose(); renderer.domElement.remove(); };
    } catch (e) { console.warn('WebGL unavailable, showing static background', e); }
  }, []);
  return <div ref={ref} className="hero3d" aria-hidden="true" />;
}
