import type { Root as HastRoot } from 'hast';
import visit from 'unist-util-visit';
import type { Element } from 'hast';
import type { DatabaseMessageExtra, DatabaseMessageExtraImageFile } from '$lib/types/database';
import { AttachmentType, UrlProtocol } from '$lib/enums';

const visitNode = visit as unknown as (...args: unknown[]) => void;

/**
 * Rehype plugin to resolve attachment image sources.
 * Converts attachment names (e.g., "mcp-attachment-xxx.png") to base64 data URLs.
 */
export function rehypeResolveAttachmentImages(options: { attachments?: DatabaseMessageExtra[] }) {
	return (tree: HastRoot) => {
		visitNode(tree, 'element', (node: Element) => {
			if (node.tagName === 'img' && node.properties?.src) {
				const src = String(node.properties.src);

				// Skip data URLs and external URLs
				if (src.startsWith(UrlProtocol.DATA) || src.startsWith(UrlProtocol.HTTP)) {
					return;
				}

				// Find matching attachment
				const attachment = options.attachments?.find(
					(a): a is DatabaseMessageExtraImageFile =>
						a.type === AttachmentType.IMAGE && a.name === src
				);

				// Replace with base64 URL if found
				if (attachment?.base64Url) {
					node.properties.src = attachment.base64Url;
				}
			}
		});
	};
}
