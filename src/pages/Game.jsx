import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap, Tooltip } from "react-leaflet";
import L from "leaflet";
import { redMarkerIcon, blueMarkerIcon } from "../components/mapIcons";
import LeafletSizeFix from "../components/LeafletSizeFix";
import "leaflet/dist/leaflet.css";

// Genera un nombre de ubicación a partir de coordenadas
function generateLocationName(lat, lng) {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  const latAbs = Math.abs(lat).toFixed(1);
  const lngAbs = Math.abs(lng).toFixed(1);
  return `${latAbs}°${latDir}, ${lngAbs}°${lngDir}`;
}

// Calculate distance between two points (km)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Formatea distancia: "X km" sin decimales, o "Y m" si < 1 km
function formatDistance(distanceKm) {
  if (distanceKm == null || isNaN(distanceKm)) return "";
  if (distanceKm < 1) {
    const meters = Math.round(distanceKm * 1000);
    return `${meters.toLocaleString()} m`;
  }
  const km = Math.round(distanceKm);
  return `${km.toLocaleString()} km`;
}

// Calculate points (max. 5000)
function calculatePoints(distanceKm, sizeKm = 14916.862) {
  if (distanceKm <= 100) return 5000; // recompensa perfecta a <100 km
  const k = 4; // ligeramente más generoso que antes
  const raw = 5000 * Math.exp((-k * distanceKm) / sizeKm);
  return Math.min(5000, Math.max(0, Math.round(raw)));
}


