/**
 * Adapter registry: metadata only. Runtime extraction lives in each
 * adapter's content script (registered in the platform manifest); the
 * popup consults this list to show per-site adapter status without
 * pulling content-script code into the extension page.
 */

export interface AdapterInfo {
	id: string;
	label: string;
	hostPatterns: string[];
}

export const ADAPTERS: readonly AdapterInfo[] = [
	{
		id: "chatgpt",
		label: "ChatGPT",
		hostPatterns: ["chatgpt.com"],
	},
];

/** True when `url` is served by one of the registered adapters. */
export function adapterForUrl(url: string | undefined): AdapterInfo | undefined {
	if (!url) return undefined;
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		return undefined;
	}
	return ADAPTERS.find((a) => a.hostPatterns.includes(host));
}
