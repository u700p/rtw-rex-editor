import React, { useState } from 'react';
import { useEDB } from '../components/edb/EDBContext';
import { useTraits } from '../components/traits/TraitsContext';
import { useAncillaries } from '../components/ancillaries/AncillariesContext';
import { useRefData } from '../components/edb/RefDataContext';
import { encodeStringsBin } from '../components/strings/stringsBinCodec';
import { parseDescrStrat, serializeDescrStrat } from '../components/map/stratParser';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Download, Package, FileText, AlertCircle, CheckCircle2, Code2, Globe2, Layers, FolderOpen } from 'lucide-react';
import JSZip from 'jszip';
import ValidationDashboard from '../components/export/ValidationDashboard';
import TriggerValidationPanel from '../components/export/TriggerValidationPanel';
import CampaignPackagePicker from '../components/export/CampaignPackagePicker';

function getCampaigns() {
  try { const s = localStorage.getItem('m2tw_campaigns'); return s ? JSON.parse(s) : []; } catch { return []; }
}

function getLuaScripts() {
  try {
    const saved = localStorage.getItem('m2tw_lua_scripts');
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function buildMergedLua(scripts) {
  const plugin = scripts.find(s => s.id === 'plugin');
  const imgui = scripts.filter(s => s.type === 'imgui');
  const custom = scripts.filter(s => s.type === 'custom');
  let out = plugin ? plugin.code : '';
  if (imgui.length) { out += '\n\n-- ═══ ImGUI Scripts ═══\n'; imgui.forEach(s => { out += `\n-- ${s.name}\n${s.code}`; }); }
  if (custom.length) { out += '\n\n-- ═══ Custom Scripts ═══\n'; custom.forEach(s => { out += `\n-- ${s.name}\n${s.code}`; }); }
  return out;
}

function encodeTGA(canvas, tw, th) {
  const off = document.createElement('canvas');
  off.width = tw; off.height = th;
  off.getContext('2d').drawImage(canvas, 0, 0, tw, th);
  const d = off.getContext('2d').getImageData(0, 0, tw, th).data;
  const hdr = new Uint8Array(18);
  hdr[2] = 2; hdr[12] = tw & 0xff; hdr[13] = tw >> 8;
  hdr[14] = th & 0xff; hdr[15] = th >> 8; hdr[16] = 32; hdr[17] = 0x28;
  const body = new Uint8Array(tw * th * 4);
  for (let i = 0; i < tw * th; i++) {
    body[i*4]=d[i*4+2]; body[i*4+1]=d[i*4+1]; body[i*4+2]=d[i*4]; body[i*4+3]=d[i*4+3];
  }
  const out = new Uint8Array(18 + body.length);
  out.set(hdr); out.set(body, 18); return out;
}

function dataUrlToCanvas(dataUrl) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.src = dataUrl;
  });
}

const IMAGE_SLOT_DEFS = [
  { type: 'icon',         w: 64,  h: 51  },
  { type: 'panel',        w: 78,  h: 62  },
  { type: 'construction', w: 300, h: 245 },
];

