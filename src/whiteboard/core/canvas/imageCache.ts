// Decodes image data URLs once and caches the HTMLImageElement. When a fresh
// image finishes loading, the registered redraw handler marks the scene dirty
// so the render loop paints it.

let redraw: () => void = () => {};
export function setImageRedrawHandler(fn: () => void): void {
  redraw = fn;
}

const cache = new Map<string, HTMLImageElement>();
export function clearImageCache():void {for(const img of cache.values())img.onload=null;cache.clear();redraw=()=>{}}

/** Returns the decoded image, or null while it is still loading. */
export function getImage(src: string): HTMLImageElement | null {
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => redraw();
    img.src = src;
    cache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}
