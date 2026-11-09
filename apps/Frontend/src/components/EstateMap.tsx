import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { Map as MapboxMap } from 'mapbox-gl';

export function EstateMap() {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const token = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN as string | undefined;

  useEffect(() => {
    const element = container.current;
    if (!element || !token) return;
    let disposed = false;
    let map: MapboxMap | undefined;
    let resize: ResizeObserver | undefined;
    async function load() {
      try {
        const [{ default: mapboxgl }] = await Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')]);
        if (disposed || !element) return;
        map = new mapboxgl.Map({ container: element, accessToken: token, style: 'mapbox://styles/mapbox/outdoors-v12', center: [75.7739, 13.3153], zoom: 10, attributionControl: true });
        map.on('load', () => { if (!disposed) { map?.resize(); setLoaded(true); } });
        map.scrollZoom.disable();
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
        map.on('error', (event) => {
          if (!disposed && /401|403|unauthorized|forbidden|webgl/i.test(event.error?.message ?? '')) setFailed(true);
        });
        resize = new ResizeObserver(() => map?.resize());
        resize.observe(element);
      } catch {
        if (!disposed) setFailed(true);
      }
    }
    const visibility = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { visibility.disconnect(); void load(); }
    }, { rootMargin: '300px' });
    visibility.observe(element);
    return () => { disposed = true; visibility.disconnect(); resize?.disconnect(); map?.remove(); };
  }, [token]);

  const staticMap = token ? `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/75.7739,13.3153,10/1000x700?access_token=${encodeURIComponent(token)}` : '';
  return <>
    {!loaded && staticMap && !imageFailed && <img className="estate-map-image estate-map-static" src={staticMap} alt="Map of the Chikkamagaluru area" onError={() => setImageFailed(true)} />}
    <div ref={container} className={`estate-map-canvas ${loaded ? 'map-ready' : ''}`} aria-label="Interactive map of the Chikkamagaluru area. Drag to explore; use the zoom buttons or pinch to zoom." />
    {(!token || (failed && imageFailed)) && <div className="map-fallback"><MapPin size={26} /><span>Chikkamagaluru, Karnataka</span><small>Map unavailable right now.</small></div>}
    {!loaded && staticMap && !imageFailed && <span className="map-attribution">© Mapbox © OpenStreetMap</span>}
  </>;
}
