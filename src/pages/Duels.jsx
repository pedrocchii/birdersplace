import { useEffect, useState, useRef, useReducer, useCallback, useMemo } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebaseClient";
import { doc, getDoc, collection, query, where, orderBy, limit, onSnapshot, deleteDoc, runTransaction, setDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { enqueueForDuel, tryMatchmake, cancelQueue, listenQueueDoc, listenMatchmakingQueue, listenForOpponentMatch, listenMatch, setRoundDataIfAbsent, submitGuessAndApplyDamage, updateHeartbeat } from "../services/multiplayer";
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap, Tooltip } from "react-leaflet";
import L from "leaflet";
import { redMarkerIcon } from "../components/mapIcons";
import LeafletSizeFix from "../components/LeafletSizeFix";
import "leaflet/dist/leaflet.css";

// Function to update player stats when they win or lose a duel
// System: +5 cups for win, -5 cups for loss (minimum 0 cups)
const updatePlayerCups = async (playerUid, playerNickname, isWin) => {
  try {
    const playerRef = doc(db, "user_stats", playerUid);
    
    await runTransaction(db, async (tx) => {
      const playerSnap = await tx.get(playerRef);
      
      if (playerSnap.exists()) {
        // Player exists, update stats
        const currentData = playerSnap.data();
        
        if (isWin) {
          // Player won - gain 5 cups
          tx.update(playerRef, {
            duelCups: (currentData.duelCups || 0) + 5,
            duelWins: (currentData.duelWins || 0) + 1,
            lastDuelWin: new Date()
          });
        } else {
          // Player lost - lose 5 cups (minimum 0)
          const newCups = Math.max(0, (currentData.duelCups || 0) - 5);
          tx.update(playerRef, {
            duelCups: newCups,
            duelLosses: (currentData.duelLosses || 0) + 1,
            lastDuelLoss: new Date()
          });
        }
      } else {
        // New player, create document
        if (isWin) {
          tx.set(playerRef, {
            uid: playerUid,
            nickname: playerNickname,
            duelCups: 5, // New player starts with 5 cups if they win
            duelWins: 1,
            duelLosses: 0,
            firstDuelWin: new Date(),
            lastDuelWin: new Date()
          });
        } else {
          tx.set(playerRef, {
            uid: playerUid,
            nickname: playerNickname,
            duelCups: 0, // New player starts with 0 cups if they lose
            duelWins: 0,
            duelLosses: 1,
            firstDuelLoss: new Date(),
            lastDuelLoss: new Date()
          });
        }
      }
    });
    
    console.log(`✅ Stats updated for ${isWin ? 'winner' : 'loser'}:`, playerNickname);
  } catch (error) {
    console.error("❌ Error updating player stats:", error);
  }
};

// Constants
const GAME_CONFIG = {
  INITIAL_HP: 6000,
  ROUND_TIMER: 30, // seconds
  RESULTS_COUNTDOWN: 10, // seconds
  HEARTBEAT_INTERVAL: 10000, // milliseconds
  MAX_OBSERVATION_ATTEMPTS: 15,
  RATE_LIMIT_DELAY: 500, // milliseconds
  TIMEOUT_DISTANCE: 20000, // km for timeout elimination
  LOADING_TIMEOUT: 20000, // milliseconds - timeout for observation loading
};

const REGIONS = [
  { name: "North America", bbox: [-170, 5, -50, 75], weight: 0.5 },
  { name: "South America", bbox: [-82, -56, -34, 12], weight: 1.0 },
  { name: "Europe", bbox: [-31, 34, 45, 72], weight: 0.5 },
  { name: "Africa", bbox: [-20, -35, 52, 37], weight: 1.0 },
  { name: "Asia", bbox: [25, -10, 180, 55], weight: 1.0 },
  { name: "Oceania", bbox: [110, -50, 180, 0], weight: 0.5 },
];

const GAME_STATUS = {
  IDLE: "idle",
  WAITING: "waiting", 
  MATCHED: "matched",
  FINISHED: "finished"
};

// Utility functions
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

function getRandomRegion() {
  return REGIONS[Math.floor(Math.random() * REGIONS.length)];
}

function buildObservationUrl(region, page = 0) {
  const [minLng, minLat, maxLng, maxLat] = region.bbox;
  return `https://api.inaturalist.org/v1/observations?photos=true&quality_grade=research&order=desc&per_page=100&geo=true&geoprivacy=open&page=${page}&swlat=${minLat}&swlng=${minLng}&nelat=${maxLat}&nelng=${maxLng}&taxon_id=3&captive=false`;
}

function buildClusterUrl(centerLat, centerLng) {
  return `https://api.inaturalist.org/v1/observations?photos=true&quality_grade=research&order=desc&per_page=100&geo=true&geoprivacy=open&coordinates_obscured=false&lat=${centerLat}&lng=${centerLng}&radius=50&taxon_id=3&captive=false`;
}

function filterValidObservations(results) {
  return (results || []).filter(r => 
    r.photos && r.photos.length && 
    r.geojson?.coordinates && 
    r.geojson.type === "Point"
  );
}

function processObservations(observations) {
  return observations.map(r => ({
    id: r.id,
    photo: r.photos[0].url.replace("square", "large"),
    lat: r.geojson.coordinates[1],
    lon: r.geojson.coordinates[0],
    species: r.taxon?.preferred_common_name || r.taxon?.name,
  }));
}

function getUniqueSpeciesObservations(observations) {
  const uniqueSpecies = new Map();
  observations.forEach(obs => {
    const speciesName = obs.taxon?.preferred_common_name || obs.taxon?.name || 'Unknown';
    if (!uniqueSpecies.has(speciesName)) {
      uniqueSpecies.set(speciesName, obs);
    }
  });
  return Array.from(uniqueSpecies.values());
}

