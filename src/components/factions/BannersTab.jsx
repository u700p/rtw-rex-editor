import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, FileText, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseBannersXml, serialiseBannersXml } from '@/components/minorfiles/banners/bannersParser';

export default function BannersTab({ factionName }) {
  const [bannersData, setBannersData] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const fileRef = useRef();

  const loadBanners = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBannersData(text);
    const parsed = parseBannersXml(text);
    setParsedData(parsed);
    localStorage.setItem(`m2tw_banners_${factionName}`, text);
    e.target.value = '';
  }, [factionName]);

  const exportBanners = () => {
    if (!parsedData) return;
    const text = serialiseBannersXml(parsedData);
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'descr_banners_new.xml';
    a.click();
  };

  const updateTexture = (bannerIdx, textureIdx, field, value) => {
    if (!parsedData) return;
    const updated = { ...parsedData };
    updated.factionBanners = updated.factionBanners.map((b, i) => {
      if (i !== bannerIdx) return b;
      const newTextures = b.textures.map((t, j) =>
        j === textureIdx ? { ...t, [field]: value } : t
      );
      return { ...b, textures: newTextures };
    });
    setParsedData(updated);
    const text = serialiseBannersXml(updated);
    setBannersData(text);
    localStorage.setItem(`m2tw_banners_${factionName}`, text);
  };

  const addTexture = (bannerIdx) => {
    if (!parsedData) return;
    const updated = { ...parsedData };
    updated.factionBanners = updated.factionBanners.map((b, i) => {
      if (i !== bannerIdx) return b;
      return {
        ...b,
        textures: [...b.textures, { faction: factionName, diffuseMap: '', translucencyMap: '' }]
      };
    });
    setParsedData(updated);
    const text = serialiseBannersXml(updated);
    setBannersData(text);
    localStorage.setItem(`m2tw_banners_${factionName}`, text);
  };

  const removeTexture = (bannerIdx, textureIdx) => {
    if (!parsedData) return;
    const updated = { ...parsedData };
    updated.factionBanners = updated.factionBanners.map((b, i) => {
      if (i !== bannerIdx) return b;
      return { ...b, textures: b.textures.filter((_, j) => j !== textureIdx) };
    });
    setParsedData(updated);
    const text = serialiseBannersXml(updated);
    setBannersData(text);
    localStorage.setItem(`m2tw_banners_${factionName}`, text);
  };

  // Copy textures from another faction to this one
  const copyFromFaction = (sourceFactionName) => {
    if (!parsedData || !sourceFactionName) return;
    const updated = { ...parsedData };
    
    updated.factionBanners = updated.factionBanners.map((banner) => {
      const sourceTextures = banner.textures.filter(t => 
        t.faction.toLowerCase() === sourceFactionName.toLowerCase()
      );
      
      if (sourceTextures.length === 0) return banner;
      
      const existingTextureIndices = banner.textures
        .map((t, i) => t.faction.toLowerCase() === factionName.toLowerCase() ? i : -1)
        .filter(i => i !== -1);
      
      let newTextures = [...banner.textures];
      existingTextureIndices.forEach(idx => {
        newTextures[idx] = null;
      });
      newTextures = newTextures.filter(t => t !== null);
      
      sourceTextures.forEach(sourceTex => {
        newTextures.push({
          faction: factionName,
          diffuseMap: sourceTex.diffuseMap,
          translucencyMap: sourceTex.translucencyMap
        });
      });
      
      return { ...banner, textures: newTextures };
    });
    
    setParsedData(updated);
    const text = serialiseBannersXml(updated);
    setBannersData(text);
    localStorage.setItem(`m2tw_banners_${factionName}`, text);
  };

  useEffect(() => {
    try {
      const data = localStorage.getItem(`m2tw_banners_${factionName}`);
      if (data) {
        setBannersData(data);
        const parsed = parseBannersXml(data);
        setParsedData(parsed);
      }
    } catch {}
  }, [factionName]);

  const factionBanners = parsedData?.factionBanners || [];
  
  const textureEntries = [];
  factionBanners.forEach((banner, bIdx) => {
    banner.textures.forEach((texture, tIdx) => {
      if (texture.faction.toLowerCase() === factionName.toLowerCase()) {
        textureEntries.push({
          bannerIdx: bIdx,
          textureIdx: tIdx,
          bannerName: banner.name,
          texture
        });
      }
    });
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-600 pb-2">
        <div>
          <p className="text-sm font-semibold text-slate-200">Banner Textures</p>
          <p className="text-xs text-slate-400">Edit texture paths for {factionName}</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xml" className="hidden" onChange={loadBanners} />
          <Button variant="outline" size="sm" className="text-[10px]" onClick={() => fileRef.current?.click()}>
            <Upload className="w-3 h-3 mr-1" /> Load XML
          </Button>
          {parsedData && (
            <Button variant="outline" size="sm" className="text-[10px]" onClick={exportBanners}>
              <Download className="w-3 h-3 mr-1" /> Export
            </Button>
          )}
        </div>
      </div>

      {parsedData ? (
        <div className="space-y-4">
          {textureEntries.length === 0 ? (
            <div className="text-center py-12 text-slate-500 border-2 border-dashed border-slate-700 rounded-lg">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No texture entries for {factionName}</p>
              <p className="text-xs mt-1">Use "Copy From Faction" to add entries from another faction</p>
            </div>
          ) : (
            <div className="space-y-3">
              {textureEntries.map((entry, idx) => (
                <div key={idx} className="border border-slate-600 rounded p-3 bg-slate-800/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300">{entry.bannerName}</span>
                    <button
                      onClick={() => removeTexture(entry.bannerIdx, entry.textureIdx)}
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 w-20">Diffuse Map:</span>
                      <Input
                        className="h-7 text-[10px] bg-slate-700 border-slate-600 text-slate-200 font-mono flex-1"
                        value={entry.texture.diffuseMap}
                        onChange={(e) => updateTexture(entry.bannerIdx, entry.textureIdx, 'diffuseMap', e.target.value)}
                        placeholder="path/to/texture.tga"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 w-20">Translucency Map:</span>
                      <Input
                        className="h-7 text-[10px] bg-slate-700 border-slate-600 text-slate-200 font-mono flex-1"
                        value={entry.texture.translucencyMap}
                        onChange={(e) => updateTexture(entry.bannerIdx, entry.textureIdx, 'translucencyMap', e.target.value)}
                        placeholder="path/to/translucency.tga"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {textureEntries.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-[10px]"
              onClick={() => addTexture(textureEntries[0]?.bannerIdx || 0)}
            >
              <Plus className="w-3 h-3 mr-1" /> Add New Texture Entry
            </Button>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500 border-2 border-dashed border-slate-700 rounded-lg">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No banners file loaded</p>
          <p className="text-xs mt-1">Click "Load XML" to import descr_banners_new.xml</p>
        </div>
      )}
    </div>
  );
}