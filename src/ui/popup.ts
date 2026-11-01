/**
 * Popup UI: adapter status for the active tab + "Export .curt" button.
 * Export flow: ask the page's content script for the model, serialize it
 * here (extension page = ES module context), then hand the blob to
 * chrome.downloads — a background download that survives popup close.
 */

import { adapterForUrl } from "../adapters/registry.js";
import { curtFilename } from "../core/filename.js";
import { CURT_GENERATOR_PREFIX, serializeCurt } from "../core/serialize.js";
import type { ExtractResult } from "../core/types.js";

const isExtractResult = (v: unknown): v is ExtractResult =>
	typeof v === "object" &&
	v !== null &&
	typeof (v as ExtractResult).conversation === "object" &&
	Array.isArray((v as ExtractResult).conversation?.messages);

function setStatus(text: string, isError = false): void {
	const el = document.getElementById("status");
	if (el) {
		el.textContent = text;
		el.classList.toggle("error", isError);
	}
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab;
}

async function exportActiveTab(tab: chrome.tabs.Tab): Promise<void> {
	if (tab.id === undefined) {
		setStatus("No active tab.", true);
		return;
	}
	let raw: unknown;
	try {
		raw = await chrome.tabs.sendMessage(tab.id, { type: "curt:extract" });
	} catch {
		setStatus("Adapter not reachable — reload the ChatGPT tab and retry.", true);
		return;
	}
	if (!isExtractResult(raw)) {
		setStatus("Adapter returned an unexpected payload.", true);
		return;
	}
	const result = raw;
	const { conversation } = result;
	if (conversation.messages.length === 0) {
		const probe = result.probe
			? " probe: " +
			  Object.entries(result.probe)
					.filter(([, n]) => typeof n === "number" ? n > 0 : n.length > 0)
					.map(([sel, n]) => `${sel}=${n}`)
					.join(" ") || "all-zero"
			: "";
		setStatus(
			`No messages found${result.skippedUnparseable ? ` (${result.skippedUnparseable} node(s) skipped)` : ""}.${probe} @ ${result.sourceUrl}`,
			true,
		);
		return;
	}

	let body: string;
	let filename: string;
	try {
		const generator = `${CURT_GENERATOR_PREFIX}@${chrome.runtime.getManifest().version}`;
		body = serializeCurt(conversation, generator);
		filename = curtFilename(conversation);
	} catch (err) {
		setStatus(`Serialization failed: ${err instanceof Error ? err.message : "unknown"}`, true);
		return;
	}

	try {
		const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
		const downloadId = await chrome.downloads.download({ url, filename, saveAs: false });
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
		setStatus(
			`Exported ${conversation.messages.length} message(s)` +
				(result.skippedUnparseable ? `, ${result.skippedUnparseable} skipped` : "") +
				` -> ${filename} (download #${downloadId})`,
		);
	} catch (err) {
		setStatus(`Download failed: ${err instanceof Error ? err.message : "unknown"}`, true);
	}
}

async function init(): Promise<void> {
	const tab = await activeTab();
	const adapter = adapterForUrl(tab?.url);
	const statusEl = document.getElementById("status");
	if (adapter && statusEl) {
		statusEl.textContent = `${adapter.label} adapter ready.`;
	}

	const button = document.getElementById("export");
	if (button && tab) {
		button.addEventListener("click", () => {
			void exportActiveTab(tab);
		});
	} else if (button) {
		(button as HTMLButtonElement).disabled = true;
	}
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
	void init();
}
