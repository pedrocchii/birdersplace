import { useEffect, useState, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebaseClient";
import { doc, getDoc, collection, query, where, orderBy, limit, onSnapshot } from "firebase/firestore";
import { enqueueForDuel, tryMatchmake, cancelQueue, listenQueueDoc, listenMatchmakingQueue, listenForOpponentMatch, listenMatch, setRoundDataIfAbsent, submitGuessAndApplyDamage, updateHeartbeat } from "../services/multiplayer";
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap, Tooltip } from "react-leaflet";
import L from "leaflet";
import { redMarkerIcon } from "../components/mapIcons";
import LeafletSizeFix from "../components/LeafletSizeFix";
import "leaflet/dist/leaflet.css";

export default function Duels() {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState("");
  const [status, setStatus] = useState("idle"); // idle | waiting | matched | finished
  const [matchId, setMatchId] = useState(null);
  const [match, setMatch] = useState(null);
  const [winner, setWinner] = useState(null);
  const [waitingPlayers, setWaitingPlayers] = useState(0);
  const [currentRoundDisplayed, setCurrentRoundDisplayed] = useState(0);
  const lastProcessedRoundRef = useRef(0);
  const lastProcessedMatchIdRef = useRef(null);

  console.log("🎮 Duels component render - status:", status, "matchId:", matchId, "user:", user?.uid);

  // Juego por ronda (similar a Game)
  const [observation, setObservation] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [guess, setGuess] = useState(null);
  const [distance, setDistance] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [roundLocked, setRoundLocked] = useState(false);
  const [hasProcessedCurrentRound, setHasProcessedCurrentRound] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [roundResults, setRoundResults] = useState(null);
  const [countdown, setCountdown] = useState(10);
  const [processedRounds, setProcessedRounds] = useState(new Set());

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

  const REGIONS = [
    { name: "North America", bbox: [-170, 5, -50, 75], weight: 0.5 }, // Reducido a la mitad
    { name: "South America", bbox: [-82, -56, -34, 12], weight: 1.0 },
    { name: "Europe", bbox: [-31, 34, 45, 72], weight: 0.5 }, // Reducido a la mitad
    { name: "Africa", bbox: [-20, -35, 52, 37], weight: 1.0 },
    { name: "Asia", bbox: [25, -10, 180, 55], weight: 1.0 },
    { name: "Oceania", bbox: [110, -50, 180, 0], weight: 0.5 }, // Reducido a la mitad
  ];

  // Función para seleccionar región basada en pesos
  function selectWeightedRegion(seededRandom) {
    const totalWeight = REGIONS.reduce((sum, region) => sum + region.weight, 0);
    let random = seededRandom * totalWeight;
    
    for (const region of REGIONS) {
      random -= region.weight;
      if (random <= 0) {
        return region;
      }
    }
    
    // Fallback (no debería llegar aquí)
    return REGIONS[REGIONS.length - 1];
  }


  async function loadObservationForMatch(matchData, hostUid) {
    if (isLoading) return;
    console.log("Starting loadObservationForMatch, isLoading:", isLoading, "matchData:", matchData);
    setIsLoading(true);
    setGuess(null);
    setDistance(null);
    setConfirmed(false);

    console.log("Host loading observation for round:", matchData.round);

    // Usar un seed determinístico basado en matchId y ronda para asegurar consistencia
    const seed = `${matchData.id || matchData.matchId}_${matchData.round}`;
    console.log("🎲 Using deterministic seed:", seed);
    
    // Función para generar números pseudoaleatorios determinísticos
    function seededRandom(seed) {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return Math.abs(hash) / 2147483647; // Normalize to 0-1
    }

    const maxAttempts = 15;
    let attempts = 0;
    
    // Delay inicial para evitar peticiones muy rápidas
    await new Promise(r => setTimeout(r, 1000));
    
    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Attempt ${attempts}/${maxAttempts}`);
      try {
        // Usar seed determinístico para seleccionar región con pesos
        const regionRandom = seededRandom(seed + "_region");
        const region = selectWeightedRegion(regionRandom);
        const [minLng, minLat, maxLng, maxLat] = region.bbox;
        const randomPage = Math.floor(seededRandom(seed + "_page") * 200);
        const randomUrl = `https://api.inaturalist.org/v1/observations?photos=true&quality_grade=research&order=desc&per_page=100&geo=true&geoprivacy=open&page=${randomPage}&swlat=${minLat}&swlng=${minLng}&nelat=${maxLat}&nelng=${maxLng}&taxon_id=3`;
        
        // Headers mínimos para evitar detección como bot
        const randomRes = await fetch(randomUrl, {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (randomRes.status === 429) { 
          console.log("💤 Límite de requests, esperando 2000ms...");
          await new Promise(r => setTimeout(r, 2000));
          continue; 
        }
        
        if (randomRes.status === 403) {
          console.log("🚫 403 Forbidden, esperando 3000ms antes del siguiente intento...");
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        const randomData = await randomRes.json();
        if (!randomData.results || randomData.results.length === 0) continue;
        const valid = (randomData.results || []).filter(r => r.photos && r.photos.length && r.geojson?.coordinates && r.geojson.type === "Point");
        if (!valid.length) {
          console.log("No valid observations found");
          continue;
        }
        // Usar seed determinístico para seleccionar observación base
        const baseIndex = Math.floor(seededRandom(seed + "_base") * valid.length);
        const base = valid[baseIndex];
        const centerLat = base.geojson.coordinates[1];
        const centerLng = base.geojson.coordinates[0];

        const clusterUrl = `https://api.inaturalist.org/v1/observations?photos=true&quality_grade=research&order=desc&per_page=100&geo=true&geoprivacy=open&coordinates_obscured=false&lat=${centerLat}&lng=${centerLng}&radius=50&taxon_id=3`;

        const clusterRes = await fetch(clusterUrl, {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (clusterRes.status === 429) { 
          console.log("💤 Límite de requests cluster, esperando 2000ms...");
          await new Promise(r => setTimeout(r, 2000));
          continue; 
        }
        
        if (clusterRes.status === 403) {
          console.log("🚫 Cluster 403 Forbidden, esperando 3000ms antes del siguiente intento...");
          await new Promise(r => setTimeout(r, 3000));
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
        }));
        console.log("Found 8 items, saving to match:", items.length);
        // Solo el host guarda las observaciones en el match
        if (matchId && matchData?.round) {
            console.log("💾 Saving round data to Firestore - MatchId:", matchId, "Round:", matchData.round);
          await setRoundDataIfAbsent(matchId, matchData.round, { items, index: 0 });
            console.log("✅ Saved round data to match successfully");
          } else {
            console.log("❌ Cannot save round data - MatchId:", matchId, "Round:", matchData?.round);
        }
        setIsLoading(false);
        return;
        }

        await new Promise(r => setTimeout(r, 2000));
      } catch (error) {
        console.error(`Error en intento ${attempts}:`, error);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    console.error("❌ No se encontró un cluster válido tras varios intentos");
    setIsLoading(false);
  }

  async function loadObservation() {
    if (isLoading) return;
     console.log("🔄 Starting loadObservation, isLoading:", isLoading, "match:", match, "user:", user?.uid);
    setIsLoading(true);
    setGuess(null);
    setDistance(null);
    setConfirmed(false);

    // Solo el host puede cargar observaciones
    if (!match?.hostUid || match.hostUid !== user.uid) {
       console.log("❌ Not host, skipping loadObservation. User:", user?.uid, "Host:", match?.hostUid);
      setIsLoading(false);
      return;
    }

     console.log("✅ Host confirmed, proceeding with loadObservation");
     console.log("🎯 Host loading observation for round:", match.round);

    const maxAttempts = 8;
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Attempt ${attempts}/${maxAttempts}`);
      try {
        const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
        const [minLng, minLat, maxLng, maxLat] = region.bbox;
        const randomPage = Math.floor(Math.random() * 200);
        const randomUrl = `https://api.inaturalist.org/v1/observations?photos=true&quality_grade=research&order=desc&per_page=100&geo=true&geoprivacy=open&page=${randomPage}&swlat=${minLat}&swlng=${minLng}&nelat=${maxLat}&nelng=${maxLng}&taxon_id=3`;

        const randomRes = await fetch(randomUrl);
        if (randomRes.status === 429) { 
          console.log("Rate limited, waiting...");
          await new Promise(r => setTimeout(r, 500)); 
          continue; 
        }
        const randomData = await randomRes.json();
        const valid = (randomData.results || []).filter(r => r.photos && r.photos.length && r.geojson?.coordinates && r.geojson.type === "Point");
        if (!valid.length) {
          console.log("No valid observations found");
          continue;
        }
        const base = valid[Math.floor(Math.random() * valid.length)];
        const centerLat = base.geojson.coordinates[1];
        const centerLng = base.geojson.coordinates[0];

        const clusterUrl = `https://api.inaturalist.org/v1/observations?photos=true&quality_grade=research&order=desc&per_page=50&geo=true&geoprivacy=open&coordinates_obscured=false&lat=${centerLat}&lng=${centerLng}&radius=50&taxon_id=3`;
        const clusterRes = await fetch(clusterUrl);
        if (clusterRes.status === 429) { 
          console.log("Cluster rate limited, waiting...");
          await new Promise(r => setTimeout(r, 500)); 
          continue; 
        }
        const clusterData = await clusterRes.json();
        const cluster = (clusterData.results || []).filter(r => r.photos && r.photos.length && r.geojson?.coordinates && r.geojson.type === "Point");
        if (cluster.length < 8) {
          console.log("Not enough cluster observations:", cluster.length);
          continue;
        }
        
        // Filtrar para obtener observaciones con especies únicas
        const uniqueSpecies = new Map();
        cluster.forEach(obs => {
          const speciesName = obs.taxon?.preferred_common_name || obs.taxon?.name || 'Unknown';
          if (!uniqueSpecies.has(speciesName)) {
            uniqueSpecies.set(speciesName, obs);
          }
        });
        
        // Si tenemos al menos 8 especies únicas, usarlas
        let selected;
        if (uniqueSpecies.size >= 8) {
          const uniqueObservations = Array.from(uniqueSpecies.values());
          const shuffled = [...uniqueObservations].sort(() => Math.random() - 0.5);
          selected = shuffled.slice(0, 8);
        } else {
          // Si no hay suficientes especies únicas, usar el método original
          const shuffled = [...cluster].sort(() => Math.random() - 0.5);
          selected = shuffled.slice(0, 8);
        }
        const items = selected.map(r => ({
          id: r.id,
          photo: r.photos[0].url.replace("square", "large"),
          lat: r.geojson.coordinates[1],
          lon: r.geojson.coordinates[0],
          species: r.taxon?.preferred_common_name || r.taxon?.name,
        }));
        console.log("Found 8 items, saving to match:", items.length);
        // Solo el host guarda las observaciones en el match
        if (matchId && match?.round) {
          await setRoundDataIfAbsent(matchId, match.round, { items, index: 0 });
          console.log("Saved round data to match");
        }
        setIsLoading(false);
        return;
      } catch (error) {
        console.error("Error in loadObservation attempt", attempts, error);
        await new Promise(r => setTimeout(r, 300));
      }
    }
    console.log("Failed to load observation after all attempts");
    setIsLoading(false);
  }

  function MapClickHandler() {
    useMapEvents({
      click(e) { 
        // Ignorar clicks cuando la ronda está bloqueada o ya confirmada
        if (roundLocked || confirmed) return;
          setGuess(e.latlng); 
      },
    });
    return null;
  }


  function ResultsMap() {
    const map = useMap();
    useEffect(() => {
      if (!roundResults || !roundResults.observation) return;
      
      const { observation, guesses } = roundResults;
      const positions = [
        [observation.lat, observation.lon],
        ...Object.values(guesses).map(g => [g.guess.lat, g.guess.lng])
      ];
      
      if (positions.length > 1) {
        const bounds = L.latLngBounds(positions);
        // Ajustar el padding y zoom para mejor visualización
        map.flyToBounds(bounds, { 
          padding: [80, 80], 
          maxZoom: 6, 
          duration: 1.2,
          animate: true
        });
      }
    }, [roundResults, map]);
    return null;
  }

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

  // Permite abrir directamente con ?match=ID (solo si viene de una sala)
  useEffect(() => {
    if (!user) return; // Esperar a que el usuario esté autenticado
    
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    const matchParam = params.get("match");
    console.log("🔍 URL params check - view:", view, "matchParam:", matchParam, "user:", user?.uid);
    if (view === "duels" && matchParam) {
      console.log("🎯 Navegando a duelo existente:", matchParam);
      // Solo establecer como matched si viene de una sala (tiene matchId real)
      setMatchId(matchParam);
      setStatus("matched");
    } else {
      console.log("ℹ️ Navegando a duelo normal, sin matchId");
    }
  }, [user]);

  // Limpiar cola anterior al cargar el componente (solo si no venimos de una sala)
  useEffect(() => {
    if (!user) return;
    
    // Verificar si venimos de una sala (tiene parámetro match en la URL)
    const params = new URLSearchParams(window.location.search);
    const matchParam = params.get("match");
    
    if (matchParam) {
      console.log("🎯 Viniendo de sala privada, saltando limpieza");
      return;
    }
    
    console.log("🧹 Limpiando cola anterior del usuario");
    
    // Limpiar cola y resetear estado completamente
    const cleanup = async () => {
      try {
        await cancelQueue();
        console.log("✅ Cola anterior limpiada");
      } catch (error) {
        console.log("⚠️ Error limpiando cola anterior:", error);
      }
      
      // Resetear estado para asegurar que empezamos limpio
      setStatus("idle");
      setMatchId(null);
      setMatch(null);
      setWinner(null);
      setObservation(null);
      setGallery([]);
      setGuess(null);
      setDistance(null);
      setConfirmed(false);
      setRoundLocked(false);
      setHasProcessedCurrentRound(false);
      setShowResults(false);
      setRoundResults(null);
      setCountdown(10);
      setProcessedRounds(new Set());
      setCurrentRoundDisplayed(0);
      lastProcessedRoundRef.current = 0;
      lastProcessedMatchIdRef.current = null;
      
      console.log("✅ Estado completamente reseteado");
    };
    
    cleanup();
  }, [user]);

  // Escuchar la cola de matchmaking
  useEffect(() => {
    if (!user || matchId) return; // No escuchar si ya tenemos un match
    
    console.log("🎧 Iniciando listener de cola de matchmaking");
    
    const off = listenMatchmakingQueue((queueData) => {
      console.log("📊 Queue data received:", queueData);
      setWaitingPlayers(queueData.waitingPlayers);
      
      // Solo cambiar a waiting si estamos en la cola
      if (queueData.myPosition > 0) {
        console.log("✅ Usuario encontrado en cola, posición:", queueData.myPosition);
        setStatus("waiting");
        
        // Si hay 2+ jugadores, intentar matchmaking
        if (queueData.waitingPlayers >= 2) {
          console.log("🎯 Hay suficientes jugadores, intentando matchmaking...");
          tryMatchmake().then((matchId) => {
            if (matchId) {
              console.log("✅ Match creado exitosamente:", matchId);
              setMatchId(matchId);
              setStatus("matched");
              // NO cargar observaciones aquí, esperar a que el host las cargue en listenMatch
            } else {
              console.log("❌ No se pudo crear el match (matchId es null)");
            }
          }).catch((error) => {
            console.log("❌ Error en matchmaking:", error);
          });
        }
      } else {
        console.log("❌ Usuario NO encontrado en cola, myPosition:", queueData.myPosition);
      }
    });
    
    return () => off();
  }, [user, matchId]); // Solo dependencias necesarias

  // Heartbeat para mantener al usuario activo en la cola
  useEffect(() => {
    if (!user || status !== "waiting") return;
    
    const heartbeatInterval = setInterval(() => {
      updateHeartbeat();
    }, 10000); // Cada 10 segundos
    
    return () => clearInterval(heartbeatInterval);
  }, [user, status]);

  // Escuchar si se creó un match para este usuario usando listenQueueDoc
  useEffect(() => {
    if (!user) return;
    
    console.log("⚠️ listenQueueDoc deshabilitado temporalmente para evitar matches fantasma");
    
    // const off = listenQueueDoc((q) => {
    //   if (!q) return;
    //   console.log("📋 Estado de cola del usuario:", q);
      
    //   if (q.status === "matched" && q.matchId) {
    //     console.log("🎯 Match encontrado para usuario:", q.matchId);
    //     setMatchId(q.matchId);
    //     setStatus("matched");
    //     // Cargar la primera ronda inmediatamente
    //     loadObservation();
    //   }
    // });
    
    // return () => off();
  }, [user]);

  // Escuchar si nuestro oponente fue emparejado con nosotros
  useEffect(() => {
    if (!user || status !== "waiting") return;
    
    const off = listenForOpponentMatch((matchData) => {
      console.log("🎯 Oponente fue emparejado con nosotros:", matchData);
      setMatchId(matchData.matchId);
      setStatus("matched");
      // No cargar observaciones aquí, esperar a que el host las cargue
    });
    
    return () => off();
  }, [user, status]);

  useEffect(() => {
    if (!matchId) return;
    const off = listenMatch(matchId, (m) => {
      console.log("Match update:", m);
      setMatch(m);
      
      // Resetear estado de rondas cuando se inicia un nuevo match
      if (m.id !== lastProcessedMatchIdRef.current) {
        lastProcessedRoundRef.current = 0;
        lastProcessedMatchIdRef.current = m.id;
        setCurrentRoundDisplayed(0);
        setGuess(null);
        setDistance(null);
        setConfirmed(false);
        setRoundLocked(false);
        setHasProcessedCurrentRound(false);
        setProcessedRounds(new Set());
      }
      
      // Verificar si el juego terminó
      if (m.state === "finished") {
           console.log("Game finished, players data:", m.players);
        setStatus("finished");
        const players = m.players || {};
           // Detectar ganador: el que NO tiene 0 puntos es el ganador
           const playersArray = Object.entries(players).map(([uid, p]) => ({ uid, ...p }));
           const winner = playersArray.find(p => p.hp > 0) || playersArray[0]; // fallback al primer jugador
           console.log("Players HP:", Object.entries(players).map(([uid, p]) => `${uid}: ${p.hp}`));
           console.log("Winner detected:", winner);
           console.log("Current user UID:", user?.uid);
           setWinner(winner);
        
        // Mostrar resultados de la última ronda antes de mostrar Game Over
        const lastRound = m.round - 1; // La ronda que se completó
        const lastRoundData = m.rounds?.[lastRound];
        if (lastRoundData && lastRoundData.guesses && Object.keys(lastRoundData.guesses).length === 2 && !showResults) {
          console.log("Game finished, showing final round results for round", lastRound);
          setRoundResults({
            round: lastRound,
            observation: lastRoundData.items?.[lastRoundData.index],
            guesses: lastRoundData.guesses,
            damage: lastRoundData.damage,
            players: m.players // Usar los HP actualizados del match actual
          });
          setShowResults(true);
        }
        return;
      }

      // Cargar automáticamente la ronda actual si hay datos
      const r = m.round;
      const rd = m.rounds?.[r];
      console.log("Match update - Round:", r, "Round data:", rd, "User:", user?.uid, "Host:", m.hostUid);
      console.log("All rounds:", m.rounds);
      
      // Solo resetear si es una ronda completamente nueva (comparar con la ronda procesada anteriormente)
      // Y no hemos procesado ya esta ronda
      if (r !== lastProcessedRoundRef.current && !hasProcessedCurrentRound) {
        console.log("Round change detected, resetting state from round", lastProcessedRoundRef.current, "to round", r);
        
        // Si estamos avanzando de una ronda anterior (no es la primera ronda), mostrar resultados
        if (lastProcessedRoundRef.current > 0) {
          const completedRound = lastProcessedRoundRef.current;
          const completedRoundData = m.rounds?.[completedRound];
          
          console.log("Showing results for completed round:", completedRound, "Data:", completedRoundData);
          console.log("Round data checks:", {
            hasRoundData: !!completedRoundData,
            hasGuesses: !!(completedRoundData?.guesses),
            guessesCount: completedRoundData?.guesses ? Object.keys(completedRoundData.guesses).length : 0,
            hasDamage: !!(completedRoundData?.damage),
            showResults: showResults,
            processedRounds: Array.from(processedRounds),
            isProcessed: processedRounds.has(completedRound)
          });
          
          if (completedRoundData && 
              completedRoundData.guesses && 
              Object.keys(completedRoundData.guesses).length === 2 && 
              completedRoundData.damage &&
              !showResults && 
              !processedRounds.has(completedRound)) {
            console.log("Both players finished round, showing results for round", completedRound);
            setRoundResults({
              round: completedRound,
              observation: completedRoundData.items?.[completedRoundData.index],
              guesses: completedRoundData.guesses,
              damage: completedRoundData.damage,
              players: m.players // Usar los HP actualizados del match actual
            });
            setShowResults(true);
            setProcessedRounds(prev => new Set([...prev, completedRound]));
          }
        }
        
        setGuess(null);
        setDistance(null);
        setConfirmed(false);
        setRoundLocked(false);
        setHasProcessedCurrentRound(false);
        setCurrentRoundDisplayed(r);
        lastProcessedRoundRef.current = r;
      }
      
      if (rd && rd.items && typeof rd.index === 'number') {
        console.log("✅ Loading round data from match - Items:", rd.items.length, "Index:", rd.index);
        setGallery(rd.items);
        const obs = rd.items[rd.index];
        setObservation(obs);
      } else if (user && m.hostUid === user.uid && !rd) {
         console.log("🎯 Host loading first round - User:", user.uid, "Host:", m.hostUid, "Round:", m.round);
        // Solo el host carga la primera ronda automáticamente
        loadObservationForMatch(m, user.uid);
       } else if (!rd) {
         console.log("⏳ Non-host waiting for host to load round data - User:", user.uid, "Host:", m.hostUid, "Round data:", rd);
         // Los no-hosts esperan a que el host cargue los datos
      }

    });
    return () => off();
  }, [matchId, user]);

  // Auto-avanzar a la siguiente ronda después de 10 segundos
  useEffect(() => {
    if (showResults && roundResults) {
      setCountdown(10);
      
      const countdownInterval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            setShowResults(false);
            setRoundResults(null);
            
            // Si el juego ha terminado, no resetear el estado del juego
            if (status !== "finished") {
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

      return () => clearInterval(countdownInterval);
    }
  }, [showResults, roundResults, status]);

  async function handleFind() {
    if (!user) return;
    
    console.log("🔍 Iniciando búsqueda de partida...");
    
    try {
    setStatus("waiting");
      console.log("✅ Status cambiado a waiting");
      
      const result = await enqueueForDuel(nickname);
      console.log("📝 Resultado de enqueueForDuel:", result);
      
      // Si ya se hizo match inmediatamente, configurar el juego
      if (result.matched && result.matchId) {
        console.log("🎯 Match encontrado inmediatamente:", result.matchId);
        setMatchId(result.matchId);
      setStatus("matched");
        // NO cargar observaciones aquí, esperar a que el host las cargue en listenMatch
      } else {
        console.log("⏳ Usuario agregado a cola, esperando matchmaking...");
        // Pequeño delay para asegurar que el listener detecte el cambio
        setTimeout(() => {
          console.log("🔍 Estado actual después de delay:", status);
          if (status === "waiting") {
            console.log("✅ Usuario en cola, esperando matchmaking...");
          } else {
            console.log("❌ Estado inesperado:", status);
          }
        }, 100);
      }
    } catch (error) {
      console.error("❌ Error buscando partida:", error);
      setStatus("idle");
    }
  }

  async function handleCancel() {
    await cancelQueue();
    setStatus("idle");
    setMatchId(null);
  }

  return (
    <div className="container-narrow" style={{ padding: "1rem", textAlign: "center" }}>
      <div style={{ position: "fixed", left: 12, top: 12, zIndex: 1000 }}>
        <button 
          onClick={() => window.location.href = "?view=rooms"}
          style={{ 
            padding: "6px 10px", 
            borderRadius: 8, 
            border: "none", 
            background: "#374151", 
            color: "#fff", 
            cursor: "pointer" 
          }}
        >
           Atrás
        </button>
      </div>
      <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Birders Place - Duels</h1>
      
      {!user && (
        <div style={{ padding: "2rem", color: "#fff" }}>Inicia sesión para jugar.</div>
      )}
      
      {user && status === "idle" && (
        <button
          onClick={handleFind}
          disabled={isLoading}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            backgroundColor: isLoading ? "#95a5a6" : "#3498db",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading ? "Cargando..." : "Buscar partida 1v1"}
        </button>
      )}
      
      {user && status === "waiting" && (
        <>
          <div style={{ marginTop: "1rem", color: "#fff" }}>
            🔍 Buscando oponente...
          </div>
          <div style={{ fontSize: "14px", marginTop: "0.5rem", opacity: 0.8 }}>
            {waitingPlayers > 0 
              ? `👥 ${waitingPlayers} jugador${waitingPlayers > 1 ? 'es' : ''} esperando...`
              : "⏳ Esperando que se una otro jugador..."
            }
          </div>
          <button
            onClick={handleCancel}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              backgroundColor: "#e74c3c",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
        </>
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
              Ronda {roundResults.round} - Resultados
            </h2>
            
            {/* Información del duelo */}
            <div style={{ 
              background: "#374151", 
              borderRadius: "8px", 
              padding: "1rem", 
              marginBottom: "1rem",
              textAlign: "center"
            }}>
              <div style={{ color: "#d1d5db", fontSize: "16px", marginBottom: "8px" }}>
                🥊 Duelo: {Object.entries(roundResults.players).map(([uid, player]) => {
                  const isCurrentPlayer = uid === user?.uid;
                  return (
                    <span key={uid} style={{ 
                      color: isCurrentPlayer ? "#8b5cf6" : "#10b981",
                      fontWeight: "bold",
                      margin: "0 4px"
                    }}>
                      {isCurrentPlayer ? "Tú" : (player?.nickname || "Jugador")}
                    </span>
                  );
                }).reduce((prev, curr, index) => [prev, index === 1 ? " vs " : "", curr])}
              </div>
            <div style={{ color: "#9ca3af", fontSize: "14px" }}>
              Rondas jugadas: {roundResults.round} | Puntos restantes: {Object.entries(roundResults.players).map(([uid, player]) => {
                const isCurrentPlayer = uid === user?.uid;
                // Los HP ya están actualizados después del daño en roundResults.players
                const finalHp = player?.hp ?? 6000;
                
                return (
                  <span key={uid} style={{ 
                    color: isCurrentPlayer ? "#8b5cf6" : "#10b981",
                    fontWeight: "bold",
                    margin: "0 8px"
                  }}>
                    {isCurrentPlayer ? "Tú" : (player?.nickname || "Jugador")}: {finalHp.toLocaleString()}
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
                  <Tooltip permanent direction="top" offset={[0, -4]} className="distance-tooltip">
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontWeight: "bold", color: "#dc2626" }}>📍 UBICACIÓN REAL</div>
                    </div>
                  </Tooltip>
                </Marker>
                
                {/* Respuestas de los jugadores */}
                {Object.entries(roundResults.guesses).map(([uid, guess], index) => {
                  const isCurrentPlayer = uid === user?.uid;
                  const player = roundResults.players[uid];
                  const colors = ["#3b82f6", "#10b981"];
                  const color = colors[index % colors.length];
                  
                  return (
                    <Marker key={uid} position={[guess.guess.lat, guess.guess.lng]}>
                      <Tooltip permanent direction="top" offset={[0, -4]} className="distance-tooltip">
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontWeight: "bold", color: color }}>
                            {isCurrentPlayer ? "TÚ" : (player?.nickname || "Rival")}
                          </div>
                          <div style={{ fontSize: "12px" }}>
                            {formatDistance(guess.distance)} de distancia
                          </div>
                        </div>
                      </Tooltip>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
            
            {/* Información de daño */}
            {roundResults.damage && (
              <div style={{ 
                background: "#dc2626", 
                borderRadius: "8px", 
                padding: "1rem", 
                marginBottom: "1rem",
                textAlign: "center"
              }}>
                <div style={{ color: "#fff", fontWeight: "bold", fontSize: "18px" }}>
                  ⚔️ {roundResults.damage.winner} ganó esta ronda!
                </div>
                <div style={{ color: "#fecaca", marginTop: "4px" }}>
                  {roundResults.damage.loser} perdió {roundResults.damage.amount.toLocaleString()} puntos
                  {roundResults.damage.multiplier && roundResults.damage.multiplier > 1 && (
                    <span style={{ color: "#fbbf24", fontWeight: "bold", marginLeft: "8px" }}>
                      (x{roundResults.damage.multiplier})
                    </span>
                  )}
                </div>
                {roundResults.damage.distances && (
                  <div style={{ color: "#fecaca", marginTop: "8px", fontSize: "14px" }}>
                    Distancias: {Object.entries(roundResults.damage.distances).map(([uid, dist]) => {
                      const player = roundResults.players[uid];
                      const isCurrentPlayer = uid === user?.uid;
                      return (
                        <span key={uid} style={{ margin: "0 8px" }}>
                          {isCurrentPlayer ? "Tú" : (player?.nickname || "Jugador")}: {formatDistance(dist)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            
            {/* HP actual de ambos jugadores */}
            <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginBottom: "1rem" }}>
              {Object.entries(roundResults.players).map(([uid, player]) => {
                const isCurrentPlayer = uid === user?.uid;
                // Los HP ya están actualizados después del daño en roundResults.players
                const finalHp = player?.hp ?? 6000;
                
                return (
                  <div key={uid} style={{ 
                    background: isCurrentPlayer ? "#374151" : "#111827", 
                    padding: "1rem", 
                    borderRadius: "8px",
                    border: isCurrentPlayer ? "2px solid #8b5cf6" : "1px solid #374151",
                    minWidth: "150px",
                    textAlign: "center"
                  }}>
                    <div style={{ fontWeight: "bold", color: isCurrentPlayer ? "#8b5cf6" : "#d1d5db" }}>
                      {isCurrentPlayer ? "Tú" : (player?.nickname || "Rival")}
                    </div>
                    <div style={{ fontSize: "24px", fontWeight: "bold", color: finalHp <= 0 ? "#ef4444" : "#10b981", marginTop: "4px" }}>
                      {finalHp.toLocaleString()} pts
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* Contador de tiempo */}
            <div style={{ textAlign: "center", color: "#9ca3af" }}>
              <div style={{ fontSize: "18px", marginBottom: "8px" }}>
                {status === "finished" ? "Mostrando resultados finales..." : "Siguiente ronda en:"}
              </div>
              <div style={{ 
                fontSize: "48px", 
                fontWeight: "bold", 
                color: countdown <= 3 ? "#ef4444" : "#f1c40f",
                textShadow: "0 0 10px rgba(241, 196, 15, 0.5)"
              }}>
                {countdown}
              </div>
            </div>
          </div>
        </div>
      )}

      {user && status === "matched" && match && !showResults && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ marginBottom: "1rem", color: "#fff" }}>
            <h3 style={{ margin: 0 }}>¡Match encontrado! Ronda {match.round || 1}</h3>
            {match.round >= 4 && (
              <div style={{ 
                marginTop: 8, 
                padding: "4px 8px", 
                backgroundColor: "#dc2626", 
                color: "#fff", 
                borderRadius: "6px", 
                fontSize: "14px", 
                fontWeight: "bold",
                display: "inline-block"
              }}>
                🔥 Multiplicador de daño: x{(1.5 + (match.round - 4) * 0.5).toFixed(1)}
              </div>
            )}
            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 12 }}>
              {Object.entries(match.players || {}).map(([uid, p]) => (
                <div key={uid} style={{ 
                  background: "#2c3e50", 
                  padding: "12px 16px", 
                  borderRadius: "8px",
                  border: uid === user.uid ? "2px solid #3498db" : "2px solid transparent"
                }}>
                  <div style={{ fontWeight: 700, color: "#fff" }}>
                    {p.nickname || (uid === user.uid ? (nickname || "Tú") : "Rival")}
                  </div>
                  <div style={{ color: "#ecf0f1" }}>Puntos: {(p.hp ?? 6000).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          {!observation && (
            <div style={{ marginTop: "1rem", color: "#fbbf24" }}>
              {isLoading ? "Cargando ronda..." : "Esperando ronda..."}
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
                  <img src={item.photo} alt={item.species} />
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
              onClick={async () => {
                if (!observation || !guess || roundLocked) return;
                setRoundLocked(true);
                
                try {
                const d = haversineDistance(observation.lat, observation.lon, guess.lat, guess.lng);
                setDistance(d);
                setConfirmed(true);
                  setHasProcessedCurrentRound(true);
                await submitGuessAndApplyDamage(matchId, user.uid, d, { lat: guess.lat, lng: guess.lng });
                  // No mostrar la ubicación real hasta que ambos terminen
                } catch (error) {
                  console.error("Error enviando guess:", error);
                  setRoundLocked(false); // En caso de error, desbloquear
                }
              }}
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
              Verificar
            </button>
          )}

          {roundLocked && (
            <div style={{ marginTop: "18px", padding: "0.6rem 1.2rem", backgroundColor: "#95a5a6", color: "white", borderRadius: "10px", textAlign: "center" }}>
              Procesando...
            </div>
          )}

          {confirmed && !showResults && (
            <div className="result-panel">
              <h3 style={{ margin: 0 }}>Ronda {match.round || 1}</h3>
              {match.round >= 4 && (
                <div style={{ 
                  marginTop: 8, 
                  padding: "4px 8px", 
                  backgroundColor: "#dc2626", 
                  color: "#fff", 
                  borderRadius: "6px", 
                  fontSize: "14px", 
                  fontWeight: "bold",
                  display: "inline-block"
                }}>
                  🔥 Multiplicador de daño: x{(1.5 + (match.round - 4) * 0.5).toFixed(1)}
              </div>
              )}
              <div style={{ marginTop: 16, color: "#fbbf24", fontSize: "18px", fontWeight: "bold" }}>
                ⏳ Esperando al rival...
              </div>
              </div>
          )}
        </div>
      )}

      {status === "finished" && winner && match && (
        <div className="result-panel" style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}>
          <h2 style={{ margin: 0, color: "#fff" }}>🎉 ¡Juego terminado!</h2>
          {console.log("Game Over screen - match.players:", match.players)}
          
          {/* Información del duelo final */}
          <div style={{ 
            background: "rgba(255,255,255,0.1)", 
            borderRadius: "8px", 
            padding: "1rem", 
            margin: "1rem 0",
            textAlign: "center"
          }}>
            <div style={{ color: "#fff", fontSize: "18px", marginBottom: "8px" }}>
              🥊 Duelo: {Object.entries(match.players || {}).map(([uid, player]) => {
                    const isCurrentPlayer = uid === user?.uid;
                    return (
                  <span key={uid} style={{ 
                    color: isCurrentPlayer ? "#fbbf24" : "#ecf0f1",
                    fontWeight: "bold",
                    margin: "0 4px"
                  }}>
                    {isCurrentPlayer ? "Tú" : (player?.nickname || "Jugador")}
                  </span>
                );
              }).reduce((prev, curr, index) => [prev, index === 1 ? " vs " : "", curr])}
                        </div>
            <div style={{ color: "#ecf0f1", fontSize: "16px", marginBottom: "8px" }}>
              Rondas jugadas: {match.round || 1}
                        </div>
            <div style={{ color: "#ecf0f1", fontSize: "16px" }}>
              Puntos finales: {Object.entries(match.players || {}).map(([uid, player]) => {
                const isCurrentPlayer = uid === user?.uid;
                return (
                  <span key={uid} style={{ 
                    color: isCurrentPlayer ? "#fbbf24" : "#ecf0f1",
                    fontWeight: "bold",
                    margin: "0 8px"
                  }}>
                    {isCurrentPlayer ? "Tú" : (player?.nickname || "Jugador")}: {(player?.hp ?? 0).toLocaleString()}
                  </span>
                );
              }).reduce((prev, curr, index) => [prev, index === 1 ? " | " : "", curr])}
                      </div>
                    </div>
          
          <div style={{ marginTop: 12, fontSize: "24px", fontWeight: "bold", color: "#fbbf24" }}>
            Ganador: {winner.nickname || "Rival"}
          </div>
          <div style={{ marginTop: 8, color: "#ecf0f1" }}>
             {(() => {
               const isWinner = winner.uid === user?.uid;
               console.log("Message check - Winner UID:", winner?.uid, "User UID:", user?.uid, "Is winner:", isWinner);
               return isWinner ? 
                 "¡Felicidades por la victoria! 🎉" : 
                 "¡Mejor suerte la próxima vez! 💪";
             })()}
          </div>
          <button
             onClick={async () => {
               console.log("🔄 Reiniciando juego - limpiando todo el estado");
               
               // Limpiar cola anterior
               await cancelQueue().catch(error => {
                 console.log("⚠️ Error limpiando cola anterior:", error);
               });
               
               // Resetear todo el estado
              setStatus("idle");
              setMatchId(null);
              setMatch(null);
              setWinner(null);
              setObservation(null);
              setGallery([]);
              setGuess(null);
              setDistance(null);
              setConfirmed(false);
               setRoundLocked(false);
               setHasProcessedCurrentRound(false);
               setShowResults(false);
               setRoundResults(null);
               setCountdown(10);
               setProcessedRounds(new Set());
               setCurrentRoundDisplayed(0);
               lastProcessedRoundRef.current = 0;
               lastProcessedMatchIdRef.current = null;
               
               console.log("✅ Estado completamente limpiado");
               
               // Detectar si venimos de sala privada o matchmaking
               const params = new URLSearchParams(window.location.search);
               const matchParam = params.get("match");
               
               if (matchParam) {
                 // Veníamos de una sala privada, volver a la sala
                 console.log("🏠 Volviendo a la sala privada");
                 window.location.href = "?view=rooms";
               } else {
                 // Veníamos de matchmaking, ir al matchmaking
                 console.log("🔍 Volviendo al matchmaking 1v1");
                 window.location.href = "?view=duels";
               }
            }}
            style={{
              marginTop: 16,
              padding: "0.7rem 1.2rem",
              backgroundColor: "#ef4444",
              color: "white",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
              boxShadow: "0 6px 14px rgba(239,68,68,0.25)"
            }}
          >
            Jugar de nuevo
          </button>
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


