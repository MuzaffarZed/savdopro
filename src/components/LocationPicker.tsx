import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Crosshair, Search, LocateFixed, Check } from "lucide-react";
import { toast } from "sonner";

const selectedIcon = L.divIcon({
  className: "location-picker-selected-icon",
  html: "<span></span>",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

type Pos = { lat: number; lng: number };

function ClickHandler({ onPick }: { onPick: (p: Pos) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function MapSync({ pos, onCenterChange }: { pos: Pos | null; onCenterChange: (p: Pos) => void }) {
  const map = useMap();
  useEffect(() => {
    const updateCenter = () => {
      const center = map.getCenter();
      onCenterChange({ lat: center.lat, lng: center.lng });
    };
    const resize = () => {
      map.invalidateSize();
      updateCenter();
    };
    const timer = window.setTimeout(resize, 200);
    const container = map.getContainer();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    map.on("moveend zoomend", updateCenter);
    updateCenter();
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      map.off("moveend zoomend", updateCenter);
    };
  }, [map, onCenterChange]);
  useEffect(() => {
    if (pos) map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 16), { duration: 0.45 });
  }, [pos, map]);
  return null;
}

export function LocationPicker({
  value,
  onChange,
  height = 280,
}: {
  value: Pos | null;
  onChange: (p: Pos | null) => void;
  height?: number;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [myPos, setMyPos] = useState<Pos | null>(null);
  const [locating, setLocating] = useState(false);
  const [mapCenter, setMapCenter] = useState<Pos | null>(null);
  const [focusPos, setFocusPos] = useState<Pos | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const center = useMemo<Pos>(() => value ?? { lat: 41.3111, lng: 69.2797 }, [value]);
  const handleCenterChange = useCallback((p: Pos) => setMapCenter(p), []);

  function locate(onLocated: (pos: Pos) => void) {
    if (!navigator.geolocation) {
      toast.error("Geolokatsiya qo'llab-quvvatlanmaydi");
      return;
    }
    setLocating(true);
    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 30000,
    };
    const fallbackOptions: PositionOptions = {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 300000,
    };
    const finalFailure = (err: GeolocationPositionError) => {
      setLocating(false);
      const message =
        err.code === err.PERMISSION_DENIED
          ? "Brauzer lokatsiyaga ruxsat bermadi"
          : "Lokatsiya topilmadi. GPS/ruxsatni tekshiring";
      toast.error(message);
    };
    const success = (p: GeolocationPosition) => {
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      setMyPos(pos);
      setFocusPos(pos);
      setLocating(false);
      onLocated(pos);
    };
    const failure = (err: GeolocationPositionError) => {
      if (err.code !== err.PERMISSION_DENIED && options.enableHighAccuracy) {
        navigator.geolocation.getCurrentPosition(success, finalFailure, fallbackOptions);
        return;
      }
      finalFailure(err);
    };
    navigator.geolocation.getCurrentPosition(success, failure, options);
  }

  function pickCurrent() {
    locate((pos) => {
      onChange(pos);
      toast.success("Joriy joy belgilandi");
    });
  }

  function showMyLocation() {
    locate(() => toast.success("Joylashuvingiz xaritada ko'rsatildi"));
  }

  function pickMapCenter() {
    if (!mapCenter) return;
    setFocusPos(null);
    onChange(mapCenter);
    toast.success("Xaritadagi joy belgilandi");
  }

  async function searchAddress() {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      );
      const data = (await res.json()) as Array<{ lat: string; lon: string }>;
      if (data[0]) {
        const pos = { lat: Number(data[0].lat), lng: Number(data[0].lon) };
        setFocusPos(pos);
        onChange(pos);
      } else toast.error("Topilmadi");
    } catch {
      toast.error("Qidiruv xato");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex">
        <div className="relative min-w-0 sm:flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-9 text-sm"
            placeholder="Manzil yoki joy nomi..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void searchAddress();
              }
            }}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void searchAddress()}
          disabled={searching}
        >
          Qidir
        </Button>
        <Button
          className="col-span-1"
          type="button"
          size="sm"
          variant="outline"
          onClick={showMyLocation}
          disabled={locating}
        >
          <LocateFixed className="h-4 w-4" />
          Joyim
        </Button>
        <Button
          className="col-span-1"
          type="button"
          size="sm"
          variant="default"
          onClick={pickCurrent}
          disabled={locating}
        >
          <Crosshair className="h-4 w-4" />
          Joriy
        </Button>
      </div>
      <div className="relative rounded-md overflow-hidden border" style={{ height }}>
        <MapContainer
          className="z-0"
          center={[center.lat, center.lng]}
          zoom={value ? 16 : 12}
          style={{ height: "100%", width: "100%", touchAction: "none" }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />
          <ClickHandler
            onPick={(p) => {
              setFocusPos(null);
              onChange(p);
            }}
          />
          <MapSync pos={focusPos ?? value} onCenterChange={handleCenterChange} />
          {myPos && (
            <CircleMarker
              center={[myPos.lat, myPos.lng]}
              radius={8}
              pathOptions={{
                color: "var(--primary)",
                fillColor: "var(--primary)",
                fillOpacity: 0.9,
                weight: 2,
              }}
            >
              <Popup>Siz shu yerdasiz</Popup>
            </CircleMarker>
          )}
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              draggable
              icon={selectedIcon}
              ref={(r) => {
                markerRef.current = r;
              }}
              eventHandlers={{
                dragend: () => {
                  const m = markerRef.current;
                  if (m) {
                    const ll = m.getLatLng();
                    setFocusPos(null);
                    onChange({ lat: ll.lat, lng: ll.lng });
                  }
                },
              }}
            />
          )}
        </MapContainer>
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[400] -translate-x-1/2 -translate-y-full text-primary drop-shadow">
          <MapPin className="h-8 w-8 fill-background" />
        </div>
        <Button
          type="button"
          size="sm"
          className="absolute bottom-3 left-1/2 z-[401] -translate-x-1/2 shadow-lg"
          onClick={pickMapCenter}
        >
          <Check className="h-4 w-4" /> Markazni belgilash
        </Button>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" /> Xaritani suring yoki ustiga bosing
        </span>
        {value && (
          <span className="font-mono">
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </span>
        )}
      </div>
    </div>
  );
}
