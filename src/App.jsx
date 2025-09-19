import { useEffect, useState } from "react";
import Game from "./pages/Game";
import AuthGate from "./components/AuthGate";
import NicknameSetup from "./components/NicknameSetup";
import UserBadge from "./components/UserBadge";
import Duels from "./pages/Duels";
import RoomLobby from "./pages/RoomLobby";
import MultiplayerGame from "./pages/MultiplayerGame";

export default function App() {
  const [view, setView] = useState("menu"); // menu | single | multi | login

  // Permite abrir vistas directamente con ?view=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    if (v && ["menu","single","multi","login","duels","rooms","multiplayer"].includes(v)) {
      setView(v);
    }
  }, []);

  if (view === "single") return (<>
    <UserBadge />
    <Game />
  </>);

  if (view === "login") {
    return (
      <AuthGate>
        <UserBadge />
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
          <NicknameSetup onDone={() => setView("menu")} />
        </div>
      </AuthGate>
    );
  }

  if (view === "multi") {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <UserBadge />
        <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 420, textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>Multiplayer</h2>
          <p style={{ opacity: 0.85 }}>Elige un modo</p>
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <button onClick={() => setView("duels")} style={{ padding: "0.6rem 1rem", background: "#10b981", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Duelos 1v1</button>
            <button onClick={() => setView("rooms")} style={{ padding: "0.6rem 1rem", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Salas privadas</button>
            <button onClick={() => setView("multiplayer")} style={{ padding: "0.6rem 1rem", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Juego Multijugador (2-10)</button>
            <button onClick={() => setView("menu")} style={{ padding: "0.6rem 1rem", background: "#374151", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Volver</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "duels") {
    return (<>
      <UserBadge />
      <Duels />
      <div style={{ position: "fixed", left: 12, top: 12 }}>
        <button onClick={() => setView("multi")} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", cursor: "pointer" }}>Atrás</button>
      </div>
    </>);
  }

  if (view === "rooms") {
    return (<>
      <UserBadge />
      <RoomLobby />
      <div style={{ position: "fixed", left: 12, top: 12 }}>
        <button onClick={() => setView("multi")} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", cursor: "pointer" }}>Atrás</button>
      </div>
    </>);
  }

  if (view === "multiplayer") {
    return (<>
      <UserBadge />
      <MultiplayerGame />
      <div style={{ position: "fixed", left: 12, top: 12 }}>
        <button onClick={() => setView("multi")} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", cursor: "pointer" }}>Atrás</button>
      </div>
    </>);
  }

  // Menú principal
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <UserBadge />
      <div style={{ background: "#0f172a", padding: 28, borderRadius: 16, width: 460, textAlign: "center", color: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}>
        <h1 style={{ marginTop: 0 }}>Birders Place</h1>
        <p style={{ opacity: 0.9, marginTop: 6 }}>Elige un modo de juego</p>
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <button onClick={() => setView("single")} style={{ padding: "0.8rem 1rem", background: "#10b981", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Single Player</button>
          <button onClick={() => setView("multi")} style={{ padding: "0.8rem 1rem", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Multiplayer</button>
          <button onClick={() => setView("login")} style={{ padding: "0.8rem 1rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Login</button>
        </div>
      </div>
    </div>
  );
}