export default function Game({ onBack }) {
  const [observation, setObservation] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [guess, setGuess] = useState(null);
  const [distance, setDistance] = useState(null);
  const [score, setScore] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [round, setRound] = useState(1);
  const [totalScore, setTotalScore] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [finalAnimatedScore, setFinalAnimatedScore] = useState(0);

  // Nuevos: sets para evitar repetición de ubicaciones
  const [usedObservations, setUsedObservations] = useState(new Set());
  const [usedBaseImages, setUsedBaseImages] = useState(new Set());
  const [usedLocations, setUsedLocations] = useState([]); // array de {lat, lng}

  const MAX_ROUNDS = 5;

  useEffect(() => {
    if (observation && !confirmed) {
      setGuess(null);
      setDistance(null);
      setScore(null);
    }
  }, [observation, confirmed]);

  // Anima el resultado final cuando termina el juego
  useEffect(() => {
    if (confirmed && round === MAX_ROUNDS) {
      let raf;
      const durationMs = 900;
      const start = performance.now();
      const from = 0;
      const to = totalScore;
      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
      const step = (now) => {
        const progress = Math.min(1, (now - start) / durationMs);
        const eased = easeOutCubic(progress);
        const value = Math.round(from + (to - from) * eased);
        setFinalAnimatedScore(value);
        if (progress < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }
  }, [confirmed, round, totalScore]);

  function getFinalRank(points) {
    if (points >= 24000) return "👑 Mister Birder";
    if (points >= 21000) return "🦅 Ornithology Legend";
    if (points >= 18000) return "🦉 Master Ornithologist";
    if (points >= 15000) return "🦆 Experto Observador";
    if (points >= 12000) return "🦜 Explorador de Aves";
    if (points >= 9000)  return "🦩 Aprendiz con Talento";
    if (points >= 6000)  return "🐥 Observador Amateur";
    if (points >= 3000)  return "🐦 Novice Adventurer";
    return "🐣 Adventurer in Training";
  }

 // Definimos las regiones principales del mundo para equilibrar la distribución
const REGIONS = [
  { name: "North America", bbox: [-170, 5, -50, 75], weight: 0.5 }, // Reducido a la mitad
  { name: "South America", bbox: [-82, -56, -34, 12], weight: 1.0 },
  { name: "Europe", bbox: [-31, 34, 45, 72], weight: 0.5 }, // Reducido a la mitad
  { name: "Africa", bbox: [-20, -35, 52, 37], weight: 1.0 },
  { name: "Asia", bbox: [25, -10, 180, 55], weight: 1.0 },
  { name: "Oceania", bbox: [110, -50, 180, 0], weight: 0.5 }, // Reducido a la mitad
];

// Función para seleccionar región basada en pesos
function selectWeightedRegion() {
  const totalWeight = REGIONS.reduce((sum, region) => sum + region.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const region of REGIONS) {
    random -= region.weight;
    if (random <= 0) {
      return region;
    }
  }
  
  // Fallback (no debería llegar aquí)
  return REGIONS[REGIONS.length - 1];
}

async function loadObservation() {
  if (isLoading) return;
  setIsLoading(true);

  // 👀 No vaciamos la galería de inmediato → así no hay flash en negro
  setGuess(null);
  setDistance(null);
  setScore(null);
  setConfirmed(false);

  const maxAttempts = 15;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      // 1️⃣ Elegimos región aleatoria con pesos (Europa, Oceanía y Norteamérica reducidas a la mitad)
      const region = selectWeightedRegion();
      const [minLng, minLat, maxLng, maxLat] = region.bbox;

      // 2️⃣ Pedimos observaciones dentro de esa región
      const randomPage = Math.floor(Math.random() * 200);
      const randomUrl = `https://api.inaturalist.org/v1/observations?photos=true&quality_grade=research&order=desc&per_page=100&geo=true&geoprivacy=open&page=${randomPage}&swlat=${minLat}&swlng=${minLng}&nelat=${maxLat}&nelng=${maxLng}&taxon_id=3&captive=false`;

      const randomRes = await fetch(randomUrl);
      if (randomRes.status === 429) {
        console.log("💤 Request limit, waiting 500ms...");
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      const randomData = await randomRes.json();
      if (!randomData.results || randomData.results.length === 0) continue;

      const validObservations = randomData.results.filter(
        r => r.photos && r.photos.length && r.geojson?.coordinates && r.geojson.type === "Point"
      );
      if (validObservations.length === 0) continue;

      // 3️⃣ Elegimos observación base aleatoria
      const randomObservation = validObservations[Math.floor(Math.random() * validObservations.length)];
      const centerLat = randomObservation.geojson.coordinates[1];
      const centerLng = randomObservation.geojson.coordinates[0];
      const locationName = generateLocationName(centerLat, centerLng);

      // 4️⃣ Buscamos cluster cercano (50 km)
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
          const shuffled = [...uniqueObservations].sort(() => Math.random() - 0.5);
          selected = shuffled.slice(0, 8);
        } else {
          // Si no hay suficientes especies únicas, usar el método original
          const shuffled = [...clusterObservations].sort(() => Math.random() - 0.5);
          selected = shuffled.slice(0, 8);
        }

        const items = selected.map(r => ({
          id: r.id,
          photo: r.photos[0].url.replace("square", "large"),
          lat: r.geojson.coordinates[1],
          lon: r.geojson.coordinates[0],
          species: r.taxon?.preferred_common_name || r.taxon?.name,
          taxon_id: r.taxon?.id,
          hotspot: locationName
        }));

        // 🖼️ Ahora sí, reemplazamos la galería (para evitar pantalla en negro durante carga)
        setGallery(items);
        requestAnimationFrame(() => {
          if (items[0]) setObservation(items[0]);
        });

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
  setIsLoading(false);
}
  

  function MapClickHandler() {
    useMapEvents({
      click(e) {
        if (!confirmed) setGuess(e.latlng);
      },
    });
    return null;
  }

  // Ajusta automáticamente el encuadre y zoom tras confirmar
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

  function handleVerify() {
    if (observation && guess) {
      const dist = haversineDistance(
        observation.lat,
        observation.lon,
        guess.lat,
        guess.lng
      );
      setDistance(dist);
      const s = calculatePoints(dist);
      setScore(s);
      setTotalScore((prev) => prev + s);
      setConfirmed(true);
    }
  }

  function handleNextRound() {
    if (round < MAX_ROUNDS && !isLoading) {
      // Clear previous round states
      setGallery([]);
      setObservation(null);
      setGuess(null);
      setDistance(null);
      setScore(null);
      setConfirmed(false);
  
      setRound(r => r + 1);
      loadObservation();
    }
  }
  

  function handleRestart() {
    if (!isLoading) {
      setRound(1);
      setTotalScore(0);
      setGuess(null);
      setDistance(null);
      setScore(null);
      setConfirmed(false);
      setObservation(null);
      setGallery([]);
      setUsedObservations(new Set());
      setUsedBaseImages(new Set());
      setUsedLocations([]);
      loadObservation();
    }
  }

  return (
    <div className="container-narrow" style={{ padding: "1rem", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <button
          onClick={onBack || (() => window.history.back())}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#6c757d",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          ← Back
        </button>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", margin: 0 }}>Birders Place</h1>
        <div style={{ width: "80px" }}></div> {/* Spacer para centrar el título */}
      </div>
      <button
        onClick={gallery.length === 0 ? loadObservation : handleRestart}
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
        {isLoading ? "Loading..." : gallery.length === 0 ? "Load Observation" : "Restart"}
      </button>

      {gallery.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
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
                {confirmed && (
                  <div 
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background: "rgba(0, 0, 0, 0.8)",
                      color: "#fff",
                      padding: "4px 6px",
                      fontSize: "11px",
                      fontWeight: "600",
                      textAlign: "center",
                      borderRadius: "0 0 8px 8px",
                      backdropFilter: "blur(4px)",
                      cursor: "pointer",
                      transition: "background-color 0.2s ease"
                    }}
                    onClick={(e) => {
                      e.stopPropagation(); // Evitar que se abra el lightbox
                      // Usar el taxon_id de la observación para mostrar el mapa de distribución de la especie
                      const taxonId = item.taxon_id || '3'; // Fallback a aves si no hay taxon_id
                      window.open(`https://www.inaturalist.org/observations?subview=map&taxon_id=${taxonId}&view=map`, '_blank');
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.backgroundColor = "rgba(0, 0, 0, 0.9)";
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
                    }}
                  >
                    {item.species}
                  </div>
                )}
              </div>
            ))}
          </div>

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
              {guess && <Marker position={[guess.lat, guess.lng]} icon={blueMarkerIcon} />}
              {confirmed && (
                <>
                  <FitOnConfirm />
                  <Marker position={[observation.lat, observation.lon]} icon={redMarkerIcon} />
                  {guess && (
                    <Polyline
                      positions={[
                        [guess.lat, guess.lng],
                        [observation.lat, observation.lon],
                      ]}
                      pathOptions={{ color: "#2ecc71", weight: 3 }}
                    />
                  )}
                  {guess && (
                    <Marker
                      position={[
                        (guess.lat + observation.lat) / 2,
                        (guess.lng + observation.lon) / 2,
                      ]}
                      icon={L.divIcon({ className: "no-icon", html: "", iconSize: [0, 0] })}
                    >
                      <Tooltip permanent direction="top" offset={[0, -4]} className="distance-tooltip">
                        {formatDistance(Number(distance))}
                      </Tooltip>
                    </Marker>
                  )}
                </>
              )}
            </MapContainer>
          </div>

          {!confirmed && (
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
              Verificar
            </button>
          )}

          {lightbox && (
            <div className="lightbox-backdrop" onClick={() => setLightbox(null)}>
              <button className="lightbox-close" onClick={() => setLightbox(null)}>
                Cerrar
              </button>
              <img className="lightbox-img" src={lightbox} alt="Foto" />
            </div>
          )}

          {confirmed && (
            <div className="result-panel">
              <h3 style={{ margin: 0 }}>
                Round {round} / {MAX_ROUNDS}
              </h3>
              <div style={{ marginTop: 6, fontSize: "22px", fontWeight: "bold", color: "#f1c40f" }}>
                {`${Number(score).toLocaleString()} points`}
              </div>
              <div className="result-bar" title="Closer → more points" style={{ marginTop: 8 }}>
                <span style={{ width: `${Math.min(100, (score / 5000) * 100)}%` }} />
              </div>
              <div style={{ marginTop: 10, color: "#ecf0f1" }}>
                What you guessed was at
                <span style={{ fontWeight: "bold", margin: "0 6px", padding: "2px 6px", background: "#2c3e50", borderRadius: "6px", color: "#f9f9f9" }}>
                  {formatDistance(Number(distance)).toUpperCase()}
                </span>
                from the correct location.
              </div>
              <div style={{ marginTop: 8 }}>Total score: <span style={{ fontWeight: "bold" }}>{Number(totalScore).toLocaleString()}</span></div>
              {round < MAX_ROUNDS ? (
                <button
                  onClick={handleNextRound}
                  disabled={isLoading}
                  style={{
                    marginTop: "12px",
                    padding: "0.6rem 1.2rem",
                    backgroundColor: isLoading ? "#95a5a6" : "#8e44ad",
                    color: "white",
                    border: "none",
                    borderRadius: "10px",
                    cursor: isLoading ? "not-allowed" : "pointer",
                  }}
                >
                  {isLoading ? "Loading..." : "Next round"}
                </button>
              ) : (
                <div style={{
                  marginTop: "16px",
                  padding: "14px 12px",
                  background: "#111827",
                  borderRadius: "12px",
                  border: "1px solid #1f2937",
                  color: "#ecf0f1"
                }}>
                  <div style={{ fontSize: "18px", opacity: 0.9, marginBottom: 6 }}>¡Juego terminado!</div>
                  <div style={{ fontSize: "32px", fontWeight: "800", background: "linear-gradient(90deg,#f59e0b,#fbbf24)", WebkitBackgroundClip: "text", color: "transparent" }}>
                    {finalAnimatedScore.toLocaleString()} points
                  </div>
                  <div style={{ marginTop: 6, fontWeight: "600" }}>{getFinalRank(totalScore)}</div>
                  <button
                    onClick={handleRestart}
                    style={{
                      marginTop: "14px",
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
            </div>
          )}
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
