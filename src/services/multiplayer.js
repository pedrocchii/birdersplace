import { db, auth } from "../firebaseClient";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

// ------------- Duelos (1v1) -------------

export async function enqueueForDuel(nickname) {
  const user = auth.currentUser;
  if (!user) throw new Error("No auth");
  
  console.log("🚀 enqueueForDuel iniciado para usuario:", user.uid, "nickname:", nickname);
  
  // Usar la colección duel_queue que ya tiene permisos
  const qRef = doc(db, "duel_queue", user.uid);
  
  try {
    // Solo agregar el usuario a la cola individual
    await setDoc(qRef, {
      uid: user.uid,
      nickname: nickname || null,
      createdAt: serverTimestamp(),
      status: "waiting",
    });
    
    console.log("✅ Usuario agregado a la cola individual");
    
    // NO hacer matchmaking aquí - solo agregar a la cola
    // El matchmaking se hará cuando haya 2+ jugadores
    return { matchId: null, matched: false };
  } catch (error) {
    console.error("❌ Error agregando a la cola:", error);
    throw error;
  }
}

export async function tryMatchmake() {
  const user = auth.currentUser;
  if (!user) throw new Error("No auth");

  console.log("🔍 Intentando matchmaking para usuario:", user.uid);

  // Usar transacción para evitar condiciones de carrera
  try {
    const result = await runTransaction(db, async (transaction) => {
      // Consulta simplificada sin orderBy para evitar necesidad de índice
      const q = query(collection(db, "duel_queue"), where("status", "==", "waiting"));
      const snap = await getDocs(q);
      const candidates = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(d => d.uid !== user.uid)
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      
      console.log("👥 Candidatos encontrados:", candidates.length);
      
      const candidate = candidates[0]; // Tomar el más antiguo
      if (!candidate) {
        console.log("❌ No hay candidatos disponibles");
        return null;
      }

      console.log("🎯 Candidato seleccionado:", candidate.uid);

      const opponent = candidate;

      // Verificar que el oponente aún esté en waiting (evitar doble matchmaking)
      const opponentRef = doc(db, "duel_queue", opponent.uid);
      const opponentSnap = await transaction.get(opponentRef);
      
      if (!opponentSnap.exists() || opponentSnap.data().status !== "waiting") {
        console.log("❌ Opponent no longer available");
        return null;
      }

      // Verificar que nosotros aún estemos en waiting
      const meRef = doc(db, "duel_queue", user.uid);
      const meSnap = await transaction.get(meRef);
      
      if (!meSnap.exists() || meSnap.data().status !== "waiting") {
        console.log("❌ Ya no estamos en waiting");
        return null;
      }

      // Crear el match
      const matchRef = doc(collection(db, "duel_matches"));
      const matchId = matchRef.id;
      
      console.log("✅ Creando match real en Firestore:", matchId);
      
      // Obtener el nickname del usuario actual desde su perfil
      const userProfileRef = doc(db, "users", user.uid);
      const userProfileSnap = await getDoc(userProfileRef);
      const userNickname = userProfileSnap.exists() ? userProfileSnap.data().nickname : null;
      
      // Crear el documento del match
      transaction.set(matchRef, {
        createdAt: serverTimestamp(),
        state: "playing",
        round: 1,
        hostUid: user.uid, // El primer usuario es el host
        players: {
          [user.uid]: { hp: 6000, nickname: userNickname },
          [opponent.uid]: { hp: 6000, nickname: opponent.nickname || "Player" },
        },
        rounds: {},
        guesses: {},
        matchmaking: true, // Mark as matchmaking duel for leaderboard stats
      });

      // Solo actualizar nuestro documento de cola (no podemos actualizar el del oponente por permisos)
      transaction.update(meRef, { 
        status: "matched", 
        matchId: matchId,
        opponentUid: opponent.uid,
        opponentNickname: opponent.nickname || null
      });

      return matchId;
    });

    if (result) {
      console.log("✅ Match creado exitosamente en Firestore:", result);
    }
    
    return result;
  } catch (error) {
    console.log("❌ Error en matchmaking:", error);
    return null;
  }
}

