import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import * as THREE from 'three';
import { Download, Plus, Trash2, ExternalLink, Search, Info, RefreshCw, X, Image, ChevronDown, CheckSquare, Square, Zap, FileText, AlertCircle, Box } from 'lucide-react';
import { parseEDU } from '../components/units/EDUParser';
import { parseCasFile, parseMeshFile } from '@/lib/casCodec';
import { textBlob, toCRLF } from '@/lib/lineEndings';
import { getEduRawText } from '@/lib/eduStorage';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'm2tw_unitcard_entries';
const EDU_PICKER_RENDER_LIMIT = 300;

export const POSE_PRESETS = [
  { id: 5,   label: 'Infantry — Standing (basic)',   category: 'infantry' },
  { id: 34,  label: 'Infantry — Archer ready',       category: 'infantry' },
  { id: 38,  label: 'Infantry — Eastern archer',     category: 'infantry' },
  { id: 43,  label: 'Infantry — Crossbowman',        category: 'infantry' },
  { id: 51,  label: 'Infantry — Spear + shield',     category: 'infantry' },
  { id: 66,  label: 'Infantry — Alt A',              category: 'infantry' },
  { id: 128, label: 'Infantry — Alt B',              category: 'infantry' },
  { id: 139, label: 'Infantry — Alt C',              category: 'infantry' },
  { id: 508, label: 'Infantry — Alt D',              category: 'infantry' },
  { id: 615, label: 'Infantry — Alt E',              category: 'infantry' },
  { id: 200, label: 'Cavalry — Mailed horse',        category: 'cavalry' },
  { id: 204, label: 'Cavalry — Heavy horse',         category: 'cavalry' },
  { id: 205, label: 'Cavalry — Fast pony',           category: 'cavalry' },
  { id: 210, label: 'Cavalry — Heavy armored horse', category: 'cavalry' },
  { id: 212, label: 'Cavalry — Light cavalry',       category: 'cavalry' },
  { id: 600, label: 'Boat (skipped by script)',      category: 'special' },
];

const DEFAULT_FACTIONS = [
  'england','france','hre','spain','portugal','milan','venice',
  'papal_states','sicily','egypt','moors','turks','byzantium',
  'russia','mongols','timurids','scotland','hungary','poland',
  'denmark','rebels','slave','mercs','normans','crusaders',
];

// ─── Smart defaults derived from a parsed EDU unit ────────────────────────────

/**
 * Given a full EDU unit object, pick the best pose ID based on category/class/attributes.
 * Cavalry → 200 (mailed horse default). Ships → 600. Archers/missiles → 34/43. Spear → 51.
 */
function smartPose(unit) {
  if (!unit) return 5;
  const cat = (unit.category || '').toLowerCase();
  const cls = (unit.class || '').toLowerCase();
  const attrs = (unit.attributes || []).map(a => a.toLowerCase());
  const priWeapon = (unit.stat_pri || '').toLowerCase();

  if (cat === 'ship') return 600;
  if (cat === 'cavalry') {
    const isMail  = (unit.soldier_model || '').toLowerCase().includes('mail');
    const isHeavy = cls === 'heavy';
    if (isHeavy && isMail) return 200;
    if (isHeavy) return 210;
    return 212;
  }
  // Missile infantry
  if (cls === 'missile') {
    if (priWeapon.includes('crossbow')) return 43;
    if (priWeapon.includes('eastern') || attrs.includes('eastern')) return 38;
    return 34;
  }
  if (attrs.includes('pike') || cls === 'spearmen' || attrs.includes('spear')) return 51;
  return 5;
}

/** First valid faction from ownership list, falling back to DEFAULT_FACTIONS[0]. */
function smartFaction(unit) {
  if (!unit) return DEFAULT_FACTIONS[0];
  const own = (unit.ownership || [])
    .map(f => String(f || '').trim().toLowerCase())
    .filter(Boolean);
  return own.find(f => f !== 'all' && f !== 'all_factions') || own[0] || DEFAULT_FACTIONS[0];
}

/** Derive model file stem from soldier_model field (M2TW convention is soldier_model = lod0 base). */
function smartModelFile(unit) {
  if (!unit) return '';
  return (unit.soldier_model || unit.type || '').toLowerCase().replace(/\s+/g, '_');
}

/** Generate a reasonable mount model name from mount field. */
function smartMountModel(unit) {
  if (!unit || !unit.mount) return '/';
  const m = unit.mount.toLowerCase().replace(/\s+/g, '_');
  // map common M2TW mount names to model naming convention
  if (m.includes('heavy_horse')) return 'mount_heavy_horse';
  if (m.includes('horse'))       return `mount_${m}`;
  if (m.includes('camel'))       return 'mount_camel';
  if (m.includes('elephant'))    return 'mount_elephant';
  return `mount_${m}`;
}

function sanitizeFactionFolder(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_/-]/g, '_')
    .replace(/^\/+|\/+$/g, '') || DEFAULT_FACTIONS[0];
}

function sanitizeCardName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]/g, '_') || 'unit_card';
}

