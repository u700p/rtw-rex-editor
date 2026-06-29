import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FolderOpen, CheckCircle2, FileText, Image, ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';

const CATEGORY_LABELS = {
  text:           { label: 'Game Data Files',         defaultOn: true,  icon: FileText },
  images_ui:      { label: 'UI Images (data/ui/)',     defaultOn: false, icon: Image },
  images_terrain: { label: 'Terrain Textures',         defaultOn: false, icon: Image },
  campaign:       { label: 'Campaign Map Files',       defaultOn: true,  icon: FileText },
  text_loc:       { label: 'Text Localization',         defaultOn: true,  icon: FileText },
};

const TEXT_FILENAMES = new Set([
  'export_descr_buildings.txt','descr_sm_factions.txt','descr_sm_resources.txt',
  'export_descr_unit.txt','descr_events.txt','export_buildings.txt',
  'descr_banners.txt',
  'descr_building_battle.txt','descr_character.txt','descr_formations_ai.txt',
  'descr_lbc_db.txt','descr_model_strat.txt','descr_offmap_models.txt',
  'descr_standards.txt','descr_ui_buildings.txt',
  'export_descr_character_traits.txt','export_descr_ancillaries.txt','export_units.txt',
  'descr_cultures.txt','descr_names.txt','descr_rebel_factions.txt','descr_religions.txt',
  'export_descr_guilds.txt','battle_models.modeldb','descr_model_battle.txt','descr_skeleton.txt','descr_mount.txt',
  'descr_aerial_map_ground_types.txt','descr_strat.txt','descr_regions.txt',
  'descr_mercenaries.txt','descr_win_conditions.txt','campaign_script.txt',
  'descr_event.txt','descr_sounds_music_types.txt','descr_terrain.txt',
  'export_vnvs.txt','export_ancillaries.txt','campaign_descriptions.txt','names.txt',
  'rebel_faction_descr.txt','strat.txt','tooltips.txt','expanded.txt','expanded_bi.txt',
  'expanded_bi_wip.txt','export_units_wip.txt','menu_english.txt','menu.txt',
]);

function categorizeFile(file) {
  const name = file.name.toLowerCase();
  const path = (file.webkitRelativePath || file.name).toLowerCase().replace(/\\/g, '/');
  const framed = `/${path}`;

  if (framed.includes('/text/') && name.endsWith('.txt')) return 'text_loc';
  if (framed.includes('/maps/campaign/') || framed.includes('/maps/base/') || framed.includes('/world/base/')) {
    if (name.endsWith('.tga') || name.endsWith('.txt')) return 'campaign';
    return null;
  }
  if (name.endsWith('.tga')) {
    if (!framed.includes('/ui/')) return null;
    if (framed.includes('/terrain/')) return 'images_terrain';
    return 'images_ui';
  }
  if (TEXT_FILENAMES.has(name)) return 'text';
  return null;
}

function summarizeFiles(files) {
  const byCategory = {};
  for (const file of files) {
    const cat = categorizeFile(file);
    if (!cat) continue;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(file);
  }
  return byCategory;
}