export default function Export() {
  const { edbData, exportEDB, textData, exportTextFile, imageData } = useEDB();
  const { traitsData, traitsFilename, exportTraitsFile, textData: traitsTextData, textBinMeta: traitsBinMeta, textFilename: traitsTextFilename, exportTextFile: exportTraitsTextFile } = useTraits();
  const { ancData, ancFilename, exportAncFile, textData: ancTextData, textBinMeta: ancBinMeta, textFilename: ancTextFilename, exportTextFile: exportAncTextFile } = useAncillaries();
  const { guildData, exportGuildsFile } = useRefData();
  const [building, setBuilding] = useState(false);
  const [done, setDone] = useState(false);
  const [exportingTwemp, setExportingTwemp] = useState(false);
  // Map<relativePath, File> for extra files to bundle
  const [extraFiles, setExtraFiles] = useState(new Map());
  const luaScripts = getLuaScripts();
  const hasLua = luaScripts.length > 0;
  const campaigns = getCampaigns();
  const hasCampaigns = campaigns.length > 0;

  const modName = (() => {
    try { return localStorage.getItem('m2tw_mod_name') || 'my_mod'; } catch { return 'my_mod'; }
  })();
  const buildingTextIsBinary = (() => {
    try { return !!localStorage.getItem('m2tw_edb_txt_bin_magic1') || !!localStorage.getItem('m2tw_edb_txt_bin_magic2'); } catch { return false; }
  })();
  const buildingTextLabel = buildingTextIsBinary ? 'export_buildings.txt.strings.bin' : 'export_buildings.txt';

  const handleExportZip = async () => {
    setBuilding(true);
    setDone(false);

    const zip = new JSZip();
    const dataFolder = zip.folder(`${modName}/data`);

    if (edbData) {
      const edbText = exportEDB().replace(/\n/g, '\r\n');
      dataFolder.file('export_descr_buildings.txt', edbText);
    }

    if (textData && Object.keys(textData).length > 0) {
      if (buildingTextIsBinary) {
        const magic1 = parseInt(localStorage.getItem('m2tw_edb_txt_bin_magic1') || '2');
        const magic2 = parseInt(localStorage.getItem('m2tw_edb_txt_bin_magic2') || '2048');
        const entries = Object.entries(textData).map(([key, value]) => ({ key, value: String(value) }));
        const binBuf = encodeStringsBin(entries, magic1, magic2);
        dataFolder.folder('text').file('export_buildings.txt.strings.bin', new Uint8Array(binBuf));
      } else {
        dataFolder.folder('text').file('export_buildings.txt', exportTextFile().replace(/\n/g, '\r\n'));
      }
    }

    // Export building images as TGA files
    if (imageData && Object.keys(imageData).length > 0) {
      for (const [key, imgEntry] of Object.entries(imageData)) {
        if (!imgEntry?.url) continue;
        const { culture, levelName, type } = imgEntry;
        if (!culture || !levelName || !type) continue;
        const slotDef = IMAGE_SLOT_DEFS.find(s => s.type === type);
        if (!slotDef) continue;
        const canvas = await dataUrlToCanvas(imgEntry.url);
        const tga = encodeTGA(canvas, slotDef.w, slotDef.h);
        const filename = `#${culture}_${levelName}${type === 'construction' ? '_constructed' : ''}.tga`;
        const subPath = type === 'icon'
          ? `ui/${culture}/buildings/constructed/${filename}`
          : `ui/${culture}/buildings/${filename}`;
        dataFolder.file(subPath, tga);
      }
    }

    // Export traits
    if (traitsData) {
      dataFolder.file('export_descr_character_traits.txt', exportTraitsFile().replace(/\n/g, '\r\n'));
    }
    if (traitsTextData && Object.keys(traitsTextData).length > 0) {
      let traitsTextContent = exportTraitsTextFile();
      if (traitsTextContent instanceof ArrayBuffer) traitsTextContent = new Uint8Array(traitsTextContent);
      const traitsTextName = traitsTextFilename || 'export_VnVs.txt';
      dataFolder.folder('text').file(traitsTextName, traitsTextContent);
    }

    // Export guilds
    if (hasGuilds) {
      dataFolder.file('export_descr_guilds.txt', exportGuildsFile().replace(/\n/g, '\r\n'));
    }

    // Export ancillaries
    if (ancData) {
      dataFolder.file('export_descr_ancillaries.txt', exportAncFile().replace(/\n/g, '\r\n'));
    }
    if (ancTextData && Object.keys(ancTextData).length > 0) {
      let ancTextContent = exportAncTextFile();
      if (ancTextContent instanceof ArrayBuffer) ancTextContent = new Uint8Array(ancTextContent);
      const ancTextName = ancTextFilename || 'export_ancillaries.txt';
      dataFolder.folder('text').file(ancTextName, ancTextContent);
    }

    // Include Lua scripts
    const luaScripts = getLuaScripts();
    if (luaScripts.length > 0) {
      const mergedLua = buildMergedLua(luaScripts);
      zip.folder(`${modName}/eopData/eopScripts`).file('luaPluginScript.lua', mergedLua);
    }

    // Include campaigns — use modified strat data from sessionStorage if available
    const campaigns = getCampaigns();
    for (const c of campaigns) {
      const campFolder = zip.folder(`${modName}/data/world/maps/campaign/custom/${c.name}`);
      // Check if there's a modified version in sessionStorage (from CampaignMap edits)
      let stratText = c.descrStrat || `campaign\t${c.name}\n`;
      try {
        const sessionRaw = sessionStorage.getItem('m2tw_strat_raw');
        if (sessionRaw) {
          const parsed = parseDescrStrat(sessionRaw);
          // Match by campaign name to use the right modified data
          if (parsed.campaignName === c.name || !c.descrStrat) {
            stratText = serializeDescrStrat(parsed, parsed.items || [], {});
          }
        }
      } catch {}
      campFolder.file('descr_strat.txt', stratText.replace(/\n/g, '\r\n'));
    }
    if (campaigns.length > 0) {
      // Merge all campaign descriptions into one file
      const allDescs = campaigns.map(c => c.descriptions || '').join('\n');
      dataFolder.folder('text').file('campaign_descriptions.txt', `¬\n${allDescs}`.replace(/\n/g, '\r\n'));
    }

    // Bundle user-selected extra files (campaign package files)
    for (const [relPath, file] of extraFiles.entries()) {
      const buf = await file.arrayBuffer();
      zip.file(`${modName}/${relPath}`, new Uint8Array(buf));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${modName}_data.zip`;
    a.click();
    URL.revokeObjectURL(url);

    setBuilding(false);
    setDone(true);
  };

  // OpenTWEMP preset export
  const handleExportTwemp = async () => {
    setExportingTwemp(true);
    const preset = {
      ModName: modName,
      ModFolder: modName,
      GameVersion: 'M2TW',
      SupportedVersion: '1.52',
      Description: `${modName} - Created with Rome / Medieval II Mod Editor`,
      Author: 'Mod Author',
      Version: '1.0',
      LaunchParams: `@M2TW.exe -mod:mods/${modName} -show_err`,
      EopEnabled: hasLua,
      Campaigns: getCampaigns().map(c => ({ name: c.name, displayName: c.displayName || c.name })),
    };
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${modName}_twemp_preset.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportingTwemp(false);
  };

  const hasEDB = !!edbData;
  const hasText = textData && Object.keys(textData).length > 0;
  const hasGuilds = !!(guildData?.guilds?.length || guildData?.triggers?.length);
  const hasTraits = !!traitsData;
  const hasTraitsText = traitsTextData && Object.keys(traitsTextData).length > 0;
  const hasAnc = !!ancData;
  const hasAncText = ancTextData && Object.keys(ancTextData).length > 0;
  const edbStats = edbData ? {
    buildings: edbData.buildings.length,
    levels: edbData.buildings.reduce((s, b) => s + b.levels.length, 0),
  } : null;

  return (
    <div className="h-screen flex flex-col">
      <div className="h-10 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-card/50">
        <Download className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Export Mod</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 max-w-2xl mx-auto space-y-5">

          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Package className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-foreground">Output path inside zip</p>
                <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{modName}/data/</p>
              </div>
              <p className="text-[10px] text-muted-foreground">Set mod name on the Home page</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">Files to include in zip</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <ExportRow
                icon={<FileText className="w-4 h-4 text-primary/70" />}
                label="export_descr_buildings.txt"
                path={`${modName}/data/`}
                status={hasEDB ? 'ready' : 'skip'}
                detail={edbStats ? `${edbStats.buildings} buildings, ${edbStats.levels} levels` : 'No EDB loaded — will be skipped'}
              />
              <ExportRow
                icon={<FileText className="w-4 h-4 text-chart-4/70" />}
                label={buildingTextLabel}
                path={`${modName}/data/text/`}
                status={hasText ? 'ready' : 'skip'}
                detail={hasText ? `${Object.keys(textData).length} text entries${buildingTextIsBinary ? ' (.strings.bin)' : ' (.txt)'}` : 'No text data — will be skipped'}
              />
              {imageData && Object.keys(imageData).length > 0 && (
                <ExportRow
                  icon={<FileText className="w-4 h-4 text-blue-400/70" />}
                  label="Building images (.tga)"
                  path={`${modName}/data/ui/[culture]/buildings/`}
                  status="ready"
                  detail={`${Object.keys(imageData).length} image(s) exported as TGA`}
                />
              )}
              <ExportRow
                icon={<FileText className="w-4 h-4 text-amber-400/70" />}
                label="export_descr_guilds.txt"
                path={`${modName}/data/`}
                status={hasGuilds ? 'ready' : 'skip'}
                detail={hasGuilds ? `${guildData.guilds?.length || 0} guild defs, ${guildData.triggers?.length || 0} triggers` : 'No guilds file loaded'}
              />
              <ExportRow
                icon={<FileText className="w-4 h-4 text-purple-400/70" />}
                label="export_descr_character_traits.txt"
                path={`${modName}/data/`}
                status={hasTraits ? 'ready' : 'skip'}
                detail={hasTraits ? `${traitsData.traits.length} traits, ${traitsData.triggers?.length || 0} triggers` : 'No traits loaded'}
              />
              <ExportRow
                icon={<FileText className="w-4 h-4 text-purple-300/70" />}
                label={traitsTextFilename || 'export_VnVs.txt'}
                path={`${modName}/data/text/`}
                status={hasTraitsText ? 'ready' : 'skip'}
                detail={hasTraitsText ? `${Object.keys(traitsTextData).length} entries${traitsBinMeta ? ' (.strings.bin)' : ' (.txt)'}` : 'No VnVs text loaded'}
              />
              <ExportRow
                icon={<FileText className="w-4 h-4 text-yellow-400/70" />}
                label="export_descr_ancillaries.txt"
                path={`${modName}/data/`}
                status={hasAnc ? 'ready' : 'skip'}
                detail={hasAnc ? `${ancData.ancillaries.length} ancillaries, ${ancData.triggers?.length || 0} triggers` : 'No ancillaries loaded'}
              />
              <ExportRow
                icon={<FileText className="w-4 h-4 text-yellow-300/70" />}
                label={ancTextFilename || 'export_ancillaries.txt'}
                path={`${modName}/data/text/`}
                status={hasAncText ? 'ready' : 'skip'}
                detail={hasAncText ? `${Object.keys(ancTextData).length} entries${ancBinMeta ? ' (.strings.bin)' : ' (.txt)'}` : 'No ancillaries text loaded'}
              />
              <ExportRow
                icon={<Code2 className="w-4 h-4 text-green-500/70" />}
                label="luaPluginScript.lua"
                path={`${modName}/eopData/eopScripts/`}
                status={hasLua ? 'ready' : 'skip'}
                detail={hasLua ? `${luaScripts.length} script(s) merged` : 'No Lua scripts — edit on Lua Scripts page'}
              />
              <ExportRow
                icon={<Globe2 className="w-4 h-4 text-blue-400/70" />}
                label="Custom Campaigns"
                path={`${modName}/data/world/maps/campaign/custom/`}
                status={hasCampaigns ? 'ready' : 'skip'}
                detail={hasCampaigns ? `${campaigns.length} campaign(s) — descr_strat.txt per campaign` : 'No campaigns — edit on Campaigns page'}
              />
            </CardContent>
          </Card>

          {/* Campaign Package Picker */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-primary" />
                Additional Files
                {extraFiles.size > 0 && (
                  <span className="ml-auto text-[10px] font-normal text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">
                    {extraFiles.size} file{extraFiles.size !== 1 ? 's' : ''} selected
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Optionally include extra game files (map TGAs, config files, textures, etc.) in the zip. Files are placed under <code className="bg-accent px-1 rounded font-mono">{modName}/</code> preserving the relative folder structure.
              </p>
              <CampaignPackagePicker selectedFiles={extraFiles} onChange={setExtraFiles} />
            </CardContent>
          </Card>

          <ValidationDashboard edbData={edbData} />
          <TriggerValidationPanel />

          {/* OpenTWEMP Integration */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" /> Medieval II OpenTWEMP Integration
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Export a preset JSON file compatible with the{' '}
                <a href="https://github.com/OpenTWEMP/OpenTWEMP-Community-Browser" target="_blank" rel="noreferrer" className="text-primary underline">OpenTWEMP Community Browser</a>{' '}
                launcher so your mod appears in the mod list with correct launch parameters.
              </p>
              <Button
                variant="outline" className="w-full h-9 text-xs gap-2"
                onClick={handleExportTwemp}
                disabled={exportingTwemp}
              >
                <Download className="w-4 h-4" />
                Export OpenTWEMP Preset ({modName}_twemp_preset.json)
              </Button>
            </CardContent>
          </Card>

          <Button
            className="w-full h-12 text-base gap-2"
            onClick={handleExportZip}
            disabled={building || (!hasEDB && !hasTraits && !hasAnc && !hasLua && !hasCampaigns && extraFiles.size === 0)}
          >
            {building ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Building zip…
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Download {modName}_data.zip
              </>
            )}
          </Button>

          {done && (
            <div className="flex items-center gap-2 text-green-400 text-xs justify-center">
              <CheckCircle2 className="w-4 h-4" />
              Zip downloaded. Drop the <code className="font-mono bg-accent px-1 rounded">{modName}/</code> folder into the matching Rome or Medieval II mod/data location.
            </div>
          )}

          {!hasEDB && !hasTraits && !hasAnc && !hasLua && !hasCampaigns && extraFiles.size === 0 && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs justify-center">
              <AlertCircle className="w-3.5 h-3.5" />
              Load at least one moddable file to enable export.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ExportRow({ icon, label, path, status, detail }) {
  const statusStyle = { ready: 'text-green-400', skip: 'text-muted-foreground', missing: 'text-destructive' };
  const statusIcon = {
    ready:   <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />,
    skip:    <div className="w-3.5 h-3.5 rounded-full border border-border shrink-0" />,
    missing: <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />,
  };
  return (
    <div className={`flex items-center gap-3 p-2.5 rounded-lg bg-accent/30 ${status === 'skip' ? 'opacity-50' : ''}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground font-mono">{label}</p>
        <p className="text-[10px] text-muted-foreground truncate font-mono">{path}</p>
      </div>
      <div className="text-right shrink-0">
        <div className="flex items-center gap-1 justify-end">{statusIcon[status]}</div>
        <p className={`text-[10px] mt-0.5 ${statusStyle[status]}`}>{detail}</p>
      </div>
    </div>
  );
}
