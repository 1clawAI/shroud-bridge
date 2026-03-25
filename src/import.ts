/** Parse `shroudbridge://import#<base64(json)>` payloads from the 1Claw dashboard setup page. */

export interface ShroudBridgeImportPayload {
    agentKey: string;
    apiUrl?: string;
    shroudUrl?: string;
    port?: number;
}

export function parseShroudBridgeImport(url: string): ShroudBridgeImportPayload | null {
    try {
        const normalized = url.trim().replace(/^shroudbridge:/i, "https:");
        const u = new URL(normalized);
        let payload = "";
        if (u.hash && u.hash.length > 1) {
            payload = decodeURIComponent(u.hash.slice(1));
        } else {
            payload = u.searchParams.get("p") || "";
        }
        if (!payload) return null;
        const bin = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
        const o = JSON.parse(bin) as Record<string, unknown>;
        const agentKey = typeof o.agentKey === "string" ? o.agentKey : "";
        if (!agentKey) return null;
        return {
            agentKey,
            apiUrl: typeof o.apiUrl === "string" ? o.apiUrl : undefined,
            shroudUrl: typeof o.shroudUrl === "string" ? o.shroudUrl : undefined,
            port: typeof o.port === "number" ? o.port : undefined,
        };
    } catch {
        return null;
    }
}
