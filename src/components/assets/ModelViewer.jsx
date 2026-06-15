import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { loadTextureBuffer } from '@/lib/textureLoader';
import ModelViewerSidebar from './ModelViewerSidebar';
import PoseEditor from './PoseEditor';
import { buildBindPoseMatrices, computePosedMatrices, skinVertices, getJointWorldPositions } from '@/lib/skeletonPoser';

const LIGHTING_PRESETS = {
  default: { name: 'Default', ambient: 0.6, dirIntensity: 0.9, dirPos: [5, 10, 7] },
  studio: { name: 'Studio', ambient: 0.4, dirIntensity: 1.2, dirPos: [3, 8, 5], fill: { intensity: 0.4, pos: [-5, 3, -3] } },
  warm: { name: 'Warm', ambient: 0.5, dirIntensity: 0.8, dirPos: [4, 8, 6], color: 0xfff0dd, ambientColor: 0xffe8cc },
  cool: { name: 'Cool', ambient: 0.5, dirIntensity: 0.8, dirPos: [4, 8, 6], color: 0xd4e5ff, ambientColor: 0xc8d8f0 },
  dramatic: { name: 'Dramatic', ambient: 0.15, dirIntensity: 1.5, dirPos: [2, 12, 4] },
  flat: { name: 'Flat', ambient: 1.0, dirIntensity: 0.1, dirPos: [0, 10, 0] },
};

/**
 * Enhanced 3D model viewer with:
 * - Large square preview with transparent background
 * - Rotation toggle
 * - Per-group visibility
 * - Per-group texture assignment (.texture / .tga / .dds)
 * - Skeleton visualization
 * - Transparent PNG screenshot
 *
 * Props:
 *   parsedMesh  — from casCodec  { meshes: [{ name, positions, normals, uvs, indices, numVertices, numFaces }] }
 *   skeletonData — optional, from ms3dCodec { vertices, groups, joints }
 */
/**
 * Build super-group hierarchy from MS3D group comments or by name prefix.
 * Group comment format: lines like "SuperGroupName\nMeshName\n0or1"
 * where 0 = random (optional in-game), 1 = always visible.
 * Returns: [{ superGroup, meshIndices: [idx], collapsed: false }]
 */
function buildSuperGroups(meshNames, groupComments) {
  const superGroupMap = new Map(); // superGroupName -> [{ meshIndex, flag }]

  if (groupComments?.length) {
    for (const gc of groupComments) {
      const lines = gc.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      // Typically: line 0 = super-group name, line 1 = mesh name, line 2 = 0 or 1
      const superName = lines[0] || 'Ungrouped';
      const flag = lines.length >= 3 ? parseInt(lines[lines.length - 1]) : -1;
      if (!superGroupMap.has(superName)) superGroupMap.set(superName, []);
      superGroupMap.get(superName).push({ meshIndex: gc.groupIndex, flag: isNaN(flag) ? -1 : flag });
    }
  } else {
    // Fallback: derive super-group from mesh name prefix (before last _ + digits)
    meshNames.forEach((name, idx) => {
      const match = name.match(/^(.+?)(?:_\d+)?$/);
      const superName = match ? match[1] : name;
      if (!superGroupMap.has(superName)) superGroupMap.set(superName, []);
      superGroupMap.get(superName).push({ meshIndex: idx, flag: -1 });
    });
  }

  // Build ordered array
  const result = [];
  for (const [superName, entries] of superGroupMap) {
    result.push({ superGroup: superName, entries });
  }
  return result;
}

