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
    <Game onBack={() => setView("menu")} />
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
          <p style={{ opacity: 0.85 }}>Choose a mode</p>
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            <button onClick={() => setView("duels")} style={{ padding: "0.6rem 1rem", background: "#10b981", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>1v1 Duels</button>
            <button onClick={() => setView("rooms")} style={{ padding: "0.6rem 1rem", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Duel rooms</button>
            <button onClick={() => setView("multiplayer")} style={{ padding: "0.6rem 1rem", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Multiplayer rooms (2-10)</button>
            <button onClick={() => setView("menu")} style={{ padding: "0.6rem 1rem", background: "#374151", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Back</button>
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
        <button onClick={() => setView("menu")} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", cursor: "pointer" }}>Back</button>
      </div>
    </>);
  }

  if (view === "rooms") {
    return (<>
      <UserBadge />
      <RoomLobby />
      <div style={{ position: "fixed", left: 12, top: 12 }}>
        <button onClick={() => setView("menu")} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", cursor: "pointer" }}>Back</button>
      </div>
    </>);
  }

  if (view === "multiplayer") {
    return (<>
      <UserBadge />
      <MultiplayerGame />
      <div style={{ position: "fixed", left: 12, top: 12 }}>
        <button onClick={() => setView("menu")} style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#374151", color: "#fff", cursor: "pointer" }}>Back</button>
      </div>
    </>);
  }

  // Menú principal
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <UserBadge />
      <div style={{ background: "#0f172a", padding: 28, borderRadius: 16, width: 460, textAlign: "center", color: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}>
        <h1 style={{ marginTop: 0 }}>Birders Place</h1>
        <p style={{ opacity: 0.9, marginTop: 6 }}>Choose your battle mode</p>
        
        {/* Credits */}
        <div style={{ 
          marginTop: "20px", 
          padding: "12px", 
          background: "rgba(255,255,255,0.1)", 
          borderRadius: "8px",
          fontSize: "12px",
          color: "#9ca3af",
          textAlign: "center"
        }}>
          <div style={{ marginBottom: "8px" }}>
            🐦 Images provided by <a href="https://inaturalist.org" target="_blank" rel="noopener noreferrer" style={{ color: "#10b981", textDecoration: "none" }}>iNaturalist</a>
          </div>
          <div>
            💚 Educational bird identification game
          </div>
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {/* Competitive Mode - Featured */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setView("duels")} style={{ 
              padding: "1rem 1.2rem", 
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", 
              color: "#fff", 
              border: "none", 
              borderRadius: 12, 
              cursor: "pointer", 
              fontWeight: 700,
              fontSize: "16px",
              boxShadow: "0 4px 14px rgba(16, 185, 129, 0.3)",
              transform: "scale(1.02)",
              transition: "all 0.2s ease"
            }}>
              ⚔️ 1v1 Duels
            </button>
            <div style={{
              position: "absolute",
              top: "-8px",
              right: "-8px",
              background: "#f59e0b",
              color: "#000",
              padding: "2px 6px",
              borderRadius: "12px",
              fontSize: "10px",
              fontWeight: "bold"
            }}>
              COMPETITIVE
            </div>
            <div style={{ 
              fontSize: "12px", 
              color: "#9ca3af", 
              marginTop: "4px",
              textAlign: "center"
            }}>
              🏆 Rank up & climb the leaderboard
            </div>
          </div>

          {/* Play with Friends Section */}
          <div style={{ 
            marginTop: "20px", 
            padding: "12px", 
            background: "rgba(255,255,255,0.05)", 
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.1)"
          }}>
            <div style={{ 
              fontSize: "14px", 
              color: "#9ca3af", 
              marginBottom: "12px",
              fontWeight: "600"
            }}>
              👥 Play with Friends
            </div>
            
            <div style={{ display: "grid", gap: 8 }}>
              <button onClick={() => setView("rooms")} style={{ 
                padding: "0.7rem 1rem", 
                background: "#8b5cf6", 
                color: "#fff", 
                border: "none", 
                borderRadius: 8, 
                cursor: "pointer", 
                fontWeight: 600,
                fontSize: "14px"
              }}>
                🏠 Duel rooms
              </button>
              
              <button onClick={() => setView("multiplayer")} style={{ 
                padding: "0.7rem 1rem", 
                background: "#f59e0b", 
                color: "#fff", 
                border: "none", 
                borderRadius: 8, 
                cursor: "pointer", 
                fontWeight: 600,
                fontSize: "14px"
              }}>
                🎮 Multiplayer rooms (2-10)
              </button>
            </div>
          </div>

          {/* Other Options */}
          <div style={{ display: "grid", gap: 8, marginTop: "16px" }}>
            <button onClick={() => setView("single")} style={{ 
              padding: "0.6rem 1rem", 
              background: "#374151", 
              color: "#fff", 
              border: "none", 
              borderRadius: 8, 
              cursor: "pointer", 
              fontWeight: 600,
              fontSize: "14px"
            }}>
              🎯 Single Player
            </button>
            
            <button onClick={() => setView("login")} style={{ 
              padding: "0.6rem 1rem", 
              background: "#2563eb", 
              color: "#fff", 
              border: "none", 
              borderRadius: 8, 
              cursor: "pointer", 
              fontWeight: 600,
              fontSize: "14px"
            }}>
              🔐 Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
