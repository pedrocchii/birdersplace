# 🧹 Limpiar Estadísticas Duplicadas

## Problema Identificado
El sistema estaba contando múltiples victorias por partida porque `updatePlayerCups` se ejecutaba cada vez que se actualizaba el match en estado `FINISHED`.

## Solución Implementada
1. **Protección contra duplicados**: Agregado flag `statsProcessed` para evitar que se procesen las estadísticas múltiples veces
2. **Limpieza de datos**: Script para resetear todas las estadísticas

## Cómo Limpiar las Estadísticas Duplicadas

### Opción 1: Desde la Consola del Navegador
1. Abre las herramientas de desarrollador (F12)
2. Ve a la pestaña "Console"
3. Ejecuta este código:

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
    
    // Also clean match stats flags
    const matchesRef = collection(db, 'duel_matches');
    const matchesSnapshot = await getDocs(matchesRef);
    
    const matchBatch = writeBatch(db);
    let matchCount = 0;
    
    matchesSnapshot.forEach((docSnapshot) => {
      const matchRef = doc(db, 'duel_matches', docSnapshot.id);
      matchBatch.update(matchRef, {
        statsProcessed: null
      });
      matchCount++;
    });
    
    await matchBatch.commit();
    console.log(`✅ Cleaned ${matchCount} matches`);
    console.log('🎉 Stats reset completed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the reset
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
- ✅ Solo 1 victoria por partida ganada
- ✅ Solo 1 derrota por partida perdida
- ✅ +5 copas por victoria
- ✅ -5 copas por derrota (mínimo 0)

## Prevención Futura
El código ahora incluye:
- ✅ Flag `statsProcessed` para evitar duplicados
- ✅ Verificación antes de actualizar estadísticas
- ✅ Logs para debugging

**¡El problema está solucionado!** 🎉
