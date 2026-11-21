import { useEffect, useRef, useState } from "react";

export function useFileSearch() {
  const [mode, setMode] = useState<"name" | "content">("name");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [dFilter, setDFilter] = useState("");
  const [dQuery, setDQuery] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDFilter(filter), 200);
    return () => clearTimeout(h);
  }, [filter]);
  useEffect(() => {
    const h = setTimeout(() => setDQuery(query), 300);
    return () => clearTimeout(h);
  }, [query]);
  const searchBox = useRef<HTMLDivElement>(null);
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    searchBox.current?.querySelector("input")?.focus();
  }, [mode]);
  const showFind = mode === "name" && dFilter.trim().length > 0;

  return { mode, setMode, filter, setFilter, query, setQuery, dFilter, dQuery, searchBox, showFind };
}
