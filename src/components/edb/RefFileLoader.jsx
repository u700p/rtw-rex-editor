import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle2, FolderOpen } from 'lucide-react';
import { useRefData } from './RefDataContext';
import { useEDB } from './EDBContext';

const REF_FILE_MAP = {
  'descr_sm_factions.txt': 'fac',
  'descr_sm_resources.txt': 'res',
  'descr_events.txt': 'ev',
  'export_descr_unit.txt': 'unit'
};

function FileBtn({ label, hint, onLoad, loaded }) {
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onLoad(ev.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  };
  return null;

}

export default function RefFileLoader() {
  const { loadFactionsFile, loadResourcesFile, loadEventsFile, loadUnitsFile } = useRefData();
  const { loadEDB } = useEDB();
  const folderRef = useRef();
  const [loaded, setLoaded] = useState({});

  const load = (key, fn) => (text, filename) => {fn(text, filename);setLoaded((p) => ({ ...p, [key]: true }));};

  const loaderMap = {
    fac: load('fac', loadFactionsFile),
    res: load('res', loadResourcesFile),
    ev: load('ev', loadEventsFile),
    unit: load('unit', loadUnitsFile)
  };

  const handleFolderSelect = (e) => {
    const files = Array.from(e.target.files || []);
    let edbFile = null;
    for (const file of files) {
      const name = file.name.toLowerCase();
      const key = REF_FILE_MAP[name];
      if (key) {
        const reader = new FileReader();
        reader.onload = (ev) => loaderMap[key](ev.target.result, file.name);
        reader.readAsText(file);
      }
      if (name === 'export_descr_buildings.txt') edbFile = file;
    }
    if (edbFile) {
      const reader = new FileReader();
      reader.onload = (ev) => loadEDB(ev.target.result, edbFile.name);
      reader.readAsText(edbFile);
    }
    e.target.value = '';
  };

  return null;















}
