import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

export default function LeafletSizeFix() {
  const map = useMap();

  useEffect(() => {
    const invalidate = () => {
      try {
        map.invalidateSize();
      } catch {}
    };

    // Disparos iniciales (por si cambia el layout tras montar)
    invalidate();
    const t1 = setTimeout(invalidate, 0);
    const t2 = setTimeout(invalidate, 250);

    // Redimensionado de ventana
    const onResize = () => invalidate();
    window.addEventListener("resize", onResize);

    // Observer del contenedor y su padre
    const container = map.getContainer();
    const parent = container?.parentElement;
    const ro = new ResizeObserver(() => invalidate());
    if (container) ro.observe(container);
    if (parent) ro.observe(parent);

    // Ajustar minZoom para que el mundo entre exactamente en el viewport
    const worldBounds = L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180));
    const applyMinZoom = () => {
      try {
        const minZ = map.getBoundsZoom(worldBounds, true);
        // Asegura que no aparezcan bordes grises a zoom mínimo
        const desiredMin = Math.max(0, minZ);
        map.setMinZoom(desiredMin);
        if (map.getZoom() < desiredMin) {
          map.setZoom(desiredMin);
        }
      } catch {}
    };
    applyMinZoom();

    // Cuando los tiles terminan de cargar
    map.on("load", () => {
      invalidate();
      applyMinZoom();
    });

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", onResize);
      map.off("load");
      try { ro.disconnect(); } catch {}
    };
  }, [map]);

  return null;
}


