import { toolbarTitle, type ToolbarMetadata } from "../../domain/toolbar-metadata.js";
import type { Toolbar } from "../../application/ports.js";
import { getStation, toolbarIconPaths, type StationId } from "../../domain/stations.js";

export class ChromeToolbar implements Toolbar {
  private current: StationId | undefined;
  private queue: Promise<void> = Promise.resolve();

  showMetadata(metadata: ToolbarMetadata): Promise<void> {
    this.queue = this.queue.catch(() => {}).then(async () => {
      // Una respuesta de otra señal nunca sustituye el tooltip de la seleccionada.
      if (this.current !== metadata.stationId) return;
      await chrome.action.setTitle({ title: toolbarTitle(metadata, Date.now()) });
    });
    return this.queue;
  }

  showStation(id: StationId): Promise<void> {
    // Serializar actualizaciones impide que una llamada lenta deje un logo antiguo.
    this.queue = this.queue.catch(() => {}).then(async () => {
      // Limpiar también el badge de versiones anteriores, sin tapar el logo.
      await chrome.action.setBadgeText({ text: "" });
      if (this.current === id) return;
      // setIcon resuelve rutas relativas desde el worker (build/entries/).
      // Usar URLs de la raíz de la extensión, independientemente del entrypoint.
      const path = Object.fromEntries(Object.entries(toolbarIconPaths(id))
        .map(([size, file]) => [size, chrome.runtime.getURL(file)]));
      await Promise.all([
        chrome.action.setIcon({ path }),
        chrome.action.setTitle({ title: `RNE · ${getStation(id)!.name}` })
      ]);
      this.current = id;
    });
    return this.queue;
  }
}