// Custom hooks
function useObservationLoader() {
  const [isLoading, setIsLoading] = useState(false);

  const loadObservations = useCallback(async (matchId, matchData, hostUid) => {
    if (isLoading) return;
    
    console.log("Starting loadObservationForMatch, isLoading:", isLoading, "matchData:", matchData);
    setIsLoading(true);

    const maxAttempts = GAME_CONFIG.MAX_OBSERVATION_ATTEMPTS;
    let attempts = 0;
    
    // Initial delay to avoid too rapid requests
    await new Promise(r => setTimeout(r, 1000));
    
    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Attempt ${attempts}/${maxAttempts}`);
      
      try {
        const region = getRandomRegion();
        const randomPage = Math.floor(Math.random() * 100);
        const randomUrl = buildObservationUrl(region, randomPage);
        
        const randomRes = await fetch(randomUrl);
        
        if (randomRes.status === 429) {
          console.log("💤 Rate limit, waiting 500ms...");
          await new Promise(r => setTimeout(r, GAME_CONFIG.RATE_LIMIT_DELAY));
          continue;
        }

        const randomData = await randomRes.json();
        const valid = filterValidObservations(randomData.results);
        
        if (!valid.length) {
          console.log("No valid observations found");
          continue;
        }
        
        const base = valid[Math.floor(Math.random() * valid.length)];
        const centerLat = base.geojson.coordinates[1];
        const centerLng = base.geojson.coordinates[0];

        const clusterUrl = buildClusterUrl(centerLat, centerLng);
        const clusterRes = await fetch(clusterUrl);
        
        if (clusterRes.status === 429) {
          console.log("💤 Cluster rate limit, waiting 500ms...");
          await new Promise(r => setTimeout(r, GAME_CONFIG.RATE_LIMIT_DELAY));
          continue;
        }

        const clusterData = await clusterRes.json();
        if (!clusterData.results || clusterData.results.length < 8) continue;

        const clusterObservations = filterValidObservations(clusterData.results);

        if (clusterObservations.length >= 8) {
          const shuffled = [...clusterObservations].sort(() => Math.random() - 0.5);
          const selected = shuffled.slice(0, 8);
          const items = processObservations(selected);
          
        console.log("Found 8 items, saving to match:", items.length);
          
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

        await new Promise(r => setTimeout(r, 200));
      } catch (error) {
        console.error(`Error in attempt ${attempts}:`, error);
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    console.error("❌ No valid cluster found after several attempts");
    setIsLoading(false);
  }, [isLoading]);

  return { isLoading, loadObservations };
}

function useGameTimer() {
  const [gameCountdown, setGameCountdown] = useState(GAME_CONFIG.ROUND_TIMER);
  const countdownStartedRef = useRef(false);
  const countdownIntervalRef = useRef(null);
  const currentRoundRef = useRef(0);
  const timeoutProcessingRef = useRef(false);

  const startTimer = useCallback((round, onTimeout) => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    countdownStartedRef.current = true;
    currentRoundRef.current = round;
    setGameCountdown(GAME_CONFIG.ROUND_TIMER);
    
    countdownIntervalRef.current = setInterval(() => {
      setGameCountdown(prev => {
        if (prev <= 1) {
          console.log("⏰ Timer reached 0, checking for automatic elimination");
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          onTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    countdownStartedRef.current = false;
    timeoutProcessingRef.current = false;
  }, []);

  const resetTimer = useCallback(() => {
    setGameCountdown(GAME_CONFIG.ROUND_TIMER);
    countdownStartedRef.current = false;
    timeoutProcessingRef.current = false;
  }, []);

  return {
    gameCountdown,
    startTimer,
    stopTimer,
    resetTimer,
    timeoutProcessingRef,
    countdownStartedRef,
    currentRoundRef
  };
}

export default function Duels() {
  // Core game state
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState("");
  const [status, setStatus] = useState(GAME_STATUS.IDLE);
  const [matchId, setMatchId] = useState(null);
  const [match, setMatch] = useState(null);
  const [winner, setWinner] = useState(null);
  const [waitingPlayers, setWaitingPlayers] = useState(0);
  
  // Game round state
  const [observation, setObservation] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [guess, setGuess] = useState(null);
  const [distance, setDistance] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [roundLocked, setRoundLocked] = useState(false);
  const [hasProcessedCurrentRound, setHasProcessedCurrentRound] = useState(false);
  
  // Loading timeout state
  const [loadingTimeoutRef, setLoadingTimeoutRef] = useState(null);
  
  // Results state
  const [showResults, setShowResults] = useState(false);
  const [roundResults, setRoundResults] = useState(null);
  const [countdown, setCountdown] = useState(GAME_CONFIG.RESULTS_COUNTDOWN);
  const [processedRounds, setProcessedRounds] = useState(new Set());
  
  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState([]);
  
  // Opponent status state
  const [opponentStatus, setOpponentStatus] = useState("Activo");
  
  // Refs for tracking
  const [currentRoundDisplayed, setCurrentRoundDisplayed] = useState(0);
  const lastProcessedRoundRef = useRef(0);
  const lastProcessedMatchIdRef = useRef(null);

  // Custom hooks
  const { isLoading, loadObservations } = useObservationLoader();
  const {
    gameCountdown,
    startTimer,
    stopTimer,
    resetTimer,
    timeoutProcessingRef,
    countdownStartedRef,
    currentRoundRef
  } = useGameTimer();

  console.log("🎮 Duels component render - status:", status, "matchId:", matchId, "user:", user?.uid);

  // Load leaderboard data
  const loadLeaderboard = useCallback(() => {
    try {
      const leaderboardRef = collection(db, "user_stats");
      const q = query(leaderboardRef, orderBy("duelCups", "desc"), limit(10));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const leaderboardData = snapshot.docs
          .filter(doc => {
            const data = doc.data();
            return data.duelCups && data.duelCups > 0; // Only show players with cups
          })
          .map((doc, index) => ({
            id: doc.id,
            rank: index + 1,
            nickname: doc.data().nickname || "Player",
            cups: doc.data().duelCups || 0,
            wins: doc.data().duelWins || 0,
            losses: doc.data().duelLosses || 0
          }));
        
        setLeaderboard(leaderboardData);
        console.log("📊 Leaderboard loaded:", leaderboardData);
      }, (error) => {
        console.error("❌ Error loading leaderboard:", error);
        // Fallback to mock data on error
        const mockLeaderboard = [
          { id: "1", rank: 1, nickname: "Champion", cups: 75, wins: 15, losses: 2 }, // 15*5 - 2*5 = 75
          { id: "2", rank: 2, nickname: "ProPlayer", cups: 60, wins: 12, losses: 3 }, // 12*5 - 3*5 = 60
          { id: "3", rank: 3, nickname: "Winner", cups: 50, wins: 10, losses: 5 }, // 10*5 - 5*5 = 50
          { id: "4", rank: 4, nickname: "Master", cups: 40, wins: 8, losses: 4 }, // 8*5 - 4*5 = 40
          { id: "5", rank: 5, nickname: "Expert", cups: 30, wins: 6, losses: 3 } // 6*5 - 3*5 = 30
        ];
        setLeaderboard(mockLeaderboard);
      });
      
      return unsubscribe;
    } catch (error) {
      console.error("❌ Error setting up leaderboard:", error);
      setLeaderboard([]);
      return null;
    }
  }, []);

  // Handle timeout elimination - improved to handle disconnections
  const handleTimeout = useCallback(async () => {
    console.log("🔍 handleTimeout called - matchId:", matchId, "user:", user?.uid, "confirmed:", confirmed, "guess:", guess);
    
    // Strict validations to prevent multiple executions
    if (!matchId || !user || timeoutProcessingRef.current || status === GAME_STATUS.FINISHED) {
      console.log("❌ handleTimeout cancelled - matchId:", !!matchId, "user:", !!user, "processing:", timeoutProcessingRef.current, "status:", status);
      return;
    }
    
    // Verify match has round data before applying timeout
    if (!match || !match.rounds || !match.rounds[match.round] || !match.rounds[match.round].items) {
      console.log("❌ handleTimeout cancelled - Match has no round data loaded");
      return;
    }
    
    // Mark as processing to avoid concurrent transactions
    timeoutProcessingRef.current = true;
    
    console.log("⏰ TIMEOUT: Checking for elimination - Current player confirmed:", confirmed, "hasGuess:", !!guess);
    
    try {
      // Automatically eliminate the player who didn't verify
      const mRef = doc(db, "duel_matches", matchId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(mRef);
        if (!snap.exists()) {
          console.log("❌ Match doesn't exist, cancelling automatic elimination");
          return;
        }
        const data = snap.data();
        
        // Check if game already finished
        if (data.state === GAME_STATUS.FINISHED) {
          console.log("❌ Game already finished, cancelling automatic elimination");
          return;
        }
        
        console.log("🔍 Applying automatic elimination - Match state:", data.state, "Round:", data.round);
        
        const players = data.players || {};
        const currentPlayer = players[user.uid] || {};
        
        // Check current round data
        const round = data.round || 1;
        const rounds = { ...(data.rounds || {}) };
        const roundData = { ...(rounds[round] || {}) };
        const roundGuesses = { ...(roundData.guesses || {}) };
        
        // Get opponent info
        const playerIds = Object.keys(players);
        const otherPlayerId = playerIds.find(id => id !== user.uid);
        const otherPlayerHasGuess = otherPlayerId && roundGuesses[otherPlayerId];
        const currentPlayerHasGuess = roundGuesses[user.uid];
        
        console.log("🔍 Timeout analysis - Current player has guess:", !!currentPlayerHasGuess, "Other player has guess:", !!otherPlayerHasGuess);
        
        // Case 1: Current player hasn't made a guess - eliminate current player
        if (!currentPlayerHasGuess) {
          console.log("🔍 Eliminating current player by timeout:", user.uid, "Current HP:", currentPlayer.hp);
          
          const updatedPlayers = {
            ...players,
            [user.uid]: {
              ...currentPlayer,
              hp: 0 // Automatic elimination
            }
          };
          
          // Add timeout guess for current player (elimination)
          roundGuesses[user.uid] = { 
            dist: GAME_CONFIG.TIMEOUT_DISTANCE, 
            guess: guess || { lat: 0, lng: 0 }, 
            distance: GAME_CONFIG.TIMEOUT_DISTANCE,
            points: 0,
            timestamp: new Date(),
            timeout: true,
            eliminated: true // Mark as eliminated by timeout
          };
          
          roundData.guesses = roundGuesses;
          rounds[round] = roundData;
          
          // End the match immediately
          tx.update(mRef, {
            players: updatedPlayers,
            rounds: rounds,
            state: GAME_STATUS.FINISHED, // End the match
            finishedAt: new Date(),
            timeoutElimination: true, // Mark as timeout elimination
            eliminatedPlayer: user.uid, // Player who was eliminated
            doubleTimeout: false // Single timeout
          });
          
          console.log("✅ Current player automatically eliminated by timeout - Match ended");
        }
        // Case 2: Current player has made a guess but opponent hasn't - eliminate opponent
        else if (currentPlayerHasGuess && !otherPlayerHasGuess && otherPlayerId) {
          console.log("🔍 Current player already verified, eliminating opponent by timeout:", otherPlayerId);
          
          const otherPlayer = players[otherPlayerId] || {};
          const updatedPlayers = {
            ...players,
            [otherPlayerId]: {
              ...otherPlayer,
              hp: 0 // Eliminate opponent
            }
          };
          
          // Add timeout guess for opponent (elimination)
          roundGuesses[otherPlayerId] = { 
            dist: GAME_CONFIG.TIMEOUT_DISTANCE, 
            guess: { lat: 0, lng: 0 }, 
            distance: GAME_CONFIG.TIMEOUT_DISTANCE,
            points: 0,
            timestamp: new Date(),
            timeout: true,
            eliminated: true
          };
          
          roundData.guesses = roundGuesses;
          rounds[round] = roundData;
          
          // End the match immediately
          tx.update(mRef, {
            players: updatedPlayers,
            rounds: rounds,
            state: GAME_STATUS.FINISHED, // End the match
            finishedAt: new Date(),
            timeoutElimination: true, // Mark as timeout elimination
            eliminatedPlayer: otherPlayerId, // Opponent who was eliminated
            doubleTimeout: false // Single timeout
          });
          
          console.log("✅ Opponent automatically eliminated by timeout - Current player wins");
        }
        // Case 3: Both players have made guesses - this shouldn't happen with timeout
        else if (currentPlayerHasGuess && otherPlayerHasGuess) {
          console.log("🔍 Both players have made guesses - no timeout elimination needed");
          return;
        }
        // Case 4: Neither player has made a guess - double timeout
        else if (!currentPlayerHasGuess && !otherPlayerHasGuess) {
          console.log("🔍 Double timeout detected - eliminating both players");
          
          const updatedPlayers = {
            ...players,
            [user.uid]: {
              ...currentPlayer,
              hp: 0
            }
          };
          
          if (otherPlayerId) {
            updatedPlayers[otherPlayerId] = {
              ...players[otherPlayerId],
              hp: 0
            };
            
            // Add timeout guess for the other player too
            roundGuesses[otherPlayerId] = { 
              dist: GAME_CONFIG.TIMEOUT_DISTANCE, 
              guess: { lat: 0, lng: 0 }, 
              distance: GAME_CONFIG.TIMEOUT_DISTANCE,
              points: 0,
              timestamp: new Date(),
              timeout: true,
              eliminated: true
            };
          }
          
          // Add timeout guess for current player (elimination)
          roundGuesses[user.uid] = { 
            dist: GAME_CONFIG.TIMEOUT_DISTANCE, 
            guess: guess || { lat: 0, lng: 0 }, 
            distance: GAME_CONFIG.TIMEOUT_DISTANCE,
            points: 0,
            timestamp: new Date(),
            timeout: true,
            eliminated: true
          };
          
          roundData.guesses = roundGuesses;
          rounds[round] = roundData;
          
          // End the match immediately
          tx.update(mRef, {
            players: updatedPlayers,
            rounds: rounds,
            state: GAME_STATUS.FINISHED, // End the match
            finishedAt: new Date(),
            timeoutElimination: true, // Mark as timeout elimination
            eliminatedPlayer: user.uid, // Player who was eliminated
            doubleTimeout: true // Mark if both players timed out
          });
          
          console.log("✅ Both players eliminated by double timeout - Match ended");
        }
      });
      
      setConfirmed(true);
      setHasProcessedCurrentRound(true);
      
      console.log("✅ AUTOMATIC ELIMINATION applied");
      } catch (error) {
      console.error("❌ Error applying automatic elimination:", error);
    } finally {
      // Release processing flag
      timeoutProcessingRef.current = false;
    }
  }, [matchId, user, confirmed, guess, status, match, timeoutProcessingRef]);

  // Check for disconnected players and eliminate them
  const checkDisconnectedPlayers = useCallback(async () => {
    if (!matchId || !match || status !== GAME_STATUS.MATCHED) return;
    
    try {
      const mRef = doc(db, "duel_matches", matchId);
      const matchSnap = await getDoc(mRef);
      
      if (!matchSnap.exists()) return;
      
      const matchData = matchSnap.data();
      if (matchData.state === GAME_STATUS.FINISHED) return;
      
      const players = matchData.players || {};
      const currentTime = new Date();
      const DISCONNECT_TIMEOUT = 90000; // 90 seconds (reduced from 93)
      
      // Check each player's last activity
      for (const [playerId, playerData] of Object.entries(players)) {
        if (playerData.hp <= 0) continue; // Already eliminated
        
        const lastActivity = playerData.lastActivity?.toDate();
        if (lastActivity && (currentTime - lastActivity) > DISCONNECT_TIMEOUT) {
          console.log("🔍 Player appears disconnected:", playerId, "Last activity:", lastActivity);
          
          // If the disconnected player is the host and we're in a later round, end the match
          const isHost = playerId === matchData.host;
          const currentRound = matchData.round || 1;
          
          if (isHost && currentRound > 1) {
            console.log("🏠 Host disconnected in round", currentRound, "- ending match");
            
            await runTransaction(db, async (tx) => {
              const snap = await tx.get(mRef);
              if (!snap.exists()) return;
              
              const data = snap.data();
              if (data.state === GAME_STATUS.FINISHED) return;
              
              // Find the remaining player (not the disconnected host)
              const remainingPlayerId = Object.keys(data.players).find(id => id !== playerId);
              
              tx.update(mRef, {
                state: GAME_STATUS.FINISHED,
                finishedAt: new Date(),
                hostDisconnected: true,
                winner: remainingPlayerId,
                disconnectionElimination: true
              });
            });
            
            return; // Exit early since match is ended
          }
          
          // Check if this player has already made a guess this round
          const round = matchData.round || 1;
          const roundData = matchData.rounds?.[round];
          const roundGuesses = roundData?.guesses || {};
          
          if (!roundGuesses[playerId]) {
            console.log("⏰ Eliminating disconnected player:", playerId);
            
            await runTransaction(db, async (tx) => {
              const snap = await tx.get(mRef);
              if (!snap.exists()) return;
              
              const data = snap.data();
              if (data.state === GAME_STATUS.FINISHED) return;
              
              const updatedPlayers = {
                ...data.players,
                [playerId]: {
                  ...data.players[playerId],
                  hp: 0
                }
              };
              
              const rounds = { ...(data.rounds || {}) };
              const currentRoundData = { ...(rounds[round] || {}) };
              const currentRoundGuesses = { ...(currentRoundData.guesses || {}) };
              
              currentRoundGuesses[playerId] = {
                dist: GAME_CONFIG.TIMEOUT_DISTANCE,
                guess: { lat: 0, lng: 0 },
                distance: GAME_CONFIG.TIMEOUT_DISTANCE,
                points: 0,
                timestamp: new Date(),
                timeout: true,
                eliminated: true,
                disconnected: true
              };
              
              currentRoundData.guesses = currentRoundGuesses;
              rounds[round] = currentRoundData;
              
              tx.update(mRef, {
                players: updatedPlayers,
                rounds: rounds,
                state: GAME_STATUS.FINISHED,
                finishedAt: new Date(),
                timeoutElimination: true,
                eliminatedPlayer: playerId,
                disconnectionElimination: true
              });
            });
          }
        }
      }
    } catch (error) {
      console.error("❌ Error checking disconnected players:", error);
    }
  }, [matchId, match, status]);

  // Handle player disconnection with atomic transaction
  const handlePlayerDisconnection = useCallback(async (disconnectedPlayerId) => {
    if (!matchId) return;
    
    try {
      const mRef = doc(db, "duel_matches", matchId);
      
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(mRef);
        if (!snap.exists() || snap.data().state === "finished") return;
        
        const matchData = snap.data();
        const remainingPlayerId = Object.keys(matchData.players)
          .find(id => id !== disconnectedPlayerId);
        
        if (!remainingPlayerId) return;
        
        // End match due to disconnection
        tx.update(mRef, {
          state: "finished",
          finishedAt: serverTimestamp(),
          winner: remainingPlayerId,
          disconnectionElimination: true,
          eliminatedPlayer: disconnectedPlayerId,
          statsProcessed: true
        });
      });
      
      console.log("✅ Match ended due to disconnection");
    } catch (error) {
      console.error("❌ Error handling disconnection:", error);
    }
  }, [matchId]);

  // Clean player state when match ends
  const cleanPlayerState = useCallback(async () => {
    if (!user) return;
    
    try {
      console.log("🧹 Cleaning player state after match end");
      
      // Clean queue document
      const queueRef = doc(db, "duel_queue", user.uid);
      await deleteDoc(queueRef).catch(() => {
        // Ignore if document doesn't exist
      });
      
      console.log("✅ Player state cleaned successfully");
    } catch (error) {
      console.error("❌ Error cleaning player state:", error);
    }
  }, [user]);

  // Map components
  const MapClickHandler = useCallback(() => {
    useMapEvents({
      click(e) { 
        // Ignore clicks when round is locked or already confirmed
        if (roundLocked || confirmed) return;
          setGuess(e.latlng); 
        
        // Update player activity when clicking on map
        if (matchId && user) {
          const mRef = doc(db, "duel_matches", matchId);
          runTransaction(db, async (tx) => {
            const snap = await tx.get(mRef);
            if (!snap.exists()) return;
            
            const data = snap.data();
            const players = { ...data.players };
            if (players[user.uid]) {
              players[user.uid] = {
                ...players[user.uid],
                lastActivity: new Date()
              };
            }
            
            tx.update(mRef, { players });
          }).catch(error => {
            console.log("⚠️ Error updating activity on map click:", error);
          });
        }
      },
    });
    return null;
  }, [roundLocked, confirmed, matchId, user]);

  const ResultsMap = useCallback(() => {
    const map = useMap();
    const hasCenteredRef = useRef(false);
    
    useEffect(() => {
      if (!roundResults || !roundResults.observation) return;
      
      // Only center once when results are shown
      if (!hasCenteredRef.current) {
        const realLocation = [roundResults.observation.lat, roundResults.observation.lon];
        
        // Center without zoom (keep current zoom) and without animation
        map.setView(realLocation, map.getZoom(), { animate: false });
        
        hasCenteredRef.current = true;
      }
      
    }, [roundResults, map]);
    
    // Reset flag when results change
    useEffect(() => {
      hasCenteredRef.current = false;
    }, [roundResults]);
    
    return null;
  }, [roundResults]);

  // Authentication effect
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

  // Handle direct match access from room
  useEffect(() => {
    if (!user) return; // Wait for user authentication
    
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    const matchParam = params.get("match");
    console.log("🔍 URL params check - view:", view, "matchParam:", matchParam, "user:", user?.uid);
    if (view === "duels" && matchParam) {
      console.log("🎯 Navigating to existing duel:", matchParam);
      // Only set as matched if coming from a room (has real matchId)
      setMatchId(matchParam);
      setStatus(GAME_STATUS.MATCHED);
    } else {
      console.log("ℹ️ Navigating to normal duel, no matchId");
    }
  }, [user]);

  // Clean previous queue on component load (only if not coming from a room)
  useEffect(() => {
    if (!user) return;
    
    // Check if coming from a room (has match parameter in URL)
    const params = new URLSearchParams(window.location.search);
    const matchParam = params.get("match");
    
    if (matchParam) {
      console.log("🎯 Coming from private room, skipping cleanup");
      return;
    }
    
    console.log("🧹 Cleaning previous user queue");
    
    // Clean queue and reset state completely
    const cleanup = async () => {
      try {
        await cancelQueue();
        console.log("✅ Previous queue cleaned");
      } catch (error) {
        console.log("⚠️ Error cleaning previous queue:", error);
      }
      
      // Reset state to ensure we start clean
      setStatus(GAME_STATUS.IDLE);
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
      setCountdown(GAME_CONFIG.RESULTS_COUNTDOWN);
      setProcessedRounds(new Set());
      setCurrentRoundDisplayed(0);
      lastProcessedRoundRef.current = 0;
      lastProcessedMatchIdRef.current = null;
      currentRoundRef.current = 0;
      
      // Clean loading timeout
      if (loadingTimeoutRef) {
        clearTimeout(loadingTimeoutRef);
        setLoadingTimeoutRef(null);
      }
      
      console.log("✅ State completely reset");
    };
    
    cleanup();
  }, [user]);

  // Listen to matchmaking queue
  useEffect(() => {
    if (!user || matchId) return; // Don't listen if we already have a match
    
    console.log("🎧 Starting matchmaking queue listener");
    
    const off = listenMatchmakingQueue((queueData) => {
      console.log("📊 Queue data received:", queueData);
      setWaitingPlayers(queueData.waitingPlayers);
      
      // Only change to waiting if we're in the queue
      if (queueData.myPosition > 0) {
        console.log("✅ User found in queue, position:", queueData.myPosition);
        setStatus(GAME_STATUS.WAITING);
        
        // If there are 2+ players, try matchmaking (transaction will prevent duplicates)
        if (queueData.waitingPlayers >= 2) {
          console.log("🎯 Enough players, trying matchmaking...");
          tryMatchmake().then((matchId) => {
            if (matchId) {
              console.log("✅ Match created successfully:", matchId);
              setMatchId(matchId);
              setStatus(GAME_STATUS.MATCHED);
              // DON'T load observations here, wait for host to load them in listenMatch
            } else {
              console.log("❌ Could not create match (matchId is null) - probably already created by another user");
            }
          }).catch((error) => {
            console.log("❌ Error in matchmaking:", error);
          });
        }
      } else {
        console.log("❌ User NOT found in queue, myPosition:", queueData.myPosition);
        console.log("🔍 Complete queue data:", queueData);
        console.log("🔍 Current user:", user?.uid);
      }
    });
    
    return () => off();
  }, [user, matchId]); // Only necessary dependencies

  // Heartbeat to keep user active in queue
  useEffect(() => {
    if (!user || status !== GAME_STATUS.WAITING) return;
    
    const heartbeatInterval = setInterval(() => {
      updateHeartbeat();
    }, GAME_CONFIG.HEARTBEAT_INTERVAL); // Every 10 seconds
    
    return () => clearInterval(heartbeatInterval);
  }, [user, status]);

  // Listen if a match was created for this user using listenQueueDoc
  useEffect(() => {
    if (!user) return;
    
    const off = listenQueueDoc(async (q) => {
      if (!q) return;
      console.log("📋 User queue status:", q);
      
      if (q.status === GAME_STATUS.MATCHED && q.matchId) {
        console.log("🎯 Match found for user:", q.matchId);
        console.log("🔍 Verifying if user is really in queue before processing match");
        
        // Check if we're already in a match to avoid double processing
        if (matchId) {
          console.log("⚠️ Already in a match, ignoring pairing:", matchId);
          return;
        }
        
        // CHECK IF MATCH IS FINISHED BEFORE JOINING
        try {
          const matchRef = doc(db, "duel_matches", q.matchId);
          const matchSnap = await getDoc(matchRef);
          
          console.log("🔍 Verifying match state before joining user");
        
        if (!matchSnap.exists()) {
            console.log("❌ Match doesn't exist, cleaning queue");
          await cancelQueue();
          return;
        }
        
          // Verify that user is really in queue before processing match
        const queueRef = doc(db, "duel_queue", user.uid);
        const queueSnap = await getDoc(queueRef);
          if (!queueSnap.exists() || queueSnap.data().status !== GAME_STATUS.MATCHED) {
            console.log("❌ User is not really in queue or not matched, ignoring match");
          return;
        }
          
          const matchData = matchSnap.data();
          if (matchData.state === GAME_STATUS.FINISHED) {
            console.log("❌ Match already finished, cleaning queue and state");
            await cancelQueue();
            setStatus(GAME_STATUS.IDLE);
            setMatchId(null);
            return;
          }
          
          console.log("✅ Valid and active match, joining user");
          setMatchId(q.matchId);
          setStatus(GAME_STATUS.MATCHED);
        } catch (error) {
          console.log("❌ Error verifying match:", error);
          // In case of error, clean queue to avoid problems
          await cancelQueue();
          setStatus(GAME_STATUS.IDLE);
          setMatchId(null);
        }
      }
    });
    
    return () => off();
  }, [user, matchId]);

  // Listen if our opponent was matched with us
  useEffect(() => {
    if (!user || status !== GAME_STATUS.WAITING) return;
    
    const off = listenForOpponentMatch(async (matchData) => {
      console.log("🎯 Opponent was matched with us:", matchData);
      
      // Check if we're already in a match to avoid double processing
      if (matchId) {
        console.log("⚠️ Already in a match, ignoring pairing:", matchId);
        return;
      }
      
      // CHECK IF MATCH IS FINISHED BEFORE JOINING
      try {
        const matchRef = doc(db, "duel_matches", matchData.matchId);
        
        // Retry logic for race conditions
        let matchSnap;
        let retries = 3;
        while (retries > 0) {
          matchSnap = await getDoc(matchRef);
          if (matchSnap.exists()) break;
          
          console.log(`⏳ Match not found, retrying... (${4-retries}/3)`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          retries--;
        }
        
        if (!matchSnap.exists()) {
          console.log("❌ Match doesn't exist after retries, cleaning queue");
          await cancelQueue();
          return;
        }
        
        const match = matchSnap.data();
        console.log("🔍 Verifying match state (opponent):", {
          matchId: matchData.matchId,
          state: match.state,
          round: match.round,
          players: Object.keys(match.players || {}),
          hostUid: match.hostUid
        });
        
        // Verify that user is really in queue before processing match
        const queueRef = doc(db, "duel_queue", user.uid);
        const queueSnap = await getDoc(queueRef);
        if (!queueSnap.exists() || queueSnap.data().status !== GAME_STATUS.MATCHED) {
          console.log("❌ User is not really in queue or not matched, ignoring match (opponent)");
          return;
        }
        
        if (match.state === GAME_STATUS.FINISHED) {
          console.log("❌ Match already finished, cleaning queue and state");
          await cancelQueue();
          setStatus(GAME_STATUS.IDLE);
          setMatchId(null);
          return;
        }
        
        console.log("✅ Valid and active match, joining user");
        setMatchId(matchData.matchId);
        setStatus(GAME_STATUS.MATCHED);
      } catch (error) {
        console.log("❌ Error verifying match:", error);
        // In case of error, clean queue to avoid problems
        await cancelQueue();
        setStatus(GAME_STATUS.IDLE);
        setMatchId(null);
      }
    });
    
    return () => off();
  }, [user, status, matchId]);

  // Main match listener
  useEffect(() => {
    if (!matchId) return;
    
    const off = listenMatch(matchId, (m) => {
      console.log("Match update:", m);
      setMatch(m);
      
      // Reset round state when starting a new match
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
        
        // Initialize player activity when joining match
        if (user && m.players && m.players[user.uid]) {
          const mRef = doc(db, "duel_matches", matchId);
          runTransaction(db, async (tx) => {
            const snap = await tx.get(mRef);
            if (!snap.exists()) return;
            
            const data = snap.data();
            const players = { ...data.players };
            if (players[user.uid]) {
              players[user.uid] = {
                ...players[user.uid],
                lastActivity: new Date()
              };
            }
            
            tx.update(mRef, { players });
          }).catch(error => {
            console.log("⚠️ Error initializing player activity:", error);
          });
        }
      }
      
      // Check if game finished
      if (m.state === GAME_STATUS.FINISHED) {
        console.log("Game finished, players data:", m.players);
        setStatus(GAME_STATUS.FINISHED);
        const players = m.players || {};
        
        // Check if it's a loading timeout (no winners)
        if (m.loadingTimeout) {
          console.log("🎯 Loading timeout detected - no winners");
          setWinner(null); // No winner in loading timeout
        }
        // Check if it's a double timeout (both players lose)
        else if (m.doubleTimeout) {
          console.log("🎯 Double timeout detected - both players lose");
          setWinner(null); // No winner in double timeout
        } else {
          // Detect winner: the one who doesn't have 0 points is the winner
          const playersArray = Object.entries(players).map(([uid, p]) => ({ uid, ...p }));
          const winner = playersArray.find(p => p.hp > 0) || playersArray[0]; // fallback to first player
          console.log("Players HP:", Object.entries(players).map(([uid, p]) => `${uid}: ${p.hp}`));
          console.log("Winner detected:", winner);
          console.log("Current user UID:", user?.uid);
          setWinner(winner);
          
          // Update cups for the winner and losses for the loser
          // Only update stats if they haven't been updated yet (check for statsProcessed flag)
          // AND only for matchmaking duels (not private rooms)
          if (!m.statsProcessed && m.matchmaking === true) {
            console.log("📊 Processing match stats for matchmaking duel");
            
            if (winner && winner.uid) {
              updatePlayerCups(winner.uid, winner.nickname || "Player", true); // true = win
            }
            
            // Update losses for the loser
            const loser = playersArray.find(p => p.uid !== winner.uid);
            if (loser && loser.uid) {
              updatePlayerCups(loser.uid, loser.nickname || "Player", false); // false = loss
            }
            
            // Mark stats as processed to prevent duplicate updates
            const mRef = doc(db, "duel_matches", matchId);
            updateDoc(mRef, { statsProcessed: true }).catch(error => {
              console.error("❌ Error marking stats as processed:", error);
            });
          } else if (m.matchmaking !== true) {
            console.log("📊 Private room match - stats not updated (only matchmaking duels count for leaderboard)");
          } else {
            console.log("📊 Stats already processed for this match, skipping");
          }
        }
        
        // Clean player state to prevent ghost state
        cleanPlayerState();
        
        // Check if it was timeout elimination
        if (m.timeoutElimination && m.eliminatedPlayer) {
          console.log("🎯 Timeout elimination detected - showing special results");
          const currentRound = m.round || 1;
          const roundData = m.rounds?.[currentRound];
          
          if (roundData && roundData.items && roundData.index !== undefined) {
            console.log("📊 Showing timeout results for round", currentRound);
            setRoundResults({
              round: currentRound,
              observation: roundData.items[roundData.index] || null,
              guesses: roundData.guesses || {},
              damage: null, // No damage in timeout
              players: m.players,
              timeoutElimination: true,
              eliminatedPlayer: m.eliminatedPlayer,
              doubleTimeout: m.doubleTimeout || false // Pass double timeout flag
            });
            setShowResults(true);
          }
        } else {
          // Show results of last round before showing Game Over (normal logic)
          const lastRound = m.round - 1; // The round that was completed
          const lastRoundData = m.rounds?.[lastRound];
          if (lastRoundData && lastRoundData.guesses && Object.keys(lastRoundData.guesses).length === 2 && !showResults) {
            console.log("Game finished, showing final round results for round", lastRound);
            setRoundResults({
              round: lastRound,
              observation: lastRoundData.items?.[lastRoundData.index] || null,
              guesses: lastRoundData.guesses,
              damage: lastRoundData.damage,
              players: m.players // Use updated HP from current match
            });
            setShowResults(true);
          }
        }
        return;
      }

      // Automatically load current round if there's data
      const r = m.round;
      const rd = m.rounds?.[r];
      console.log("Match update - Round:", r, "Round data:", rd, "User:", user?.uid, "Host:", m.hostUid);
      console.log("All rounds:", m.rounds);
      
      // Only reset if it's a completely new round (compare with previously processed round)
      // And we haven't already processed this round
      if (r !== lastProcessedRoundRef.current && !hasProcessedCurrentRound) {
        console.log("Round change detected, resetting state from round", lastProcessedRoundRef.current, "to round", r);
        
        // If we're advancing from a previous round (not the first round), show results
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
              observation: completedRoundData.items?.[completedRoundData.index] || null,
              guesses: completedRoundData.guesses,
              damage: completedRoundData.damage,
              players: m.players // Use updated HP from current match
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
        // DON'T reset timer here - only when round really changes
        lastProcessedRoundRef.current = r;
      }
      
      if (rd && rd.items && typeof rd.index === 'number') {
      console.log("✅ Loading round data from match - Items:", rd.items.length, "Index:", rd.index);
      setGallery(rd.items);
      const obs = rd.items[rd.index];
      setObservation(obs);
      
      // Clear loading timeout since round data is now loaded
      if (loadingTimeoutRef) {
        console.log("✅ Clearing loading timeout - round data loaded successfully");
        clearTimeout(loadingTimeoutRef);
        setLoadingTimeoutRef(null);
      }
      
        // DON'T reset timer here - only when new round really starts
      
        // Timer will start in separate useEffect
      } else if (user && m.hostUid === user.uid && !rd) {
         console.log("🎯 Host loading first round - User:", user.uid, "Host:", m.hostUid, "Round:", m.round);
        // Only host loads first round automatically
        loadObservations(matchId, m, user.uid);
       } else if (!rd) {
         console.log("⏳ Non-host waiting for host to load round data - User:", user.uid, "Host:", m.hostUid, "Round data:", rd);
        // Non-hosts wait for host to load data - start loading timeout
        if (!loadingTimeoutRef) {
          console.log("⏰ Starting loading timeout for non-host player");
          const timeout = setTimeout(async () => {
            console.log("⏰ Loading timeout reached - ending match due to loading timeout");
            try {
              const mRef = doc(db, "duel_matches", matchId);
              await runTransaction(db, async (tx) => {
                const snap = await tx.get(mRef);
                if (!snap.exists()) return;
                
                const data = snap.data();
                if (data.state === GAME_STATUS.FINISHED) return;
                
                // End match due to loading timeout - no winners
                tx.update(mRef, {
                  state: GAME_STATUS.FINISHED,
                  finishedAt: new Date(),
                  loadingTimeout: true, // Mark as loading timeout
                  loadingTimeoutReason: "Loading timeout - host disconnected or failed to load"
                });
              });
              console.log("✅ Match ended due to loading timeout");
            } catch (error) {
              console.error("❌ Error ending match due to loading timeout:", error);
            }
          }, GAME_CONFIG.LOADING_TIMEOUT);
          setLoadingTimeoutRef(timeout);
        }
      }
    });
    
    return () => off();
  }, [matchId, user, loadObservations, cleanPlayerState]);

  // Auto-advance to next round after 10 seconds
  useEffect(() => {
    if (showResults && roundResults) {
      setCountdown(GAME_CONFIG.RESULTS_COUNTDOWN);
      
      const countdownInterval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            setShowResults(false);
            setRoundResults(null);
            
            // If game has finished, don't reset game state
            if (status !== GAME_STATUS.FINISHED) {
              setGuess(null);
              setDistance(null);
              setConfirmed(false);
              setRoundLocked(false);
              setHasProcessedCurrentRound(false);
              
              // Reset timer state for new round
              console.log("🔄 Resetting timer state for new round");
              resetTimer();
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(countdownInterval);
    }
  }, [showResults, roundResults, status, resetTimer]);

  // Game timer (30 seconds per round) - Only runs when observation is loaded AND results are not shown
  useEffect(() => {
    // Don't start timer if results are being shown
    if (showResults) {
      console.log("⏰ Not starting timer - results are being shown");
      return;
    }
    
    if (status === GAME_STATUS.MATCHED && match && match.state !== GAME_STATUS.FINISHED && !showResults && !roundLocked && observation && 
        (!countdownStartedRef.current || match.round !== currentRoundRef.current) && 
        match.rounds && match.rounds[match.round] && match.rounds[match.round].items) {
      console.log("⏰ Starting 30 second timer for round", match.round);
      console.log("🔍 Timer state - started:", countdownStartedRef.current, "currentRound:", currentRoundRef.current, "newRound:", match.round);
      console.log("🔍 Conditions - status:", status, "match:", !!match, "showResults:", showResults, "roundLocked:", roundLocked, "observation:", !!observation);
      console.log("🔍 Match data:", { id: match.id, state: match.state, round: match.round, players: match.players });
      console.log("🔍 Round data:", { hasRounds: !!match.rounds, currentRound: match.round, hasItems: !!(match.rounds && match.rounds[match.round] && match.rounds[match.round].items) });
      
      const onTimeout = () => {
        // Apply timeout logic if game hasn't finished AND match has round data
        if (!timeoutProcessingRef.current && status !== GAME_STATUS.FINISHED && 
                match && match.rounds && match.rounds[match.round] && match.rounds[match.round].items) {
          console.log("⏰ TIMEOUT: Checking for elimination - Player confirmed:", confirmed, "hasGuess:", !!guess);
          handleTimeout();
        } else {
          console.log("⏰ Timeout skipped - processing:", timeoutProcessingRef.current, "status:", status, "hasMatchData:", !!(match && match.rounds && match.rounds[match.round] && match.rounds[match.round].items));
        }
      };
      
      startTimer(match.round, onTimeout);
    }
  }, [observation, match?.round, showResults, status, match, roundLocked, confirmed, guess, user?.uid, handleTimeout, startTimer]);

  // Clean timer only when necessary
  useEffect(() => {
    if (status === GAME_STATUS.FINISHED || showResults) {
      // Clean timer when game ends or results are shown
      stopTimer();
      console.log("🧹 Timer cleaned - game finished or showing results");
      
      // Also clean loading timeout
      if (loadingTimeoutRef) {
        console.log("🧹 Loading timeout cleaned - game finished or showing results");
        clearTimeout(loadingTimeoutRef);
        setLoadingTimeoutRef(null);
      }
    }
  }, [status, showResults, stopTimer, loadingTimeoutRef]);

  // Heartbeat system - send activity every 10 seconds
  useEffect(() => {
    if (status !== GAME_STATUS.MATCHED || !matchId || !user) return;
    
    const updateHeartbeat = async () => {
      try {
        const mRef = doc(db, "duel_matches", matchId);
        await updateDoc(mRef, {
          [`players.${user.uid}.lastActivity`]: serverTimestamp()
        });
        console.log("💓 Heartbeat sent");
      } catch (error) {
        console.error("❌ Error sending heartbeat:", error);
      }
    };
    
    // Send heartbeat immediately and then every 10 seconds
    updateHeartbeat();
    const heartbeatInterval = setInterval(updateHeartbeat, 10000);
    
    return () => clearInterval(heartbeatInterval);
  }, [status, matchId, user]);

  // Check for disconnected players periodically
  useEffect(() => {
    if (status !== GAME_STATUS.MATCHED || !matchId) return;
    
    const disconnectCheckInterval = setInterval(() => {
      checkDisconnectedPlayers();
    }, 10000); // Check every 10 seconds
    
    return () => clearInterval(disconnectCheckInterval);
  }, [status, matchId, checkDisconnectedPlayers]);

  // Monitor opponent status in real-time
  useEffect(() => {
    if (!matchId || !match || !user) return;
    
    const opponentId = Object.keys(match.players || {}).find(id => id !== user.uid);
    if (!opponentId) return;
    
    const mRef = doc(db, "duel_matches", matchId);
    
    const unsubscribe = onSnapshot(mRef, (doc) => {
      if (!doc.exists()) return;
      
      const matchData = doc.data();
      const opponentData = matchData.players?.[opponentId];
      
      if (!opponentData) return;
      
      const lastActivity = opponentData.lastActivity?.toDate();
      const currentTime = new Date();
      const DISCONNECT_TIMEOUT = 90000; // 90 seconds
      
      const isDisconnected = lastActivity && 
        (currentTime - lastActivity) > DISCONNECT_TIMEOUT;
      
      setOpponentStatus(isDisconnected ? "Desconectado" : "Activo");
    });
    
    return () => unsubscribe();
  }, [matchId, match, user]);

  // Load leaderboard on component mount
  useEffect(() => {
    const unsubscribe = loadLeaderboard();
    return () => {
      if (unsubscribe && typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [loadLeaderboard]);

  const handleFind = useCallback(async () => {
    if (!user) return;
    
    // Prevent multiple searches
    if (status === GAME_STATUS.WAITING || status === GAME_STATUS.MATCHED) {
      console.log("⚠️ Already in queue or in a match, ignoring search");
      return;
    }
    
    console.log("🔍 Starting match search...");
    
    try {
      // Clean any existing queue state before starting new search
      console.log("🧹 Cleaning any existing queue state before new search");
      await cancelQueue().catch(error => {
        console.log("⚠️ Error cleaning previous queue:", error);
      });
      
      // Also clean any remaining queue document
      try {
        const userRef = doc(db, "duel_queue", user.uid);
        await deleteDoc(userRef);
        console.log("✅ Queue document deleted completely");
      } catch (error) {
        console.log("⚠️ Error deleting queue document:", error);
      }
      
      setStatus(GAME_STATUS.WAITING);
      console.log("✅ Status changed to waiting");
      
      const result = await enqueueForDuel(nickname);
      console.log("📝 enqueueForDuel result:", result);
      
      // If match was made immediately, configure the game
      if (result.matched && result.matchId) {
        console.log("🎯 Match found immediately:", result.matchId);
        setMatchId(result.matchId);
        setStatus(GAME_STATUS.MATCHED);
        // DON'T load observations here, wait for host to load them in listenMatch
      } else {
        console.log("⏳ User added to queue, waiting for matchmaking...");
        // Small delay to ensure listener detects the change
        setTimeout(() => {
          // Don't check state here as it may have changed due to matchmaking
          console.log("⏳ User added to queue, waiting for matchmaking...");
        }, 100);
      }
    } catch (error) {
      console.error("❌ Error searching for match:", error);
      setStatus(GAME_STATUS.IDLE);
    }
  }, [user, status, nickname]);

  const handleCancel = useCallback(async () => {
    await cancelQueue();
    setStatus(GAME_STATUS.IDLE);
    setMatchId(null);
  }, []);

  return (
    <div className="container-narrow" style={{ padding: "1rem", textAlign: "center" }}>
      <div style={{ position: "fixed", left: 12, top: 12, zIndex: 1000 }}>
        <button 
          onClick={async () => {
            console.log("🔙 Back button pressed - clearing state");
            
            // Clean queue if we're waiting
            if (status === GAME_STATUS.WAITING) {
              try {
                await cancelQueue();
                console.log("✅ Cola cancelada");
              } catch (error) {
                console.log("⚠️ Error cancelando cola:", error);
              }
            }
            
            // Reset all state
            setStatus(GAME_STATUS.IDLE);
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
            
            console.log("✅ State completely cleared by Back button");
            
            // Navegar de vuelta al menú principal
            console.log("🔍 Volviendo al menú principal");
            window.location.href = "?view=menu";
          }}
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
      <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Birders Place - Duels</h1>
      
      {!user && (
        <div style={{ padding: "2rem", color: "#fff", textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>1v1 Duels</h2>
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
      )}
      
      {user && status === GAME_STATUS.IDLE && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "center" }}>
          <button
            onClick={handleFind}
            disabled={isLoading}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: isLoading ? "#95a5a6" : "#3498db",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? "Loading..." : "Search 1v1 Match"}
          </button>
          
          {/* Leaderboard Component - Always Visible */}
          <div style={{
            marginTop: "1rem",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            borderRadius: "12px",
            padding: "1rem",
            maxWidth: "400px",
            width: "100%"
          }}>
            <h3 style={{ margin: "0 0 1rem 0", color: "#fff", textAlign: "center" }}>
              🏆 Top 10 Players
            </h3>
            
            {leaderboard.length === 0 ? (
              <div style={{ color: "#ecf0f1", textAlign: "center", padding: "1rem" }}>
                No data yet. Be the first to win!
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {leaderboard.map((player, index) => (
                  <div
                    key={player.id}
            style={{
                      background: "rgba(255,255,255,0.1)",
                      borderRadius: "8px",
                      padding: "0.75rem",
                      border: index < 3 ? "2px solid #fbbf24" : "1px solid rgba(255,255,255,0.2)"
                    }}
                  >
                    {/* Header con ranking y nombre */}
                    <div style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "space-between",
                      marginBottom: "0.5rem"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ 
                          color: index < 3 ? "#fbbf24" : "#ecf0f1", 
                          fontWeight: "bold",
                          minWidth: "25px",
                          fontSize: "16px"
                        }}>
                          #{player.rank}
                        </span>
                        <span style={{ color: "#fff", fontWeight: "bold", fontSize: "16px" }}>
                          {player.nickname || "Player"}
                        </span>
                      </div>
                      <div style={{ color: "#fbbf24", fontWeight: "bold", fontSize: "16px" }}>
                        🏆 {player.cups || 0}
                      </div>
                    </div>
                    
                    {/* Estadísticas detalladas */}
                    <div style={{ 
                      display: "flex", 
                      justifyContent: "space-between",
                      fontSize: "14px",
                      color: "#ecf0f1"
                    }}>
                      <div style={{ display: "flex", gap: "1rem" }}>
                          <span style={{ color: "#10b981" }}>
                            ✅ {player.wins || 0} wins
                          </span>
                          <span style={{ color: "#ef4444" }}>
                            ❌ {player.losses || 0} losses
                          </span>
                      </div>
                      <div style={{ color: "#9ca3af" }}>
                        {player.wins + player.losses > 0 
                          ? `${Math.round((player.wins / (player.wins + player.losses)) * 100)}% WR`
                          : "0% WR"
                        }
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
        </div>
      )}
      
      {user && status === GAME_STATUS.WAITING && (
        <>
          <div style={{ marginTop: "1rem", color: "#fff" }}>
            🔍 Searching for opponent...
          </div>
          <div style={{ fontSize: "14px", marginTop: "0.5rem", opacity: 0.8 }}>
            {waitingPlayers > 0 
              ? `👥 ${waitingPlayers} player${waitingPlayers > 1 ? 's' : ''} waiting...`
              : "⏳ Waiting for another player to join..."
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
            Cancel
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
              Round {roundResults.round} - Results
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
                🥊 Duel: {Object.entries(roundResults.players).map(([uid, player]) => {
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
              Rounds played: {roundResults.round} | Remaining points: {Object.entries(roundResults.players).map(([uid, player]) => {
                const isCurrentPlayer = uid === user?.uid;
                // Los HP ya están actualizados después del daño en roundResults.players
                const finalHp = player?.hp ?? 6000;
                
                return (
                  <span key={uid} style={{ 
                    color: isCurrentPlayer ? "#8b5cf6" : "#10b981",
                    fontWeight: "bold",
                    margin: "0 8px"
                  }}>
                    {isCurrentPlayer ? "You" : (player?.nickname || "Player")}: {finalHp.toLocaleString()}
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
                {roundResults.observation && (
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
                )}
                
                {/* Player responses */}
                {Object.entries(roundResults.guesses).map(([uid, guess], index) => {
                  const isCurrentPlayer = uid === user?.uid;
                  const player = roundResults.players[uid];
                  const isEliminated = roundResults.timeoutElimination && uid === roundResults.eliminatedPlayer;
                  const colors = ["#3b82f6", "#10b981"];
                  const color = isEliminated ? "#ef4444" : colors[index % colors.length];
                  
                  // Verificar que guess.guess existe antes de renderizar
                  if (!guess?.guess?.lat || !guess?.guess?.lng) {
                    return null;
                  }
                  
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
                        {isEliminated ? "❌" : (isCurrentPlayer ? "YOU" : (player?.nickname || "Opponent"))}
                      </Tooltip>
                    </Marker>
                  );
                })}
              </MapContainer>
            </div>
            
            {/* Información de daño o eliminación por timeout */}
            {roundResults.timeoutElimination ? (
              <div style={{ 
                background: "#dc2626", 
                borderRadius: "8px", 
                padding: "1rem", 
                marginBottom: "1rem",
                textAlign: "center"
              }}>
                <div style={{ color: "#fff", fontWeight: "bold", fontSize: "18px" }}>
                  ⏰ Timeout Elimination!
                </div>
                <div style={{ color: "#fecaca", marginTop: "4px" }}>
                  {roundResults.doubleTimeout
                    ? "Neither player clicked in time - both eliminated"
                    : "The opponent didn't click in time and was automatically eliminated"
                  }
                </div>
                <div style={{ color: "#fecaca", marginTop: "8px", fontSize: "14px" }}>
                  {roundResults.doubleTimeout ? (
                    <div style={{ color: "#ef4444", fontWeight: "bold" }}>
                      ⏰ Both players: ❌ Didn't click
                    </div>
                  ) : (
                    Object.entries(roundResults.guesses).map(([uid, guess]) => {
                    const player = roundResults.players[uid];
                    const isCurrentPlayer = uid === user?.uid;
                    const isEliminated = uid === roundResults.eliminatedPlayer;
                    
                    if (isEliminated) {
                      return (
                        <span key={uid} style={{ margin: "0 8px", color: "#ef4444" }}>
                            {isCurrentPlayer ? "You" : (player?.nickname || "Player")}: ❌ Didn't click
                        </span>
                      );
                    } else {
                      return (
                        <span key={uid} style={{ margin: "0 8px", color: "#10b981" }}>
                            {isCurrentPlayer ? "You" : (player?.nickname || "Player")}: ✅ Clicked
                        </span>
                      );
                    }
                    })
                  )}
                </div>
              </div>
            ) : roundResults.damage && (
              <div style={{ 
                background: "#dc2626", 
                borderRadius: "8px", 
                padding: "1rem", 
                marginBottom: "1rem",
                textAlign: "center"
              }}>
                <div style={{ color: "#fff", fontWeight: "bold", fontSize: "18px" }}>
                  ⚔️ {roundResults.damage.winner} won this round!
                </div>
                <div style={{ color: "#fecaca", marginTop: "4px" }}>
                  {roundResults.damage.loser} lost {roundResults.damage.amount.toLocaleString()} points
                  {roundResults.damage.multiplier && roundResults.damage.multiplier > 1 && (
                    <span style={{ color: "#fbbf24", fontWeight: "bold", marginLeft: "8px" }}>
                      (x{roundResults.damage.multiplier})
                    </span>
                  )}
                </div>
                {roundResults.damage.distances && (
                  <div style={{ color: "#fecaca", marginTop: "8px", fontSize: "14px" }}>
                    Distances: {Object.entries(roundResults.damage.distances).map(([uid, dist]) => {
                      const player = roundResults.players[uid];
                      const isCurrentPlayer = uid === user?.uid;
                      return (
                        <span key={uid} style={{ margin: "0 8px" }}>
                          {isCurrentPlayer ? "You" : (player?.nickname || "Player")}: {formatDistance(dist)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            
            {/* Current HP of both players */}
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
                      {isCurrentPlayer ? "You" : (player?.nickname || "Opponent")}
                    </div>
                    <div style={{ fontSize: "24px", fontWeight: "bold", color: finalHp <= 0 ? "#ef4444" : "#10b981", marginTop: "4px" }}>
                      {finalHp.toLocaleString()} pts
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* Time counter */}
            <div style={{ textAlign: "center", color: "#9ca3af" }}>
              <div style={{ fontSize: "18px", marginBottom: "8px" }}>
                {status === "finished" ? "Showing final results..." : "Next round in:"}
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

      {/* Opponent Status */}
      {user && status === GAME_STATUS.MATCHED && match && !showResults && (
        <div style={{ marginBottom: "1rem" }}>
          {opponentStatus === "Desconectado" && (
            <div style={{
              background: "#ef4444",
              color: "#fff",
              padding: "8px 16px",
              borderRadius: "8px",
              textAlign: "center",
              fontSize: "14px",
              fontWeight: "bold"
            }}>
              ⚠️ Oponente desconectado - Partida terminará automáticamente
            </div>
          )}
          
          {opponentStatus === "Activo" && (
            <div style={{
              background: "#10b981",
              color: "#fff",
              padding: "8px 16px",
              borderRadius: "8px",
              textAlign: "center",
              fontSize: "14px",
              fontWeight: "bold"
            }}>
              ✅ Oponente conectado
            </div>
          )}
        </div>
      )}

      {user && status === GAME_STATUS.MATCHED && match && !showResults && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ marginBottom: "1rem", color: "#fff" }}>
            <h3 style={{ margin: 0 }}>Match found! Round {match.round || 1}</h3>
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
            
            {/* Game time counter */}
            <div style={{ textAlign: "center", marginTop: "1rem", marginBottom: "1rem" }}>
              <div style={{ fontSize: "18px", color: "#9ca3af", marginBottom: "8px" }}>
                Tiempo restante:
              </div>
              <div style={{ 
                fontSize: "48px", 
                fontWeight: "bold", 
                color: gameCountdown <= 10 ? "#ef4444" : gameCountdown <= 30 ? "#f59e0b" : "#10b981",
                textShadow: "0 0 10px rgba(16, 185, 129, 0.5)"
              }}>
                {gameCountdown}
              </div>
              {gameCountdown <= 10 && !confirmed && (
                <div style={{ 
                  fontSize: "14px", 
                  color: "#ffffff", 
                  fontWeight: "bold",
                  marginTop: "8px",
                  textShadow: "0 0 5px rgba(0, 0, 0, 0.8)"
                }}>
                  ⚠️ Automatic elimination if you don't verify!
                </div>
              )}
              {gameCountdown <= 10 && confirmed && (
                <div style={{ 
                  fontSize: "14px", 
                  color: "#10b981", 
                  fontWeight: "bold",
                  marginTop: "8px",
                  textShadow: "0 0 5px rgba(16, 185, 129, 0.5)"
                }}>
                  ✅ You already clicked - Waiting for opponent...
                </div>
              )}
            </div>
            
            <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 12 }}>
              {Object.entries(match.players || {}).map(([uid, p]) => (
                <div key={uid} style={{ 
                  background: "#2c3e50", 
                  padding: "12px 16px", 
                  borderRadius: "8px",
                  border: uid === user.uid ? "2px solid #3498db" : "2px solid transparent"
                }}>
                  <div style={{ fontWeight: 700, color: "#fff" }}>
                    {p.nickname || (uid === user.uid ? (nickname || "You") : "Opponent")}
                  </div>
                  <div style={{ color: "#ecf0f1" }}>Points: {(p.hp ?? 6000).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          {!observation && (
            <div style={{ marginTop: "1rem", color: "#fbbf24" }}>
              {isLoading ? "Loading round..." : "Waiting for round..."}
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
              onClick={async () => {
                if (!observation || !guess || roundLocked) return;
                setRoundLocked(true);
                
                try {
                const d = haversineDistance(observation.lat, observation.lon, guess.lat, guess.lng);
                setDistance(d);
                setConfirmed(true);
                  setHasProcessedCurrentRound(true);
                
                // Update player activity before submitting guess
                const mRef = doc(db, "duel_matches", matchId);
                await runTransaction(db, async (tx) => {
                  const snap = await tx.get(mRef);
                  if (!snap.exists()) return;
                  
                  const data = snap.data();
                  const players = { ...data.players };
                  if (players[user.uid]) {
                    players[user.uid] = {
                      ...players[user.uid],
                      lastActivity: new Date()
                    };
                  }
                  
                  tx.update(mRef, { players });
                });
                
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
              <h3 style={{ margin: 0 }}>Round {match.round || 1}</h3>
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
                ⏳ Waiting for opponent...
              </div>
              </div>
          )}
        </div>
      )}

      {status === GAME_STATUS.FINISHED && match && (
        <div className="result-panel" style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}>
          <h2 style={{ margin: 0, color: "#fff" }}>🎉 Game finished!</h2>
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
              🥊 Duel: {Object.entries(match.players || {}).map(([uid, player]) => {
                    const isCurrentPlayer = uid === user?.uid;
                    return (
                  <span key={uid} style={{ 
                    color: isCurrentPlayer ? "#fbbf24" : "#ecf0f1",
                    fontWeight: "bold",
                    margin: "0 4px"
                  }}>
                    {isCurrentPlayer ? "You" : (player?.nickname || "Player")}
                  </span>
                );
              }).reduce((prev, curr, index) => [prev, index === 1 ? " vs " : "", curr])}
                        </div>
            <div style={{ color: "#ecf0f1", fontSize: "16px", marginBottom: "8px" }}>
              Rounds played: {match.round || 1}
                        </div>
            <div style={{ color: "#ecf0f1", fontSize: "16px" }}>
              Final points: {Object.entries(match.players || {}).map(([uid, player]) => {
                const isCurrentPlayer = uid === user?.uid;
                return (
                  <span key={uid} style={{ 
                    color: isCurrentPlayer ? "#fbbf24" : "#ecf0f1",
                    fontWeight: "bold",
                    margin: "0 8px"
                  }}>
                    {isCurrentPlayer ? "You" : (player?.nickname || "Player")}: {(player?.hp ?? 0).toLocaleString()}
                  </span>
                );
              }).reduce((prev, curr, index) => [prev, index === 1 ? " | " : "", curr])}
                      </div>
                    </div>
          
          {/* Check if it's a loading timeout, double timeout, or normal winner */}
          {match.loadingTimeout ? (
            <div style={{ marginTop: 12, fontSize: "24px", fontWeight: "bold", color: "#e74c3c" }}>
              ⏰ Match ended due to loading timeout!
            </div>
          ) : match.doubleTimeout ? (
            <div style={{ marginTop: 12, fontSize: "24px", fontWeight: "bold", color: "#e74c3c" }}>
              ⏰ Both players lost due to timeout!
            </div>
          ) : winner ? (
          <div style={{ marginTop: 12, fontSize: "24px", fontWeight: "bold", color: "#fbbf24" }}>
            Winner: {winner.nickname || "Opponent"}
          </div>
          ) : null}
          
          <div style={{ marginTop: 8, color: "#ecf0f1" }}>
             {(() => {
               if (match.loadingTimeout) {
                 return "⏰ The host disconnected during loading. No winners!";
               } else if (match.doubleTimeout) {
                 return "⏰ Neither player verified in time. Both lost!";
               } else if (winner) {
               const isWinner = winner.uid === user?.uid;
               console.log("Message check - Winner UID:", winner?.uid, "User UID:", user?.uid, "Is winner:", isWinner);
               return isWinner ? 
                         "Congratulations on the victory! 🎉" :
                   "Better luck next time! 💪";
               }
               return "";
             })()}
          </div>
          <button
             onClick={async () => {
               console.log("🔄 Reiniciando juego - limpiando todo el estado");
               
               // Clean player state completely
               await cleanPlayerState();
               
               // Also clean any remaining queue document
               try {
                 const userRef = doc(db, "duel_queue", user.uid);
                 await deleteDoc(userRef);
                 console.log("✅ Queue document deleted completely");
               } catch (error) {
                 console.log("⚠️ Error deleting queue document:", error);
               }
               
               // Reset all state
              setStatus(GAME_STATUS.IDLE);
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
               
               // Clean loading timeout
               if (loadingTimeoutRef) {
                 clearTimeout(loadingTimeoutRef);
                 setLoadingTimeoutRef(null);
               }
               
               console.log("✅ Estado completamente limpiado");
               
               // Navegar de vuelta a la vista de duels para buscar nueva partida
               console.log("🔍 Volviendo a la vista de duels para buscar nueva partida");
               window.location.href = "?view=duels";
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
            Play again
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
      
      {/* Credits Footer */}
      <div style={{ 
        position: "fixed", 
        bottom: 10, 
        right: 10, 
        fontSize: "10px", 
        color: "#666",
        background: "rgba(255,255,255,0.9)",
        padding: "4px 8px",
        borderRadius: "4px",
        zIndex: 1000
      }}>
        Images: <a href="https://inaturalist.org" target="_blank" rel="noopener noreferrer" style={{ color: "#10b981" }}>iNaturalist</a>
      </div>
    </div>
  );
}


