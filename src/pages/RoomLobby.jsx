import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebaseClient";
import { doc, getDoc } from "firebase/firestore";
import { createRoom, joinRoomByCode, listenRoom, listenRoomPlayers, leaveRoom, createDuelFromRoom, createMultiplayerGameFromRoom, listenGameReadyNotification } from "../services/multiplayer";

export default function RoomLobby() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [duelMatchId, setDuelMatchId] = useState(null);
  const [gameId, setGameId] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      if (u) {
        const snap = await getDoc(doc(db, "users", u.uid));
        setNickname(snap.exists() ? (snap.data()?.nickname || "") : "");
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!roomId || !user) return;
    
    const off1 = listenRoom(roomId, (roomData) => {
      setRoom(roomData);
      if (roomData?.duelMatchId) {
        setDuelMatchId(roomData.duelMatchId);
        // Navegar automáticamente al duelo cuando se detecte
        window.location.href = `?view=duels&match=${roomData.duelMatchId}`;
      }
      if (roomData?.gameId) {
        setGameId(roomData.gameId);
        // Navegar automáticamente al juego multijugador cuando se detecte
        window.location.href = `?view=multiplayer&game=${roomData.gameId}`;
      }
    });
    
    const off2 = listenRoomPlayers(roomId, setPlayers);
    
    // Escuchar notificaciones de juego listo
    const off3 = listenGameReadyNotification(roomId, user.uid, (notification) => {
      if (notification?.gameId) {
        console.log("🎮 Notificación de juego listo recibida, navegando...");
        setGameId(notification.gameId);
        window.location.href = `?view=multiplayer&game=${notification.gameId}`;
      }
    });
    
    return () => { off1(); off2(); off3(); };
  }, [roomId, user]);

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      const res = await createRoom(nickname);
      setRoomId(res.roomId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("createRoom error", e);
      setError(e?.message || "No se pudo crear la sala");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    setError("");
    setLoading(true);
    try {
      const id = await joinRoomByCode(codeInput.trim().toUpperCase(), nickname);
      setRoomId(id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("joinRoom error", e);
      setError(e?.message || "No se pudo unir");
    } finally {
      setLoading(false);
    }
  }

  async function handleLeave() {
    if (roomId) await leaveRoom(roomId);
    setRoomId(null);
    setRoom(null);
    setPlayers([]);
    setDuelMatchId(null);
  }


  if (!user) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 480, textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>Salas privadas</h2>
          <p style={{ opacity: 0.85, marginBottom: 20 }}>Inicia sesión para crear o unirte a una sala.</p>
          <button
            onClick={() => window.location.href = "?view=login"}
            style={{
              padding: "0.6rem 1rem",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600
            }}
          >
            Iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  if (!roomId) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 520, textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>Salas privadas</h2>
          <div>Tu nick: <b>{nickname || user.email}</b></div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12 }}>
            <button onClick={handleCreate} disabled={loading} style={{ padding: "0.6rem 1rem", background: loading ? "#6b7280" : "#10b981", color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer", fontWeight: 600 }}>{loading ? "Creando..." : "Crear sala"}</button>
          </div>
          <div style={{ marginTop: 14 }}>
            <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="CÓDIGO" style={{ padding: "0.5rem 0.8rem", borderRadius: 8, border: "1px solid #374151", background: "#0b1220", color: "#fff" }} />
            <button onClick={handleJoin} disabled={loading} style={{ marginLeft: 8, padding: "0.6rem 1rem", background: loading ? "#6b7280" : "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer" }}>Unirse</button>
          </div>
          {error && <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 12 }}>{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 560, textAlign: "center" }}>
        <h2 style={{ marginTop: 0 }}>Sala: {room?.code || ""}</h2>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {players.map(p => (
            <div key={p.id} style={{ background: "#0b1220", padding: 10, borderRadius: 8 }}>
              <div style={{ fontWeight: 700 }}>{p.nickname || p.id}</div>
            </div>
          ))}
        </div>
        
        {duelMatchId ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: "#10b981", fontWeight: 600 }}>¡Redirigiendo al duelo...</div>
          </div>
        ) : gameId ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: "#10b981", fontWeight: 600 }}>¡Redirigiendo al juego multijugador...</div>
          </div>
        ) : room?.hostUid === user.uid && players.length >= 2 ? (
          <div style={{ marginTop: 12, display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={async () => {
              setError("");
              setLoading(true);
              try {
                const id = await createDuelFromRoom(roomId);
                setDuelMatchId(id);
                // navegamos internamente al duelo
                window.location.href = `?view=duels&match=${id}`;
              } catch (e) {
                // eslint-disable-next-line no-console
                console.error("create duel from room", e);
                setError(e?.message || "No se pudo iniciar el duelo");
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            style={{ padding: "0.6rem 1rem", background: loading ? "#6b7280" : "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer", fontWeight: 600 }}>
              {loading ? "Iniciando..." : "Iniciar duelo (1v1)"}
            </button>
            
            <button onClick={async () => {
              setError("");
              setLoading(true);
              try {
                const id = await createMultiplayerGameFromRoom(roomId);
                setGameId(id);
                console.log("🎮 Juego multijugador creado:", id);
                // La navegación se hará automáticamente via notificaciones
              } catch (e) {
                // eslint-disable-next-line no-console
                console.error("create multiplayer game from room", e);
                setError(e?.message || "No se pudo iniciar el juego multijugador");
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            style={{ padding: "0.6rem 1rem", background: loading ? "#6b7280" : "#f59e0b", color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer", fontWeight: 600 }}>
              {loading ? "Iniciando..." : `Iniciar multijugador (${players.length} jugadores)`}
            </button>
          </div>
        ) : players.length < 2 && (
          <div style={{ marginTop: 12, color: "#fbbf24" }}>
            Esperando más jugadores... (2/2)
          </div>
        )}
        
        {error && <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 12 }}>{error}</div>}
        
        <div style={{ marginTop: 12 }}>
          <button onClick={handleLeave} style={{ padding: "0.6rem 1rem", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Salir de la sala</button>
        </div>
      </div>
    </div>
  );
}


