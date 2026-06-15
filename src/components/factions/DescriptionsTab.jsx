import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Download, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseStringsBin, encodeStringsBin } from '@/components/strings/stringsBinCodec';

export default function DescriptionsTab({ factionName }) {
  const [expandedData, setExpandedData] = useState('');
  const [campaignDescData, setCampaignDescData] = useState('');
  const [stringsBinEntries, setStringsBinEntries] = useState([]);
  const expandedRef = useRef();
  const campaignRef = useRef();
  const stringsBinRef = useRef();

  const loadExpanded = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setExpandedData(text);
    localStorage.setItem(`m2tw_expanded_${factionName}`, text);
    e.target.value = '';
  }, [factionName]);

  const loadCampaignDesc = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCampaignDescData(text);
    localStorage.setItem(`m2tw_campaign_desc_${factionName}`, text);
    e.target.value = '';
  }, [factionName]);

  const loadStringsBin = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const parsed = parseStringsBin(arrayBuffer);
    if (parsed && parsed.entries) {
      // Filter entries that contain the faction name in the key
      const factionUpper = factionName.toUpperCase();
      const filtered = parsed.entries.filter(entry => 
        entry.key && entry.key.toUpperCase().includes(factionUpper)
      );
      setStringsBinEntries(filtered);
      // Store raw buffer for export
      localStorage.setItem(`m2tw_strings_bin_${factionName}`, JSON.stringify({
        entries: parsed.entries,
        magic1: parsed.magic1,
        magic2: parsed.magic2
      }));
    }
    e.target.value = '';
  }, [factionName]);

  const exportFile = (data, filename) => {
    if (!data) return;
    const blob = new Blob([data], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };

  const exportStringsBin = () => {
    if (stringsBinEntries.length === 0) return;
    // Get all entries from storage (not just filtered ones)
    try {
      const stored = localStorage.getItem(`m2tw_strings_bin_${factionName}`);
      if (stored) {
        const { entries, magic1, magic2 } = JSON.parse(stored);
        const buffer = encodeStringsBin(entries, magic1, magic2);
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'strings.bin';
        a.click();
      }
    } catch {}
  };

  const updateStringValue = (key, newValue) => {
    // Update the filtered entry
    setStringsBinEntries(prev => 
      prev.map(entry => entry.key === key ? { ...entry, value: newValue } : entry)
    );
    // Also update the full stored data
    try {
      const stored = localStorage.getItem(`m2tw_strings_bin_${factionName}`);
      if (stored) {
        const { entries, magic1, magic2 } = JSON.parse(stored);
        const updatedEntries = entries.map(entry => 
          entry.key === key ? { ...entry, value: newValue } : entry
        );
        localStorage.setItem(`m2tw_strings_bin_${factionName}`, JSON.stringify({
          entries: updatedEntries,
          magic1,
          magic2
        }));
      }
    } catch {}
  };

  useEffect(() => {
    try {
      const exp = localStorage.getItem(`m2tw_expanded_${factionName}`);
      if (exp) setExpandedData(exp);
    } catch {}
    try {
      const camp = localStorage.getItem(`m2tw_campaign_desc_${factionName}`);
      if (camp) setCampaignDescData(camp);
    } catch {}
    try {
      const stored = localStorage.getItem(`m2tw_strings_bin_${factionName}`);
      if (stored) {
        const { entries, magic1, magic2 } = JSON.parse(stored);
        const factionUpper = factionName.toUpperCase();
        const filtered = entries.filter(entry => 
          entry.key && entry.key.toUpperCase().includes(factionUpper)
        );
        setStringsBinEntries(filtered);
      }
    } catch {}
  }, [factionName]);

  return (
    <div className="space-y-4">
      <div className="border-b border-slate-600 pb-2">
        <p className="text-sm font-semibold text-slate-200">Faction Descriptions</p>
        <p className="text-xs text-slate-400">Edit expanded.txt and campaign_descriptions.txt for {factionName}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-slate-300">expanded.txt</label>
          <div className="flex gap-2">
            <input ref={expandedRef} type="file" accept=".txt" className="hidden" onChange={loadExpanded} />
            <Button variant="outline" size="sm" className="text-[10px]" onClick={() => expandedRef.current?.click()}>
              <Upload className="w-3 h-3 mr-1" /> Load
            </Button>
            {expandedData && (
              <Button variant="outline" size="sm" className="text-[10px]" onClick={() => exportFile(expandedData, 'expanded.txt')}>
                <Download className="w-3 h-3 mr-1" /> Export
              </Button>
            )}
          </div>
        </div>
        {expandedData ? (
          <textarea
            className="w-full h-48 bg-slate-800 border border-slate-600 rounded p-3 text-[10px] font-mono text-slate-200"
            value={expandedData}
            onChange={(e) => {
              setExpandedData(e.target.value);
              localStorage.setItem(`m2tw_expanded_${factionName}`, e.target.value);
            }}
          />
        ) : (
          <div className="text-center py-6 text-slate-500 border border-dashed border-slate-700 rounded">
            <p className="text-xs">No expanded.txt loaded</p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-slate-300">campaign_descriptions.txt</label>
          <div className="flex gap-2">
            <input ref={campaignRef} type="file" accept=".txt" className="hidden" onChange={loadCampaignDesc} />
            <Button variant="outline" size="sm" className="text-[10px]" onClick={() => campaignRef.current?.click()}>
              <Upload className="w-3 h-3 mr-1" /> Load
            </Button>
            {campaignDescData && (
              <Button variant="outline" size="sm" className="text-[10px]" onClick={() => exportFile(campaignDescData, 'campaign_descriptions.txt')}>
                <Download className="w-3 h-3 mr-1" /> Export
              </Button>
            )}
          </div>
        </div>
        {campaignDescData ? (
          <textarea
            className="w-full h-48 bg-slate-800 border border-slate-600 rounded p-3 text-[10px] font-mono text-slate-200"
            value={campaignDescData}
            onChange={(e) => {
              setCampaignDescData(e.target.value);
              localStorage.setItem(`m2tw_campaign_desc_${factionName}`, e.target.value);
            }}
          />
        ) : (
          <div className="text-center py-6 text-slate-500 border border-dashed border-slate-700 rounded">
            <p className="text-xs">No campaign_descriptions.txt loaded</p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-slate-300">strings.bin (faction entries)</label>
          <div className="flex gap-2">
            <input ref={stringsBinRef} type="file" accept=".bin" className="hidden" onChange={loadStringsBin} />
            <Button variant="outline" size="sm" className="text-[10px]" onClick={() => stringsBinRef.current?.click()}>
              <Upload className="w-3 h-3 mr-1" /> Load
            </Button>
            {stringsBinEntries.length > 0 && (
              <Button variant="outline" size="sm" className="text-[10px]" onClick={exportStringsBin}>
                <Download className="w-3 h-3 mr-1" /> Export
              </Button>
            )}
          </div>
        </div>
        {stringsBinEntries.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {stringsBinEntries.map((entry, idx) => (
              <div key={idx} className="bg-slate-800 border border-slate-600 rounded p-2">
                <div className="text-[9px] font-mono text-slate-500 mb-1">{entry.key}</div>
                <input
                  type="text"
                  value={entry.value}
                  onChange={(e) => updateStringValue(entry.key, e.target.value)}
                  className="w-full bg-transparent text-[11px] text-slate-200 font-mono outline-none"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 border border-dashed border-slate-700 rounded">
            <p className="text-xs">No strings.bin loaded - upload to see faction-specific entries</p>
          </div>
        )}
      </div>
    </div>
  );
}