/** Build a card entry with smart defaults from a full EDU unit. */
function entryFromUnit(unit) {
  const faction    = smartFaction(unit);
  const folder     = sanitizeFactionFolder(faction);
  const poseId     = smartPose(unit);
  const modelFile  = smartModelFile(unit);
  const isCavalry  = poseId >= 200 && poseId < 600;
  const factionAbbr = faction.slice(0, 2).toUpperCase();

  return {
    id: Date.now() + Math.floor(Math.random() * 99999),
    portraitFilename:       unit.type || '',
    game:                   'base',
    faction,
    poseId,
    additionalObject:        isCavalry ? smartMountModel(unit) : '/',
    additionalObjectTexture: isCavalry && unit.mount ? `${smartMountModel(unit)}_${faction}` : '/',
    modelFile,
    // Texture naming convention: {PREFIX}_{ModelName}_{faction}  (albedo)  and  {PREFIX}_{ModelName}_normal (pbr)
    mainTextureAlb: `${factionAbbr}_${modelFile}_${faction}`,
    mainTexturePbr: `${factionAbbr}_${modelFile}_normal`,
    attachTextureAlb: '',
    attachTexturePbr: '',
    outputDir: folder,
    visibleModels: '',
    // Store EDU metadata for display in the panel
    _eduCategory: unit.category || '',
    _eduClass: unit.class || '',
    _eduOwnership: (unit.ownership || []).join(', '),
    _eduMount: unit.mount || '',
    _eduSoldierNum: unit.soldier_num || 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFactionList() {
  try {
    const raw = localStorage.getItem('m2tw_factions_raw') || sessionStorage.getItem('m2tw_factions_raw');
    if (!raw) return DEFAULT_FACTIONS;
    const matches = [...raw.matchAll(/^faction\s+(\S+)/gm)].map(m => m[1]).filter(Boolean);
    return matches.length > 0 ? matches : DEFAULT_FACTIONS;
  } catch { return DEFAULT_FACTIONS; }
}

function loadEduUnits() {
  try {
    const raw = getEduRawText();
    if (!raw) return [];
    return parseEDU(raw);
  } catch { return []; }
}

function isCavalryPose(poseId) {
  return Number(poseId) >= 200 && Number(poseId) < 600;
}

function newEntry() {
  return {
    id: Date.now() + Math.floor(Math.random() * 10000),
    portraitFilename: '', game: 'base', faction: 'england', poseId: 5,
    additionalObject: '/', additionalObjectTexture: '/',
    modelFile: '', mainTextureAlb: '', mainTexturePbr: '',
    attachTextureAlb: '', attachTexturePbr: '',
    outputDir: 'england', visibleModels: '',
  };
}

function serializeInputFile(entries) {
  return entries.map((e, idx) => {
    const cols = [
      idx + 1,
      '#' + e.portraitFilename,
      e.game,
      e.faction,
      e.poseId,
      e.additionalObject || '/',
      e.additionalObjectTexture || '/',
      e.modelFile,
      e.mainTextureAlb,
      e.mainTexturePbr,
      e.attachTextureAlb,
      e.attachTexturePbr,
      sanitizeFactionFolder(e.outputDir || e.faction),
    ];
    if (e.visibleModels && e.visibleModels.trim()) {
      cols.push(...e.visibleModels.trim().split(/\s+/));
    }
    return cols.join('\t') + '\t';
  }).join('\n');
}

function buildUiFolderPlan(entries) {
  const folders = new Set();
  const rows = [];
  for (const entry of entries) {
    const faction = sanitizeFactionFolder(entry.outputDir || entry.faction);
    const card = sanitizeCardName(entry.portraitFilename);
    folders.add(faction);
    rows.push({
      faction,
      unitCard: `data/ui/units/${faction}/${card}.tga`,
      infoCard: `data/ui/unit_info/${faction}/${card}_info.tga`,
    });
  }
  return { folders: [...folders].sort(), rows };
}

function downloadText(content, filename) {
  const blob = textBlob(content);
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function encodeCardTga(imageData) {
  const { width, height, data } = imageData;
  const out = new Uint8Array(18 + width * height * 4);
  out[2] = 2;
  out[12] = width & 255; out[13] = width >> 8;
  out[14] = height & 255; out[15] = height >> 8;
  out[16] = 32; out[17] = 0x28;
  let p = 18;
  for (let i = 0; i < data.length; i += 4) {
    out[p++] = data[i + 2];
    out[p++] = data[i + 1];
    out[p++] = data[i];
    out[p++] = data[i + 3];
  }
  return out;
}

function encodeCardDds(imageData) {
  const { width, height, data } = imageData;
  const out = new Uint8Array(128 + width * height * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x20534444, true);
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x0002100f, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(20, width * 4, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 0x41, true);
  view.setUint32(88, 32, true);
  view.setUint32(92, 0x00ff0000, true);
  view.setUint32(96, 0x0000ff00, true);
  view.setUint32(100, 0x000000ff, true);
  view.setUint32(104, 0xff000000, true);
  view.setUint32(108, 0x1000, true);
  let p = 128;
  for (let i = 0; i < data.length; i += 4) {
    out[p++] = data[i + 2];
    out[p++] = data[i + 1];
    out[p++] = data[i];
    out[p++] = data[i + 3];
  }
  return out;
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), type));
}

function drawVanillaCardBackground(ctx, width, height, background) {
  if (background) {
    const scale = Math.max(width / background.width, height / background.height);
    const w = background.width * scale;
    const h = background.height * scale;
    ctx.drawImage(background, (width - w) / 2, (height - h) / 2, w, h);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#7f8d95');
    sky.addColorStop(0.45, '#4b5554');
    sky.addColorStop(0.46, '#5e563d');
    sky.addColorStop(1, '#1d1a12');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 226, 150, 0.18)';
    ctx.fillRect(0, Math.round(height * 0.48), width, Math.max(1, Math.round(height * 0.03)));
  }
  const vignette = ctx.createRadialGradient(width * 0.50, height * 0.44, width * 0.18, width * 0.50, height * 0.44, width * 0.82);
  vignette.addColorStop(0, 'rgba(255,255,255,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.52)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = Math.max(1, Math.round(width * 0.035));
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);
  ctx.strokeStyle = '#b59a52';
  ctx.lineWidth = Math.max(1, Math.round(width * 0.014));
  ctx.strokeRect(ctx.lineWidth + 1, ctx.lineWidth + 1, width - (ctx.lineWidth + 1) * 2, height - (ctx.lineWidth + 1) * 2);
}

function uniqueSorted(values) {
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function extractAsciiStrings(buffer, minLength = 4) {
  const bytes = new Uint8Array(buffer);
  const strings = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const value = i < bytes.length ? bytes[i] : 0;
    const printable = value >= 32 && value <= 126;
    if (printable && start < 0) start = i;
    if ((!printable || i === bytes.length) && start >= 0) {
      if (i - start >= minLength) {
        strings.push(new TextDecoder('latin1').decode(bytes.slice(start, i)));
      }
      start = -1;
    }
  }
  return strings;
}

function parseAnimationListText(text) {
  return uniqueSorted(String(text || '').split(/\r?\n/).map(line => line.replace(/;.*$/, '').trim()));
}

function parseSkeletonIndexBuffer(buffer) {
  return uniqueSorted(extractAsciiStrings(buffer, 5).filter(value => /^fs_|^strat_|pole|flag|standard/i.test(value)));
}

