import React, { useState, useEffect, useMemo } from 'react';
import { Upload, Download, Plus, X, Search, Copy } from 'lucide-react';
import { getTextLocalizationStore } from '@/lib/textLocalizationStore';
import { useModData } from '@/components/shared/ModDataContext';
import { textBlob, toCRLF } from '@/lib/lineEndings';
import { parseTextLocFile, serializeTextLocFile } from '@/lib/textLocParser';

// ─── descr_names.txt parser ─────────────────────────────────────────────────
// Grammar:
//   faction: [name]
//   \tcharacters / surnames / women   (section headers)
//   \t\t[name]                        (one per line)
function parseDescrNames(text) {
  const factions = {};
  let currentFaction = null;
  let currentSection = null;

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (const raw of lines) {
    const noComment = raw.replace(/;.*$/, '');
    const trimmed = noComment.trim();
    if (!trimmed) continue;

    // "faction: [name]"
    const factionMatch = trimmed.match(/^faction:\s*(\S+)/i);
    if (factionMatch) {
      currentFaction = factionMatch[1];
      factions[currentFaction] = { characters: [], surnames: [], females: [] };
      currentSection = null;
      continue;
    }

    if (!currentFaction) continue;

    if (/^characters$/i.test(trimmed)) { currentSection = 'characters'; continue; }
    if (/^surnames$/i.test(trimmed))   { currentSection = 'surnames';   continue; }
    if (/^women$/i.test(trimmed))      { currentSection = 'females';    continue; }
    if (/^females?$/i.test(trimmed))   { currentSection = 'females';    continue; }
    if (/^male$/i.test(trimmed))       { currentSection = 'characters'; continue; }

    if (currentSection) {
      factions[currentFaction][currentSection].push(trimmed);
    }
  }
  return factions;
}