// Función para que el oponente se una al match cuando detecte que fue emparejado
export async function joinMatchAsOpponent(matchId, opponentUid, opponentNickname) {
  const user = auth.currentUser;
  if (!user) throw new Error("No auth");

  console.log("🤝 Joining match as opponent:", matchId);

  try {
    // Actualizar nuestro documento de cola
    const meRef = doc(db, "duel_queue", user.uid);
    await updateDoc(meRef, {
      status: "matched",
      matchId: matchId,
      opponentUid: opponentUid,
      opponentNickname: opponentNickname
    });

    console.log("✅ Oponente unido al match exitosamente");
    return true;
  } catch (error) {
    console.log("❌ Error joining match:", error);
    return false;
  }
}

// Mantener heartbeat para indicar que el usuario sigue activo
export async function updateHeartbeat() {
  const user = auth.currentUser;
  if (!user) return;
  
  const qRef = doc(db, "duel_queue", user.uid);
  
  try {
    await updateDoc(qRef, {
      lastSeen: serverTimestamp()
    });
  } catch (error) {
    console.log("Error actualizando heartbeat:", error);
  }
}

// Heartbeat mejorado para salas y juegos
export async function updateGameHeartbeat(gameId, gameType = "multiplayer") {
  const user = auth.currentUser;
  if (!user) return;
  
  const collectionName = gameType === "duel" ? "duel_matches" : "multiplayer_games";
  const gameRef = doc(db, collectionName, gameId);
  
  try {
    await updateDoc(gameRef, {
      [`players.${user.uid}.lastSeen`]: serverTimestamp()
    });
  } catch (error) {
    console.log("Error actualizando heartbeat del juego:", error);
  }
}

// Detectar jugadores desconectados (más de 30 segundos sin actividad)
export function detectDisconnectedPlayers(players) {
  const now = Date.now();
  const disconnectedThreshold = 30000; // 30 segundos
  
  return Object.entries(players).filter(([uid, player]) => {
    if (!player.lastSeen) return false;
    const lastSeen = player.lastSeen.toDate ? player.lastSeen.toDate() : new Date(player.lastSeen);
    return (now - lastSeen.getTime()) > disconnectedThreshold;
  });
}

// Escuchar la cola de matchmaking
export function listenMatchmakingQueue(cb) {
  const user = auth.currentUser;
  if (!user) return () => {};
  
  const q = query(collection(db, "duel_queue"), where("status", "==", "waiting"));
  return onSnapshot(q, (snapshot) => {
    const waitingPlayers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const myPosition = waitingPlayers.findIndex(p => p.uid === user.uid);
    
    console.log("📊 Queue updated:", waitingPlayers.length, "players, my position:", myPosition + 1);
    
    cb({
      waitingPlayers: waitingPlayers.length,
      myPosition: myPosition >= 0 ? myPosition + 1 : -1,
      players: waitingPlayers
    });
  });
}


// Escuchar si nuestro oponente fue emparejado
export function listenForOpponentMatch(cb) {
  const user = auth.currentUser;
  if (!user) return () => {};
  
  const q = query(
    collection(db, "duel_queue"), 
    where("opponentUid", "==", user.uid),
    where("status", "==", "matched")
  );
  
  return onSnapshot(q, async (snapshot) => {
    if (!snapshot.empty) {
      const matchData = snapshot.docs[0].data();
      console.log("🎯 Oponente fue emparejado con nosotros:", matchData);
      
      // Verificar que nuestro documento esté en estado "waiting" antes de procesar
      const meRef = doc(db, "duel_queue", user.uid);
      const meSnap = await getDoc(meRef);
      
      if (!meSnap.exists() || meSnap.data().status !== "waiting") {
        console.log("❌ No estamos en waiting, ignorando match de oponente");
        return;
      }
      
      // Actualizar nuestro documento para unirnos al match
      await joinMatchAsOpponent(
        matchData.matchId, 
        matchData.uid, 
        matchData.nickname
      );
      
      // Notificar con los datos actualizados
      cb({
        ...matchData,
        matchId: matchData.matchId,
        opponentUid: matchData.uid,
        opponentNickname: matchData.nickname
      });
    }
  });
}

