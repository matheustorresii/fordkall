// Lazy access to the bundled SVG icon libraries (official AWS icons + dev-tool
// logos). Each library's SVG data lives in its own chunk that is dynamically
// imported the first time one of its icons needs to render, keeping the big
// string blobs out of the main bundle.
//
// Element iconIds use a "<lib>:<id>" scheme, e.g. "aws-svc:ec2" or "dev:redis".

type SvgMap = Record<string, string>;

const loaders: Record<string, () => Promise<SvgMap>> = {
  "aws-svc": () => import("./awsIconData").then((m) => m.AWS_SVG),
  dev: () => import("./devIconData").then((m) => m.DEV_SVG),
};

const maps: Record<string, SvgMap | undefined> = {};
const loading: Record<string, boolean> = {};
const uriCache = new Map<string, string>();
let onReady: () => void = () => {};

/** Registered by the canvas so a finished load triggers a repaint. */
export function setSvgReadyHandler(fn: () => void): void {
  onReady = fn;
}

/** True if an iconId belongs to a known SVG library (aws-svc:/dev:). */
export function isSvgIcon(iconId: string): boolean {
  const i = iconId.indexOf(":");
  return i > 0 && iconId.slice(0, i) in loaders;
}

/** data: URI for a "<lib>:<id>" icon, or null while its data chunk loads. */
export function svgIconDataUri(iconId: string): string | null {
  const i = iconId.indexOf(":");
  if (i <= 0) return null;
  const lib = iconId.slice(0, i);
  const id = iconId.slice(i + 1);
  const loader = loaders[lib];
  if (!loader) return null;
  const map = maps[lib];
  if (!map) {
    if (!loading[lib]) {
      loading[lib] = true;
      void loader().then((m) => {
        maps[lib] = m;
        loading[lib] = false;
        onReady();
      });
    }
    return null;
  }
  const raw = map[id];
  if (!raw) return null;
  let uri = uriCache.get(iconId);
  if (!uri) {
    uri = "data:image/svg+xml," + encodeURIComponent(raw);
    uriCache.set(iconId, uri);
  }
  return uri;
}
