import { Routes, Route } from "react-router-dom";
import Nav from "./components/Nav";
import PageFooter from "./components/PageFooter";
import Agents from "./pages/Agents";
import AgentDetail from "./pages/AgentDetail";
import Sessions from "./pages/Sessions";
import SessionDetail from "./pages/SessionDetail";
import Activity from "./pages/Activity";
import Guardrails from "./pages/Guardrails";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="cl-page-main flex-1">
        <Routes>
          <Route path="/" element={<Agents />} />
          <Route path="/agent/:agentId" element={<AgentDetail />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/session/:sessionKey" element={<SessionDetail />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/guardrails" element={<Guardrails />} />
        </Routes>
      </main>
      <PageFooter />
    </div>
  );
}
