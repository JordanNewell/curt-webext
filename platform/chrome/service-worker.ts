/**
 * MV3 service worker. The popup performs the primary export path itself
 * (extract -> serialize -> blob URL -> chrome.downloads.download). This
 * worker provides a data-URL download fallback for callers without a DOM
 * (e.g. a future keyboard command) plus install-time logging.
 */

interface DownloadRequest {
	type?: unknown;
	body?: unknown;
	filename?: unknown;
}

const isDownloadRequest = (msg: unknown): msg is DownloadRequest =>
	typeof msg === "object" &&
	msg !== null &&
	(msg as DownloadRequest).type === "curt:download" &&
	typeof (msg as DownloadRequest).body === "string" &&
	typeof (msg as DownloadRequest).filename === "string";

chrome.runtime.onInstalled.addListener((details) => {
	if (details.reason === "install") {
		console.info("curt-webext installed: active adapters = chatgpt.com");
	}
});

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
	if (!isDownloadRequest(msg)) return; // not ours; let other listeners answer
	const body = msg.body as string;
	const filename = msg.filename as string;
	// Service workers have no URL.createObjectURL; data: URLs are the
	// background-safe transport for chrome.downloads.download.
	const url = `data:text/plain;charset=utf-8,${encodeURIComponent(body)}`;
	chrome.downloads
		.download({ url, filename, saveAs: false })
		.then((id) => sendResponse({ ok: true, downloadId: id }))
		.catch((err: unknown) =>
			sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
		);
	return true; // async sendResponse
});
