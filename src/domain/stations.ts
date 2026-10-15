export const STATIONS = [
  { id: "rne1", name: "Radio Nacional", short: "RNE", description: "Actualidad, cultura y compañía", color: "#ef6848", logo: "assets/logos/radio-nacional.svg" },
  { id: "rner3", name: "Radio 3", short: "R3", description: "Música y cultura alternativa", color: "#e8bc51", logo: "assets/logos/radio-3.svg" },
  { id: "rner4", name: "Ràdio 4", short: "R4", description: "Informació i cultura en català", color: "#bc9af7", logo: "assets/logos/radio-4.svg" },
  { id: "rnerc", name: "Radio Clásica", short: "RC", description: "Clásica, jazz y músicas del mundo", color: "#8bc9b6", logo: "assets/logos/radio-clasica.svg" },
  { id: "rne5", name: "Radio 5", short: "R5", description: "Información y noticias", color: "#7eb7ef", logo: "assets/logos/radio-5.svg" },
  { id: "rneree", name: "Radio Exterior", short: "RE", description: "Una ventana de España al mundo", color: "#e89fbd", logo: "assets/logos/radio-exterior.svg" }
] as const;

export type Station = (typeof STATIONS)[number];
export type StationId = Station["id"];
export const DEFAULT_STATION = STATIONS[0];

export function getStation(id: unknown): Station | undefined {
  return STATIONS.find((station) => station.id === id);
}

export function isStationId(id: unknown): id is StationId {
  return getStation(id) !== undefined;
}

export function toolbarIconPaths(id: unknown): Record<number, string> {
  const station = getStation(id) ?? DEFAULT_STATION;
  return Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/${station.id}-${size}.png`]));
}

export function streamUrl(id: StationId): string {
  if (!isStationId(id)) throw new Error("Emisora no válida");
  // No guardar las redirecciones con tokens temporales del distribuidor.
  return `https://dispatcher.rndfnk.com/crtve/${id}/main/mp3/high`;
}
