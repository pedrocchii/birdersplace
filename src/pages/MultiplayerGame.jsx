import { useEffect, useState, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebaseClient";
import { doc, getDoc, collection, query, where, orderBy, limit, onSnapshot, runTransaction, updateDoc } from "firebase/firestore";
import { createRoom, joinRoomByCode, listenRoom, listenRoomPlayers, leaveRoom, createMultiplayerGameFromRoom, setMultiplayerRoundDataIfAbsent, submitMultiplayerGuess } from "../services/multiplayer";
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap, Tooltip } from "react-leaflet";
import L from "leaflet";
import { redMarkerIcon } from "../components/mapIcons";
import LeafletSizeFix from "../components/LeafletSizeFix";
import "leaflet/dist/leaflet.css";

export default function MultiplayerGame() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState(null);
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [gameId, setGameId] = useState(null);
  const [game, setGame] = useState(null);
  const [status, setStatus] = useState("lobby"); // lobby | playing | finished
  const [winner, setWinner] = useState(null);

  // Estados del juego (similar a Game.jsx)
  const [observation, setObservation] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [guess, setGuess] = useState(null);
  const [distance, setDistance] = useState(null);
  const [score, setScore] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [round, setRound] = useState(1);
  const [totalScore, setTotalScore] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [roundLocked, setRoundLocked] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [roundResults, setRoundResults] = useState(null);
  const [countdown, setCountdown] = useState(10);
  const [processedRounds, setProcessedRounds] = useState(new Set());
  const [hasProcessedCurrentRound, setHasProcessedCurrentRound] = useState(false);

  const MAX_ROUNDS = 5;
  const lastProcessedRoundRef = useRef(0);
  const lastProcessedGameIdRef = useRef(null);

  // Funciones de utilidad (copiadas de Game.jsx y Duels.jsx)
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(distanceKm) {
    if (distanceKm == null || isNaN(distanceKm)) return "";
    if (distanceKm < 1) {
      const meters = Math.round(distanceKm * 1000);
      return `${meters.toLocaleString()} m`;
    }
    const km = Math.round(distanceKm);
    return `${km.toLocaleString()} km`;
  }

  function calculatePoints(distanceKm, sizeKm = 14916.862) {
    if (distanceKm <= 100) return 5000;
    const k = 4;
    const raw = 5000 * Math.exp((-k * distanceKm) / sizeKm);
    return Math.min(5000, Math.max(0, Math.round(raw)));
  }

  function generateLocationName(lat, lng) {
    const latDir = lat >= 0 ? "N" : "S";
    const lngDir = lng >= 0 ? "E" : "W";
    const latAbs = Math.abs(lat).toFixed(1);
    const lngAbs = Math.abs(lng).toFixed(1);
    return `${latAbs}°${latDir}, ${lngAbs}°${lngDir}`;
  }

  // Regiones para la selección de observaciones (copiadas de Duels.jsx)
  const REGIONS = [
    { name: "North America", bbox: [-170, 5, -50, 75], weight: 0.5 },
    { name: "South America", bbox: [-82, -56, -34, 12], weight: 1.0 },
    { name: "Europe", bbox: [-31, 34, 45, 72], weight: 0.5 },
    { name: "Africa", bbox: [-20, -35, 52, 37], weight: 1.0 },
    { name: "Asia", bbox: [25, -10, 180, 55], weight: 1.0 },
    { name: "Oceania", bbox: [110, -50, 180, 0], weight: 0.5 },
  ];

  function selectWeightedRegion() {
    const totalWeight = REGIONS.reduce((sum, region) => sum + region.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const region of REGIONS) {
      random -= region.weight;
      if (random <= 0) {
        return region;
      }
    }
    
    return REGIONS[REGIONS.length - 1];
  }

  // Función para generar números pseudoaleatorios determinísticos
  function seededRandom(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) / 2147483647;
  }

  // Cargar observación para el juego multijugador (similar a Duels.jsx)
  async function loadObservationForGame(gameData, hostUid) {
    if (isLoading) return;
    console.log("Starting loadObservationForGame, isLoading:", isLoading, "gameData:", gameData);
    setIsLoading(true);
    setGuess(null);
    setDistance(null);
    setConfirmed(false);

    console.log("Host loading observation for round:", gameData.round);

    // Usar un seed determinístico basado en gameId y ronda
    const seed = `${gameData.id || gameData.gameId}_${gameData.round}`;
    console.log("🎲 Using deterministic seed:", seed);

    const maxAttempts = 15;
    let attempts = 0;
    
    await new Promise(r => setTimeout(r, 1000));
    
    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Attempt ${attempts}/${maxAttempts}`);
      try {
        const region = selectWeightedRegion();
        const [minLng, minLat, maxLng, maxLat] = region.bbox;
        const randomPage = Math.floor(Math.random() * 100);
        const randomUrl = `https://api.inaturalist.org/v1/observations?photos=true&quality_grade=research&order=desc&per_page=100&geo=true&geoprivacy=open&page=${randomPage}&swlat=${minLat}&swlng=${minLng}&nelat=${maxLat}&nelng=${maxLng}&taxon_id=3&captive=false`;
        
        const randomRes = await fetch(randomUrl);
        if (randomRes.status === 429) {
          console.log("💤 Request limit, waiting 500ms...");
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        const randomData = await randomRes.json();
        if (!randomData.results || randomData.results.length === 0) continue;
        const valid = (randomData.results || []).filter(r => r.photos && r.photos.length && r.geojson?.coordinates && r.geojson.type === "Point");
        if (!valid.length) {
          console.log("No valid observations found");
          continue;
        }
        
        const baseIndex = Math.floor(seededRandom(seed + "_base") * valid.length);
        const base = valid[baseIndex];
        const centerLat = base.geojson.coordinates[1];
        const centerLng = base.geojson.coordinates[0];
        const locationName = generateLocationName(centerLat, centerLng);

        const clusterUrl = `https://api.inaturalist.org/v1/observations?photos=true&quality_grade=research&order=desc&per_page=100&geo=true&geoprivacy=open&coordinates_obscured=false&lat=${centerLat}&lng=${centerLng}&radius=50&taxon_id=3&captive=false`;

        const clusterRes = await fetch(clusterUrl);
        if (clusterRes.status === 429) {
          console.log("💤 Cluster request limit, waiting 500ms...");
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        const clusterData = await clusterRes.json();
        if (!clusterData.results || clusterData.results.length < 8) continue;

        const clusterObservations = clusterData.results.filter(
          r => r.photos && r.photos.length && r.geojson?.coordinates && r.geojson.type === "Point"
        );

        if (clusterObservations.length >= 8) {
          // Filtrar para obtener observaciones con especies únicas
          const uniqueSpecies = new Map();
          clusterObservations.forEach(obs => {
            const speciesName = obs.taxon?.preferred_common_name || obs.taxon?.name || 'Unknown';
            if (!uniqueSpecies.has(speciesName)) {
              uniqueSpecies.set(speciesName, obs);
            }
          });
          
          // Si tenemos al menos 8 especies únicas, usarlas
          let selected;
          if (uniqueSpecies.size >= 8) {
            const uniqueObservations = Array.from(uniqueSpecies.values());
            const shuffled = [...uniqueObservations].sort((a, b) => {
              const hashA = seededRandom(seed + "_shuffle_" + a.id);
              const hashB = seededRandom(seed + "_shuffle_" + b.id);
              return hashA - hashB;
            });
            selected = shuffled.slice(0, 8);
          } else {
            // Si no hay suficientes especies únicas, usar el método original
            const shuffled = [...clusterObservations].sort((a, b) => {
              const hashA = seededRandom(seed + "_shuffle_" + a.id);
              const hashB = seededRandom(seed + "_shuffle_" + b.id);
              return hashA - hashB;
            });
            selected = shuffled.slice(0, 8);
          }
          const items = selected.map(r => ({
            id: r.id,
            photo: r.photos[0].url.replace("square", "large"),
            lat: r.geojson.coordinates[1],
            lon: r.geojson.coordinates[0],
            species: r.taxon?.preferred_common_name || r.taxon?.name,
            hotspot: locationName
          }));
          
          console.log("Found 8 items, saving to game:", items.length);
          if (gameId && gameData?.round) {
            console.log("💾 Saving round data to Firestore - GameId:", gameId, "Round:", gameData.round);
            try {
              await setMultiplayerRoundDataIfAbsent(gameId, gameData.round, { items, index: 0 });
              console.log("✅ Saved round data to game successfully");
            } catch (error) {
              console.error("❌ Error saving round data:", error);
            }
          } else {
            console.log("❌ Cannot save round data - GameId:", gameId, "Round:", gameData?.round);
          }
          setIsLoading(false);
          return;
        }

        await new Promise(r => setTimeout(r, 200));
      } catch (error) {
        console.error(`Error en intento ${attempts}:`, error);
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.error("❌ No valid cluster found after several attempts");
    
    // Mostrar mensaje de error al usuario
    setError("Error loading observations. The iNaturalist API is experiencing problems. Try again in a few minutes.");
    
    setIsLoading(false);
  }



  // Handlers del mapa
  function MapClickHandler() {
    useMapEvents({
      click(e) {
        if (roundLocked || confirmed) return;
        setGuess(e.latlng);
      },
    });
    return null;
  }

  function FitOnConfirm() {
    const map = useMap();

    useEffect(() => {
      if (!confirmed || !guess || !observation) return;

      const bounds = L.latLngBounds(
        [guess.lat, guess.lng],
        [observation.lat, observation.lon]
      );

      const d = Number(distance) || 0;
      const maxZoom = d <= 50 ? 10 : d <= 200 ? 8 : d <= 1000 ? 6 : d <= 3000 ? 5 : 4;

      map.flyToBounds(bounds, {
        padding: [60, 60],
        maxZoom,
        duration: 0.8,
      });
    }, [confirmed, guess, observation, distance, map]);

    return null;
  }

  function ResultsMap() {
    const map = useMap();
    const hasCenteredRef = useRef(false);
    
    useEffect(() => {
      if (!roundResults || !roundResults.observation) return;
      
      // Solo centrar una vez cuando se muestran los resultados
      if (!hasCenteredRef.current) {
        const realLocation = [roundResults.observation.lat, roundResults.observation.lon];
        
        // Centrar sin zoom (mantener zoom actual) y sin animación
        map.setView(realLocation, map.getZoom(), { animate: false });
        
        hasCenteredRef.current = true;
      }
      
    }, [roundResults]); // Removido 'map' de las dependencias
    
    // Resetear el flag cuando cambien los resultados
    useEffect(() => {
      hasCenteredRef.current = false;
    }, [roundResults]);
    
    return null;
  }

  // Handlers del juego

  async function handleVerify() {
    if (!observation || !guess || roundLocked) return;
    setRoundLocked(true);
    
    try {
      const d = haversineDistance(observation.lat, observation.lon, guess.lat, guess.lng);
      setDistance(d);
      setConfirmed(true);
      setHasProcessedCurrentRound(true);
      await submitMultiplayerGuess(gameId, user.uid, d, { lat: guess.lat, lng: guess.lng });
    } catch (error) {
      console.error("Error enviando guess:", error);
      setRoundLocked(false);
    }
  }

  // Efectos
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

  // Escuchar cambios en la sala
  useEffect(() => {
    if (!roomId) return;
    const off1 = listenRoom(roomId, (roomData) => {
      console.log("🏠 Room update:", roomData);
      setRoom(roomData);
      if (roomData?.gameId) {
        console.log("🎮 Game ID detected in room:", roomData.gameId);
        setGameId(roomData.gameId);
        setStatus("playing");
      }
    });
    const off2 = listenRoomPlayers(roomId, (players) => {
      console.log("👥 Players update:", players);
      setPlayers(players);
    });
    return () => { off1(); off2(); };
  }, [roomId]);

  // Escuchar cambios en el juego
  useEffect(() => {
    if (!gameId) return;
    const off = onSnapshot(doc(db, "multiplayer_games", gameId), (doc) => {
      if (doc.exists()) {
        const gameData = { id: doc.id, ...doc.data() };
        setGame(gameData);
        
        // NO cambiar inmediatamente a finished cuando el juego termina en Firestore
        // Esto permite mostrar primero los resultados de la última ronda
        if (gameData.state === "finished" && status !== "finished") {
          // Solo cambiar a finished si ya hemos mostrado los resultados de la última ronda
          // o si es el host y debe finalizar el juego
          console.log("🎯 Game finished in Firestore, but waiting to show last round results first");
        }
        
        // Cargar datos de la ronda actual
        const currentRound = gameData.round || 1;
        const roundData = gameData.rounds?.[currentRound];
        
        console.log("🎮 Game update - Round:", currentRound, "Round data:", roundData, "User:", user?.uid, "Host:", gameData.hostUid);
        
        // Solo resetear si es una ronda completamente nueva (comparar con la ronda procesada anteriormente)
        // Y no hemos procesado ya esta ronda
        if (currentRound !== lastProcessedRoundRef.current && !hasProcessedCurrentRound) {
          console.log("Round change detected, resetting state from round", lastProcessedRoundRef.current, "to round", currentRound);
          
          // Si estamos avanzando de una ronda anterior (no es la primera ronda), mostrar resultados
          if (lastProcessedRoundRef.current > 0) {
            const completedRound = lastProcessedRoundRef.current;
            const completedRoundData = gameData.rounds?.[completedRound];
            
            console.log("Showing results for completed round:", completedRound, "Data:", completedRoundData);
            
            if (completedRoundData && 
                completedRoundData.guesses && 
                completedRoundData.results &&
                !showResults && 
                !processedRounds.has(completedRound)) {
              console.log("🎯 All players finished round, showing results for round", completedRound);
              console.log("📊 Round data:", {
                guesses: Object.keys(completedRoundData.guesses).length,
                results: completedRoundData.results,
                players: Object.keys(gameData.players).length
              });
              setRoundResults({
                round: completedRound,
                observation: completedRoundData.items?.[completedRoundData.index],
                guesses: completedRoundData.guesses,
                results: completedRoundData.results,
                players: gameData.players
              });
              setShowResults(true);
              setProcessedRounds(prev => new Set([...prev, completedRound]));
            } else {
              console.log("❌ Not showing results:", {
                hasRoundData: !!completedRoundData,
                hasGuesses: !!(completedRoundData?.guesses),
                hasResults: !!(completedRoundData?.results),
                showResults,
                isProcessed: processedRounds.has(completedRound)
              });
            }
          }
          
          setGuess(null);
          setDistance(null);
          setConfirmed(false);
          setRoundLocked(false);
          setHasProcessedCurrentRound(false);
          lastProcessedRoundRef.current = currentRound;
        }
        
        if (roundData && roundData.items && typeof roundData.index === 'number') {
          console.log("✅ Loading round data for all players");
          setGallery(roundData.items);
          const obs = roundData.items[roundData.index];
          setObservation(obs);
        } else if (user && gameData.hostUid === user.uid && !roundData) {
          console.log("🎯 Host loading observation for round:", currentRound);
          // Solo el host carga las observaciones
          loadObservationForGame(gameData, user.uid);
        } else if (!roundData) {
          console.log("⏳ Non-host waiting for host to load round data");
          // Los no-hosts esperan a que el host cargue los datos
        }
      }
    });
    return () => off();
  }, [gameId, user]);

  // Ref para mantener el intervalo del countdown
  const countdownIntervalRef = useRef(null);

  // Limpiar intervalo cuando el componente se desmonte o cambie el estado
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, []);

  // Auto-avanzar a la siguiente ronda después de 10 segundos (como en duels)
  useEffect(() => {
    if (showResults && roundResults) {
      // Limpiar intervalo anterior si existe
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
      
      setCountdown(10);
      
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
            }
            setShowResults(false);
            setRoundResults(null);
            
            // Verificar si es la última ronda para mostrar resultados finales
            const maxRounds = game?.maxRounds || 5;
            const currentRound = roundResults?.round || 0;
            
            if (currentRound >= 5 || currentRound >= maxRounds) {
              // Es la última ronda, cambiar a finished inmediatamente
              console.log("🏁 Last round completed, transitioning to finished state");
              setStatus("finished");
              // Calcular ganador
              if (game?.players) {
                const winner = Object.entries(game.players)
                  .reduce((prev, [uid, player]) => 
                    (player.totalScore || 0) > (prev.totalScore || 0) 
                      ? { uid, ...player } 
                      : prev
                  , { totalScore: 0 });
                setWinner(winner.uid);
                console.log("🏆 Winner calculated:", winner.uid, "with score:", winner.totalScore);
              }
            } else if (status !== "finished") {
              // No es la última ronda, continuar normalmente
              setGuess(null);
              setDistance(null);
              setConfirmed(false);
              setRoundLocked(false);
              setHasProcessedCurrentRound(false);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
      };
    }
  }, [showResults, roundResults]); // Removido status y game de las dependencias

  // Handlers de la sala
  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      const res = await createRoom(nickname);
      setRoomId(res.roomId);
    } catch (e) {
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
    setGameId(null);
    setGame(null);
    setStatus("lobby");
  }

  async function handleStartGame() {
    setError("");
    setLoading(true);
    try {
      const id = await createMultiplayerGameFromRoom(roomId);
      setGameId(id);
      setStatus("playing");
    } catch (e) {
      console.error("create multiplayer game error", e);
      setError(e?.message || "No se pudo iniciar el juego");
    } finally {
      setLoading(false);
    }
  }

  // Renderizado
  if (!user) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 480, textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>Multiplayer Game</h2>
          <p style={{ opacity: 0.85, marginBottom: 20 }}>Sign in to play.</p>
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
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (status === "lobby") {
    if (!roomId) {
      return (
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 520, textAlign: "center" }}>
            <h2 style={{ marginTop: 0 }}>Multiplayer Game (2-10 players)</h2>
            <div>Your nick: <b>{nickname || user.email}</b></div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12 }}>
              <button onClick={handleCreate} disabled={loading} style={{ padding: "0.6rem 1rem", background: loading ? "#6b7280" : "#10b981", color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer", fontWeight: 600 }}>{loading ? "Creating..." : "Create room"}</button>
            </div>
            <div style={{ marginTop: 14 }}>
              <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="CODE" style={{ padding: "0.5rem 0.8rem", borderRadius: 8, border: "1px solid #374151", background: "#0b1220", color: "#fff" }} />
              <button onClick={handleJoin} disabled={loading} style={{ marginLeft: 8, padding: "0.6rem 1rem", background: loading ? "#6b7280" : "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer" }}>Join</button>
            </div>
            {error && <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 12 }}>{error}</div>}
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#111827", padding: 24, borderRadius: 12, color: "#fff", width: 560, textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>Room: {room?.code || ""}</h2>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {players.map(p => (
              <div key={p.id} style={{ background: "#0b1220", padding: 10, borderRadius: 8 }}>
                <div style={{ fontWeight: 700 }}>{p.nickname || p.id}</div>
              </div>
            ))}
          </div>
          
          {gameId ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: "#10b981", fontWeight: 600 }}>¡Redirigiendo al juego...</div>
            </div>
          ) : room?.hostUid === user.uid && players.length >= 2 && players.length <= 10 ? (
            <div style={{ marginTop: 12 }}>
              <button onClick={handleStartGame}
                disabled={loading}
                style={{ padding: "0.6rem 1rem", background: loading ? "#6b7280" : "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {loading ? "Starting..." : "Start multiplayer game"}
              </button>
            </div>
          ) : players.length < 2 ? (
            <div style={{ marginTop: 12, color: "#fbbf24" }}>
              Waiting for more players... ({players.length}/2-10)
            </div>
          ) : players.length > 10 ? (
            <div style={{ marginTop: 12, color: "#fca5a5" }}>
              Too many players ({players.length}/10 maximum)
            </div>
          ) : null}
          
          {error && <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 12 }}>{error}</div>}
          
          <div style={{ marginTop: 12 }}>
            <button onClick={handleLeave} style={{ padding: "0.6rem 1rem", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Leave room</button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "playing") {
    return (
      <div className="container-narrow" style={{ padding: "1rem", textAlign: "center" }}>
        <div style={{ position: "fixed", left: 12, top: 12, zIndex: 1000 }}>
          <button 
            onClick={() => window.location.href = "?view=menu"}
            style={{ 
              padding: "6px 10px", 
              borderRadius: 8, 
              border: "none", 
              background: "#374151", 
              color: "#fff", 
              cursor: "pointer" 
            }}
          >
            Back
          </button>
        </div>
        <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Birders Place - Multiplayer</h1>
        
        {game && (
          <div style={{ marginBottom: "1rem", color: "#fff" }}>
            <h3 style={{ margin: 0 }}>Round {game.round || 1} / {MAX_ROUNDS}</h3>
            <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>
              Host: {game.hostUid === user?.uid ? "You" : "Other player"} | State: {game.state || "playing"}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 12 }}>
              {Object.entries(game.players || {}).map(([uid, p]) => (
                <div key={uid} style={{ 
                  background: "#2c3e50", 
                  padding: "8px 12px", 
                  borderRadius: "8px",
                  border: uid === user.uid ? "2px solid #3498db" : "2px solid transparent"
                }}>
                  <div style={{ fontWeight: 700, color: "#fff", fontSize: "14px" }}>
                    {p.nickname || (uid === user.uid ? (nickname || "You") : "Player")}
                  </div>
                  <div style={{ color: "#ecf0f1", fontSize: "12px" }}>Points: {(p.totalScore || 0).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!observation && (
          <div style={{ marginTop: "1rem", color: "#fbbf24" }}>
            {isLoading ? (
              <div>
                <div>Loading round...</div>
                <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>
                  {game?.hostUid === user?.uid ? "Searching for observations..." : "Waiting for host to load the round..."}
                </div>
              </div>
            ) : error ? (
              <div>
                <div style={{ color: "#ef4444", marginBottom: "8px" }}>{error}</div>
                {game?.hostUid === user?.uid && (
                  <button
                    onClick={() => {
                      setError("");
                      loadObservationForGame(game, user.uid);
                    }}
                    style={{
                      padding: "0.5rem 1rem",
                      backgroundColor: "#ef4444",
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "14px"
                    }}
                  >
                    Reintentar
                  </button>
                )}
              </div>
            ) : (
              "Waiting for round..."
            )}
          </div>
        )}

        {gallery.length > 0 && (
          <div className="gallery">
            {gallery.map((item) => (
              <div
                key={item.id}
                className={`gallery-item ${observation?.id === item.id ? "active" : ""}`}
                onClick={() => {
                  setObservation(item);
                  setLightbox(item.photo);
                }}
              >
                <img src={item.photo} />
              </div>
            ))}
          </div>
        )}

        {observation && (
          <div className="map-wrapper">
            <MapContainer
              center={[20, 0]}
              zoom={2}
              maxBounds={[[-90, -180], [90, 180]]}
              maxBoundsViscosity={1.0}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                noWrap={true}
              />
              <LeafletSizeFix />
              <MapClickHandler />
              {guess && <Marker position={[guess.lat, guess.lng]} />}
              {confirmed && !showResults && (
                <>
                  {/* Solo mantener el marcador del guess, sin tooltip ni zoom */}
                  {guess && <Marker position={[guess.lat, guess.lng]} />}
                </>
              )}
            </MapContainer>
          </div>
        )}

        {observation && !confirmed && guess && !roundLocked && (
          <div style={{ marginTop: "12px", color: "#d1d5db", fontSize: "14px" }}>
            Haz click en el mapa para cambiar la posición
          </div>
        )}

        {observation && !confirmed && guess && !roundLocked && (
          <button
            onClick={handleVerify}
            style={{
              marginTop: "18px",
              padding: "0.6rem 1.2rem",
              backgroundColor: "#27ae60",
              color: "white",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            Verify
          </button>
        )}

        {roundLocked && (
          <div style={{ marginTop: "18px", padding: "0.6rem 1.2rem", backgroundColor: "#95a5a6", color: "white", borderRadius: "10px", textAlign: "center" }}>
            Procesando...
          </div>
        )}

        {confirmed && !showResults && (
          <div className="result-panel">
            <h3 style={{ margin: 0 }}>Round {game?.round || 1}</h3>
            <div style={{ marginTop: 16, color: "#fbbf24", fontSize: "18px", fontWeight: "bold" }}>
              ⏳ Waiting for other players...
            </div>
          </div>
        )}

        {showResults && roundResults && (
          <div style={{ 
            position: "fixed", 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            background: "rgba(0,0,0,0.9)", 
            zIndex: 2000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem"
          }}>
            <div style={{ 
              background: "#1f2937", 
              borderRadius: "12px", 
              padding: "2rem", 
              maxWidth: "800px", 
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto"
            }}>
              <h2 style={{ color: "#f1c40f", margin: "0 0 1rem 0", textAlign: "center" }}>
                Round {roundResults.round} - Results
              </h2>
              
              {/* Información del juego */}
              <div style={{ 
                background: "#374151", 
                borderRadius: "8px", 
                padding: "1rem", 
                marginBottom: "1rem",
                textAlign: "center"
              }}>
                <div style={{ color: "#d1d5db", fontSize: "16px", marginBottom: "8px" }}>
                  🎮 Juego Multijugador: {Object.entries(roundResults.players).map(([uid, player]) => {
                    const isCurrentPlayer = uid === user?.uid;
                    return (
                      <span key={uid} style={{ 
                        color: isCurrentPlayer ? "#8b5cf6" : "#10b981",
                        fontWeight: "bold",
                        margin: "0 4px"
                      }}>
                        {isCurrentPlayer ? "You" : (player?.nickname || "Player")}
                      </span>
                    );
                  }).reduce((prev, curr, index) => [prev, index === 1 ? " vs " : "", curr])}
                </div>
                <div style={{ color: "#9ca3af", fontSize: "14px" }}>
                  Rounds played: {roundResults.round} | Total score: {Object.entries(roundResults.players).map(([uid, player]) => {
                    const isCurrentPlayer = uid === user?.uid;
                    const totalScore = player?.totalScore ?? 0;
                    
                    return (
                      <span key={uid} style={{ 
                        color: isCurrentPlayer ? "#8b5cf6" : "#10b981",
                        fontWeight: "bold",
                        margin: "0 8px"
                      }}>
                        {isCurrentPlayer ? "You" : (player?.nickname || "Player")}: {totalScore.toLocaleString()}
                      </span>
                    );
                  }).reduce((prev, curr, index) => [prev, index === 1 ? " | " : "", curr])}
                </div>
              </div>
              
              {/* Mapa de resultados */}
              <div style={{ height: "300px", marginBottom: "1rem", borderRadius: "8px", overflow: "hidden" }}>
                <MapContainer
                  center={[20, 0]}
                  zoom={2}
                  maxBounds={[[-90, -180], [90, 180]]}
                  maxBoundsViscosity={1.0}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                    noWrap={true}
                  />
                  <LeafletSizeFix />
                  <ResultsMap />
                  
                  {/* Ubicación real */}
                  <Marker position={[roundResults.observation.lat, roundResults.observation.lon]} icon={redMarkerIcon}>
                    <Tooltip permanent direction="top" offset={[-20, -25]} className="distance-tooltip" style={{ 
                      background: "transparent", 
                      border: "none", 
                      boxShadow: "none",
                      color: "#dc2626",
                      fontWeight: "bold",
                      fontSize: "14px",
                      textAlign: "center",
                      width: "40px",
                      marginLeft: "-20px"
                    }}>
                      📍 REAL LOCATION
                    </Tooltip>
                  </Marker>
                  
                  {/* Player responses */}
                  {Object.entries(roundResults.guesses).map(([uid, guess], index) => {
                    const isCurrentPlayer = uid === user?.uid;
                    const player = roundResults.players[uid];
                    const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#ec4899", "#6366f1"];
                    const color = colors[index % colors.length];
                    
                    return (
                      <Marker key={uid} position={[guess.guess.lat, guess.guess.lng]}>
                        <Tooltip permanent direction="top" offset={[-20, -25]} className="distance-tooltip" style={{ 
                          background: "transparent", 
                          border: "none", 
                          boxShadow: "none",
                          color: color,
                          fontWeight: "bold",
                          fontSize: "14px",
                          textAlign: "center",
                          width: "40px",
                          marginLeft: "-20px"
                        }}>
                          {isCurrentPlayer ? "YOU" : (player?.nickname || "Player")}
                        </Tooltip>
                      </Marker>
                    );
                  })}
                </MapContainer>
              </div>
              
              {/* Ranking de la ronda */}
              {roundResults.results && roundResults.results.rankings && (
                <div style={{ 
                  background: "#374151", 
                  borderRadius: "8px", 
                  padding: "1rem", 
                  marginBottom: "1rem"
                }}>
                  <h3 style={{ color: "#f1c40f", margin: "0 0 1rem 0", textAlign: "center" }}>
                    Total Ranking
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {roundResults.results.rankings.map((player, index) => {
                      const isCurrentPlayer = player.uid === user?.uid;
                      const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
                      const totalScore = roundResults.players[player.uid]?.totalScore || 0;
                      
                      return (
                        <div key={player.uid} style={{ 
                          background: isCurrentPlayer ? "#1f2937" : "#111827",
                          padding: "12px",
                          borderRadius: "8px",
                          border: isCurrentPlayer ? "2px solid #8b5cf6" : "1px solid #374151",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "18px" }}>{medal}</span>
                            <span style={{ 
                              fontWeight: "bold", 
                              color: isCurrentPlayer ? "#8b5cf6" : "#d1d5db" 
                            }}>
                              {isCurrentPlayer ? "You" : player.nickname}
                            </span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#f1c40f", fontWeight: "bold", fontSize: "16px" }}>
                              {totalScore.toLocaleString()} pts
                            </div>
                            <div style={{ color: "#10b981", fontSize: "12px" }}>
                              +{player.points.toLocaleString()} esta ronda
                            </div>
                            <div style={{ color: "#9ca3af", fontSize: "11px" }}>
                              {formatDistance(player.distance)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Time counter */}
              <div style={{ textAlign: "center", color: "#9ca3af" }}>
                {(() => {
                  const maxRounds = game?.maxRounds || 5;
                  const currentRound = roundResults?.round || 0;
                  // Detectar si es la última ronda: si currentRound es 5 o si no hay más rondas en el juego
                  const isLastRound = currentRound >= 5 || currentRound >= maxRounds;
                  
                  console.log("🔍 Round detection:", { 
                    maxRounds, 
                    currentRound, 
                    isLastRound, 
                    status,
                    gameMaxRounds: game?.maxRounds 
                  });
                  
                  return (
                    <>
                      <div style={{ fontSize: "18px", marginBottom: "8px" }}>
                        {status === "finished" ? "Mostrando resultados finales..." : 
                         isLastRound ? "View final results in:" : "Next round in:"}
                      </div>
                      <div style={{ 
                        fontSize: "48px", 
                        fontWeight: "bold", 
                        color: countdown <= 3 ? "#ef4444" : "#f1c40f",
                        textShadow: "0 0 10px rgba(241, 196, 15, 0.5)"
                      }}>
                        {countdown}
                      </div>
                      
                      {/* Botón para ir directamente a resultados finales si es la última ronda */}
                      {isLastRound && status !== "finished" && (
                        <button
                          onClick={() => {
                            setShowResults(false);
                            setRoundResults(null);
                            setStatus("finished");
                            // Calcular ganador
                            if (game?.players) {
                              const winner = Object.entries(game.players)
                                .reduce((prev, [uid, player]) => 
                                  (player.totalScore || 0) > (prev.totalScore || 0) 
                                    ? { uid, ...player } 
                                    : prev
                                , { totalScore: 0 });
                              setWinner(winner.uid);
                            }
                          }}
                          style={{
                            marginTop: "20px",
                            padding: "12px 24px",
                            fontSize: "16px",
                            fontWeight: "bold",
                            color: "#fff",
                            background: "linear-gradient(135deg, #f39c12 0%, #e67e22 100%)",
                            border: "none",
                            borderRadius: "8px",
                            cursor: "pointer",
                            transition: "all 0.3s ease",
                            boxShadow: "0 4px 8px rgba(243, 156, 18, 0.3)"
                          }}
                        >
                          🏆 Ver resultados finales ahora
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {lightbox && (
          <div className="lightbox-backdrop" onClick={() => setLightbox(null)}>
            <button className="lightbox-close" onClick={() => setLightbox(null)}>
              Cerrar
            </button>
            <img className="lightbox-img" src={lightbox} alt="Foto" />
          </div>
        )}
      </div>
    );
  }

  if (status === "finished") {
    // Crear ranking final ordenado por puntuación total
    const finalRanking = game?.players ? Object.entries(game.players)
      .map(([uid, player]) => ({
        uid,
        nickname: player.nickname || "Player",
        totalScore: player.totalScore || 0
      }))
      .sort((a, b) => b.totalScore - a.totalScore) : [];

    return (
      <div style={{ 
        minHeight: "100vh", 
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        position: "relative",
        overflow: "hidden"
      }}>
        {/* Efectos de fondo */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.3) 0%, transparent 50%)",
          pointerEvents: "none"
        }} />
        
        {/* Contenido principal */}
        <div style={{
          background: "rgba(255, 255, 255, 0.1)",
          backdropFilter: "blur(20px)",
          borderRadius: "20px",
          padding: "40px",
          maxWidth: "600px",
          width: "100%",
          textAlign: "center",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.3)",
          position: "relative",
          zIndex: 1
        }}>
          {/* Título principal */}
          <div style={{ marginBottom: "30px" }}>
            <h1 style={{ 
              margin: 0, 
              color: "#fff", 
              fontSize: "36px",
              fontWeight: "bold",
              textShadow: "0 4px 8px rgba(0, 0, 0, 0.3)",
              marginBottom: "10px"
            }}>
              🎉 ¡Juego Terminado! 🎉
            </h1>
            <div style={{ 
              fontSize: "18px", 
              color: "#a0a0a0",
              marginBottom: "20px"
            }}>
              {game?.maxRounds || 5} rondas completadas
            </div>
          </div>

          {/* Ganador destacado */}
          <div style={{
            background: "linear-gradient(135deg, #ffd700 0%, #ffed4e 100%)",
            borderRadius: "15px",
            padding: "20px",
            marginBottom: "30px",
            border: "3px solid #ffd700",
            boxShadow: "0 10px 20px rgba(255, 215, 0, 0.3)",
            position: "relative"
          }}>
            <div style={{ fontSize: "24px", marginBottom: "10px" }}>🏆</div>
            <div style={{ 
              fontSize: "28px", 
              fontWeight: "bold", 
              color: "#1a1a2e",
              marginBottom: "5px"
            }}>
              {game?.players?.[winner]?.nickname || "Player"}
            </div>
            <div style={{ 
              fontSize: "18px", 
              color: "#1a1a2e",
              opacity: 0.8
            }}>
              ¡Felicidades por la victoria!
            </div>
            <div style={{ 
              fontSize: "20px", 
              fontWeight: "bold", 
              color: "#1a1a2e",
              marginTop: "10px"
            }}>
              {game?.players?.[winner]?.totalScore?.toLocaleString() || 0} points
            </div>
          </div>

          {/* Ranking completo */}
          <div style={{ marginBottom: "30px" }}>
            <h3 style={{ 
              color: "#fff", 
              fontSize: "24px", 
              marginBottom: "20px",
              textShadow: "0 2px 4px rgba(0, 0, 0, 0.3)"
            }}>
              Clasificación Final
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {finalRanking.map((player, index) => {
                const isCurrentPlayer = player.uid === user?.uid;
                const isTop3 = index < 3;
                
                // Colores especiales para top 3
                let bgColor, borderColor, textColor;
                if (index === 0) {
                  bgColor = "linear-gradient(135deg, #ffd700 0%, #ffed4e 100%)";
                  borderColor = "#ffd700";
                  textColor = "#1a1a2e";
                } else if (index === 1) {
                  bgColor = "linear-gradient(135deg, #c0c0c0 0%, #e8e8e8 100%)";
                  borderColor = "#c0c0c0";
                  textColor = "#1a1a2e";
                } else if (index === 2) {
                  bgColor = "linear-gradient(135deg, #cd7f32 0%, #daa520 100%)";
                  borderColor = "#cd7f32";
                  textColor = "#1a1a2e";
                } else {
                  bgColor = isCurrentPlayer ? "rgba(139, 92, 246, 0.3)" : "rgba(255, 255, 255, 0.1)";
                  borderColor = isCurrentPlayer ? "#8b5cf6" : "rgba(255, 255, 255, 0.2)";
                  textColor = "#fff";
                }

                return (
                  <div key={player.uid} style={{
                    background: bgColor,
                    borderRadius: "12px",
                    padding: "16px",
                    border: `2px solid ${borderColor}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    boxShadow: isTop3 ? "0 8px 16px rgba(0, 0, 0, 0.2)" : "0 4px 8px rgba(0, 0, 0, 0.1)",
                    transform: isTop3 ? "scale(1.02)" : "scale(1)",
                    transition: "all 0.3s ease"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ 
                        fontSize: "24px",
                        minWidth: "30px",
                        textAlign: "center"
                      }}>
                        {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`}
                      </div>
                      <div>
                        <div style={{ 
                          fontWeight: "bold", 
                          fontSize: "18px",
                          color: textColor,
                          textShadow: isTop3 ? "0 1px 2px rgba(0, 0, 0, 0.1)" : "none"
                        }}>
                          {isCurrentPlayer ? "You" : player.nickname}
                        </div>
                        {isCurrentPlayer && (
                          <div style={{ 
                            fontSize: "12px", 
                            color: textColor,
                            opacity: 0.8
                          }}>
                            (Jugador actual)
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ 
                      fontSize: "20px", 
                      fontWeight: "bold",
                      color: textColor,
                      textShadow: isTop3 ? "0 1px 2px rgba(0, 0, 0, 0.1)" : "none"
                    }}>
                      {player.totalScore.toLocaleString()} pts
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Botones de acción */}
          <div style={{ display: "flex", gap: "15px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => {
                setStatus("lobby");
                setGameId(null);
                setGame(null);
                setWinner(null);
                setObservation(null);
                setGallery([]);
                setGuess(null);
                setDistance(null);
                setConfirmed(false);
                setRoundLocked(false);
                setShowResults(false);
                setRoundResults(null);
                setCountdown(10);
                setProcessedRounds(new Set());
                setHasProcessedCurrentRound(false);
                setError(null);
                setLoading(false);
                lastProcessedRoundRef.current = 0;
                lastProcessedGameIdRef.current = null;
              }}
              style={{
                padding: "15px 30px",
                fontSize: "16px",
                fontWeight: "bold",
                color: "#fff",
                background: "linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)",
                border: "none",
                borderRadius: "12px",
                cursor: "pointer",
                transition: "all 0.3s ease",
                boxShadow: "0 4px 8px rgba(231, 76, 60, 0.3)",
                minWidth: "140px"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "translateY(-2px)";
                e.target.style.boxShadow = "0 6px 12px rgba(231, 76, 60, 0.4)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "0 4px 8px rgba(231, 76, 60, 0.3)";
              }}
            >
              🎮 Jugar de nuevo
            </button>
            
            <button
              onClick={() => {
                setStatus("lobby");
                setGameId(null);
                setGame(null);
                setWinner(null);
                setObservation(null);
                setGallery([]);
                setGuess(null);
                setDistance(null);
                setConfirmed(false);
                setRoundLocked(false);
                setShowResults(false);
                setRoundResults(null);
                setCountdown(10);
                setProcessedRounds(new Set());
                setHasProcessedCurrentRound(false);
                setError(null);
                setLoading(false);
                lastProcessedRoundRef.current = 0;
                lastProcessedGameIdRef.current = null;
              }}
              style={{
                padding: "15px 30px",
                fontSize: "16px",
                fontWeight: "bold",
                color: "#1a1a2e",
                background: "linear-gradient(135deg, #f39c12 0%, #e67e22 100%)",
                border: "none",
                borderRadius: "12px",
                cursor: "pointer",
                transition: "all 0.3s ease",
                boxShadow: "0 4px 8px rgba(243, 156, 18, 0.3)",
                minWidth: "140px"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "translateY(-2px)";
                e.target.style.boxShadow = "0 6px 12px rgba(243, 156, 18, 0.4)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "0 4px 8px rgba(243, 156, 18, 0.3)";
              }}
            >
              🏠 Volver al menú
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
