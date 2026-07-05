import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import CampaignMap from './pages/CampaignMap';
import CampaignManager from './pages/CampaignManager';
import SoundEditor from './pages/SoundEditor';

import TraitsEditor from './pages/TraitsEditor';
import AncillariesEditor from './pages/AncillariesEditor';
import LuaScripts from './pages/LuaScripts';
import UnitEditor from './pages/UnitEditor';
import TextLocalizationEditor from './pages/TextLocalizationEditor';
import AssetsConverter from './pages/AssetsConverter';
import UnitCardGenerator from './pages/UnitCardGenerator';
import AnimationEditor from './pages/AnimationEditor';
import GoatTools from './pages/GoatTools';
import ScriptEditor from './pages/ScriptEditor';
import CulturesEditor from './pages/CulturesEditor';
import FactionsEditor from './pages/FactionsEditor';
import CampaignSettings from './pages/CampaignSettings';
import MinorFiles from './pages/MinorFiles';
import NewMapEditor from './pages/NewMapEditor';
import BattleModelsEditor from './pages/BattleModelsEditor';
import RomeTools from './pages/RomeTools';
import AIGenerator from './pages/AIGenerator';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const LocalApp = () => {
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/CampaignMap" element={<LayoutWrapper currentPageName="CampaignMap"><CampaignMap /></LayoutWrapper>} />
      <Route path="/CampaignManager" element={<LayoutWrapper currentPageName="CampaignManager"><CampaignManager /></LayoutWrapper>} />
      <Route path="/SoundEditor" element={<LayoutWrapper currentPageName="SoundEditor"><SoundEditor /></LayoutWrapper>} />

      <Route path="/TraitsEditor" element={<LayoutWrapper currentPageName="TraitsEditor"><TraitsEditor /></LayoutWrapper>} />
      <Route path="/AncillariesEditor" element={<LayoutWrapper currentPageName="AncillariesEditor"><AncillariesEditor /></LayoutWrapper>} />
      <Route path="/LuaScripts" element={<LayoutWrapper currentPageName="LuaScripts"><LuaScripts /></LayoutWrapper>} />
      <Route path="/UnitEditor" element={<LayoutWrapper currentPageName="UnitEditor"><UnitEditor /></LayoutWrapper>} />
      <Route path="/TextLocalizationEditor" element={<LayoutWrapper currentPageName="TextLocalizationEditor"><TextLocalizationEditor /></LayoutWrapper>} />
      <Route path="/AssetsConverter" element={<LayoutWrapper currentPageName="AssetsConverter"><AssetsConverter /></LayoutWrapper>} />
      <Route path="/UnitCardGenerator" element={<LayoutWrapper currentPageName="UnitCardGenerator"><UnitCardGenerator /></LayoutWrapper>} />
      <Route path="/AnimationEditor" element={<LayoutWrapper currentPageName="AnimationEditor"><AnimationEditor /></LayoutWrapper>} />
      <Route path="/GoatTools" element={<LayoutWrapper currentPageName="GoatTools"><GoatTools /></LayoutWrapper>} />
      <Route path="/ScriptEditor" element={<LayoutWrapper currentPageName="ScriptEditor"><ScriptEditor /></LayoutWrapper>} />
      <Route path="/CulturesEditor" element={<LayoutWrapper currentPageName="CulturesEditor"><CulturesEditor /></LayoutWrapper>} />
      <Route path="/FactionsEditor" element={<LayoutWrapper currentPageName="FactionsEditor"><FactionsEditor /></LayoutWrapper>} />
      <Route path="/CampaignSettings" element={<LayoutWrapper currentPageName="CampaignSettings"><CampaignSettings /></LayoutWrapper>} />
      <Route path="/MinorFiles" element={<LayoutWrapper currentPageName="MinorFiles"><MinorFiles /></LayoutWrapper>} />
      <Route path="/NewMapEditor" element={<LayoutWrapper currentPageName="NewMapEditor"><NewMapEditor /></LayoutWrapper>} />
      <Route path="/BattleModelsEditor" element={<LayoutWrapper currentPageName="BattleModelsEditor"><BattleModelsEditor /></LayoutWrapper>} />
      <Route path="/RomeTools" element={<LayoutWrapper currentPageName="RomeTools"><RomeTools /></LayoutWrapper>} />
      <Route path="/AIGenerator" element={<LayoutWrapper currentPageName="AIGenerator"><AIGenerator /></LayoutWrapper>} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router basename={import.meta.env.BASE_URL}>
        <LocalApp />
      </Router>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App