export async function cancelQueue() {
  const user = auth.currentUser;
  if (!user) return;
  
  const qRef = doc(db, "duel_queue", user.uid);
  
  try {
    await deleteDoc(qRef);
    console.log("✅ Usuario removido de la cola");
  } catch (error) {
    console.error("Error cancelando cola:", error);
  }
}

export function listenQueueDoc(cb) {
  const user = auth.currentUser;
  if (!user) return () => {};
  const qRef = doc(db, "duel_queue", user.uid);
  return onSnapshot(qRef, (s) => cb(s.exists() ? s.data() : null));
}

// Escucha la cola completa para detectar cuando hay nuevos oponentes
export function listenQueueForMatchmaking(cb) {
  const user = auth.currentUser;
  if (!user) return () => {};
  
  // Consulta simplificada sin orderBy para evitar necesidad de índice
  const q = query(
    collection(db, "duel_queue"), 
    where("status", "==", "waiting")
  );
  
  return onSnapshot(q, (snapshot) => {
    const waitingPlayers = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(player => player.uid !== user.uid)
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)); // Ordenar en cliente
    
    cb(waitingPlayers);
  });
}

export function listenMatch(matchId, cb) {
  const mRef = doc(db, "duel_matches", matchId);
  return onSnapshot(mRef, (s) => cb({ id: matchId, ...(s.data() || {}) }));
}

export async function submitRoundResult(matchId, uid, distanceKm) {
  // daño por distancia (igual que single, pero transformado a daño)
  const damage = Math.min(50, Math.round(Math.max(0, distanceKm) / 100 * 50));
  const mRef = doc(db, "duel_matches", matchId);
  await runTransaction(db, async (tx) => {
    const mSnap = await tx.get(mRef);
    if (!mSnap.exists()) return;
    const data = mSnap.data();
    const me = data.players?.[uid] || { hp: 6000 };
    const otherUid = Object.keys(data.players || {}).find((k) => k !== uid);
    const opp = data.players?.[otherUid] || { hp: 6000 };
    // restamos vida al oponente basada en nuestra precisión
    const newHp = Math.max(0, (opp.hp ?? 6000) - damage);
    const players = { ...data.players, [otherUid]: { ...opp, hp: newHp } };
    const nextRound = (data.round || 1) + 1;
    const state = newHp <= 0 ? "finished" : "playing";
    tx.update(mRef, { players, round: nextRound, state });
  });
}

// ------------- Salas privadas (código) -------------

export async function createRoom(nickname) {
  const user = auth.currentUser;
  if (!user) throw new Error("No auth");
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const roomRef = doc(collection(db, "rooms"));
  await setDoc(roomRef, {
    code,
    hostUid: user.uid,
    createdAt: serverTimestamp(),
    state: "lobby",
  });
  const playerRef = doc(db, "rooms", roomRef.id, "players", user.uid);
  await setDoc(playerRef, { uid: user.uid, nickname: nickname || null, joinedAt: serverTimestamp() });
  return { roomId: roomRef.id, code };
}

