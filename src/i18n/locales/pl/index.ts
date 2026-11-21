const files = import.meta.glob<Record<string, string>>(["./*.json", "!./*.todo.json"], { eager: true, import: "default" });
const help = import.meta.glob<unknown>("./help/*.json", { eager: true, import: "default" });

export const extras: Record<string, unknown> = Object.fromEntries(Object.entries(help).map(([p, v]) => [p.slice(7, -5), v]));

export default Object.assign({}, ...Object.values(files)) as Record<string, string>;
