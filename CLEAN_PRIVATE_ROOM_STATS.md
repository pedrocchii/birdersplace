# 🧹 Limpiar Estadísticas de Salas Privadas

## Problema Identificado
Las victorias/derrotas de las salas privadas se estaban contando para el leaderboard, cuando solo deberían contar los duels de matchmaking.

## Solución Implementada
1. **Diferenciación de tipos de juego**: 
   - `matchmaking: true` - Para duels de matchmaking (cuentan para leaderboard)
   - `matchmaking: false` - Para salas privadas (NO cuentan para leaderboard)

2. **Verificación en el código**: Solo se actualizan las estadísticas si `m.matchmaking === true`

## Cómo Limpiar las Estadísticas Incorrectas

### Opción 1: Desde la Consola del Navegador
Ejecuta este código para resetear todas las estadísticas:

```javascript
// Reset all user stats to 0
async function resetAllStats() {
  const { db } = await import('./src/firebaseClient.js');
  const { collection, getDocs, doc, updateDoc, writeBatch } = await import('firebase/firestore');
  
  try {
    console.log('🧹 Starting stats reset...');
    
    const userStatsRef = collection(db, 'user_stats');
    const snapshot = await getDocs(userStatsRef);
    
    const batch = writeBatch(db);
    let count = 0;
    
    snapshot.forEach((docSnapshot) => {
      const userRef = doc(db, 'user_stats', docSnapshot.id);
      batch.update(userRef, {
        duelCups: 0,
        duelWins: 0,
        duelLosses: 0,
        lastDuelWin: null,
        lastDuelLoss: null,
        firstDuelWin: null,
        firstDuelLoss: null
      });
      count++;
    });
    
    await batch.commit();
    console.log(`✅ Reset stats for ${count} users`);
    console.log('🎉 Stats reset completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

resetAllStats();
```

### Opción 2: Desde Firebase Console
1. Ve a Firebase Console > Firestore Database
2. Navega a la colección `user_stats`
3. Para cada documento, edita manualmente:
   - `duelCups`: 0
   - `duelWins`: 0
   - `duelLosses`: 0
   - Elimina: `lastDuelWin`, `lastDuelLoss`, `firstDuelWin`, `firstDuelLoss`

## Verificación
Después de limpiar, las estadísticas se actualizarán correctamente:
- ✅ **Solo duels de matchmaking** cuentan para el leaderboard
- ✅ **Salas privadas** NO cuentan para el leaderboard
- ✅ **+5 copas por victoria** (solo matchmaking)
- ✅ **-5 copas por derrota** (solo matchmaking)

## Prevención Futura
El código ahora incluye:
- ✅ Flag `matchmaking: true/false` para distinguir tipos de juego
- ✅ Verificación `m.matchmaking === true` antes de actualizar stats
- ✅ Logs para debugging y verificación

**¡El problema está solucionado!** 🎉