// ─── descr_names.txt serializer ───────────────────────────────────────────────
function serializeDescrNames(factions) {
  return toCRLF(Object.entries(factions).map(([name, data]) => {
    const lines = [`faction: ${name}`];
    lines.push('\tcharacters');
    for (const n of data.characters) lines.push(`\t\t${n}`);
    lines.push('\tsurnames');
    for (const n of data.surnames) lines.push(`\t\t${n}`);
    lines.push('\twomen');
    for (const n of data.females) lines.push(`\t\t${n}`);
    return lines.join('\n');
  }).join('\n\n'));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const SECTIONS = [
  { key: 'characters', label: 'Male First Names' },
  { key: 'surnames', label: 'Surnames & Bynames' },
  { key: 'females', label: 'Female First Names' },
];

const DEFAULT_GENERATOR_CULTURES = ['hellenized', 'phoenician', 'arabic'];
const DEFAULT_GENERATOR_COUNTS = { characters: 250, surnames: 35, females: 100 };
const GENERATOR_COUNT_FIELDS = [
  { key: 'characters', label: 'Men' },
  { key: 'surnames', label: 'Surnames' },
  { key: 'females', label: 'Women' },
];

const NAME_MODULES = {
  arabic: {
    label: 'Pre-Islamic Arabic',
    theophoric: true,
    male: [
      'Malik','Salih','Dathan','Qaydar','Radif','Waddah','Hawmal','Zariq','Nasr','Lihyan','Amru','Harith','Hud','Shalaf','Thamim','Zamil','Raqim','Ghawth','Jadhima','Adnan','Nizar','Mudar','Rabi','Bahir','Kathir','Suwayb','Ablaq','Dhabin','Rufaq','Luqman','Hamdan','Nadir','Tayyi','Wabr','Kahf','Qusayy','Jasim','Rizam','Sabiq','Damir','Walid','Tarif','Nafis','Zafir','Rayyan','Sabur','Wathil','Qasim','Yazid','Zayd',
      'Aws','Khazraj','Ghassan','Jafna','Mundhir','Numan','Imru','Qays','Kinda','Hujr','Akil','Adi','Ubayd','Utba','Shayba','Nawfal','Hakam','Hisham','Safwan','Umayya','Makhzum','Kilab','Murra','Tamim','Bakr','Taghlib','Shayban','Yashkur','Azd','Aamir','Mazim','Saad','Sadus','Asad','Kinanah','Khuzaa','Rabah','Rafi','Suhayl','Suhaym','Dhuwayb','Jundub','Ghalib','Hanzala','Ashath','Zuhayr','Labid','Antara','Urwa','Alqama','Nabigha','Tarafa','Mutalammis','Maysara','Shurahbil','Rabiah','Hawazin','Sulaym','Mazin','Mirdas','Dirar','Aqra','Asim','Khalid','Marwan','Abjar','Yashjub','Himyar','Saba','Dhu_Nuwas','Dhu_Yazan','Tubba','Qataban','Awsan','Mina','Madhij','Murad','Zubayd','Jarm','Judham','Kalb','Tanukh','Iyad','Anmar','Bajila','Sakhr','Fazara','Abs','Dhubyan','Murayrah','Rawaha','Habib','Ayyub','Safir','Rabah'
    ],
    female: [
      'Labna','Hasna','Rima','Suhayla','Nashwa','Layla','Hind','Rawda','Ghusun','Dalila','Sabra','Nura','Wafa','Badra','Haifa','Thuraya','Asila','Khawla','Amina','Zahra','Afra','Samira','Lina','Tamara','Salma','Rahma','Wardah','Hana','Lubna','Maryam','Khadija','Nadia','Ruba','Dina','Haya','Abla','Tarfah','Shamsa','Nuha','Yasmin','Sawsan','Nabila','Raniya','Warda','Siham','Basma','Arwa','Nayla','Munia','Sawdah',
      'Atika','Asma','Barrah','Jamila','Juwayriya','Ruqayya','Safiyya','Sukayna','Sumayya','Ummama','Rayhana','Maysun','Halah','Fakhita','Fariha','Qutayla','Ramlah','Rabab','Umaima','Raitah','Zaynab','Bahila','Qayla','Rumana','Sahar','Saba','Dhuha','Nawar','Maha','Mays','Hawla','Ghazala','Jumana','Hulda','Najma','Durra','Amra','Hindah','Saffana','Habiba','Jalila','Karima','Lamis','Muna','Sahba','Thubayta','Aaliyah','Ghaliya','Qamar','Rashida','Rufayda'
    ],
    roots: ['Salih','Datha','Qaydar','Lihyan','Adnan','Nizar','Mudar','Rabiah','Harith','Qusayy','Jadhima','Ghassan','Jafna','Kinda','Hujr','Qays','Tamim','Bakr','Taghlib','Shayban','Azd','Himyar','Saba','Madhij','Kalb','Tanukh','Abs','Dhubyan','Murra','Kilab','Makhzum'],
    deities: ['Wadd','Allat','Uzza','Manat','Shams','Qays','Nasr','Ruda','Dushara','Hubal','Yaghuth','Suwai']
  },
  phoenician: {
    label: 'Phoenician/Punic',
    theophoric: true,
    male: [
      'Abibaal','Ahiram','Hiram','Ithobaal','Ittobaal','Ethbaal','Eshmunazar','Tabnit','Bodashtart','Yatonbaal','Baalyaton','Milkiram','Milkyaton','Mattan','Mattanbaal','Baalshillek','Baalhanno','Hannobaal','Hannibal','Hanno','Bostar','Bodmelqart','Bodon','Bomilcar','Hamilcar','Hasdrubal','Maharbal','Mago','Gisco','Gisgo','Himilco','Adonibaal','Abdmilk','Abdmelqart','Abdastart','Abdeshmun','Gerastart','Azimilk','Shipitbaal','Sakunbaal','Pumayyaton','Eshmunhalos','Baalazor','Elibaal','Sibitti','Aderbal','Safat','Saphon','Mahar','Ahirom','Astarton','Melqartshama','Baalram','Baalshamar','Maharbaal','Baalpilles','Eshmunyaton','Bodtanit','Abdtanit','Tanitbaal','Reshefazar','Abdreshef','Milkbaal','Yadaamilk','Yehawmilk','Baalhannos','Hannosh','Germelqart','Bodashmun','Abdhammon','Hammon','Baalhammon','Adonmelqart','Muthunbaal','Sikarbaal','Zimrida','Abiatar','Yaphur','Baalmalek','Malchus'
    ],
    female: [
      'Elissa','Dido','Sophonisba','Arishat','Batnoam','Abiba','Astarte','Ashtart','Tanit','Amatastart','Baalat','Bodashtart','Eshmunit','Melqartia','Hanniba','Hannona','Salambo','Saponiba','Abdmilkia','Milkiramia','Yatonbaala','Adonia','Ahiroma','Astartia','Pumayyata','Mattanat','Tanitbaala','Reshefa','Ashtartia','Baalhanna','Gisgona','Hammonia','Bostarida','Magonissa','Himilka','Yehawmilka','Bodtanita','Saphona','Tabnita','Aderbala'
    ],
    roots: ['Baal','Melqart','Eshmun','Astarte','Tanit','Hanno','Mago','Hamilcar','Hasdrubal','Mattan','Hiram','Abibaal','Bodashtart','Yatonbaal','Gisco','Himilco','Bostar','Reshef','Hammon','Milk'],
    deities: ['Baal','Melqart','Eshmun','Astarte','Tanit','Reshef','Hammon','Milk']
  },
  hellenized: {
    label: 'Hellenized',
    male: [
      'Alexandros','Antiochos','Demetrios','Diodoros','Dionysios','Apollonios','Theodoros','Herakleides','Philinos','Philotas','Philoxenos','Nikandros','Nikanor','Nikarchos','Seleukos','Ptolemaios','Lysimachos','Menandros','Polyxenos','Artemidoros','Zenon','Zopyros','Kleon','Klearchos','Sostratos','Sosibios','Damon','Damasos','Timaios','Timarchos','Ariston','Aristoboulos','Aristokles','Hegesias','Hegemon','Krateros','Eumenes','Peukestas','Andronikos','Kallias','Kallikrates','Kleomenes','Leontios','Leonidas','Menedemos','Mithridates','Orophernes','Athenaios','Poseidonios','Heliodoros','Diogenes','Philokles','Straton','Doros','Nikomachos','Eukrates','Eupolemos','Theophilos','Zabdas','Zabdaios','Iamblichos','Malichos','Aretas','Obodas','Syllaios','Abgaros','Sampsigeramos','Sohaimos','Azizos','Monimos','Mannaios','Rabbilos','Gennaios','Kaisaros','Herodoros'
    ],
    female: [
      'Berenike','Arsinoe','Kleopatra','Laodike','Apollonia','Diodora','Dionysia','Theodora','Nikaia','Philippa','Olympias','Stratonike','Eurydike','Kleonike','Kallisto','Kallistrate','Timandra','Aristomache','Phila','Philista','Philotera','Athenais','Heliodora','Nikomache','Eukleia','Euphemia','Damarete','Xenokleia','Zoe','Thais','Glaphyra','Nysa','Tryphaina','Basileia','Herakleia','Leontis','Melitta','Eirene','Agathonike','Eudokia'
    ],
    roots: ['Alexandros','Antiochos','Demetrios','Seleukos','Diodoros','Zenon','Apollonios','Theodoros','Aretas','Obodas','Malichos','Iamblichos','Zabdas','Abgaros','Syllaios','Azizos'],
    deities: ['Apollo','Dionysos','Helios','Herakles','Zeus','Artemis']
  },
  hittite: {
    label: 'Hittite',
    male: ['Hattusili','Mursili','Suppiluliuma','Tudhaliya','Arnuwanda','Telipinu','Zidanta','Huzziya','Kantuzzili','Piyassili','Kurunta','Tuwanuwa','Zuwapi','Pithana','Anitta','Zita','Tarhunta','Arma','Hantili','Mashuiluwa','Manapa','Kupanta','Ura','Zalpa','Kukkuli','Ukkura','Zitana','Huzziyas','Muwatalli','Halpasulupi'],
    female: ['Puduhepa','Tawananna','Nikkal','Asmunikal','Harapsili','Danuhepa','Gassulawiya','Malnigal','Ammuna','Kiluhepa','Ariya','Hepat','Azzari','Naptera','Ishara','Waliyanni'],
    roots: ['Hatti','Tarhun','Arma','Tudhaliya','Mursili','Hattusili','Kurunta','Piyassili','Zalpa','Nerik'],
    deities: ['Tarhun','Arma','Hepat','Telepinu','Ishara']
  },
  luwian: {
    label: 'Luwian',
    male: ['Tarkasnawa','Kupanta','Mira','Muwawalwi','Mashuiluwa','Manapa','Piyama','Runtiya','Tiwata','Walwaziti','Kukkunnis','Uhhaziti','Piyamaradu','Tarkhunta','Armaziti','Sarpedon','Glaukos','Lukka','Muksus','Zaparas','Tarkondemos','Walmus','Tarhundaradu','Ura-Tarhun','Atpa'],
    female: ['Ariyawiya','Kupantaia','Miraia','Runtiya','Tiwati','Hepatia','Maliya','Katawata','Armaia','Tarhuntiya','Walwiya','Lukkia','Zaparaya','Astarpa','Piyamaia'],
    roots: ['Tarhun','Runtiya','Mira','Lukka','Kupanta','Piyama','Muksus','Arma','Walwi','Tiwata'],
    deities: ['Tarhun','Runtiya','Arma','Tiwat','Maliya']
  },
};

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function sanitizeName(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

function uniqueNames(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const clean = sanitizeName(value);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function shuffled(values, seedText) {
  const random = seededRandom(hashString(seedText));
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hellenizeSemiticName(name, suffix) {
  const base = sanitizeName(name).replace(/y$/i, '').replace(/ah$/i, '').replace(/a$/i, '');
  if (!base) return '';
  if (/os$|es$|ios$/i.test(base)) return base;
  return `${base}${suffix}`;
}

function expandGeneratedNames(base, modules, kind, seedText) {
  const generated = [...base];
  const roots = uniqueNames(modules.flatMap(m => m.roots || []));
  const deities = uniqueNames(modules.filter(m => m.theophoric).flatMap(m => m.deities || []));
  const maleRoots = uniqueNames(modules.flatMap(m => m.male || []));

  if (kind === 'male') {
    for (const deity of deities) {
      generated.push(`Abd${deity}`, `Bod${deity}`, `Mattan${deity}`, `${deity}azar`);
    }
    for (const root of maleRoots) {
      generated.push(hellenizeSemiticName(root, 'os'), hellenizeSemiticName(root, 'ios'), hellenizeSemiticName(root, 'es'));
    }
  }
  if (kind === 'female') {
    for (const root of roots) {
      generated.push(`${root}ia`, `${root}a`, `Amat${root}`);
    }
    for (const deity of deities) {
      generated.push(`Amat${deity}`, `${deity}ia`);
    }
  }
  return shuffled(uniqueNames(generated), seedText);
}

function takeGenerated(values, count) {
  return uniqueNames(values).slice(0, Math.max(0, count));
}

function ensureGeneratedCount(values, count, modules, kind, seedText) {
  const out = uniqueNames(values);
  if (out.length >= count) return shuffled(out, seedText);

  const roots = uniqueNames(modules.flatMap(m => m.roots || []));
  const maleRoots = uniqueNames(modules.flatMap(m => m.male || []));
  const femaleRoots = uniqueNames(modules.flatMap(m => m.female || []));
  const baseRoots = roots.length ? roots : uniqueNames([...maleRoots, ...femaleRoots]);
  const places = ['Hegra', 'Dumatha', 'Tyre', 'Sidon', 'Petra', 'Tayma', 'Dedan', 'Palmyra'];
  const candidates = [];

  for (let i = 0; i < Math.max(count * 4, 80); i++) {
    const a = baseRoots[i % Math.max(1, baseRoots.length)] || 'Malik';
    const b = baseRoots[(i * 7 + 3) % Math.max(1, baseRoots.length)] || 'Salih';
    const m = maleRoots[(i * 5 + 1) % Math.max(1, maleRoots.length)] || a;
    const place = places[i % places.length];
    if (kind === 'male') {
      const suffixes = ['os', 'ios', 'es', 'an', 'on', 'ar', 'aios', 'ides'];
      candidates.push(hellenizeSemiticName(`${a}${b}`, suffixes[i % suffixes.length]));
      candidates.push(hellenizeSemiticName(`${a}`, suffixes[(i + 3) % suffixes.length]));
    } else if (kind === 'female') {
      const suffixes = ['a', 'ia', 'ina', 'ana', 'ene', 'is', 'at', 'aya'];
      candidates.push(`${a}${suffixes[i % suffixes.length]}`, `${b}${suffixes[(i + 2) % suffixes.length]}`);
      candidates.push(`Amat${a}`);
    } else {
      candidates.push(`${a}_ibn_${m}`, `bar_${a}`, `${a}_of_${place}`, `${a}_${b}`);
    }
  }

  return shuffled(uniqueNames([...out, ...candidates]), seedText);
}

function displayForInternalName(name) {
  return String(name || '')
    .replace(/_/g, ' ')
    .replace(/\bibn\b/gi, 'ibn')
    .replace(/\bbar\b/gi, 'bar')
    .replace(/\bof\b/gi, 'of');
}

function buildGeneratedNamelist({ faction, cultureKeys, maleCount, surnameCount, femaleCount }) {
  const modules = cultureKeys.map(key => NAME_MODULES[key]).filter(Boolean);
  const seed = `${faction}|${cultureKeys.join(',')}|${maleCount}|${surnameCount}|${femaleCount}`;
  const maleBase = modules.flatMap(m => m.male || []);
  const femaleBase = modules.flatMap(m => m.female || []);
  const roots = modules.flatMap(m => m.roots || []);
  const male = takeGenerated(ensureGeneratedCount(expandGeneratedNames(maleBase, modules, 'male', `${seed}|male`), maleCount, modules, 'male', `${seed}|male-fill`), maleCount);
  const female = takeGenerated(ensureGeneratedCount(expandGeneratedNames(femaleBase, modules, 'female', `${seed}|female`), femaleCount, modules, 'female', `${seed}|female-fill`), femaleCount);
  const surnameBase = [
    ...roots.map(root => `${root}_ibn_${male[hashString(root) % Math.max(1, male.length)] || 'Malik'}`),
    ...roots.map(root => `bar_${root}`),
    ...roots.map(root => `${root}_of_Hegra`),
    ...roots.map(root => `${root}_of_Tyre`),
    'Salih_ibn_Datha',
    'Zayd',
  ];
  const surnames = takeGenerated(ensureGeneratedCount(shuffled(uniqueNames(surnameBase), `${seed}|surnames`), surnameCount, modules, 'surname', `${seed}|surname-fill`), surnameCount);
  const displayNames = {};
  for (const key of [...male, ...female, ...surnames]) displayNames[key] = displayForInternalName(key);
  return {
    faction,
    names: { characters: male, surnames, females: female },
    displayNames,
  };
}

function mergeDisplayNamesForDescr(descrNames, displayNames) {
  const next = { ...(displayNames || {}) };
  for (const faction of Object.values(descrNames || {})) {
    for (const key of [
      ...(faction.characters || []),
      ...(faction.surnames || []),
      ...(faction.females || []),
    ]) {
      if (!key) continue;
      if (next[key] === undefined || next[key] === '') next[key] = displayForInternalName(key);
    }
  }
  return next;
}

function storeDescrNames(descrNames) {
  const text = serializeDescrNames(descrNames);
  try { localStorage.setItem('m2tw_names_file', text); } catch {}
  try { sessionStorage.setItem('m2tw_descr_names_raw', text); } catch {}
  return text;
}

function storeDisplayNames(displayNames) {
  try { localStorage.setItem('rtw_names_text_entries', JSON.stringify(displayNames)); } catch {}
  try { sessionStorage.setItem('m2tw_char_names_display', JSON.stringify(displayNames)); } catch {}
}

// ─── Inline editable name row ─────────────────────────────────────────────────
function NameRow({ internalName, displayName, onDisplayChange, onRemoveInternal, onInternalChange }) {
  const [editInternal, setEditInternal] = useState(internalName);

  useEffect(() => { setEditInternal(internalName); }, [internalName]);

  return (
    <div className="flex items-center gap-1.5 py-0.5 group">
      <input
        value={editInternal}
        onChange={e => setEditInternal(e.target.value)}
        onBlur={() => { if (editInternal !== internalName) onInternalChange(editInternal); }}
        placeholder="internal_name"
        className="w-36 h-6 px-2 text-[11px] bg-slate-800 border border-slate-700 rounded text-slate-200 font-mono placeholder-slate-600 focus:border-slate-500 focus:outline-none"
      />
      <span className="text-slate-600 text-[11px] shrink-0">→</span>
      <input
        value={displayName}
        onChange={e => onDisplayChange(e.target.value)}
        placeholder="Display Name"
        className="flex-1 h-6 px-2 text-[11px] bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:border-slate-500 focus:outline-none"
      />
      <button onClick={onRemoveInternal}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400 transition-all">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CharacterNamesTab() {
  const [descrNames, setDescrNames] = useState({});
  const [displayNames, setDisplayNames] = useState({});

  const [selectedFaction, setSelectedFaction] = useState('');
  const [activeSection, setActiveSection] = useState('characters');
  const [search, setSearch] = useState('');
  const [factionSearch, setFactionSearch] = useState('');
  const [parseError, setParseError] = useState('');
  const [generatorFaction, setGeneratorFaction] = useState('thamud_01');
  const [generatorCultures, setGeneratorCultures] = useState(DEFAULT_GENERATOR_CULTURES);
  const [generatorCounts, setGeneratorCounts] = useState(DEFAULT_GENERATOR_COUNTS);
  const [generatorMessage, setGeneratorMessage] = useState('');

  const applyDescrNames = (raw) => {
    setParseError('');
    const parsed = parseDescrNames(raw);
    const factions = Object.keys(parsed);
    if (factions.length === 0) {
      setParseError('No factions found. The file may use an unsupported format or be empty.');
      return;
    }
    setDescrNames(parsed);
    setSelectedFaction(factions[0]);
  };

  const applyNamesText = (raw) => {
    const map = parseTextLocFile(raw);
    setDisplayNames(map);
    storeDisplayNames(map);
  };

  const applyNamesTextEntries = (entries) => {
    const map = {};
    for (const { key, value } of entries) if (key) map[key] = value;
    setDisplayNames(map);
    storeDisplayNames(map);
  };

  // Auto-restore from localStorage / localization store on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('m2tw_names_file');
      if (raw) applyDescrNames(raw);
    } catch {}

    try {
      const store = getTextLocalizationStore();
      const entry = Object.entries(store).find(([k]) => k.toLowerCase().includes('names'));
      if (entry?.[1]) {
        applyNamesTextEntries(entry[1].entries);
      }
    } catch {}

    try {
      const raw = localStorage.getItem('rtw_names_text_entries');
      if (raw) {
        setDisplayNames(JSON.parse(raw));
      }
    } catch {}

    const onNamesLoaded = (e) => { if (e.detail?.raw) applyDescrNames(e.detail.raw); };
    const onTextLocalizationUpdated = () => {
      try {
        const store = getTextLocalizationStore();
        const entry = Object.entries(store).find(([k]) => k.toLowerCase().includes('names'));
        if (entry?.[1]) applyNamesTextEntries(entry[1].entries);
      } catch {}
    };
    window.addEventListener('load-character-names', onNamesLoaded);
    window.addEventListener('text-localization-updated', onTextLocalizationUpdated);
    return () => {
      window.removeEventListener('load-character-names', onNamesLoaded);
      window.removeEventListener('text-localization-updated', onTextLocalizationUpdated);
    };
  }, []);

  const factionList = useMemo(() => Object.keys(descrNames), [descrNames]);

  const filteredFactions = useMemo(() => {
    if (!factionSearch) return factionList;
    const s = factionSearch.toLowerCase();
    return factionList.filter(f => f.toLowerCase().includes(s));
  }, [factionList, factionSearch]);

  const currentNames = useMemo(() => {
    if (!selectedFaction || !descrNames[selectedFaction]) return [];
    return descrNames[selectedFaction][activeSection] || [];
  }, [descrNames, selectedFaction, activeSection]);

  const filteredNames = useMemo(() => {
    if (!search) return currentNames;
    const s = search.toLowerCase();
    return currentNames.filter(n =>
      n.toLowerCase().includes(s) || (displayNames[n] || '').toLowerCase().includes(s)
    );
  }, [currentNames, search, displayNames]);

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleLoadDescr = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      // Clear stale cache before applying fresh file
      try {
        localStorage.removeItem('rtw_names_text_entries');
      } catch {}
      setDisplayNames({});
      applyDescrNames(text);
      try { localStorage.setItem('m2tw_names_file', text); } catch {}
      try { sessionStorage.setItem('m2tw_descr_names_raw', text); } catch {}
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const handleLoadNamesText = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { applyNamesText(ev.target.result); };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const handleExportDescr = () => {
    const text = serializeDescrNames(descrNames);
    downloadBlob(textBlob(text), 'descr_names.txt');
  };

  const handleExportNamesText = () => {
    const map = mergeDisplayNamesForDescr(descrNames, displayNames);
    storeDisplayNames(map);
    downloadBlob(textBlob(serializeTextLocFile(map)), 'names.txt');
  };

  const toggleGeneratorCulture = (key) => {
    setGeneratorCultures(prev => {
      if (prev.includes(key)) return prev.length === 1 ? prev : prev.filter(k => k !== key);
      return [...prev, key];
    });
  };

  const setGeneratorCount = (key, value) => {
    const parsed = Number(value);
    setGeneratorCounts(prev => ({
      ...prev,
      [key]: Number.isFinite(parsed) ? Math.max(0, Math.min(500, Math.floor(parsed))) : prev[key],
    }));
  };

  const generateNamelist = () => {
    const faction = sanitizeName(generatorFaction) || 'thamud_01';
    const cultureKeys = generatorCultures.length ? generatorCultures : DEFAULT_GENERATOR_CULTURES;
    const generated = buildGeneratedNamelist({
      faction,
      cultureKeys,
      maleCount: generatorCounts.characters,
      surnameCount: generatorCounts.surnames,
      femaleCount: generatorCounts.females,
    });
    const replacing = Boolean(descrNames[faction]);

    setDescrNames(prev => {
      const next = { ...prev, [faction]: generated.names };
      storeDescrNames(next);
      return next;
    });
    setDisplayNames(prev => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(generated.displayNames)) {
        if (next[key] === undefined || next[key] === '') next[key] = value;
      }
      storeDisplayNames(next);
      return next;
    });

    setGeneratorFaction(faction);
    setSelectedFaction(faction);
    setActiveSection('characters');
    setSearch('');
    setFactionSearch('');
    setParseError('');
    setGeneratorMessage(`${replacing ? 'Replaced' : 'Created'} ${faction}: ${generated.names.characters.length} men, ${generated.names.surnames.length} surnames, ${generated.names.females.length} women.`);
  };

  const updateSection = (newList) => {
    setDescrNames(prev => {
      const next = {
        ...prev,
        [selectedFaction]: { ...prev[selectedFaction], [activeSection]: newList }
      };
      storeDescrNames(next);
      return next;
    });
  };

  const addName = () => {
    const newKey = `new_name_${Date.now()}`;
    updateSection([...currentNames, newKey]);
    setDisplayNames(prev => {
      const next = { ...prev, [newKey]: '' };
      storeDisplayNames(next);
      return next;
    });
  };

  const sortNamesAZ = () => {
    updateSection([...currentNames].sort((a, b) => a.localeCompare(b)));
  };

  const removeNameAt = (internalName) => {
    updateSection(currentNames.filter(n => n !== internalName));
  };

  const renameInternal = (oldKey, newKey) => {
    if (!newKey || newKey === oldKey) return;
    updateSection(currentNames.map(n => n === oldKey ? newKey : n));
    setDisplayNames(prev => {
      const next = { ...prev, [newKey]: prev[oldKey] ?? '' };
      delete next[oldKey];
      storeDisplayNames(next);
      return next;
    });
  };

  const setDisplay = (internalName, value) => {
    setDisplayNames(prev => {
      const next = { ...prev, [internalName]: value };
      storeDisplayNames(next);
      return next;
    });
  };

  const addFaction = () => {
    const name = `new_faction_${Date.now()}`;
    setDescrNames(prev => {
      const next = { ...prev, [name]: { characters: [], surnames: [], females: [] } };
      storeDescrNames(next);
      return next;
    });
    setSelectedFaction(name);
  };

  // ─── Duplicate faction names ────────────────────────────────────────────────
  const [showDupModal, setShowDupModal] = useState(false);
  const [dupTargetFaction, setDupTargetFaction] = useState('');
  const { factionNames } = useModData();

  const availableDupTargets = useMemo(() => {
    // Factions from descr_sm_factions.txt that are not already in descrNames
    return factionNames.filter(f => !descrNames[f]);
  }, [factionNames, descrNames]);

  const confirmDuplicate = () => {
    if (!dupTargetFaction || !selectedFaction) return;
    const src = descrNames[selectedFaction];
    setDescrNames(prev => {
      const next = {
        ...prev,
        [dupTargetFaction]: {
          characters: [...src.characters],
          surnames: [...src.surnames],
          females: [...src.females],
        }
      };
      storeDescrNames(next);
      return next;
    });
    // Also copy display names for all internal name keys across all sections
    const allKeys = [...src.characters, ...src.surnames, ...src.females];
    setDisplayNames(prev => {
      const next = { ...prev };
      for (const k of allKeys) { if (prev[k] !== undefined) next[k] = prev[k]; }
      storeDisplayNames(next);
      return next;
    });
    setSelectedFaction(dupTargetFaction);
    setShowDupModal(false);
    setDupTargetFaction('');
  };

  const noneLoaded = factionList.length === 0;
  const exportDisplayNames = useMemo(() => mergeDisplayNamesForDescr(descrNames, displayNames), [descrNames, displayNames]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 transition-colors">
          <Upload className="w-3 h-3" /> Load descr_names.txt
          <input type="file" accept=".txt,text/plain" className="hidden" onChange={handleLoadDescr} />
        </label>
        <label className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-slate-800 border border-slate-600/40 text-slate-300 hover:bg-slate-700 transition-colors">
          <Upload className="w-3 h-3" /> Load names.txt
          <input type="file" accept=".txt,text/plain" className="hidden" onChange={handleLoadNamesText} />
        </label>
        <button onClick={handleExportDescr} disabled={noneLoaded}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/40 disabled:opacity-40 transition-colors">
          <Download className="w-3 h-3" /> Export descr_names.txt
        </button>
        <button onClick={handleExportNamesText} disabled={!Object.keys(exportDisplayNames).length}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] bg-amber-600/20 border border-amber-500/30 text-amber-400 hover:bg-amber-600/40 disabled:opacity-40 transition-colors">
          <Download className="w-3 h-3" /> Export names.txt
        </button>
      </div>

      <div className="rounded border border-slate-700/70 bg-slate-900/60 p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-44 flex-1 space-y-1">
            <span className="block text-[9px] text-slate-500 uppercase font-semibold tracking-wider">Faction</span>
            <input
              value={generatorFaction}
              onChange={e => setGeneratorFaction(e.target.value)}
              list="namelist-generator-factions"
              placeholder="thamud_01"
              className="w-full h-7 px-2 text-[11px] bg-slate-800 border border-slate-600/60 rounded text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500"
            />
            <datalist id="namelist-generator-factions">
              {[...new Set([...factionNames, ...factionList])].sort().map(f => <option key={f} value={f} />)}
            </datalist>
          </label>
          {GENERATOR_COUNT_FIELDS.map(field => (
            <label key={field.key} className="w-24 space-y-1">
              <span className="block text-[9px] text-slate-500 uppercase font-semibold tracking-wider">{field.label}</span>
              <input
                type="number"
                min="0"
                max="500"
                value={generatorCounts[field.key]}
                onChange={e => setGeneratorCount(field.key, e.target.value)}
                className="w-full h-7 px-2 text-[11px] bg-slate-800 border border-slate-600/60 rounded text-slate-200 focus:outline-none focus:border-amber-500"
              />
            </label>
          ))}
          <button
            onClick={generateNamelist}
            className="h-7 flex items-center gap-1 px-3 rounded text-[11px] bg-amber-600/25 border border-amber-500/40 text-amber-300 hover:bg-amber-600/40 transition-colors">
            <Plus className="w-3 h-3" /> Generate Namelist
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(NAME_MODULES).map(([key, module]) => {
            const active = generatorCultures.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleGeneratorCulture(key)}
                className={`px-2 py-1 rounded text-[10px] border transition-colors ${
                  active
                    ? 'bg-blue-600/25 border-blue-500/40 text-blue-300'
                    : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500'
                }`}>
                {module.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-500">
          Builds RTW-ready <span className="font-mono">descr_names.txt</span> blocks with modular culture mixing. Existing names.txt text entries are preserved.
          <span className="ml-1 text-slate-600">names.txt export has {Object.keys(exportDisplayNames).length} strings ready.</span>
          {generatorMessage && <span className="ml-2 text-emerald-400">{generatorMessage}</span>}
        </p>
      </div>

      {parseError && (
        <p className="text-[10px] text-red-400 bg-red-900/20 border border-red-700/40 rounded px-2.5 py-1.5">{parseError}</p>
      )}

      {noneLoaded ? (
        <p className="text-[10px] text-slate-600 text-center py-6">
          Load <span className="font-mono text-slate-500">descr_names.txt</span> and/or <span className="font-mono text-slate-500">names.txt</span> to start editing.
        </p>
      ) : (
        <div className="flex gap-3">
          {/* Faction sidebar */}
          <div className="w-44 shrink-0 space-y-1">
            <p className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider mb-1.5">
              Factions <span className="text-slate-600 normal-case font-normal">({factionList.length})</span>
            </p>
            {/* Faction search */}
            <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded px-1.5 h-6 mb-1">
              <Search className="w-3 h-3 text-slate-500 shrink-0" />
              <input
                value={factionSearch}
                onChange={e => setFactionSearch(e.target.value)}
                placeholder="Filter factions…"
                className="flex-1 bg-transparent text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none"
              />
              {factionSearch && (
                <button onClick={() => setFactionSearch('')} className="text-slate-500 hover:text-slate-300">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="space-y-0.5 max-h-96 overflow-y-auto">
              {filteredFactions.map(f => (
                <button key={f} onClick={() => { setSelectedFaction(f); setSearch(''); }}
                  className={`w-full text-left px-2 py-1 rounded text-[11px] font-mono transition-colors truncate ${
                    selectedFaction === f
                      ? 'bg-primary/20 text-primary'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}>
                  {f}
                </button>
              ))}
              {filteredFactions.length === 0 && (
                <p className="text-[10px] text-slate-600 px-2 py-1">No match</p>
              )}
            </div>
            <button onClick={addFaction}
              className="w-full flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-dashed border-slate-600/40 text-slate-500 hover:text-slate-300 hover:border-slate-400 transition-colors mt-2">
              <Plus className="w-3 h-3" /> Add Faction
            </button>
            {selectedFaction && (
              <button onClick={() => { setDupTargetFaction(''); setShowDupModal(true); }}
                className="w-full flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-dashed border-blue-600/40 text-blue-400 hover:text-blue-300 hover:border-blue-400 transition-colors mt-1">
                <Copy className="w-3 h-3" /> Duplicate Names
              </button>
            )}
          </div>

          {/* Duplicate modal */}
          {showDupModal && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
              <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-72 space-y-3 shadow-xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200">Duplicate Names</h3>
                  <button onClick={() => setShowDupModal(false)} className="text-slate-500 hover:text-slate-300">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Copy all names from <span className="font-mono text-amber-400">{selectedFaction}</span> to a new faction.
                </p>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-500 uppercase font-semibold">Target Faction</label>
                  {availableDupTargets.length > 0 ? (
                    <select
                      value={dupTargetFaction}
                      onChange={e => setDupTargetFaction(e.target.value)}
                      className="w-full h-7 px-2 text-[11px] bg-slate-900 border border-slate-600 rounded text-slate-200 focus:outline-none focus:border-blue-500">
                      <option value="">— select faction —</option>
                      {availableDupTargets.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  ) : (
                    <p className="text-[10px] text-slate-500 italic">No factions from descr_sm_factions.txt available (load it first or all are already present).</p>
                  )}
                  <p className="text-[9px] text-slate-600">Or type a custom name:</p>
                  <input
                    value={dupTargetFaction}
                    onChange={e => setDupTargetFaction(e.target.value)}
                    placeholder="custom_faction_name"
                    className="w-full h-7 px-2 text-[11px] bg-slate-900 border border-slate-600 rounded text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <button onClick={() => setShowDupModal(false)}
                    className="px-3 py-1 rounded text-[11px] border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors">
                    Cancel
                  </button>
                  <button onClick={confirmDuplicate} disabled={!dupTargetFaction.trim()}
                    className="px-3 py-1 rounded text-[11px] bg-blue-600/30 border border-blue-500/50 text-blue-300 hover:bg-blue-600/50 disabled:opacity-40 transition-colors">
                    Duplicate
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Right panel */}
          {selectedFaction && (
            <div className="flex-1 min-w-0 space-y-2">
              {/* Section tabs */}
              <div className="flex gap-1 border-b border-slate-800 pb-2">
                {SECTIONS.map(s => (
                  <button key={s.key} onClick={() => setActiveSection(s.key)}
                    className={`px-3 py-1 rounded-t text-[11px] font-semibold transition-colors ${
                      activeSection === s.key
                        ? 'bg-slate-700 text-slate-100'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}>
                    {s.label}
                    <span className="ml-1 text-[9px] text-slate-500">
                      ({descrNames[selectedFaction]?.[s.key]?.length ?? 0})
                    </span>
                  </button>
                ))}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-3 text-[9px] text-slate-600">
                <span className="font-mono w-36">internal_name</span>
                <span>→</span>
                <span>Display Name (names.txt)</span>
              </div>

              {/* Search + Add + Sort row */}
              <div className="flex items-center gap-1.5">
                <Search className="w-3 h-3 text-slate-500 shrink-0" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                  className="w-32 h-6 px-2 text-[11px] bg-slate-800 border border-slate-600/40 rounded text-slate-200 placeholder-slate-600 focus:outline-none" />
                {search && (
                  <button onClick={() => setSearch('')} className="text-slate-500 hover:text-slate-300 shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                )}
                <span className="text-[9px] text-slate-600 shrink-0">{filteredNames.length}/{currentNames.length}</span>
                <div className="flex-1" />
                <button onClick={sortNamesAZ} disabled={currentNames.length < 2}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-slate-600/40 text-slate-400 hover:text-slate-200 hover:border-slate-400 disabled:opacity-30 transition-colors">
                  A→Z
                </button>
                <button onClick={addName}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-dashed border-slate-600/40 text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors">
                  <Plus className="w-3 h-3" /> Add Name
                </button>
              </div>

              {/* Names list */}
              <div className="space-y-0.5">
                {filteredNames.map(name => (
                  <NameRow
                    key={`${selectedFaction}__${activeSection}__${name}`}
                    internalName={name}
                    displayName={displayNames[name] ?? ''}
                    onDisplayChange={val => setDisplay(name, val)}
                    onRemoveInternal={() => removeNameAt(name)}
                    onInternalChange={newKey => renameInternal(name, newKey)}
                  />
                ))}
              </div>

              {currentNames.length === 0 && (
                <p className="text-[10px] text-slate-600 py-2">No names in this section yet.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