export default function ModelViewer({ parsedMesh, skeletonData, groupComments, soloMeshIndex = -1, className = '' }) {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const groupRef = useRef(null);       // main rotation group
  const meshObjsRef = useRef([]);      // THREE.Mesh objects
  const skeletonObjRef = useRef(null); // skeleton line group
  const animIdRef = useRef(null);
  const isRotatingRef = useRef(true);
  const isDraggingRef = useRef(false);

  const lightsRef = useRef({ ambient: null, dir: null, fill: null });
  const bindPoseRef = useRef(null);       // { invBindMats, localMats, worldMats }
  const origPositionsRef = useRef([]);    // original mesh positions per group (for skinning reset)
  const bboxSizeRef = useRef(1);
  // Reusable buffers to avoid GC pressure during posing
  const posedWorldMatsRef = useRef(null); // reusable Matrix4 array
  const skinnedBufRef = useRef(null);     // reusable Float32Array for skinned positions
  const jointPosRef = useRef(null);       // reusable Vector3 array for joint positions
  const groupVertMapsRef = useRef([]);    // pre-computed per-group vertex index maps

  const [isRotating, setIsRotating] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showWireframe, setShowWireframe] = useState(true);
  const [lightingPreset, setLightingPreset] = useState('default');
  const [poseRotations, setPoseRotations] = useState({});  // { boneIdx: { rx, ry, rz } }
  const [sidebarTab, setSidebarTab] = useState('view');    // 'view' | 'pose'
  const [meshInfos, setMeshInfos] = useState([]); // [{ name, visible, textureFile }]
  const [hasSkeleton, setHasSkeleton] = useState(false);
  const [superGroups, setSuperGroups] = useState([]);

  // Keep ref in sync with state for animation loop
  useEffect(() => { isRotatingRef.current = isRotating; }, [isRotating]);

  // ── Build scene ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!parsedMesh?.meshes?.length || !mountRef.current) return;
    const el = mountRef.current;

    // Clean up previous — dispose all Three.js resources to prevent memory leaks
    if (rendererRef.current) {
      cancelAnimationFrame(animIdRef.current);
      // Dispose all mesh geometries, materials, and textures
      meshObjsRef.current.forEach(obj => {
        obj.geometry?.dispose();
        if (obj.material?.map) obj.material.map.dispose();
        if (obj.material?.normalMap) obj.material.normalMap.dispose();
        if (obj.material?.specularMap) obj.material.specularMap.dispose();
        obj.material?.dispose();
        obj.children.forEach(c => {
          c.geometry?.dispose();
          c.material?.dispose();
        });
      });
      meshObjsRef.current = [];
      if (skeletonObjRef.current) {
        skeletonObjRef.current.traverse(child => {
          child.geometry?.dispose();
          child.material?.dispose();
        });
        skeletonObjRef.current = null;
      }
      rendererRef.current.dispose();
      while (el.firstChild) el.removeChild(el.firstChild);
    }
    // Clear reusable buffers
    posedWorldMatsRef.current = null;
    skinnedBufRef.current = null;
    jointPosRef.current = null;
    groupVertMapsRef.current = [];

    const w = el.clientWidth || 600;
    const h = el.clientHeight || 600;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 10000);
    cameraRef.current = camera;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(5, 10, 7);
    scene.add(dir);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0);
    fillLight.position.set(-5, 3, -3);
    scene.add(fillLight);
    lightsRef.current = { ambient: ambientLight, dir, fill: fillLight };

    const mainGroup = new THREE.Group();
    scene.add(mainGroup);
    groupRef.current = mainGroup;

    const meshObjects = [];
    let bbox = new THREE.Box3();
    const infos = [];

    parsedMesh.meshes.forEach((mesh, index) => {
      const meshName = mesh.name || `Mesh_${index}`;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      geo.computeBoundingBox();

      const mat = new THREE.MeshPhongMaterial({
        color: 0x8899bb,
        wireframe: false,
        side: THREE.DoubleSide,
      });
      const obj = new THREE.Mesh(geo, mat);
      obj.name = meshName;
      mainGroup.add(obj);
      meshObjects.push(obj);
      if (geo.boundingBox) bbox.union(geo.boundingBox);

      // wireframe overlay
      const wf = new THREE.LineSegments(
        new THREE.WireframeGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x334466, opacity: 0.3, transparent: true })
      );
      wf.name = meshName + '_wire';
      obj.add(wf);

      infos.push({ name: meshName, visible: true, textureFile: null, normalMapFile: null, specularMapFile: null });
    });

    meshObjsRef.current = meshObjects;
    setMeshInfos(infos);

    // Build super-groups from comments or name prefix
    const meshNames = parsedMesh.meshes.map((m, i) => m.name || `Mesh_${i}`);
    setSuperGroups(buildSuperGroups(meshNames, groupComments));

    // Center & fit camera
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const bboxSize = bbox.getSize(new THREE.Vector3()).length();
    bboxSizeRef.current = bboxSize;
    camera.position.set(center.x, center.y, center.z + bboxSize * 1.5);
    camera.lookAt(center);

    // ── Skeleton + skinning setup ─────────────────────────────────────────
    const hasJoints = skeletonData?.joints?.length > 0;
    setHasSkeleton(hasJoints);

    // Store original positions for skinning
    origPositionsRef.current = parsedMesh.meshes.map(m => new Float32Array(m.positions));

    if (hasJoints) {
      const joints = skeletonData.joints;
      
      // Build bind pose matrices for skinning
      const bindPose = buildBindPoseMatrices(joints);
      bindPoseRef.current = bindPose;

      // Pre-allocate reusable buffers for posing (avoids GC pressure)
      posedWorldMatsRef.current = joints.map(() => new THREE.Matrix4());
      jointPosRef.current = joints.map(() => new THREE.Vector3());
      if (skeletonData.vertices?.length > 0) {
        skinnedBufRef.current = new Float32Array(skeletonData.vertices.length * 3);
      }

      // Pre-compute per-group vertex index maps (avoids rebuilding each pose tick)
      if (skeletonData.groups?.length > 0 && skeletonData.triangles?.length > 0) {
        groupVertMapsRef.current = skeletonData.groups.map(grp => {
          const vertSet = new Set();
          for (const ti of grp.triIndices) {
            const tri = skeletonData.triangles[ti];
            if (tri) { tri.vi.forEach(vi => vertSet.add(vi)); }
          }
          return [...vertSet].sort((a, b) => a - b);
        });
      } else {
        groupVertMapsRef.current = [];
      }

      // Build skeleton visualization
      const skelGroup = new THREE.Group();
      skelGroup.name = '__skeleton__';
      skelGroup.visible = false;

      const worldPositions = getJointWorldPositions(bindPose.worldMats);

      // Draw bones as lines — store references for later update
      const boneLines = [];
      const jointDots = [];
      for (let i = 0; i < joints.length; i++) {
        if (joints[i].parentIdx >= 0) {
          const pts = [worldPositions[joints[i].parentIdx], worldPositions[i]];
          const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 });
          const line = new THREE.Line(lineGeo, lineMat);
          line.userData = { boneIdx: i, parentIdx: joints[i].parentIdx };
          skelGroup.add(line);
          boneLines.push(line);
        }
        const dotGeo = new THREE.SphereGeometry(bboxSize * 0.008, 6, 6);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(worldPositions[i]);
        dot.userData = { boneIdx: i };
        skelGroup.add(dot);
        jointDots.push(dot);
      }

      skelGroup.userData = { boneLines, jointDots };
      mainGroup.add(skelGroup);
      skeletonObjRef.current = skelGroup;
    } else {
      bindPoseRef.current = null;
    }

    // Reset pose when loading new model
    setPoseRotations({});

    // ── Orbit controls ────────────────────────────────────────────────────
    let lastX = 0, lastY = 0;
    const onDown = (e) => { isDraggingRef.current = true; lastX = e.clientX; lastY = e.clientY; };
    const onUp = () => { isDraggingRef.current = false; };
    const onMove = (e) => {
      if (!isDraggingRef.current) return;
      mainGroup.rotation.y += (e.clientX - lastX) * 0.01;
      mainGroup.rotation.x += (e.clientY - lastY) * 0.01;
      lastX = e.clientX; lastY = e.clientY;
    };
    const onWheel = (e) => {
      camera.position.z = Math.max(bboxSize * 0.2, camera.position.z + e.deltaY * bboxSize * 0.001);
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    el.addEventListener('wheel', onWheel, { passive: true });

    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      if (isRotatingRef.current && !isDraggingRef.current) mainGroup.rotation.y += 0.003;
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const ro = new ResizeObserver(() => {
      const rw = el.clientWidth || 600;
      const rh = el.clientHeight || 600;
      renderer.setSize(rw, rh);
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(animIdRef.current);
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
      // Dispose all Three.js resources
      meshObjsRef.current.forEach(obj => {
        obj.geometry?.dispose();
        if (obj.material?.map) obj.material.map.dispose();
        if (obj.material?.normalMap) obj.material.normalMap.dispose();
        if (obj.material?.specularMap) obj.material.specularMap.dispose();
        obj.material?.dispose();
        obj.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose(); });
      });
      meshObjsRef.current = [];
      if (skeletonObjRef.current) {
        skeletonObjRef.current.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
        skeletonObjRef.current = null;
      }
      posedWorldMatsRef.current = null;
      skinnedBufRef.current = null;
      jointPosRef.current = null;
      groupVertMapsRef.current = [];
      renderer.dispose();
      while (el.firstChild) el.removeChild(el.firstChild);
    };
  }, [parsedMesh, skeletonData, groupComments]);

  // ── Skeleton visibility ─────────────────────────────────────────────────
  useEffect(() => {
    if (skeletonObjRef.current) skeletonObjRef.current.visible = showSkeleton;
  }, [showSkeleton]);

  // ── Solo mesh index (from external slider) ──────────────────────────────
  useEffect(() => {
    if (!meshObjsRef.current.length) return;
    meshObjsRef.current.forEach((obj, idx) => {
      const visible = soloMeshIndex === -1 || idx === soloMeshIndex;
      obj.visible = visible;
    });
    // Sync meshInfos state so sidebar reflects the change
    setMeshInfos(prev => prev.map((info, idx) => ({
      ...info,
      visible: soloMeshIndex === -1 || idx === soloMeshIndex,
    })));
  }, [soloMeshIndex]);

  // ── Apply pose (skin vertices + update skeleton vis) ───────────────────
  useEffect(() => {
    if (!skeletonData?.joints?.length || !bindPoseRef.current) return;
    const joints = skeletonData.joints;
    const { invBindMats } = bindPoseRef.current;

    // Reuse pre-allocated buffers to avoid GC pressure
    const posedWorldMats = computePosedMatrices(joints, poseRotations, posedWorldMatsRef.current);

    // Skin each mesh group's vertices using reusable buffer
    if (skeletonData.vertices?.length > 0) {
      const skinnedPositions = skinVertices(skeletonData.vertices, invBindMats, posedWorldMats, skinnedBufRef.current);

      // Distribute skinned positions back to per-group meshes using pre-computed vertex maps
      const vertMaps = groupVertMapsRef.current;
      if (vertMaps.length > 0 && parsedMesh?.meshes?.length > 0) {
        for (let gIdx = 0; gIdx < vertMaps.length; gIdx++) {
          const meshObj = meshObjsRef.current[gIdx];
          if (!meshObj) continue;
          const posAttr = meshObj.geometry.attributes.position;
          const uniqueVerts = vertMaps[gIdx];

          for (let ni = 0; ni < uniqueVerts.length && ni < posAttr.count; ni++) {
            const gi = uniqueVerts[ni];
            posAttr.setXYZ(ni, skinnedPositions[gi * 3], skinnedPositions[gi * 3 + 1], skinnedPositions[gi * 3 + 2]);
          }
          posAttr.needsUpdate = true;
        }
      }
    }

    // Update skeleton visualization
    if (skeletonObjRef.current) {
      const worldPositions = getJointWorldPositions(posedWorldMats, jointPosRef.current);
      const { jointDots, boneLines } = skeletonObjRef.current.userData;

      if (jointDots) {
        for (let i = 0; i < jointDots.length; i++) {
          const dot = jointDots[i];
          const bi = dot.userData.boneIdx;
          if (worldPositions[bi]) dot.position.copy(worldPositions[bi]);
        }
      }
      if (boneLines) {
        for (let i = 0; i < boneLines.length; i++) {
          const line = boneLines[i];
          const { boneIdx, parentIdx } = line.userData;
          const p0 = worldPositions[parentIdx];
          const p1 = worldPositions[boneIdx];
          if (p0 && p1) {
            // Update existing geometry in-place instead of dispose/recreate
            const posArr = line.geometry.attributes.position;
            if (posArr && posArr.count >= 2) {
              posArr.setXYZ(0, p0.x, p0.y, p0.z);
              posArr.setXYZ(1, p1.x, p1.y, p1.z);
              posArr.needsUpdate = true;
            } else {
              line.geometry.dispose();
              line.geometry = new THREE.BufferGeometry().setFromPoints([p0, p1]);
            }
          }
        }
      }
    }
  }, [poseRotations, skeletonData, parsedMesh]);

  // ── Lighting preset ──────────────────────────────────────────────────────
  useEffect(() => {
    const { ambient, dir, fill } = lightsRef.current;
    if (!ambient || !dir) return;
    const p = LIGHTING_PRESETS[lightingPreset] || LIGHTING_PRESETS.default;
    ambient.intensity = p.ambient;
    ambient.color.set(p.ambientColor || 0xffffff);
    dir.intensity = p.dirIntensity;
    dir.color.set(p.color || 0xffffff);
    dir.position.set(...p.dirPos);
    if (fill) {
      fill.intensity = p.fill?.intensity || 0;
      if (p.fill?.pos) fill.position.set(...p.fill.pos);
      fill.color.set(p.color || 0xffffff);
    }
  }, [lightingPreset]);

  // ── Wireframe visibility ────────────────────────────────────────────────
  useEffect(() => {
    meshObjsRef.current.forEach((obj, idx) => {
      // Only toggle wireframe overlay on meshes without a texture applied
      obj.children.forEach(c => {
        if (c.isLineSegments) {
          c.visible = showWireframe && !meshInfos[idx]?.textureFile;
        }
      });
    });
  }, [showWireframe, meshInfos]);

  // ── Mesh visibility ─────────────────────────────────────────────────────
  const handleToggleVisibility = useCallback((index) => {
    setMeshInfos(prev => {
      const next = [...prev];
      next[index] = { ...next[index], visible: !next[index].visible };
      if (meshObjsRef.current[index]) meshObjsRef.current[index].visible = next[index].visible;
      return next;
    });
  }, []);

  // ── Super-group visibility toggle ─────────────────────────────────────
  const handleToggleSuperGroup = useCallback((sgIndex) => {
    const sg = superGroups[sgIndex];
    if (!sg) return;
    // Determine target: if any mesh in group is visible, hide all; otherwise show all
    const anyVisible = sg.entries.some(e => meshInfos[e.meshIndex]?.visible);
    const newVisible = !anyVisible;
    setMeshInfos(prev => {
      const next = [...prev];
      for (const entry of sg.entries) {
        next[entry.meshIndex] = { ...next[entry.meshIndex], visible: newVisible };
        if (meshObjsRef.current[entry.meshIndex]) meshObjsRef.current[entry.meshIndex].visible = newVisible;
      }
      return next;
    });
  }, [superGroups, meshInfos]);

  // ── Texture assignment ──────────────────────────────────────────────────
  const handleTextureFile = useCallback(async (index, file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const buf = await file.arrayBuffer();
    const result = loadTextureBuffer(buf, ext);
    if (!result?.imageData) return;

    // Create Three.js texture from ImageData
    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    canvas.getContext('2d').putImageData(result.imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.needsUpdate = true;

    const obj = meshObjsRef.current[index];
    if (obj) {
      obj.material.map = tex;
      obj.material.color.set(0xffffff);
      obj.material.needsUpdate = true;
      // hide wireframe when textured
      obj.children.forEach(c => { if (c.isLineSegments) c.visible = false; });
    }

    setMeshInfos(prev => {
      const next = [...prev];
      next[index] = { ...next[index], textureFile: file.name };
      return next;
    });
  }, []);

  // ── Remove texture ──────────────────────────────────────────────────────
  const handleRemoveTexture = useCallback((index) => {
    const obj = meshObjsRef.current[index];
    if (obj) {
      if (obj.material.map) { obj.material.map.dispose(); obj.material.map = null; }
      obj.material.color.set(0x8899bb);
      obj.material.needsUpdate = true;
      obj.children.forEach(c => { if (c.isLineSegments) c.visible = true; });
    }
    setMeshInfos(prev => {
      const next = [...prev];
      next[index] = { ...next[index], textureFile: null };
      return next;
    });
  }, []);

  // ── Normal map assignment ───────────────────────────────────────────────
  const handleNormalMapFile = useCallback(async (index, file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const buf = await file.arrayBuffer();
    const result = loadTextureBuffer(buf, ext);
    if (!result?.imageData) return;

    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    canvas.getContext('2d').putImageData(result.imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.needsUpdate = true;

    const obj = meshObjsRef.current[index];
    if (obj) {
      if (obj.material.normalMap) obj.material.normalMap.dispose();
      obj.material.normalMap = tex;
      obj.material.needsUpdate = true;
    }
    setMeshInfos(prev => {
      const next = [...prev];
      next[index] = { ...next[index], normalMapFile: file.name };
      return next;
    });
  }, []);

  const handleRemoveNormalMap = useCallback((index) => {
    const obj = meshObjsRef.current[index];
    if (obj) {
      if (obj.material.normalMap) { obj.material.normalMap.dispose(); obj.material.normalMap = null; }
      obj.material.needsUpdate = true;
    }
    setMeshInfos(prev => {
      const next = [...prev];
      next[index] = { ...next[index], normalMapFile: null };
      return next;
    });
  }, []);

  // ── Specular map assignment ─────────────────────────────────────────────
  const handleSpecularMapFile = useCallback(async (index, file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const buf = await file.arrayBuffer();
    const result = loadTextureBuffer(buf, ext);
    if (!result?.imageData) return;

    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    canvas.getContext('2d').putImageData(result.imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.needsUpdate = true;

    const obj = meshObjsRef.current[index];
    if (obj) {
      if (obj.material.specularMap) obj.material.specularMap.dispose();
      obj.material.specularMap = tex;
      obj.material.specular = new THREE.Color(0x444444);
      obj.material.needsUpdate = true;
    }
    setMeshInfos(prev => {
      const next = [...prev];
      next[index] = { ...next[index], specularMapFile: file.name };
      return next;
    });
  }, []);

  const handleRemoveSpecularMap = useCallback((index) => {
    const obj = meshObjsRef.current[index];
    if (obj) {
      if (obj.material.specularMap) { obj.material.specularMap.dispose(); obj.material.specularMap = null; }
      obj.material.specular = new THREE.Color(0x111111);
      obj.material.needsUpdate = true;
    }
    setMeshInfos(prev => {
      const next = [...prev];
      next[index] = { ...next[index], specularMapFile: null };
      return next;
    });
  }, []);

  // ── Fix normals ──────────────────────────────────────────────────────────
  const handleFixNormals = useCallback(() => {
    meshObjsRef.current.forEach(obj => {
      const geo = obj.geometry;
      geo.computeVertexNormals();
      geo.attributes.normal.needsUpdate = true;
    });
  }, []);

  // ── Screenshot ──────────────────────────────────────────────────────────
  const handleScreenshot = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    // Force a render then grab canvas
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = 'model-screenshot.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleResetPose = useCallback(() => {
    setPoseRotations({});
  }, []);

  return (
    <div className={`flex ${className}`}>
      {/* Preview container */}
      <div className="flex-1 min-w-0 min-h-0 relative"
        style={{ background: 'repeating-conic-gradient(#1e293b 0% 25%, #0f172a 0% 50%) 0 0 / 16px 16px' }}>
        <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      </div>

      {/* Sidebar with tabs */}
      <div className="w-52 border-l border-slate-700 bg-slate-900 flex flex-col shrink-0">
        {/* Tab switcher */}
        {hasSkeleton && (
          <div className="flex border-b border-slate-700">
            <button
              onClick={() => setSidebarTab('view')}
              className={`flex-1 text-[11px] py-1.5 text-center transition-colors ${
                sidebarTab === 'view' ? 'bg-slate-800 text-blue-300 border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-200'
              }`}
            >View</button>
            <button
              onClick={() => setSidebarTab('pose')}
              className={`flex-1 text-[11px] py-1.5 text-center transition-colors ${
                sidebarTab === 'pose' ? 'bg-slate-800 text-yellow-300 border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-200'
              }`}
            >Pose</button>
          </div>
        )}

        {sidebarTab === 'view' ? (
          <ModelViewerSidebar
            isRotating={isRotating}
            onToggleRotation={() => setIsRotating(r => !r)}
            showSkeleton={showSkeleton}
            onToggleSkeleton={() => setShowSkeleton(s => !s)}
            hasSkeleton={hasSkeleton}
            showWireframe={showWireframe}
            onToggleWireframe={() => setShowWireframe(w => !w)}
            lightingPreset={lightingPreset}
            onLightingChange={setLightingPreset}
            lightingPresets={LIGHTING_PRESETS}
            onFixNormals={handleFixNormals}
            meshInfos={meshInfos}
            superGroups={superGroups}
            onToggleVisibility={handleToggleVisibility}
            onToggleSuperGroup={handleToggleSuperGroup}
            onTextureFile={handleTextureFile}
            onRemoveTexture={handleRemoveTexture}
            onNormalMapFile={handleNormalMapFile}
            onRemoveNormalMap={handleRemoveNormalMap}
            onSpecularMapFile={handleSpecularMapFile}
            onRemoveSpecularMap={handleRemoveSpecularMap}
            onScreenshot={handleScreenshot}
          />
        ) : (
          <PoseEditor
            joints={skeletonData?.joints || []}
            poseRotations={poseRotations}
            onPoseChange={setPoseRotations}
            onReset={handleResetPose}
          />
        )}
      </div>
    </div>
  );
}