import { useEffect } from 'react';
import { trackPageView, trackEvent, trackGameEvent, trackUserEngagement, trackMultiplayerEvent } from '../services/analytics';

// Hook personalizado para analytics
export const useAnalytics = () => {
  // Track page views automáticamente
  useEffect(() => {
    trackPageView(window.location.pathname, document.title);
  }, []);

  return {
    trackEvent,
    trackGameEvent,
    trackUserEngagement,
    trackMultiplayerEvent,
  };
};

// Hook específico para tracking de juegos
export const useGameAnalytics = () => {
  const analytics = useAnalytics();

  const trackGameStart = (gameMode, difficulty = null) => {
    analytics.trackGameEvent('game_start', gameMode, { difficulty });
  };

  const trackGameEnd = (gameMode, score, duration, correctAnswers) => {
    analytics.trackGameEvent('game_end', gameMode, {
      score,
      duration_seconds: duration,
      correct_answers: correctAnswers,
    });
  };

  const trackBirdIdentified = (gameMode, isCorrect, birdSpecies = null) => {
    analytics.trackGameEvent('bird_identified', gameMode, {
      correct: isCorrect,
      bird_species: birdSpecies,
    });
  };

  const trackGameModeSelected = (gameMode) => {
    analytics.trackGameEvent('mode_selected', gameMode);
  };

  return {
    trackGameStart,
    trackGameEnd,
    trackBirdIdentified,
    trackGameModeSelected,
  };
};

// Hook para tracking de multiplayer
export const useMultiplayerAnalytics = () => {
  const analytics = useAnalytics();

  const trackRoomCreated = (roomType, maxPlayers) => {
    analytics.trackMultiplayerEvent('room_created', roomType, { max_players: maxPlayers });
  };

  const trackRoomJoined = (roomType, roomId) => {
    analytics.trackMultiplayerEvent('room_joined', roomType, { room_id: roomId });
  };

  const trackRoomLeft = (roomType, roomId) => {
    analytics.trackMultiplayerEvent('room_left', roomType, { room_id: roomId });
  };

  const trackDuelStarted = (opponentId) => {
    analytics.trackMultiplayerEvent('duel_started', 'duel', { opponent_id: opponentId });
  };

  const trackDuelEnded = (result, score) => {
    analytics.trackMultiplayerEvent('duel_ended', 'duel', { result, score });
  };

  return {
    trackRoomCreated,
    trackRoomJoined,
    trackRoomLeft,
    trackDuelStarted,
    trackDuelEnded,
  };
};

export default useAnalytics;