function detectCampaignFolders(files) {
  const direct = new Set(), custom = new Set();
  for (const file of files) {
    const path = (file.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/');
    const framed = `/${path}`;
    const customMatch = framed.match(/\/maps\/campaign\/custom\/([^/]+)\//);
    if (customMatch) { custom.add(customMatch[1]); continue; }
    const directMatch = framed.match(/\/maps\/campaign\/([^/]+)\//);
    if (directMatch && directMatch[1] !== 'custom') direct.add(directMatch[1]);
  }
  return { direct: [...direct], custom: [...custom] };
}

function detectUiFolders(files) {
  const folders = new Set();
  for (const file of files) {
    const path = (file.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/');
    const match = `/${path}`.match(/\/ui\/([^/]+)\//);
    if (match) folders.add(match[1]);
  }
  return [...folders];
}

function fkey(f) { return f.webkitRelativePath || f.name; }

function mergeFileLists(existing, incoming) {
  const map = new Map();
  for (const file of existing || []) map.set(fkey(file), file);
  for (const file of incoming || []) map.set(fkey(file), file);
  return [...map.values()];
}

function detectRootFolder(files) {
  const rel = files.find(f => f.webkitRelativePath)?.webkitRelativePath || '';
  return rel ? rel.replace(/\\/g, '/').split('/')[0] : 'selected folder';
}

// Categories that support individual file selection
const INDIVIDUAL_SELECT_CATS = new Set(['text', 'text_loc', 'images_terrain']);

export default function DataFolderPicker({ onLoad, loading }) {
  const inputRef = useRef();
  const [scanned, setScanned] = useState(null);
  const [checked, setChecked] = useState({});
  const [checkedFiles, setCheckedFiles] = useState(new Set());
  const [expanded, setExpanded] = useState({});
  const [selectedCampaigns, setSelectedCampaigns] = useState(new Set());
  const [selectedUiFolders, setSelectedUiFolders] = useState(new Set());
  const [expandedCampaign, setExpandedCampaign] = useState(new Set());
  const [expandedUiFolder, setExpandedUiFolder] = useState(new Set());
  const [folderSelections, setFolderSelections] = useState([]);

  const handleFolderSelect = (e) => {
    const incoming = Array.from(e.target.files || []);
    e.target.value = '';
    if (incoming.length === 0) return;

    const files = mergeFileLists(scanned?.allFiles || [], incoming);

    const byCategory = summarizeFiles(files);
    const { direct: directCampaigns, custom: customCampaigns } = detectCampaignFolders(files);
    const uiFolders = detectUiFolders(byCategory['images_ui'] || []);

    const initChecked = {};
    const initCheckedFiles = new Set();
    for (const [cat, catFiles] of Object.entries(byCategory)) {
      const on = CATEGORY_LABELS[cat]?.defaultOn ?? true;
      initChecked[cat] = on;
      if (on) catFiles.forEach(f => initCheckedFiles.add(fkey(f)));
    }

    setChecked(initChecked);
    setCheckedFiles(initCheckedFiles);
    setScanned({ byCategory, allFiles: files, directCampaigns, customCampaigns, uiFolders });
    const allCampaigns = [...directCampaigns, ...customCampaigns];
    setSelectedCampaigns(allCampaigns.length > 0 ? new Set([allCampaigns[0]]) : new Set());
    setSelectedUiFolders(new Set(uiFolders));
    setExpanded({});
    setExpandedCampaign(new Set());
    setExpandedUiFolder(new Set());
    setFolderSelections(prev => [...prev, { name: detectRootFolder(incoming), count: incoming.length }]);
  };

  const handleClear = () => {
    setScanned(null);
    setChecked({});
    setCheckedFiles(new Set());
    setExpanded({});
    setSelectedCampaigns(new Set());
    setSelectedUiFolders(new Set());
    setExpandedCampaign(new Set());
    setExpandedUiFolder(new Set());
    setFolderSelections([]);
  };

  const toggleCat = (cat) => {
    const willBeOn = !checked[cat];
    setChecked(prev => ({ ...prev, [cat]: willBeOn }));
    if (scanned && INDIVIDUAL_SELECT_CATS.has(cat)) {
      const files = scanned.byCategory[cat] || [];
      setCheckedFiles(prev => {
        const next = new Set(prev);
        files.forEach(f => willBeOn ? next.add(fkey(f)) : next.delete(fkey(f)));
        return next;
      });
    }
  };

  const toggleFile = (f) => {
    const k = fkey(f);
    setCheckedFiles(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const toggleExpand = (cat) => setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }));

  const toggleCampaign = (name) => setSelectedCampaigns(prev =>
    prev.has(name) ? new Set() : new Set([name]));

  const toggleUiFolder = (name) => setSelectedUiFolders(prev => {
    const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n;
  });
  const toggleExpandCampaign = (name) => setExpandedCampaign(prev => {
    const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n;
  });
  const toggleExpandUiFolder = (name) => setExpandedUiFolder(prev => {
    const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n;
  });

  const directCampaignFiles = (folder) => (scanned?.byCategory['campaign'] || []).filter(f =>
    `/${(f.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/')}`.includes(`/campaign/${folder}/`));
  const customCampaignFiles = (folder) => (scanned?.byCategory['campaign'] || []).filter(f =>
    `/${(f.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/')}`.includes(`/campaign/custom/${folder}/`));
  const uiFolderFiles = (folder) => (scanned?.byCategory['images_ui'] || []).filter(f =>
    `/${(f.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/')}`.includes(`/ui/${folder}/`));

  const countSelected = () => {
    if (!scanned) return 0;
    let s = 0;
    for (const [cat, files] of Object.entries(scanned.byCategory)) {
      if (!checked[cat]) continue;
      if (cat === 'campaign') {
        s += files.filter(f => {
          const path = (f.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/');
          const framed = `/${path}`;
          const customMatch = framed.match(/\/maps\/campaign\/custom\/([^/]+)\//);
          if (customMatch) return selectedCampaigns.has(customMatch[1]);
          const directMatch = framed.match(/\/maps\/campaign\/([^/]+)\//);
          if (directMatch && directMatch[1] !== 'custom') return selectedCampaigns.has(directMatch[1]);
          return true;
        }).length;
      } else if (cat === 'images_ui') {
        s += files.filter(f => {
          const path = (f.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/');
          const m = `/${path}`.match(/\/ui\/([^/]+)\//);
          return !m || selectedUiFolders.has(m[1]);
        }).length;
      } else {
        s += files.filter(f => checkedFiles.has(fkey(f))).length;
      }
    }
    return s;
  };

  const handleConfirm = () => {
    if (!scanned) return;
    const toLoad = [];
    for (const [cat, files] of Object.entries(scanned.byCategory)) {
      if (!checked[cat]) continue;
      if (cat === 'campaign') {
        const baseFiles = [], campaignFiles = [];
        for (const file of files) {
          const path = (file.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/');
          const framed = `/${path}`;
          const customMatch = framed.match(/\/maps\/campaign\/custom\/([^/]+)\//);
          if (customMatch) { if (selectedCampaigns.has(customMatch[1])) campaignFiles.push(file); continue; }
          const directMatch = framed.match(/\/maps\/campaign\/([^/]+)\//);
          if (directMatch && directMatch[1] !== 'custom') { if (selectedCampaigns.has(directMatch[1])) campaignFiles.push(file); continue; }
          baseFiles.push(file);
        }
        const campaignFileNames = new Set(campaignFiles.map(f => f.name.toLowerCase()));
        for (const f of baseFiles) { if (!campaignFileNames.has(f.name.toLowerCase())) toLoad.push(f); }
        toLoad.push(...campaignFiles);
      } else if (cat === 'images_ui') {
        for (const file of files) {
          const path = (file.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/');
          const match = `/${path}`.match(/\/ui\/([^/]+)\//);
          if (!match || selectedUiFolders.has(match[1])) toLoad.push(file);
        }
      } else {
        toLoad.push(...files.filter(f => checkedFiles.has(fkey(f))));
      }
    }
    onLoad(toLoad, [...(scanned.directCampaigns || []), ...(scanned.customCampaigns || [])], [...selectedCampaigns]);
  };

  const totalSelected = countSelected();

  return (
    <div className="space-y-3">
      <label className="cursor-pointer">
        <input ref={inputRef} type="file" className="hidden"
          webkitdirectory="" directory="" multiple onChange={handleFolderSelect} />
        <Button asChild variant="outline"
          className="w-full h-11 border-primary/30 text-primary hover:bg-primary/10 pointer-events-none gap-2">
          <span>
            {scanned ? <Plus className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />}
            {scanned ? 'Add another folder' : 'Browse to'} <code className="text-xs font-mono">…\data\</code>
          </span>
        </Button>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" size="sm" className="h-8 text-[11px] gap-1.5" onClick={() => inputRef.current?.click()}>
          <FolderOpen className="w-3.5 h-3.5" />
          Add Rome/mod folder
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 text-[11px] gap-1.5" onClick={handleClear} disabled={!scanned}>
          <Trash2 className="w-3.5 h-3.5" />
          Clear scan
        </Button>
      </div>

      {!scanned && (
        <p className="text-[10px] text-muted-foreground text-center">
          Select vanilla <code className="font-mono">Rome Total War Gold\data</code>, then add a mod data folder to merge both in one load.
        </p>
      )}

      {scanned && (
        <div className="border border-border rounded-lg overflow-hidden bg-background">
          <div className="px-3 py-2 border-b border-border bg-accent/10 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground">
              {scanned.allFiles.length} files detected
            </span>
            <span className="text-[10px] text-muted-foreground">{folderSelections.length} folders · {totalSelected} selected</span>
          </div>

          {folderSelections.length > 0 && (
            <div className="px-3 py-1.5 border-b border-border bg-background/80 flex flex-wrap gap-1">
              {folderSelections.map((folder, idx) => (
                <Badge key={`${folder.name}-${idx}`} variant="outline" className="h-5 text-[10px] max-w-full">
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-1 text-muted-foreground">({folder.count})</span>
                </Badge>
              ))}
            </div>
          )}

          <div className="divide-y divide-border">
            {Object.entries(CATEGORY_LABELS).map(([cat, meta]) => {
              const files = scanned.byCategory[cat];
              if (!files || files.length === 0) return null;
              const Icon = meta.icon;
              const isOn = !!checked[cat];
              const isExp = !!expanded[cat];
              const selectedCount = INDIVIDUAL_SELECT_CATS.has(cat)
                ? files.filter(f => checkedFiles.has(fkey(f))).length
                : files.length;

              return (
                <div key={cat}>
                  {/* Category header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/5">
                    <input type="checkbox" checked={isOn} onChange={() => toggleCat(cat)}
                      className="accent-primary w-3.5 h-3.5 shrink-0" />
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isOn ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className={`text-xs flex-1 font-medium ${isOn ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {meta.label}
                    </span>
                    {INDIVIDUAL_SELECT_CATS.has(cat) ? (
                      <span className="text-[10px] text-muted-foreground">{selectedCount}/{files.length}</span>
                    ) : (
                      <Badge variant="outline" className="text-[10px] h-4">{files.length}</Badge>
                    )}
                    {!meta.defaultOn && <span className="text-[9px] text-amber-400 font-medium">large</span>}
                    <button onClick={() => toggleExpand(cat)} className="text-muted-foreground hover:text-foreground ml-1">
                      {isExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                  </div>

                  {/* Expanded content */}
                  {isExp && (
                    <div className="bg-accent/5 px-3 py-2">

                      {/* Individual file selection: compact 2-column chip grid */}
                      {INDIVIDUAL_SELECT_CATS.has(cat) ? (
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                          {files.map((f, i) => {
                            const k = fkey(f);
                            const isChecked = checkedFiles.has(k);
                            return (
                              <label key={i} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-accent/20 cursor-pointer group min-w-0">
                                <input type="checkbox" checked={isChecked} onChange={() => toggleFile(f)}
                                  className="accent-primary w-3 h-3 shrink-0" />
                                <span className={`text-[10px] font-mono truncate leading-tight ${isChecked ? 'text-foreground' : 'text-muted-foreground/50 line-through'}`}
                                  title={f.name}>
                                  {f.name}
                                </span>
                              </label>
                            );
                          })}
                        </div>

                      /* Campaign: base + direct (radio) + custom sub-folders (radio) */
                      ) : cat === 'campaign' ? (
                        <div className="space-y-1">
                          {(() => {
                            const baseFiles = (scanned.byCategory['campaign'] || []).filter(f =>
                              `/${(f.webkitRelativePath || '').toLowerCase().replace(/\\/g, '/')}`.includes('/maps/base/'));
                            if (!baseFiles.length) return null;
                            const isExpB = expandedCampaign.has('__base__');
                            return (
                              <div>
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 shrink-0" />
                                  <span className="text-[11px] font-mono text-foreground flex-1">maps/base/</span>
                                  <span className="text-[9px] text-green-400 font-medium">always</span>
                                  <span className="text-[10px] text-muted-foreground">{baseFiles.length} files</span>
                                  <button onClick={() => toggleExpandCampaign('__base__')} className="text-muted-foreground hover:text-foreground">
                                    {isExpB ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  </button>
                                </div>
                                {isExpB && (
                                  <div className="ml-5 mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
                                    {baseFiles.map((f, i) => <p key={i} className="text-[10px] font-mono text-muted-foreground truncate">{f.name}</p>)}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {scanned.directCampaigns.map(folder => {
                            const folderFiles = directCampaignFiles(folder);
                            const isExpF = expandedCampaign.has(folder);
                            return (
                              <div key={folder}>
                                <div className="flex items-center gap-2">
                                  <input type="radio" name="campaign_select" checked={selectedCampaigns.has(folder)}
                                    onChange={() => toggleCampaign(folder)} className="accent-primary w-3 h-3 shrink-0" />
                                  <span className="text-[11px] font-mono text-foreground flex-1">{folder}/</span>
                                  <span className="text-[10px] text-muted-foreground">{folderFiles.length} files</span>
                                  <button onClick={() => toggleExpandCampaign(folder)} className="text-muted-foreground hover:text-foreground">
                                    {isExpF ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  </button>
                                </div>
                                {isExpF && (
                                  <div className="ml-5 mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
                                    {folderFiles.map((f, i) => <p key={i} className="text-[10px] font-mono text-muted-foreground truncate">{f.name}</p>)}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {scanned.customCampaigns.length > 0 && (
                            <>
                              <p className="text-[10px] text-muted-foreground pt-1 pb-0.5 border-t border-border mt-1">custom/ — select one:</p>
                              {scanned.customCampaigns.map(folder => {
                                const folderFiles = customCampaignFiles(folder);
                                const isExpF = expandedCampaign.has(`custom:${folder}`);
                                return (
                                  <div key={folder}>
                                    <div className="flex items-center gap-2">
                                      <input type="radio" name="campaign_select" checked={selectedCampaigns.has(folder)}
                                        onChange={() => toggleCampaign(folder)} className="accent-primary w-3 h-3 shrink-0" />
                                      <span className="text-[11px] font-mono text-foreground flex-1">custom/{folder}/</span>
                                      <span className="text-[10px] text-muted-foreground">{folderFiles.length} files</span>
                                      <button onClick={() => toggleExpandCampaign(`custom:${folder}`)} className="text-muted-foreground hover:text-foreground">
                                        {isExpF ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                      </button>
                                    </div>
                                    {isExpF && (
                                      <div className="ml-5 mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
                                        {folderFiles.map((f, i) => <p key={i} className="text-[10px] font-mono text-muted-foreground truncate">{f.name}</p>)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>

                      /* UI images: sub-folder checkboxes */
                      ) : cat === 'images_ui' && scanned.uiFolders.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground mb-1">Select UI sub-folders:</p>
                          {scanned.uiFolders.map(folder => {
                            const folderFiles = uiFolderFiles(folder);
                            const isFolderExp = expandedUiFolder.has(folder);
                            return (
                              <div key={folder}>
                                <div className="flex items-center gap-2">
                                  <input type="checkbox" checked={selectedUiFolders.has(folder)} onChange={() => toggleUiFolder(folder)}
                                    className="accent-primary w-3 h-3 shrink-0" />
                                  <span className="text-[11px] font-mono text-foreground flex-1">ui/{folder}/</span>
                                  <span className="text-[10px] text-muted-foreground">{folderFiles.length} files</span>
                                  <button onClick={() => toggleExpandUiFolder(folder)} className="text-muted-foreground hover:text-foreground">
                                    {isFolderExp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  </button>
                                </div>
                                {isFolderExp && (
                                  <div className="ml-5 mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
                                    {folderFiles.map((f, i) => <p key={i} className="text-[10px] font-mono text-muted-foreground truncate">{f.name}</p>)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="px-3 py-2 border-t border-border bg-accent/10">
            <Button className="w-full h-9 gap-2 text-xs" onClick={handleConfirm}
              disabled={loading || totalSelected === 0}>
              {loading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading files…</>
                : <><CheckCircle2 className="w-3.5 h-3.5" /> Load {totalSelected} selected files</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
