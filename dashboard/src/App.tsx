import { Routes, Route } from "react-router-dom";
import Nav from "./components/Nav";
import Agents from "./pages/Agents";
import AgentDetail from "./pages/AgentDetail";
import SessionDetail from "./pages/SessionDetail";
import Activity from "./pages/Activity";
import Guardrails from "./pages/Guardrails";

export default function App() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-6xl mx-auto px-6 py-12">
        <Routes>
          <Route path="/" element={<Agents />} />
          <Route path="/agent/:agentId" element={<AgentDetail />} />
          <Route path="/session/:sessionKey" element={<SessionDetail />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/guardrails" element={<Guardrails />} />
        </Routes>
      </main>
    </div>
  );
}