function parseAnimationPackIndex(buffer) {
  return uniqueSorted(extractAsciiStrings(buffer, 8)
    .filter(value => /\.cas$/i.test(value) || /data\/animations\//i.test(value))
    .map(value => value.replace(/\\/g, '/')));
}

function animationLabel(path) {
  return String(path || '').replace(/^data\/animations\//i, '').replace(/\.cas$/i, '');
}

function suggestSkeletonForModel(modelName, skeletons) {
  const name = String(modelName || '').toLowerCase();
  const candidates = [
    [/(dog|hound|wardog|war_dog)/, 'fs_dog'],
    [/(pig)/, 'fs_pig'],
    [/(camel)/, 'fs_camel'],
    [/(elephant)/, 'fs_african_elephant'],
    [/(horse|cavalry|cataphract|mounted)/, 'fs_horse'],
    [/(archer|bow)/, 'fs_archer'],
    [/(javelin|peltast)/, 'fs_javelinman'],
    [/(slinger)/, 'fs_slinger_new'],
    [/(spear|hoplite|phalanx|pike)/, 'fs_spearman'],
    [/(2h|twohand|two_hand|berserker)/, 'fs_2handed'],
  ];
  for (const [pattern, skeleton] of candidates) {
    if (pattern.test(name) && skeletons.includes(skeleton)) return skeleton;
  }
  return skeletons.includes('fs_swordsman') ? 'fs_swordsman' : (skeletons[0] || '');
}

function CasUnitCardStudio() {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const groupRef = useRef(null);
  const cardRef = useRef(null);
  const [model, setModel] = useState(null);
  const [background, setBackground] = useState(null);
  const [animationPack, setAnimationPack] = useState({ files: [], skeletons: [], animations: [] });
  const [animationSearch, setAnimationSearch] = useState('');
  const [status, setStatus] = useState('Load a .cas or .mesh model, optionally load a background, then export RTW-style card files.');
  const [settings, setSettings] = useState({
    name: 'unit_card',
    width: 48,
    height: 64,
    modelScale: 92,
    modelX: 0,
    modelY: 2,
    yaw: -28,
    pitch: 8,
    roll: 0,
    material: '#d7c7a2',
    shadow: true,
    stamp: true,
    skeleton: '',
    animation: '',
  });

  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const loadModel = async (file) => {
    const buffer = await file.arrayBuffer();
    const ext = file.name.split('.').pop().toLowerCase();
    const parsed = ext === 'mesh' ? parseMeshFile(buffer) : parseCasFile(buffer);
    if (!parsed?.meshes?.length) throw new Error(parsed?.errors?.join('\n') || 'No mesh data found.');
    setModel({ name: file.name, parsed });
    setSettings(prev => {
      const skeleton = prev.skeleton || suggestSkeletonForModel(file.name, animationPack.skeletons);
      return { ...prev, name: sanitizeCardName(file.name.replace(/\.(cas|mesh)$/i, '')), skeleton };
    });
    setStatus(`Loaded ${file.name}: ${parsed.meshes.length} group${parsed.meshes.length === 1 ? '' : 's'}.`);
  };

  const handleModelInput = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { await loadModel(file); } catch (err) { setStatus(`Model load failed: ${err.message}`); }
  };

  const handleBackground = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      setBackground({ name: file.name, bitmap });
      setStatus(`Loaded background ${file.name}.`);
    } catch (err) {
      setStatus(`Background load failed: ${err.message}`);
    }
  };

  const handleAnimationPack = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    try {
      const loadedFiles = [];
      let skeletons = [];
      let animations = [];
      for (const file of files) {
        const name = file.name.toLowerCase();
        loadedFiles.push({ name: file.name, size: file.size });
        if (name === 'list.txt') {
          skeletons.push(...parseAnimationListText(await file.text()));
        } else if (name === 'skeletons.idx') {
          skeletons.push(...parseSkeletonIndexBuffer(await file.arrayBuffer()));
        } else if (name === 'pack.idx') {
          animations.push(...parseAnimationPackIndex(await file.arrayBuffer()));
        }
      }
      skeletons = uniqueSorted(skeletons);
      animations = uniqueSorted(animations);
      setAnimationPack({ files: loadedFiles, skeletons, animations });
      setSettings(prev => ({
        ...prev,
        skeleton: prev.skeleton || suggestSkeletonForModel(model?.name || prev.name, skeletons),
        animation: prev.animation || animations.find(path => /stand|idle/i.test(path)) || animations[0] || '',
      }));
      setStatus(`Loaded animation pack references: ${skeletons.length} skeletons, ${animations.length} animation CAS entries, ${loadedFiles.length} files.`);
    } catch (err) {
      setStatus(`Animation pack load failed: ${err.message}`);
    }
  };

  const exportAnimationAssignment = () => {
    const safe = sanitizeCardName(settings.name);
    const text = [
      'RTW unit card skeleton/animation assignment',
      '',
      `Model: ${model?.name || ''}`,
      `Card: ${safe}`,
      `Skeleton: ${settings.skeleton || ''}`,
      `Animation: ${settings.animation || ''}`,
      `Animation label: ${animationLabel(settings.animation)}`,
      '',
      'Loaded files:',
      ...animationPack.files.map(file => `- ${file.name}\t${Math.ceil(file.size / 1024)} KB`),
      '',
      'Notes:',
      '- This assignment is for the CAS card studio and Blender/unit-card workflow.',
      '- The browser preview uses the static CAS mesh plus manual pose controls; RTW pack.dat/aninterp.cache are kept as source references.',
    ].join('\n');
    downloadText(toCRLF(text), `${safe}_animation_assignment.txt`);
  };

  useEffect(() => {
    if (!model || !mountRef.current) return undefined;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(512, 512);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    mountRef.current.replaceChildren(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 10000);
    const group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.AmbientLight(0xfff1d0, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(4, 7, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa8c8ff, 0.42);
    fill.position.set(-5, 3, 2);
    scene.add(fill);

    const material = new THREE.MeshPhongMaterial({
      color: settings.material,
      shininess: 18,
      specular: 0x383226,
      side: THREE.DoubleSide,
    });

    let box = new THREE.Box3();
    for (const mesh of model.parsed.meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      geo.computeBoundingBox();
      const obj = new THREE.Mesh(geo, material.clone());
      group.add(obj);
      box.union(geo.boundingBox);
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    group.position.set(-center.x, -center.y, -center.z);
    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.25 / maxAxis;
    group.scale.setScalar(scale);
    camera.position.set(0, size.y * scale * 0.18, 4.4);
    camera.lookAt(0, 0.1, 0);
    sceneRef.current = scene;
    cameraRef.current = camera;
    groupRef.current = group;

    return () => {
      renderer.dispose();
      scene.traverse(obj => {
        obj.geometry?.dispose?.();
        obj.material?.dispose?.();
      });
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      groupRef.current = null;
    };
  }, [model]);

  const renderCard = useCallback(() => {
    const canvas = cardRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const group = groupRef.current;
    if (!canvas || !renderer || !scene || !camera || !group) return null;
    const width = Math.max(24, Math.min(512, Number(settings.width) || 48));
    const height = Math.max(32, Math.min(768, Number(settings.height) || 64));
    canvas.width = width;
    canvas.height = height;
    group.rotation.set(
      THREE.MathUtils.degToRad(Number(settings.pitch) || 0),
      THREE.MathUtils.degToRad(Number(settings.yaw) || 0),
      THREE.MathUtils.degToRad(Number(settings.roll) || 0),
    );
    group.traverse(obj => {
      if (obj.isMesh && obj.material?.color) obj.material.color.set(settings.material || '#d7c7a2');
    });
    renderer.render(scene, camera);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    drawVanillaCardBackground(ctx, width, height, background?.bitmap);
    if (settings.shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(width * 0.5, height * 0.83, width * 0.28, height * 0.055, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const modelSide = Math.max(width, height) * (Number(settings.modelScale) || 92) / 100;
    const x = (width - modelSide) / 2 + (Number(settings.modelX) || 0);
    const y = height * 0.10 + (Number(settings.modelY) || 0);
    ctx.drawImage(renderer.domElement, x, y, modelSide, modelSide);
    if (settings.stamp && width >= 96) {
      ctx.font = `${Math.max(7, Math.round(width * 0.035))}px serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(244, 225, 170, 0.55)';
      ctx.fillText('REX BY ATREUS ONLY', width / 2, height - Math.max(4, Math.round(height * 0.025)));
    }
    return canvas;
  }, [background, settings]);

  useEffect(() => { renderCard(); }, [renderCard, model]);

  const exportCards = async () => {
    const canvas = renderCard();
    if (!canvas) {
      setStatus('Load a model first.');
      return;
    }
    const safe = sanitizeCardName(settings.name);
    const imageData = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    const zip = new JSZip();
    zip.file(`${safe}.tga`, encodeCardTga(imageData));
    zip.file(`${safe}.dds`, encodeCardDds(imageData));
    const png = await canvasToBlob(canvas, 'image/png');
    if (png) zip.file(`${safe}.png`, png);
    zip.file('unit_card_render_report.txt', toCRLF([
      `Model: ${model?.name || ''}`,
      `Background: ${background?.name || 'generated vanilla-style gradient'}`,
      `Size: ${canvas.width}x${canvas.height}`,
      `Pose: yaw ${settings.yaw}, pitch ${settings.pitch}, roll ${settings.roll}`,
      `Skeleton: ${settings.skeleton || ''}`,
      `Animation: ${settings.animation || ''}`,
      'Outputs: .tga, .dds, .png',
    ].join('\n')));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safe}_unit_card.zip`);
    setStatus(`Exported ${safe}_unit_card.zip.`);
  };

  const animationOptions = useMemo(() => {
    const q = animationSearch.trim().toLowerCase();
    const list = q
      ? animationPack.animations.filter(path => path.toLowerCase().includes(q))
      : animationPack.animations;
    return list.slice(0, 160);
  }, [animationPack.animations, animationSearch]);

  return (
    <div className="grid grid-cols-[300px_1fr_240px] gap-3 p-3 bg-slate-950/60">
      <div className="space-y-2">
        <label className="block rounded border border-slate-700 bg-slate-900 p-2 cursor-pointer hover:border-amber-500/60">
          <input type="file" accept=".cas,.mesh" className="hidden" onChange={handleModelInput} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><Box className="w-3.5 h-3.5 text-amber-400" />Load .cas/.mesh model</span>
        </label>
        <label className="block rounded border border-slate-700 bg-slate-900 p-2 cursor-pointer hover:border-amber-500/60">
          <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handleBackground} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><Image className="w-3.5 h-3.5 text-amber-400" />Load background image</span>
        </label>
        <label className="block rounded border border-slate-700 bg-slate-900 p-2 cursor-pointer hover:border-amber-500/60">
          <input type="file" accept=".txt,.idx,.dat,.cache" multiple webkitdirectory="" className="hidden" onChange={handleAnimationPack} />
          <span className="flex items-center gap-2 text-xs text-slate-200"><FileText className="w-3.5 h-3.5 text-amber-400" />Load animation pack folder</span>
          <span className="block mt-1 text-[9px] text-slate-500">Reads list.txt, skeletons.idx, pack.idx and records .dat/.cache references.</span>
        </label>
        {(animationPack.skeletons.length > 0 || animationPack.animations.length > 0) && (
          <div className="rounded border border-slate-700 bg-slate-900/60 p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase text-slate-500">Skeleton / Animation</span>
              <span className="text-[9px] text-slate-600">{animationPack.files.length} files</span>
            </div>
            <label className="block">
              <span className="text-[9px] text-slate-500">Skeleton</span>
              <select value={settings.skeleton} onChange={e => update('skeleton', e.target.value)}
                className="w-full h-7 mt-1 px-1 text-[10px] bg-slate-950 border border-slate-700 rounded text-slate-200">
                <option value="">-- none --</option>
                {animationPack.skeletons.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[9px] text-slate-500">Filter animations</span>
              <input value={animationSearch} onChange={e => setAnimationSearch(e.target.value)}
                placeholder="stand, idle, attack..."
                className="w-full h-7 mt-1 px-2 text-[10px] bg-slate-950 border border-slate-700 rounded text-slate-200 placeholder-slate-600" />
            </label>
            <label className="block">
              <span className="text-[9px] text-slate-500">Animation CAS</span>
              <select value={settings.animation} onChange={e => update('animation', e.target.value)}
                className="w-full h-7 mt-1 px-1 text-[10px] bg-slate-950 border border-slate-700 rounded text-slate-200">
                <option value="">-- none --</option>
                {animationOptions.map(path => <option key={path} value={path}>{animationLabel(path)}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-1">
              <Button variant="outline" className="h-7 text-[10px]" onClick={() => update('skeleton', suggestSkeletonForModel(model?.name || settings.name, animationPack.skeletons))}>
                Suggest
              </Button>
              <Button variant="outline" className="h-7 text-[10px]" onClick={exportAnimationAssignment} disabled={!settings.skeleton && !settings.animation}>
                Export assign
              </Button>
            </div>
            {animationPack.animations.length > animationOptions.length && (
              <p className="text-[9px] text-slate-600">Showing {animationOptions.length}/{animationPack.animations.length}; filter to narrow.</p>
            )}
          </div>
        )}
        <label className="block">
          <span className="text-[9px] uppercase text-slate-500">Card filename</span>
          <input value={settings.name} onChange={e => update('name', e.target.value)} className="w-full h-7 mt-1 px-2 text-[11px] font-mono bg-slate-900 border border-slate-700 rounded" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {['width', 'height'].map(key => (
            <label key={key} className="block">
              <span className="text-[9px] uppercase text-slate-500">{key}</span>
              <input type="number" min="24" max="768" value={settings[key]} onChange={e => update(key, e.target.value)} className="w-full h-7 mt-1 px-2 text-[11px] bg-slate-900 border border-slate-700 rounded" />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-slate-300">
          <input type="checkbox" checked={settings.stamp} onChange={e => update('stamp', e.target.checked)} className="accent-amber-500" />
          REX BY ATREUS ONLY stamp on larger cards
        </label>
        <Button className="w-full h-8 text-xs gap-1.5" onClick={exportCards} disabled={!model}>
          <Download className="w-3.5 h-3.5" />
          Export TGA/DDS/PNG
        </Button>
        <p className="text-[11px] text-amber-300 whitespace-pre-wrap">{status}</p>
      </div>
      <div className="rounded border border-slate-700 bg-black/40 grid place-items-center min-h-[260px] overflow-hidden">
        <canvas ref={cardRef} className="max-h-[360px] max-w-full image-render-pixelated" style={{ width: 'auto', height: 'auto' }} />
      </div>
      <div className="space-y-2">
        {[
          ['modelScale', 'Scale', 30, 180],
          ['modelX', 'X', -80, 80],
          ['modelY', 'Y', -80, 80],
          ['yaw', 'Yaw', -180, 180],
          ['pitch', 'Pitch', -90, 90],
          ['roll', 'Roll', -90, 90],
        ].map(([key, label, min, max]) => (
          <label key={key} className="block">
            <span className="text-[9px] uppercase text-slate-500 flex justify-between"><span>{label}</span><span>{settings[key]}</span></span>
            <input type="range" min={min} max={max} value={settings[key]} onChange={e => update(key, e.target.value)} className="w-full accent-amber-500" />
          </label>
        ))}
        <label className="block">
          <span className="text-[9px] uppercase text-slate-500">Model material</span>
          <input type="color" value={settings.material} onChange={e => update('material', e.target.value)} className="w-full h-8 mt-1 bg-slate-900 border border-slate-700 rounded" />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-slate-300">
          <input type="checkbox" checked={settings.shadow} onChange={e => update('shadow', e.target.checked)} className="accent-amber-500" />
          Ground shadow
        </label>
      </div>
      <div ref={mountRef} className="fixed -left-[9999px] top-0 w-[512px] h-[512px] pointer-events-none opacity-0" />
    </div>
  );
}

// ─── Entry Form ───────────────────────────────────────────────────────────────

function EntryForm({ entry, factions, onSave, onCancel }) {
  const [d, setD] = useState({ ...entry });
  const set = (k, v) => setD(prev => ({ ...prev, [k]: v }));
  const cavalry = isCavalryPose(d.poseId);

  const handleFactionChange = (faction) => {
    set('faction', faction);
    if (!d.outputDir || d.outputDir === sanitizeFactionFolder(d.faction)) {
      set('outputDir', sanitizeFactionFolder(faction));
    }
  };

  return (
    <div className="space-y-2 text-[11px]">
      {/* EDU info badge */}
      {d._eduCategory && (
        <div className="flex flex-wrap gap-1 pb-1 border-b border-slate-700/40">
          <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-[9px] text-slate-400 font-mono">{d._eduCategory}</span>
          <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-[9px] text-slate-400 font-mono">{d._eduClass}</span>
          {d._eduMount && <span className="px-1.5 py-0.5 rounded bg-amber-900/40 text-[9px] text-amber-300 font-mono">🐴 {d._eduMount}</span>}
          {d._eduSoldierNum > 0 && <span className="px-1.5 py-0.5 rounded bg-slate-700/60 text-[9px] text-slate-500 font-mono">{d._eduSoldierNum} men</span>}
        </div>
      )}

      {/* Portrait filename */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Portrait Filename</p>
        <div className="flex items-center">
          <span className="h-6 px-1.5 bg-slate-700/60 border border-r-0 border-slate-600/40 rounded-l text-slate-400 flex items-center">#</span>
          <input value={d.portraitFilename} onChange={e => set('portraitFilename', e.target.value)}
            placeholder="unit_name"
            className="flex-1 h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded-r text-slate-200 font-mono" />
        </div>
      </div>

      {/* Game + Faction */}
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <p className="text-[9px] text-slate-500 mb-0.5">Game</p>
          <select value={d.game} onChange={e => set('game', e.target.value)}
            className="w-full h-6 px-1 bg-slate-800 border border-slate-600/40 rounded text-slate-200">
            <option>base</option><option>kingdoms</option>
          </select>
        </div>
        <div>
          <p className="text-[9px] text-slate-500 mb-0.5">Faction</p>
          <select value={d.faction} onChange={e => handleFactionChange(e.target.value)}
            className="w-full h-6 px-1 bg-slate-800 border border-slate-600/40 rounded text-slate-200">
            {factions.map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>

      {/* Pose */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Pose ID</p>
        <div className="flex gap-1.5">
          <select value={d.poseId} onChange={e => set('poseId', parseInt(e.target.value))}
            className="flex-1 h-6 px-1 bg-slate-800 border border-slate-600/40 rounded text-slate-200 text-[10px]">
            {POSE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input type="number" value={d.poseId} onChange={e => set('poseId', parseInt(e.target.value) || 5)}
            className="w-14 h-6 px-1 bg-slate-800 border border-slate-600/40 rounded text-slate-400 font-mono text-center" />
        </div>
        {cavalry && <p className="text-[8px] text-amber-400 mt-0.5">⚠ Cavalry pose — fill mount fields below</p>}
      </div>

      {/* Model file */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Model File <span className="text-slate-600">(without _lod0 suffix)</span></p>
        <input value={d.modelFile} onChange={e => set('modelFile', e.target.value)}
          placeholder="peasant_crossbowmen"
          className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
      </div>

      {/* Mount (cavalry) */}
      {cavalry ? (
        <div>
          <p className="text-[9px] text-amber-400 uppercase font-semibold mb-1">Mount (Additional Object)</p>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <p className="text-[9px] text-slate-500 mb-0.5">Mount Model</p>
              <input value={d.additionalObject} onChange={e => set('additionalObject', e.target.value)}
                placeholder="mount_heavy_horse"
                className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
            </div>
            <div>
              <p className="text-[9px] text-slate-500 mb-0.5">Mount Texture</p>
              <input value={d.additionalObjectTexture} onChange={e => set('additionalObjectTexture', e.target.value)}
                placeholder="heavy_horse_england"
                className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <div className="flex-1">
            <p className="text-[9px] text-slate-500 mb-0.5">Additional Object</p>
            <input value={d.additionalObject} onChange={e => set('additionalObject', e.target.value)}
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
          </div>
          <div className="flex-1">
            <p className="text-[9px] text-slate-500 mb-0.5">Add. Object Texture</p>
            <input value={d.additionalObjectTexture} onChange={e => set('additionalObjectTexture', e.target.value)}
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
          </div>
        </div>
      )}

      {/* Main textures */}
      <div>
        <p className="text-[9px] text-slate-500 uppercase font-semibold mb-1">Main Textures <span className="text-slate-600 normal-case">(body / armour)</span></p>
        <div className="space-y-1">
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">Albedo (faction-coloured)</p>
            <input value={d.mainTextureAlb} onChange={e => set('mainTextureAlb', e.target.value)}
              placeholder="EN_Peasant_Padded_england"
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
          </div>
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">PBR / Normal map</p>
            <input value={d.mainTexturePbr} onChange={e => set('mainTexturePbr', e.target.value)}
              placeholder="EN_Peasant_Padded_normal"
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
          </div>
        </div>
      </div>

      {/* Attach textures */}
      <div>
        <p className="text-[9px] text-slate-500 uppercase font-semibold mb-1">Attach Textures <span className="text-slate-600 normal-case">(shield / weapon)</span></p>
        <div className="space-y-1">
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">Albedo _diff</p>
            <input value={d.attachTextureAlb} onChange={e => set('attachTextureAlb', e.target.value)}
              placeholder="shield_heater_england_diff"
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
          </div>
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">PBR _norm</p>
            <input value={d.attachTexturePbr} onChange={e => set('attachTexturePbr', e.target.value)}
              placeholder="shield_heater_england_norm"
              className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[10px]" />
          </div>
        </div>
      </div>

      {/* Output dir */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Output Directory</p>
        <input value={d.outputDir} onChange={e => set('outputDir', e.target.value)}
          placeholder={d.faction}
          className="w-full h-6 px-1.5 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono" />
      </div>

      {/* Visible models */}
      <div>
        <p className="text-[9px] text-slate-500 mb-0.5">Visible Models <span className="text-slate-600">(optional, space-separated)</span></p>
        <textarea value={d.visibleModels} onChange={e => set('visibleModels', e.target.value)} rows={2}
          placeholder="Arms__Arms__1 Body__Body__03 Helmet__Object01 ..."
          className="w-full px-1.5 py-1 bg-slate-800 border border-slate-600/40 rounded text-slate-200 font-mono text-[9px] resize-y placeholder-slate-600" />
      </div>

      <div className="flex gap-1.5 justify-end pt-1 border-t border-slate-700/40">
        <button onClick={onCancel} className="px-2 py-1 text-[10px] rounded border border-slate-700/40 text-slate-400 hover:text-slate-200">Cancel</button>
        <button onClick={() => onSave(d)}
          className="px-3 py-1 text-[10px] rounded bg-amber-600/80 hover:bg-amber-600 text-slate-900 font-semibold">Save Entry</button>
      </div>
    </div>
  );
}

// ─── EDU Unit Picker Panel ─────────────────────────────────────────────────────

function EduPickerPanel({ eduUnits, existingPortraits, onImport, onClose, loading, loadError, onRefresh }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('all'); // all | infantry | cavalry | missile | new

  const existingSet = useMemo(() => new Set(existingPortraits), [existingPortraits]);

  const filtered = useMemo(() => {
    return eduUnits.filter(u => {
      if (filter === 'new' && existingSet.has(u.type)) return false;
      if (filter === 'cavalry' && (u.category || '').toLowerCase() !== 'cavalry') return false;
      if (filter === 'infantry' && (u.category || '').toLowerCase() !== 'infantry') return false;
      if (filter === 'missile' && (u.class || '').toLowerCase() !== 'missile') return false;
      if (search && !u.type.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [eduUnits, filter, search, existingSet]);
  const visibleFiltered = useMemo(() => filtered.slice(0, EDU_PICKER_RENDER_LIMIT), [filtered]);

  const allSelected = filtered.length > 0 && filtered.every(u => selected.has(u.type));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(u => n.delete(u.type)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(u => n.add(u.type)); return n; });
    }
  };

  const catIcon = (unit) => {
    const cat = (unit.category || '').toLowerCase();
    const cls = (unit.class || '').toLowerCase();
    if (cat === 'cavalry') return '🐴';
    if (cat === 'ship')    return '⚓';
    if (cls === 'missile') return '🏹';
    return '⚔️';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-slate-700/50 shrink-0 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-foreground">Select EDU Units to Import</p>
          <div className="flex items-center gap-1.5">
            <button onClick={onRefresh} disabled={loading} className="text-[9px] text-slate-500 hover:text-slate-300 disabled:opacity-40">Refresh</button>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter units…"
            className="w-full h-6 pl-6 pr-2 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 placeholder-slate-600" />
        </div>
        {/* Category filters */}
        <div className="flex gap-1 flex-wrap">
          {['all','new','infantry','cavalry','missile'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors ${filter === f ? 'bg-amber-600/20 border-amber-500/40 text-amber-400' : 'border-slate-700/40 text-slate-500 hover:text-slate-300'}`}>
              {f === 'new' ? '✨ new' : f}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-[9px]">
          <button onClick={toggleAll} className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors">
            {allSelected ? <CheckSquare className="w-3 h-3 text-amber-400" /> : <Square className="w-3 h-3" />}
            {allSelected ? 'Deselect all' : `Select all (${filtered.length})`}
          </button>
          <span className="text-slate-600">{selected.size} selected</span>
        </div>
      </div>

      {/* Unit list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600 px-4 text-center">
            <RefreshCw className="w-5 h-5 opacity-40 animate-spin" />
            <p className="text-[10px]">Loading EDU units…</p>
          </div>
        ) : loadError ? (
          <div className="p-4 text-center text-[10px] text-red-400">{loadError}</div>
        ) : eduUnits.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600 px-4 text-center">
            <FileText className="w-6 h-6 opacity-30" />
            <p className="text-[10px]">No EDU loaded. Load <code className="bg-slate-800 px-1 rounded">export_descr_unit.txt</code> in the Unit Editor first.</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-[10px] text-slate-600 text-center py-6">No units match the filter.</p>
        ) : (
          <>
          {filtered.length > EDU_PICKER_RENDER_LIMIT && (
            <div className="px-3 py-1 text-[9px] text-slate-500 bg-slate-900/70 border-b border-slate-800">
              Showing {EDU_PICKER_RENDER_LIMIT}/{filtered.length}. Use search or filters to narrow the list.
            </div>
          )}
          {visibleFiltered.map(unit => {
            const isSelected = selected.has(unit.type);
            const alreadyIn  = existingSet.has(unit.type);
            return (
              <div key={unit.type}
                onClick={() => setSelected(prev => { const n = new Set(prev); n.has(unit.type) ? n.delete(unit.type) : n.add(unit.type); return n; })}
                className={`flex items-center gap-2 px-2 py-1 cursor-pointer border-b border-slate-800/60 transition-colors ${isSelected ? 'bg-amber-900/15' : 'hover:bg-slate-800/30'}`}>
                <div className={`w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ${isSelected ? 'bg-amber-500 border-amber-500' : 'border-slate-600'}`}>
                  {isSelected && <span className="text-[7px] text-black font-bold">✓</span>}
                </div>
                <span className="text-sm shrink-0">{catIcon(unit)}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-[10px] font-mono truncate ${isSelected ? 'text-amber-300' : 'text-slate-300'}`}>{unit.type}</p>
                  <p className="text-[8px] text-slate-600 truncate">{unit.category} / {unit.class} · {(unit.ownership || []).slice(0,3).join(', ')}</p>
                </div>
                {alreadyIn && <span className="text-[8px] text-green-500 shrink-0" title="Already imported">✓</span>}
              </div>
            );
          })}
          </>
        )}
      </div>

      {/* Import button */}
      <div className="px-3 py-2 border-t border-slate-700/50 shrink-0">
        <button
          disabled={selected.size === 0}
          onClick={() => {
            const units = eduUnits.filter(u => selected.has(u.type));
            onImport(units);
            setSelected(new Set());
          }}
          className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-semibold border transition-colors ${
            selected.size > 0
              ? 'bg-amber-600/20 hover:bg-amber-600/40 border-amber-500/40 text-amber-400'
              : 'border-slate-700/30 text-slate-600 cursor-not-allowed opacity-40'}`}>
          <Zap className="w-3 h-3" />
          Import {selected.size} unit{selected.size !== 1 ? 's' : ''} with smart defaults
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UnitCardGenerator() {
  const [entries, setEntries] = useState(() => {
    try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
  });
  const [editEntry, setEditEntry]   = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch]         = useState('');
  const [showInfo, setShowInfo]     = useState(false);
  const [showPoses, setShowPoses]   = useState(false);
  const [showCasStudio, setShowCasStudio] = useState(false);
  const [importMsg, setImportMsg]   = useState('');

  const factions  = useMemo(() => parseFactionList(), []);

  const [eduUnitsLive, setEduUnitsLive] = useState([]);
  const [eduLoading, setEduLoading] = useState(false);
  const [eduLoadError, setEduLoadError] = useState('');

  const refreshEduUnits = useCallback(() => {
    setEduLoading(true);
    setEduLoadError('');
    window.setTimeout(() => {
      try {
        setEduUnitsLive(loadEduUnits());
      } catch (err) {
        setEduLoadError(`EDU load failed: ${err.message}`);
      } finally {
        setEduLoading(false);
      }
    }, 0);
  }, []);

  // Re-load whenever EDU is saved to localStorage (same tab or other tab)
  useEffect(() => {
    // cross-tab: storage event fires when another tab writes to localStorage
    window.addEventListener('storage', refreshEduUnits);
    // same-tab: Unit Editor dispatches this custom event after writing EDU to localStorage
    window.addEventListener('edu-file-loaded', refreshEduUnits);
    return () => {
      window.removeEventListener('storage', refreshEduUnits);
      window.removeEventListener('edu-file-loaded', refreshEduUnits);
    };
  }, [refreshEduUnits]);

  useEffect(() => {
    if (showPicker && eduUnitsLive.length === 0 && !eduLoading) refreshEduUnits();
  }, [showPicker, eduUnitsLive.length, eduLoading, refreshEduUnits]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
  }, [entries]);

  const saveEntry = useCallback((draft) => {
    setEntries(prev => {
      const idx = prev.findIndex(e => e.id === draft.id);
      return idx >= 0 ? prev.map(e => e.id === draft.id ? draft : e) : [...prev, draft];
    });
    setEditEntry(null);
  }, []);

  const deleteEntry = useCallback((id) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    setEditEntry(prev => prev?.id === id ? null : prev);
  }, []);

  /** Import a list of full EDU unit objects, building smart-defaulted entries. */
  const handleImportUnits = useCallback((units) => {
    const existingPortraits = new Set(entries.map(e => e.portraitFilename));
    const toAdd = units
      .filter(u => !existingPortraits.has(u.type))
      .map(entryFromUnit);
    const skipped = units.length - toAdd.length;
    setEntries(prev => [...prev, ...toAdd]);
    setShowPicker(false);
    const msg = skipped > 0
      ? `Imported ${toAdd.length} units (${skipped} already existed). Review textures in each entry.`
      : `Imported ${toAdd.length} units with smart defaults. Review textures in each entry.`;
    setImportMsg(msg);
    setTimeout(() => setImportMsg(''), 5000);
  }, [entries]);

  const exportInputFile = useCallback(() => {
    if (!entries.length) return;
    downloadText(serializeInputFile(entries), 'inputfile.txt');
  }, [entries]);

  const exportUiFolders = useCallback(async () => {
    if (!entries.length) return;
    const zip = new JSZip();
    const input = toCRLF(serializeInputFile(entries));
    const plan = buildUiFolderPlan(entries);
    zip.file('inputfile.txt', input);
    for (const faction of plan.folders) {
      zip.folder(`data/ui/units/${faction}`).file('.keep', '');
      zip.folder(`data/ui/unit_info/${faction}`).file('.keep', '');
    }
    zip.file('ui_card_folder_plan.txt', toCRLF([
      'Copy the generated portrait TGAs into these RTW folders:',
      '',
      ...plan.rows.flatMap(row => [
        row.unitCard,
        row.infoCard,
        '',
      ]),
    ].join('\n')));
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'rtw_unit_card_ui_folders.zip');
  }, [entries]);

  const filtered = useMemo(() =>
    entries.filter(e => !search ||
      e.portraitFilename.toLowerCase().includes(search.toLowerCase()) ||
      e.faction.toLowerCase().includes(search.toLowerCase()) ||
      e.modelFile.toLowerCase().includes(search.toLowerCase())),
    [entries, search]);

  const isEditing  = editEntry && entries.some(e => e.id === editEntry.id);
  const incomplete = entries.filter(e => !e.modelFile || !e.mainTextureAlb || !e.mainTexturePbr).length;
  const existingPortraitNames = useMemo(() => entries.map(e => e.portraitFilename), [entries]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">

      {/* ── Header ── */}
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-3 shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-foreground">Unit Card Generator</h1>
          <p className="text-[9px] text-muted-foreground truncate">
            Generates <code className="bg-slate-800 px-1 rounded">inputfile.txt</code> for the Feral Interactive M2TW Blender Portrait Creator
          </p>
        </div>
        {incomplete > 0 && (
          <span className="text-[9px] text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">
            ⚠ {incomplete} incomplete
          </span>
        )}
        <a href="https://github.com/FeralInteractive/medieval2-unitcards" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded px-2 py-1 shrink-0">
          <ExternalLink className="w-3 h-3" /> GitHub
        </a>
        <button onClick={() => setShowInfo(v => !v)}
          className={`p-1.5 rounded border transition-colors ${showInfo ? 'bg-blue-600/20 border-blue-500/30 text-blue-400' : 'border-slate-600/40 text-slate-500 hover:text-slate-300'}`}>
          <Info className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Info banner ── */}
      {showInfo && (
        <div className="bg-blue-950/20 border-b border-blue-500/20 px-4 py-2.5 text-[10px] text-slate-300 shrink-0">
          <p className="font-semibold text-blue-300 mb-1">Workflow:</p>
          <ol className="list-decimal list-inside space-y-0.5 text-slate-400">
            <li>Click <strong className="text-slate-200">Import from EDU</strong> — select units from the list, smart defaults are filled automatically (pose, faction, model name, texture prefixes).</li>
            <li>Click any row to fine-tune textures, pose or visible models in the side panel.</li>
            <li>Export <code className="bg-slate-800 px-1 rounded text-slate-200">inputfile.txt</code> and place it in the <code className="bg-slate-800 px-1 rounded text-slate-200">Mobile_Portrait_Creator_/</code> Blender folder.</li>
            <li>Open <code className="bg-slate-800 px-1 rounded text-slate-200">M2_Portrait_Creator_scene.blend</code> in Blender 2.93+ and run <code className="bg-slate-800 px-1 rounded text-slate-200">Portrait_creator.py</code>.</li>
          </ol>
          <p className="text-slate-600 mt-1 italic text-[9px]">Smart defaults: pose is derived from category/class/attributes. Faction = first ownership entry. Model file = soldier_model. Texture names = faction-prefix convention.</p>
        </div>
      )}

      {/* ── Import message ── */}
      {importMsg && (
        <div className="bg-green-950/30 border-b border-green-500/20 px-4 py-1.5 text-[10px] text-green-300 flex items-center gap-2 shrink-0">
          <Zap className="w-3 h-3 shrink-0" />{importMsg}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="border-b border-border px-3 py-1.5 flex items-center gap-2 shrink-0 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="h-6 pl-6 pr-2 w-40 text-[10px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 placeholder-slate-600" />
        </div>
        <button onClick={() => {
          setShowPicker(v => {
            const next = !v;
            if (next && eduUnitsLive.length === 0 && !eduLoading) refreshEduUnits();
            return next;
          });
          setEditEntry(null);
        }}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-colors ${showPicker ? 'bg-amber-600/20 border-amber-500/40 text-amber-400' : 'border-slate-600/40 text-slate-400 hover:text-slate-200 hover:border-slate-500'}`}>
          <RefreshCw className="w-3 h-3" /> Import from EDU
          {eduLoading ? <span className="text-[8px] text-slate-500 ml-0.5">(loading)</span> : eduUnitsLive.length > 0 && <span className="text-[8px] text-slate-500 ml-0.5">({eduUnitsLive.length})</span>}
        </button>
        <button onClick={() => { setEditEntry(newEntry()); setShowPicker(false); }}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-amber-500/30 text-amber-400 hover:bg-amber-600/20 transition-colors">
          <Plus className="w-3 h-3" /> Add Entry
        </button>
        <button onClick={() => setShowCasStudio(v => !v)}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-colors ${showCasStudio ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'border-slate-600/40 text-slate-400 hover:text-slate-200 hover:border-slate-500'}`}>
          <Box className="w-3 h-3" /> CAS Card Studio
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-600">{entries.length} entries ({filtered.length} shown)</span>
        <button onClick={exportInputFile} disabled={entries.length === 0}
          className={`flex items-center gap-1 px-3 py-1 text-[10px] rounded font-semibold border transition-colors ${
            entries.length > 0
              ? 'bg-green-600/20 hover:bg-green-600/40 border-green-500/40 text-green-400'
              : 'border-slate-700/30 text-slate-600 cursor-not-allowed opacity-40'}`}>
          <Download className="w-3 h-3" /> Export inputfile.txt
        </button>
        <button onClick={exportUiFolders} disabled={entries.length === 0}
          className={`flex items-center gap-1 px-3 py-1 text-[10px] rounded font-semibold border transition-colors ${
            entries.length > 0
              ? 'bg-amber-600/20 hover:bg-amber-600/40 border-amber-500/40 text-amber-300'
              : 'border-slate-700/30 text-slate-600 cursor-not-allowed opacity-40'}`}>
          <Download className="w-3 h-3" /> Export UI folders
        </button>
      </div>

      {showCasStudio && (
        <div className="border-b border-border shrink-0 max-h-[46vh] overflow-auto">
          <CasUnitCardStudio />
        </div>
      )}

      {/* ── Main ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: EDU picker panel */}
        {showPicker && (
          <div className="w-72 shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
            <EduPickerPanel
              eduUnits={eduUnitsLive}
              existingPortraits={existingPortraitNames}
              onImport={handleImportUnits}
              onClose={() => setShowPicker(false)}
              loading={eduLoading}
              loadError={eduLoadError}
              onRefresh={refreshEduUnits}
            />
          </div>
        )}

        {/* Center: entry table */}
        <div className={`flex-1 overflow-auto ${editEntry ? 'border-r border-border' : ''}`}>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3 p-8 text-center">
              <Image className="w-8 h-8 opacity-30" />
              <p className="text-[12px] font-semibold">No entries yet</p>
              <p className="text-[10px] max-w-xs">
                Click <strong className="text-slate-400">Import from EDU</strong> to batch-select units — smart defaults for pose, faction, model and texture names are filled automatically from the EDU data.
              </p>
              {eduUnitsLive.length === 0 && (
                <div className="flex items-center gap-1.5 text-[10px] text-amber-400 border border-amber-500/20 rounded px-2 py-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  Load export_descr_unit.txt in the Unit Editor first
                </div>
              )}
            </div>
          ) : (
            <table className="w-full text-[10px] border-collapse">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold w-8">#</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Portrait Filename</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Cat</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Faction</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Pose</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Model File</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Main Alb Texture</th>
                  <th className="px-2 py-1.5 text-left text-[9px] text-slate-500 font-semibold">Output Dir</th>
                  <th className="px-2 py-1.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, idx) => {
                  const isSelected = editEntry?.id === entry.id;
                  const ok = entry.modelFile && entry.mainTextureAlb && entry.mainTexturePbr;
                  const catIcon = entry._eduCategory === 'cavalry' ? '🐴' : entry._eduCategory === 'ship' ? '⚓' : entry._eduClass === 'missile' ? '🏹' : '⚔️';
                  return (
                    <tr key={entry.id}
                      onClick={() => { setEditEntry({ ...entry }); setShowPicker(false); }}
                      className={`border-b border-border/50 cursor-pointer transition-colors ${isSelected ? 'bg-amber-900/15' : 'hover:bg-slate-800/30'}`}>
                      <td className="px-2 py-1 text-slate-600 font-mono">{idx + 1}</td>
                      <td className="px-2 py-1 font-mono">
                        <span className="text-slate-500">#</span>
                        <span className={isSelected ? 'text-amber-300' : ok ? 'text-slate-200' : 'text-slate-400'}>
                          {entry.portraitFilename || <span className="italic text-slate-600">unnamed</span>}
                        </span>
                        {!ok && <span className="ml-1 text-[8px] text-red-400">⚠</span>}
                      </td>
                      <td className="px-2 py-1 text-slate-400 text-center">{catIcon}</td>
                      <td className="px-2 py-1 text-blue-300 font-mono">{entry.faction}</td>
                      <td className="px-2 py-1 text-slate-400 font-mono">
                        {entry.poseId}
                        {isCavalryPose(entry.poseId) && <span className="ml-0.5 text-[8px] text-amber-500">🐴</span>}
                      </td>
                      <td className="px-2 py-1 font-mono max-w-[130px] truncate">
                        {entry.modelFile ? <span className="text-slate-300">{entry.modelFile}</span> : <span className="text-red-400/50 italic">—</span>}
                      </td>
                      <td className="px-2 py-1 font-mono max-w-[150px] truncate">
                        {entry.mainTextureAlb ? <span className="text-slate-400">{entry.mainTextureAlb}</span> : <span className="text-red-400/50 italic">—</span>}
                      </td>
                      <td className="px-2 py-1 text-slate-500 font-mono">{entry.outputDir || entry.faction}</td>
                      <td className="px-2 py-1">
                        <button onClick={e => { e.stopPropagation(); deleteEntry(entry.id); }}
                          className="p-0.5 text-slate-600 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right: entry edit panel */}
        {editEntry && (
          <div className="w-80 shrink-0 flex flex-col overflow-hidden border-l border-border bg-card">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <p className="text-[11px] font-semibold text-foreground">
                {isEditing ? `Edit — #${editEntry.portraitFilename || '…'}` : 'New Entry'}
              </p>
              <button onClick={() => setEditEntry(null)} className="text-slate-500 hover:text-slate-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <EntryForm
                entry={editEntry}
                factions={factions}
                onSave={saveEntry}
                onCancel={() => setEditEntry(null)}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Pose reference footer ── */}
      <div className="border-t border-border px-3 py-1 shrink-0 bg-card">
        <button onClick={() => setShowPoses(v => !v)}
          className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 transition-colors">
          <ChevronDown className={`w-3 h-3 transition-transform ${showPoses ? 'rotate-180' : ''}`} />
          Pose ID Quick Reference
        </button>
        {showPoses && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 pb-0.5">
            {['infantry', 'cavalry', 'special'].map(cat => (
              <div key={cat} className="flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-[8px] text-slate-600 uppercase w-full mt-0.5">{cat}</span>
                {POSE_PRESETS.filter(p => p.category === cat).map(p => (
                  <span key={p.id} className="text-[9px] font-mono whitespace-nowrap">
                    <span className="text-amber-400">{p.id}</span>
                    <span className="text-slate-600"> = {p.label.split('—')[1]?.trim()}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
