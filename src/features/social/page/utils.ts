/** Code aus Eingabe: „K7QX2M9P“, „https://vibe.axolite.app/p/K7QX2M9P“ (auch alte Adresse) oder „vibelauncher://pack/K7QX2M9P“. */
export function parsePackCode(v: string): string {
  const m = v.trim().match(/(?:\/p\/|pack\/)?([A-Za-z0-9]{4,16})\/?$/);
  return m ? m[1].toUpperCase() : "";
}