export async function joinRoomByCode(code, nickname) {
  const user = auth.currentUser;
  if (!user) throw new Error("No auth");
  const q = query(collection(db, "rooms"), where("code", "==", code), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("Invalid code");
  const roomDoc = snap.docs[0];
  const playerRef = doc(db, "rooms", roomDoc.id, "players", user.uid);
  await setDoc(playerRef, { uid: user.uid, nickname: nickname || null, joinedAt: serverTimestamp() });
  return roomDoc.id;
}

export function listenRoom(roomId, cb) {
  const rRef = doc(db, "rooms", roomId);
  return onSnapshot(rRef, (s) => cb({ id: roomId, ...(s.data() || {}) }));
}

export function listenRoomPlayers(roomId, cb) {
  const pCol = collection(db, "rooms", roomId, "players");
  const qy = query(pCol, orderBy("joinedAt", "asc"));
  return onSnapshot(qy, (s) => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// Escuchar notificaciones de juego listo para un jugador específico
export function listenGameReadyNotification(roomId, uid, cb) {
  const notificationRef = doc(db, "rooms", roomId, "players", uid, "notifications", "game_ready");
  return onSnapshot(notificationRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      console.log(`🎮 Notificación de juego listo recibida:`, data);
      cb(data);
    }
  });
}

export async function leaveRoom(roomId) {
  const user = auth.currentUser;
  if (!user) return;
  const pRef = doc(db, "rooms", roomId, "players", user.uid);
  const pSnap = await getDoc(pRef);
  if (pSnap.exists()) await deleteDoc(pRef);
}

// Función para limpiar datos de duels de forma segura (solo lo que se puede limpiar)
export async function cleanupDuelsData() {
  const user = auth.currentUser;
  if (!user) {
    console.log("❌ No hay usuario autenticado");
    return;
  }

  console.log("🧹 Iniciando limpieza de datos de duels del usuario actual...");

  try {
    // 1. Limpiar solo la cola del usuario actual (esto siempre funciona)
    console.log("🗑️ Limpiando cola del usuario actual...");
    const userQueueRef = doc(db, "duel_queue", user.uid);
    const userQueueSnap = await getDoc(userQueueRef);
    
    let queueDeleted = 0;
    if (userQueueSnap.exists()) {
      await deleteDoc(userQueueRef);
      queueDeleted = 1;
      console.log("✅ Cola del usuario eliminada");
    } else {
      console.log("ℹ️ No user queue to delete");
    }

    // 2. Eliminar TODOS los matches donde el usuario es HOST (terminados y activos)
    console.log("🗑️ Eliminando TODOS los matches donde el usuario es host...");
    const matchesQuery = query(collection(db, "duel_matches"));
    const matchesSnap = await getDocs(matchesQuery);
    
    let matchesDeleted = 0;
    let matchesSkipped = 0;
    
    for (const matchDoc of matchesSnap.docs) {
      const matchData = matchDoc.data();
      
      // Solo intentar eliminar si el usuario es el HOST
      if (matchData.hostUid === user.uid) {
        try {
          await deleteDoc(matchDoc.ref);
          matchesDeleted++;
          console.log(`✅ Match eliminado: ${matchDoc.id} (estado: ${matchData.state})`);
        } catch (error) {
          console.log(`⚠️ No se pudo eliminar match ${matchDoc.id}:`, error.message);
          matchesSkipped++;
        }
      } else {
        // No es host, no intentar eliminar
        matchesSkipped++;
      }
    }

    console.log("✅ Limpieza de duels completada");
    console.log(`📊 Resumen: ${queueDeleted} cola eliminada, ${matchesDeleted} matches eliminados, ${matchesSkipped} matches no tocados`);
    
    return {
      queueDeleted,
      matchesDeleted,
      matchesSkipped
    };

  } catch (error) {
    console.error("❌ Error durante la limpieza:", error);
    throw error;
  }
}

// Función para limpiar TODOS los datos de duels (DESARROLLO/TESTING)
export async function cleanupAllDuelsData() {
  const user = auth.currentUser;
  if (!user) {
    console.log("❌ No hay usuario autenticado");
    return;
  }

  console.log("🧹 INICIANDO LIMPIEZA COMPLETA DE DUELS (DESARROLLO)...");
  console.log("⚠️ WARNING: This will delete ALL duel data from ALL users");

  try {
    // 1. Limpiar TODAS las colas de duels
    console.log("🗑️ Eliminando TODAS las colas de duels...");
    const queueQuery = query(collection(db, "duel_queue"));
    const queueSnap = await getDocs(queueQuery);
    
    const queueDeletePromises = queueSnap.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(queueDeletePromises);
    console.log(`✅ ${queueSnap.docs.length} colas eliminadas`);

    // 2. Eliminar TODOS los matches de duels
    console.log("🗑️ Eliminando TODOS los matches de duels...");
    const matchesQuery = query(collection(db, "duel_matches"));
    const matchesSnap = await getDocs(matchesQuery);
    
    const matchesDeletePromises = matchesSnap.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(matchesDeletePromises);
    console.log(`✅ ${matchesSnap.docs.length} matches eliminados`);

    console.log("✅ LIMPIEZA COMPLETA DE DUELS COMPLETADA");
    console.log(`📊 Resumen: ${queueSnap.docs.length} colas eliminadas, ${matchesSnap.docs.length} matches eliminados`);
    
    return {
      queueDeleted: queueSnap.docs.length,
      matchesDeleted: matchesSnap.docs.length
    };

  } catch (error) {
    console.error("❌ Error durante la limpieza completa:", error);
    throw error;
  }
}

export async function createDuelFromRoom(roomId) {
  // crea un duelo 1v1 con los jugadores actuales de la sala
  const rRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(rRef);
  const playersCol = collection(db, "rooms", roomId, "players");
  const snap = await getDocs(playersCol);
  const players = snap.docs.map(d => ({ uid: d.id, ...(d.data() || {}) }));
  if (players.length < 2) throw new Error("Se necesitan 2 jugadores");
  const [p1, p2] = players.slice(0, 2);
  const matchRef = doc(collection(db, "duel_matches"));
  await setDoc(matchRef, {
    createdAt: serverTimestamp(),
    state: "playing",
    round: 1,
    hostUid: roomSnap.exists() ? roomSnap.data()?.hostUid || p1.uid : p1.uid,
    players: {
      [p1.uid]: { hp: 6000, nickname: p1.nickname || null },
      [p2.uid]: { hp: 6000, nickname: p2.nickname || null },
    },
    rounds: {},
    guesses: {},
    matchmaking: false, // Mark as private room duel (no leaderboard stats)
  });
  await updateDoc(rRef, { duelMatchId: matchRef.id });
  return matchRef.id;
}

export async function setRoundDataIfAbsent(matchId, round, roundData) {
  const mRef = doc(db, "duel_matches", matchId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(mRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const current = (data.rounds && data.rounds[round]) || null;
    if (current) return; // ya hay
    const rounds = { ...(data.rounds || {}) };
    rounds[round] = roundData;
    tx.update(mRef, { rounds });
  });
}

// Function to calculate points like in singleplayer (max. 5000)
function calculatePoints(distanceKm, sizeKm = 14916.862) {
  if (distanceKm <= 100) return 5000; // recompensa perfecta a <100 km
  const k = 4; // ligeramente más generoso que antes
  const raw = 5000 * Math.exp((-k * distanceKm) / sizeKm);
  return Math.min(5000, Math.max(0, Math.round(raw)));
}

export async function submitGuessAndApplyDamage(matchId, uid, distanceKm, guessLatLng) {
  const mRef = doc(db, "duel_matches", matchId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(mRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const round = data.round || 1;
    const players = data.players || {};
    const otherUid = Object.keys(players).find(k => k !== uid);
    const rounds = { ...(data.rounds || {}) };
    const roundData = { ...(rounds[round] || {}) };
    const roundGuesses = { ...(roundData.guesses || {}) };
    roundGuesses[uid] = { dist: distanceKm, guess: guessLatLng, distance: distanceKm };
    roundData.guesses = roundGuesses;
    rounds[round] = roundData;

    // If both responded, calculate points like in singleplayer
    if (roundGuesses[otherUid] && typeof roundGuesses[otherUid].dist === 'number') {
      const dA = roundGuesses[uid].dist;
      const dB = roundGuesses[otherUid].dist;
      
      // Calculate points for each player (like in singleplayer)
      const pointsA = calculatePoints(dA);
      const pointsB = calculatePoints(dB);
      
      // Determine winner (the one with more points)
      const winnerUid = pointsA > pointsB ? uid : otherUid;
      const loserUid = pointsA > pointsB ? otherUid : uid;
      const winnerPoints = pointsA > pointsB ? pointsA : pointsB;
      const loserPoints = pointsA > pointsB ? pointsB : pointsA;
      
      // The loser loses the point difference
      let damage = winnerPoints - loserPoints;
      
      // Multiplicador de daño progresivo a partir de la ronda 4
      if (round >= 4) {
        const multiplier = 1.5 + (round - 4) * 0.5; // Ronda 4: x1.5, Ronda 5: x2.0, Ronda 6: x2.5, etc.
        damage = Math.round(damage * multiplier);
        console.log(`🔥 Multiplicador de daño ronda ${round}: x${multiplier} (daño: ${damage})`);
      }
      
      const winner = players[winnerUid] || { hp: 6000 };
      const loser = players[loserUid] || { hp: 6000 };
      const newHp = Math.max(0, (loser.hp ?? 6000) - damage);
      const newPlayers = { ...players, [loserUid]: { ...loser, hp: newHp } };
      const nextRound = (data.round || 1) + 1;
      const state = newHp <= 0 ? "finished" : "playing";
      
      // Guardar información de daño para mostrar en la UI
      roundData.damage = {
        winner: winner.nickname || `Jugador ${winnerUid.slice(0, 6)}`,
        loser: loser.nickname || `Jugador ${loserUid.slice(0, 6)}`,
        amount: damage,
        winnerUid,
        loserUid,
        winnerPoints,
        loserPoints,
        multiplier: round >= 4 ? 1.5 + (round - 4) * 0.5 : 1,
        round,
        distances: {
          [uid]: dA,
          [otherUid]: dB
        }
      };
      rounds[round] = roundData;
      
      tx.update(mRef, { players: newPlayers, rounds, round: nextRound, state });
    } else {
      tx.update(mRef, { rounds });
    }
  });
}

// ------------- Juego Multijugador (2-10 jugadores) -------------

export async function createMultiplayerGameFromRoom(roomId) {
  // Crea un juego multijugador con los jugadores actuales de la sala
  const rRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(rRef);
  const playersCol = collection(db, "rooms", roomId, "players");
  const snap = await getDocs(playersCol);
  const players = snap.docs.map(d => ({ uid: d.id, ...(d.data() || {}) }));
  
  console.log(`🎮 Creando juego multijugador con ${players.length} jugadores:`, players.map(p => p.nickname || p.uid.slice(0, 6)));
  
  if (players.length < 2) throw new Error("Se necesitan al menos 2 jugadores");
  if (players.length > 10) throw new Error("Maximum 10 players");
  
  // Crear objeto de jugadores con puntuación inicial y timestamp de conexión
  const playersObj = {};
  const now = serverTimestamp();
  players.forEach(player => {
    playersObj[player.uid] = {
      nickname: player.nickname || null,
      totalScore: 0,
      lastSeen: now,
      connected: true
    };
  });
  
  const gameRef = doc(collection(db, "multiplayer_games"));
  const gameId = gameRef.id;
  
  try {
    await setDoc(gameRef, {
      createdAt: serverTimestamp(),
      state: "playing",
      round: 1,
      hostUid: roomSnap.exists() ? roomSnap.data()?.hostUid || players[0].uid : players[0].uid,
      players: playersObj,
      rounds: {},
      maxRounds: 5,
      roomId: roomId // Añadir referencia a la sala original
    });
    
    console.log(`✅ Juego multijugador creado: ${gameId} con ${Object.keys(playersObj).length} jugadores`);
    
    await updateDoc(rRef, { gameId: gameId });
    
    // Notificar a todos los jugadores que el juego está listo
    await notifyPlayersGameReady(roomId, gameId, players.map(p => p.uid));
    
    return gameId;
  } catch (error) {
    console.error("❌ Error creando juego multijugador:", error);
    throw error;
  }
}

// Notificar a todos los jugadores que el juego está listo
async function notifyPlayersGameReady(roomId, gameId, playerUids) {
  try {
    const batch = [];
    const playersCol = collection(db, "rooms", roomId, "players");
    
    // Crear notificaciones para cada jugador
    playerUids.forEach(uid => {
      const notificationRef = doc(playersCol, uid, "notifications", "game_ready");
      batch.push(setDoc(notificationRef, {
        gameId: gameId,
        timestamp: serverTimestamp(),
        type: "game_ready"
      }));
    });
    
    await Promise.all(batch);
    console.log(`📢 Notificaciones de juego listo enviadas a ${playerUids.length} jugadores`);
  } catch (error) {
    console.error("Error enviando notificaciones:", error);
  }
}

export async function setMultiplayerRoundDataIfAbsent(gameId, round, roundData) {
  const gameRef = doc(db, "multiplayer_games", gameId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const current = (data.rounds && data.rounds[round]) || null;
    if (current) return; // ya hay
    const rounds = { ...(data.rounds || {}) };
    rounds[round] = roundData;
    tx.update(gameRef, { rounds });
  });
}

