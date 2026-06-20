import { useEffect } from "react";

const SITE = "inochi";

export function useTitle(section?: string) {
  useEffect(() => {
    document.title = section ? `${section} · ${SITE}` : SITE;
  }, [section]);
}
