import { headers } from "next/headers";
import { resolveOrigin } from "./site";

export async function currentOrigin(): Promise<string> {
  const h = await headers();
  return resolveOrigin({
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
    forwardedProto: h.get("x-forwarded-proto"),
  });
}
