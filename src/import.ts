/** Parse `shroudbridge://import#<base64(json)>` payloads from the 1Claw dashboard setup page. */

export interface ShroudBridgeImportPayload {
    agentKey: string;
    apiUrl?: string;
    shroudUrl?: string;
    port?: number;
    /** SEC-002: Set when apiUrl or shroudUrl points to a non-allowlisted host. */
    untrustedHost?: boolean;
}

const ALLOWED_HOSTS = new Set([
    "api.1claw.xyz",
    "shroud.1claw.xyz",
    "localhost",
    "127.0.0.1",
]);

function isAllowedUrl(urlStr: string): boolean {
    try {
        const u = new URL(urlStr);
        return ALLOWED_HOSTS.has(u.hostname);
    } catch {
        return false;
    }
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

        const apiUrl = typeof o.apiUrl === "string" ? o.apiUrl : undefined;
        const shroudUrl = typeof o.shroudUrl === "string" ? o.shroudUrl : undefined;

        const untrustedHost =
            (apiUrl != null && !isAllowedUrl(apiUrl)) ||
            (shroudUrl != null && !isAllowedUrl(shroudUrl));

        return {
            agentKey,
            apiUrl,
            shroudUrl,
            port: typeof o.port === "number" ? o.port : undefined,
            untrustedHost: untrustedHost || undefined,
        };
    } catch {
        return null;
    }
}