export async function submitMultiplayerGuess(gameId, uid, distanceKm, guessLatLng) {
  const gameRef = doc(db, "multiplayer_games", gameId);
  
  await runTransaction(db, async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists()) return;
    
    const gameData = gameSnap.data();
    const round = gameData.round || 1;
    const rounds = gameData.rounds || {};
    const roundData = rounds[round] || { guesses: {} };
    const guesses = roundData.guesses || {};
    
    // Guardar el guess del jugador
    guesses[uid] = {
      guess: guessLatLng,
      dist: distanceKm,
      points: calculatePoints(distanceKm),
      timestamp: new Date()
    };
    
    roundData.guesses = guesses;
    rounds[round] = roundData;
    
    // Verificar si todos los jugadores han terminado la ronda
    const players = gameData.players || {};
    const playerUids = Object.keys(players);
    const completedGuesses = Object.keys(guesses);
    
    if (completedGuesses.length === playerUids.length) {
      // Todos han terminado, calcular resultados de la ronda
      const roundResults = calculateMultiplayerRoundResults(guesses, players);
      roundData.results = roundResults;
      
      // Actualizar puntuaciones totales de los jugadores
      const updatedPlayers = { ...players };
      Object.entries(roundResults.scores).forEach(([uid, points]) => {
        updatedPlayers[uid] = {
          ...updatedPlayers[uid],
          totalScore: (updatedPlayers[uid].totalScore || 0) + points
        };
      });
      
      // Verificar si es la última ronda
      const nextRound = round + 1;
      const maxRounds = gameData.maxRounds || 5;
      const isGameFinished = nextRound > maxRounds;
      
      if (isGameFinished) {
        // Determinar ganador
        const winnerUid = Object.entries(updatedPlayers).reduce((a, b) => 
          updatedPlayers[a[0]].totalScore > updatedPlayers[b[0]].totalScore ? a : b
        )[0];
        
        tx.update(gameRef, { 
          players: updatedPlayers, 
          rounds, 
          round: nextRound,
          state: "finished",
          winner: winnerUid
        });
      } else {
        tx.update(gameRef, { 
          players: updatedPlayers, 
          rounds, 
          round: nextRound
        });
      }
    } else {
      // Aún faltan jugadores, solo actualizar guesses
      tx.update(gameRef, { rounds });
    }
  });
}

// Calcular resultados de la ronda multijugador
function calculateMultiplayerRoundResults(guesses, players) {
  const results = {
    scores: {},
    rankings: []
  };
  
  // Calculate points for each player
  Object.entries(guesses).forEach(([uid, guess]) => {
    results.scores[uid] = guess.points;
  });
  
  // Crear ranking
  results.rankings = Object.entries(results.scores)
    .map(([uid, points]) => ({
      uid,
      nickname: players[uid]?.nickname || "Player",
      points,
      distance: guesses[uid].dist
    }))
    .sort((a, b) => b.points - a.points);
  
  return results;
}


