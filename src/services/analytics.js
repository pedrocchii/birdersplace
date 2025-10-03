// Google Analytics 4 (GA4) Service
// Configuración de GA4
const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

// Función para cargar el script de Google Analytics
const loadGAScript = () => {
  return new Promise((resolve) => {
    if (window.gtag) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    script.onload = () => {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function() {
        window.dataLayer.push(arguments);
      };
      window.gtag('js', new Date());
      resolve();
    };
    document.head.appendChild(script);
  });
};

// Inicializar Google Analytics
export const initGA = async () => {
  if (!GA_MEASUREMENT_ID) {
    console.warn('GA4 Measurement ID no configurado. Añade VITE_GA_MEASUREMENT_ID a tu .env.local');
    return;
  }

  try {
    await loadGAScript();
    window.gtag('config', GA_MEASUREMENT_ID, {
      page_title: document.title,
      page_location: window.location.href,
    });
    console.log('✅ Google Analytics 4 inicializado');
  } catch (error) {
    console.error('Error inicializando Google Analytics:', error);
  }
};

// Track page views
export const trackPageView = (page_path, page_title) => {
  if (!GA_MEASUREMENT_ID || !window.gtag) return;
  
  window.gtag('config', GA_MEASUREMENT_ID, {
    page_path,
    page_title,
    page_location: window.location.href,
  });
};

// Track custom events
export const trackEvent = (event_name, parameters = {}) => {
  if (!GA_MEASUREMENT_ID || !window.gtag) return;
  
  window.gtag('event', event_name, {
    event_category: 'engagement',
    ...parameters,
  });
};

// Eventos específicos del juego
export const trackGameEvent = (action, gameMode, details = {}) => {
  trackEvent('game_action', {
    event_category: 'game',
    action,
    game_mode: gameMode,
    ...details,
  });
};

// Track user engagement
export const trackUserEngagement = (action, details = {}) => {
  trackEvent('user_engagement', {
    event_category: 'engagement',
    action,
    ...details,
  });
};

// Track multiplayer events
export const trackMultiplayerEvent = (action, roomType, details = {}) => {
  trackEvent('multiplayer_action', {
    event_category: 'multiplayer',
    action,
    room_type: roomType,
    ...details,
  });
};

export default {
  initGA,
  trackPageView,
  trackEvent,
  trackGameEvent,
  trackUserEngagement,
  trackMultiplayerEvent,
};
