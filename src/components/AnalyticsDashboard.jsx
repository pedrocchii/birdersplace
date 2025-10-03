import { useState, useEffect } from 'react';
import { useAnalytics } from '../hooks/useAnalytics';

const AnalyticsDashboard = ({ onBack }) => {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const analytics = useAnalytics();

  useEffect(() => {
    // Verificar si GA4 está configurado
    const gaId = import.meta.env.VITE_GA_MEASUREMENT_ID;
    setAnalyticsEnabled(!!gaId);
  }, []);

  const openGoogleAnalytics = () => {
    analytics.trackEvent('analytics_dashboard_click', { action: 'open_ga_dashboard' });
    window.open('https://analytics.google.com/', '_blank');
  };

  const openGA4Setup = () => {
    analytics.trackEvent('analytics_dashboard_click', { action: 'open_ga_setup' });
    window.open('https://support.google.com/analytics/answer/9304153', '_blank');
  };

  return (
    <div style={{ 
      display: "flex", 
      minHeight: "100vh", 
      alignItems: "center", 
      justifyContent: "center",
      background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)"
    }}>
      <div style={{ 
        background: "#0f172a", 
        padding: 32, 
        borderRadius: 16, 
        width: 600, 
        color: "#fff", 
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.1)"
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
          <button 
            onClick={onBack}
            style={{ 
              padding: "8px 12px", 
              borderRadius: 8, 
              border: "none", 
              background: "#374151", 
              color: "#fff", 
              cursor: "pointer",
              marginRight: 16
            }}
          >
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: "24px" }}>📊 Analytics Dashboard</h1>
        </div>

        {analyticsEnabled ? (
          <div>
            <div style={{ 
              background: "rgba(16, 185, 129, 0.1)", 
              border: "1px solid #10b981", 
              borderRadius: 8, 
              padding: 16, 
              marginBottom: 24 
            }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "20px", marginRight: 8 }}>✅</span>
                <strong style={{ color: "#10b981" }}>Google Analytics 4 Activo</strong>
              </div>
              <p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
                Tu sitio está siendo monitoreado. Los datos aparecerán en Google Analytics en 24-48 horas.
              </p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <h3 style={{ marginTop: 0, marginBottom: 16, color: "#f3f4f6" }}>📈 Métricas que se están rastreando:</h3>
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ 
                  background: "rgba(255,255,255,0.05)", 
                  padding: 12, 
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.1)"
                }}>
                  <strong style={{ color: "#10b981" }}>👥 Visitantes únicos</strong>
                  <p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "#9ca3af" }}>
                    Número de usuarios únicos que visitan tu sitio
                  </p>
                </div>
                
                <div style={{ 
                  background: "rgba(255,255,255,0.05)", 
                  padding: 12, 
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.1)"
                }}>
                  <strong style={{ color: "#3b82f6" }}>📄 Páginas vistas</strong>
                  <p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "#9ca3af" }}>
                    Total de páginas visitadas por los usuarios
                  </p>
                </div>
                
                <div style={{ 
                  background: "rgba(255,255,255,0.05)", 
                  padding: 12, 
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.1)"
                }}>
                  <strong style={{ color: "#8b5cf6" }}>⏱️ Duración de sesión</strong>
                  <p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "#9ca3af" }}>
                    Tiempo promedio que los usuarios pasan en tu sitio
                  </p>
                </div>
                
                <div style={{ 
                  background: "rgba(255,255,255,0.05)", 
                  padding: 12, 
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.1)"
                }}>
                  <strong style={{ color: "#f59e0b" }}>🎮 Eventos del juego</strong>
                  <p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "#9ca3af" }}>
                    Partidas jugadas, duels, identificaciones de aves, etc.
                  </p>
                </div>
                
                <div style={{ 
                  background: "rgba(255,255,255,0.05)", 
                  padding: 12, 
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.1)"
                }}>
                  <strong style={{ color: "#ef4444" }}>🌍 Ubicación geográfica</strong>
                  <p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "#9ca3af" }}>
                    Países y ciudades de donde vienen tus visitantes
                  </p>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <button 
                onClick={openGoogleAnalytics}
                style={{ 
                  padding: "12px 16px", 
                  background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)", 
                  color: "#fff", 
                  border: "none", 
                  borderRadius: 8, 
                  cursor: "pointer", 
                  fontWeight: 600,
                  fontSize: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px"
                }}
              >
                📊 Abrir Google Analytics
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ 
              background: "rgba(239, 68, 68, 0.1)", 
              border: "1px solid #ef4444", 
              borderRadius: 8, 
              padding: 16, 
              marginBottom: 24 
            }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: "20px", marginRight: 8 }}>⚠️</span>
                <strong style={{ color: "#ef4444" }}>Google Analytics no configurado</strong>
              </div>
              <p style={{ margin: 0, color: "#9ca3af", fontSize: "14px" }}>
                Necesitas configurar tu Measurement ID de GA4 para ver las estadísticas.
              </p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <h3 style={{ marginTop: 0, marginBottom: 16, color: "#f3f4f6" }}>🔧 Cómo configurar Google Analytics 4:</h3>
              <div style={{ 
                background: "rgba(255,255,255,0.05)", 
                padding: 16, 
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)"
              }}>
                <ol style={{ margin: 0, paddingLeft: 20, color: "#d1d5db" }}>
                  <li style={{ marginBottom: 8 }}>Ve a <a href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6" }}>Google Analytics</a></li>
                  <li style={{ marginBottom: 8 }}>Crea una nueva propiedad para tu sitio web</li>
                  <li style={{ marginBottom: 8 }}>Copia tu "Measurement ID" (formato: G-XXXXXXXXXX)</li>
                  <li style={{ marginBottom: 8 }}>Crea un archivo <code style={{ background: "rgba(255,255,255,0.1)", padding: "2px 4px", borderRadius: 4 }}>.env.local</code> en la raíz del proyecto</li>
                  <li style={{ marginBottom: 8 }}>Añade: <code style={{ background: "rgba(255,255,255,0.1)", padding: "2px 4px", borderRadius: 4 }}>VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX</code></li>
                  <li>Reinicia el servidor de desarrollo</li>
                </ol>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <button 
                onClick={openGA4Setup}
                style={{ 
                  padding: "12px 16px", 
                  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", 
                  color: "#fff", 
                  border: "none", 
                  borderRadius: 8, 
                  cursor: "pointer", 
                  fontWeight: 600,
                  fontSize: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px"
                }}
              >
                🚀 Guía de configuración GA4
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
