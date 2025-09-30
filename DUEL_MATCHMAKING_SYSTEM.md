# 🎯 Birders Place - Sistema de Matchmaking de Duels

## 📋 **Índice**
1. [Arquitectura General](#arquitectura-general)
2. [Flujo de Matchmaking](#flujo-de-matchmaking)
3. [Sincronización de Imágenes](#sincronización-de-imágenes)
4. [Sistema de Tiempo](#sistema-de-tiempo)
5. [Estados del Juego](#estados-del-juego)
6. [Manejo de Errores](#manejo-de-errores)
7. [Base de Datos](#base-de-datos)

---

## 🏗️ **Arquitectura General**

### **Componentes Principales:**
- **Frontend**: React con hooks para estado
- **Backend**: Firebase Firestore (tiempo real)
- **Autenticación**: Firebase Auth
- **Sincronización**: Firestore listeners (onSnapshot)

### **Colecciones de Firestore:**
```
duel_queue/{uid}          # Cola de espera de usuarios
duel_matches/{matchId}    # Partidas activas
user_stats/{uid}          # Estadísticas y leaderboard
users/{uid}              # Perfiles de usuario
```

---

## 🔄 **Flujo de Matchmaking**

### **1. Usuario busca partida**
```javascript
// Usuario hace clic en "Find Match"
handleFind() → enqueueForDuel() → setDoc(duel_queue/{uid})
```

**Estado**: `waiting` → Usuario agregado a la cola

### **2. Sistema detecta 2+ jugadores**
```javascript
// Listener detecta cambios en la cola
listenQueueForMatchmaking() → tryMatchmake()
```

**Condiciones**:
- Mínimo 2 usuarios en cola
- Ambos en estado `waiting`
- Verificación de disponibilidad

### **3. Creación del match**
```javascript
// Transacción atómica
runTransaction() → {
  // 1. Verificar que ambos usuarios sigan disponibles
  // 2. Crear documento en duel_matches
  // 3. Actualizar estado de usuarios a "matched"
}
```

**Resultado**: Match creado con ID único

### **4. Notificación a oponente**
```javascript
// El oponente recibe notificación
listenForOpponentMatch() → joinMatchAsOpponent()
```

**Proceso**:
- Detección de emparejamiento
- Verificación de estado del match
- Unión al match

---

## 🖼️ **Sincronización de Imágenes**

### **¿Cómo se asegura que ambos jugadores vean la misma imagen?**

#### **1. Host carga la observación**
```javascript
// Solo el HOST (primer usuario) carga la observación
if (user.uid === match.hostUid) {
  loadObservation() → setRoundDataIfAbsent()
}
```

#### **2. Datos almacenados en Firestore**
```javascript
// Estructura en duel_matches/{matchId}
{
  rounds: {
    1: {
      items: [observation],  // Misma observación para ambos
      startTime: timestamp,   // Tiempo sincronizado
      duration: 90           // 90 segundos
    }
  }
}
```

#### **3. Sincronización en tiempo real**
```javascript
// Ambos jugadores escuchan los mismos datos
listenMatch(matchId) → onSnapshot() → {
  // Misma observación
  // Mismo tiempo de inicio
  // Mismo tiempo restante
}
```

### **Flujo de Sincronización:**
1. **Host** carga observación de iNaturalist
2. **Host** guarda datos en `duel_matches/{matchId}/rounds/{round}`
3. **Oponente** recibe actualización vía `onSnapshot`
4. **Ambos** ven la misma imagen al mismo tiempo

---

## ⏰ **Sistema de Tiempo**

### **Configuración de Tiempo:**
```javascript
const GAME_CONFIG = {
  ROUND_TIMER: 90,        // 90 segundos por ronda
  RESULTS_COUNTDOWN: 10,  // 10 segundos para resultados
  HEARTBEAT_INTERVAL: 10000 // 10 segundos para detectar desconexiones
}
```

### **Flujo de Tiempo:**

#### **1. Inicio de ronda**
```javascript
// Cuando ambos jugadores están listos
startTimer(round, onTimeout) → {
  // Timer de 90 segundos
  // Countdown visual
  // Detección de timeout
}
```

#### **2. Sincronización de tiempo**
```javascript
// Tiempo calculado desde el servidor
const timeRemaining = 90 - (now - roundStartTime)
```

#### **3. Timeout automático**
```javascript
// Si no se verifica en 90 segundos
onTimeout() → handleTimeout() → {
  // Eliminación automática
  // Daño por timeout
  // Fin de partida
}
```

### **Estados de Tiempo:**
- **90s**: Tiempo para hacer clic y verificar
- **10s**: Mostrar resultados
- **0s**: Timeout automático

---

## 🎮 **Estados del Juego**

### **Estados del Usuario:**
```javascript
const GAME_STATUS = {
  IDLE: "idle",           // En menú principal
  WAITING: "waiting",     // Buscando partida
  MATCHED: "matched",     // En partida
  FINISHED: "finished"    // Partida terminada
}
```

### **Estados del Match:**
```javascript
const MATCH_STATES = {
  PLAYING: "playing",     // Partida activa
  FINISHED: "finished"    // Partida terminada
}
```

### **Transiciones de Estado:**
```
IDLE → WAITING → MATCHED → FINISHED → IDLE
  ↑                              ↓
  └────────── (Nueva partida) ────┘
```

---

## 🛡️ **Manejo de Errores**

### **1. Condiciones de Carrera**
```javascript
// Problema: Match no existe inmediatamente
// Solución: Lógica de reintentos
let retries = 3;
while (retries > 0) {
  matchSnap = await getDoc(matchRef);
  if (matchSnap.exists()) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
  retries--;
}
```

### **2. Desconexiones**
```javascript
// Detección de jugadores desconectados
checkDisconnectedPlayers() → {
  // Verificar lastActivity
  // Timeout de 30 segundos
  // Eliminación automática
}
```

### **3. Matches Abandonados**
```javascript
// Prevención de unirse a matches abandonados
if (hostLastActivity && (currentTime - hostLastActivity) > DISCONNECT_TIMEOUT) {
  // No unirse al match
  return null;
}
```

---

## 🗄️ **Base de Datos**

### **Estructura de duel_queue:**
```javascript
{
  uid: "user123",
  nickname: "PlayerName",
  status: "waiting",        // waiting | matched
  createdAt: timestamp,
  matchId: "match456",      // Solo si está matched
  opponentUid: "user789",   // Solo si está matched
  opponentNickname: "Opponent"
}
```

### **Estructura de duel_matches:**
```javascript
{
  createdAt: timestamp,
  state: "playing",         // playing | finished
  round: 1,
  hostUid: "user123",
  players: {
    "user123": { hp: 6000, nickname: "Player1" },
    "user789": { hp: 6000, nickname: "Player2" }
  },
  rounds: {
    1: {
      items: [observation],
      startTime: timestamp,
      guesses: {
        "user123": { dist: 150, points: 4500 },
        "user789": { dist: 200, points: 4000 }
      }
    }
  },
  matchmaking: true,        // true = matchmaking, false = private room
  statsProcessed: false     // Para evitar duplicar estadísticas
}
```

### **Estructura de user_stats:**
```javascript
{
  uid: "user123",
  nickname: "PlayerName",
  duelCups: 25,             // Sistema de copas
  duelWins: 5,              // Victorias
  duelLosses: 2,            // Derrotas
  lastDuelWin: timestamp,
  lastDuelLoss: timestamp
}
```

---

## 🔄 **Flujo Completo Paso a Paso**

### **Paso 1: Usuario A busca partida**
1. Usuario A hace clic en "Find Match"
2. Se crea documento en `duel_queue/userA`
3. Estado: `waiting`

### **Paso 2: Usuario B busca partida**
1. Usuario B hace clic en "Find Match"
2. Se crea documento en `duel_queue/userB`
3. Sistema detecta 2 usuarios → inicia matchmaking

### **Paso 3: Creación del match**
1. Sistema selecciona candidato (usuario más antiguo)
2. Transacción atómica:
   - Verifica disponibilidad de ambos
   - Crea `duel_matches/matchId`
   - Actualiza `duel_queue/userA` a `matched`

### **Paso 4: Notificación a Usuario B**
1. Usuario B recibe notificación vía `listenForOpponentMatch`
2. Verifica que el match existe (con reintentos)
3. Se une al match
4. Ambos usuarios están en estado `matched`

### **Paso 5: Carga de observación**
1. Solo el HOST (Usuario A) carga la observación
2. Guarda datos en `duel_matches/matchId/rounds/1`
3. Usuario B recibe la misma observación vía listener

### **Paso 6: Juego**
1. Ambos ven la misma imagen
2. Timer de 90 segundos inicia
3. Ambos hacen clic y verifican
4. Sistema calcula daño y actualiza HP

### **Paso 7: Fin de partida**
1. Cuando un jugador llega a 0 HP
2. Match se marca como `finished`
3. Se actualizan estadísticas
4. Ambos usuarios vuelven a estado `idle`

---

## 🎯 **Características Clave**

### **✅ Sincronización Perfecta**
- Misma imagen para ambos jugadores
- Tiempo sincronizado desde el servidor
- Estados consistentes

### **✅ Robustez**
- Manejo de condiciones de carrera
- Detección de desconexiones
- Prevención de matches abandonados

### **✅ Escalabilidad**
- Sistema de cola eficiente
- Transacciones atómicas
- Limpieza automática de datos

### **✅ Experiencia de Usuario**
- Matchmaking rápido
- Feedback visual claro
- Manejo de errores transparente

---

**El sistema de matchmaking de Birders Place está diseñado para ser robusto, escalable y proporcionar una experiencia de juego perfectamente sincronizada entre dos jugadores.** 🎮✨
