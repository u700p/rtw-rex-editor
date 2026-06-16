import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { EDBProvider } from './components/edb/EDBContext';
import { RefDataProvider } from './components/edb/RefDataContext';
import { TraitsProvider } from './components/traits/TraitsContext';
import { AncillariesProvider } from './components/ancillaries/AncillariesContext';
import { ModDataProvider } from './components/shared/ModDataContext';
import { Castle, Download, Home, Shield, Package, Code2, Swords, Map, Globe, Volume2, FileText, ScrollText, Gem, Image } from 'lucide-react';
import AppErrorBoundary from './components/AppErrorBoundary';
import romeLogo from './assets/rome/rome-logo.png';

// localStorage keys that indicate a given editor has data loaded
const NAV_DATA_KEYS = {
  EDBEditor:         ['m2tw_edb_file'],
  TraitsEditor:      ['m2tw_traits_file'],
  AncillariesEditor: ['m2tw_anc_file'],
  UnitEditor:        ['m2tw_units_file'],
  CampaignMap:       ['m2tw_campaign_strat'],
  ScriptEditor:      ['m2tw_lua_scripts'],
  MinorFiles:        ['m2tw_rebel_factions_file', 'm2tw_religions_file'],
  CulturesEditor:    ['m2tw_cultures_file'],
  UnitCardGenerator: ['m2tw_unitcard_entries'],
  FactionsEditor:    ['m2tw_factions_file'],
  StringsBinEditor:  ['m2tw_edb_txt_file'],
  LuaScripts:        ['m2tw_lua_scripts'],
};

function useLoadedPages() {
  const [loaded, setLoaded] = useState({});
  useEffect(() => {
    function check() {
      const result = {};
      for (const [page, keys] of Object.entries(NAV_DATA_KEYS)) {
        try {
          result[page] = keys.some(k => !!localStorage.getItem(k));
        } catch { result[page] = false; }
      }
      setLoaded(result);
    }
    check();
    window.addEventListener('storage', check);
    // Also re-check when custom load events fire
    const events = ['load-traits','load-ancillaries','load-export-units','strings-bin-updated','lua-scripts-loaded','modeldb-file-loaded'];
    events.forEach(e => window.addEventListener(e, check));
    return () => {
      window.removeEventListener('storage', check);
      events.forEach(e => window.removeEventListener(e, check));
    };
  }, []);
  return loaded;
}

const navItems = [
{ name: 'Home', icon: Home, page: 'Home' },
{ name: 'EDB Editor', icon: Castle, page: 'EDBEditor' },
{ name: 'Traits Editor', icon: Shield, page: 'TraitsEditor' },
{ name: 'Ancillaries', icon: Gem, page: 'AncillariesEditor' },
{ name: 'Unit Editor', icon: Swords, page: 'UnitEditor' },
{ name: 'Campaign Map', icon: Map, page: 'CampaignMap' },
{ name: 'Script Editor', icon: ScrollText, page: 'ScriptEditor' },
{ name: 'Minor Files', icon: Package, page: 'MinorFiles' },
{ name: 'Cultures', icon: Globe, page: 'CulturesEditor' },
{ name: 'Factions', icon: Shield, page: 'FactionsEditor' },
{ name: 'Sound Files', icon: Volume2, page: 'SoundEditor' },
{ name: 'Strings Editor', icon: FileText, page: 'StringsBinEditor' },
{ name: '3D Model Viewer', icon: Package, page: 'AssetsConverter' },
{ name: 'Unit Card Gen', icon: Image, page: 'UnitCardGenerator' },
{ name: 'Animations', icon: Swords, page: 'AnimationEditor' },
{ name: 'GOAT Tools', icon: Swords, page: 'GoatTools' },
{ name: 'Lua Scripts', icon: Code2, page: 'LuaScripts' },
{ name: 'New Map Editor', icon: Globe, page: 'NewMapEditor' },
{ name: 'Export', icon: Download, page: 'Export' }];


export default function Layout({ children, currentPageName }) {
  const loadedPages = useLoadedPages();
  return (
    <RefDataProvider>
    <EDBProvider>
    <TraitsProvider>
    <AncillariesProvider>
    <ModDataProvider>
        <div className="dark min-h-screen bg-background flex">
          <nav className="w-16 lg:w-56 border-r border-border bg-card flex flex-col shrink-0">
            <div className="p-3 lg:p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-black/35 border border-primary/20 flex items-center justify-center overflow-hidden">
                  <img src={romeLogo} alt="Rome: Total War" className="w-9 h-auto" />
                </div>
                <div className="hidden lg:block">
                  <h1 className="text-sm font-bold text-foreground leading-none">Rome: Total War</h1>
                  <p className="text-muted-foreground text-sm">Mod Editor</p>
                </div>
              </div>
            </div>
            <div className="flex-1 p-2 space-y-1">
              {navItems.map((item) => {
                      const isActive = currentPageName === item.page;
                      return (
                        <Link
                          key={item.page}
                          to={createPageUrl(item.page)}
                          className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                      ${isActive ?
                          'bg-primary/15 text-primary' :
                          'text-muted-foreground hover:text-foreground hover:bg-accent'}`
                          }>
                          
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span className="hidden lg:block flex-1">{item.name}</span>
                    {loadedPages[item.page] && (
                      <span className="hidden lg:block w-2 h-2 rounded-full bg-green-500 shrink-0 ml-auto" title="Data loaded" />
                    )}
                    {loadedPages[item.page] && (
                      <span className="lg:hidden w-2 h-2 rounded-full bg-green-500 shrink-0 absolute bottom-1 right-1" />
                    )}
                  </Link>);

                    })}
            </div>
            <div className="p-3 border-t border-border">
              <p className="text-[10px] text-muted-foreground text-center hidden lg:block">Rome / Medieval II data tooling</p>
            </div>
          </nav>

          <main className="flex-1 min-h-screen overflow-auto">
            <AppErrorBoundary>
              {children}
            </AppErrorBoundary>
          </main>
        </div>
    </ModDataProvider>
    </AncillariesProvider>
    </TraitsProvider>
    </EDBProvider>
    </RefDataProvider>);

}
