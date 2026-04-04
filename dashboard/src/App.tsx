import { Routes, Route } from "react-router-dom";
import Nav from "./components/Nav";
import Overview from "./pages/Overview";
import AgentDetail from "./pages/AgentDetail";
import SessionDetail from "./pages/SessionDetail";
import Activity from "./pages/Activity";

export default function App() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/agent/:agentId" element={<AgentDetail />} />
          <Route path="/session/:sessionKey" element={<SessionDetail />} />
          <Route path="/activity" element={<Activity />} />
        </Routes>
      </main>
    </div>
  );
}
