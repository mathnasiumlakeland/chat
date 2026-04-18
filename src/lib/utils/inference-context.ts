import {
	ATTACHMENT_LABEL_FILE,
	ATTACHMENT_LABEL_MCP_PROMPT,
	ATTACHMENT_LABEL_MCP_RESOURCE,
	ATTACHMENT_LABEL_PDF_FILE
} from '$lib/constants';
import { AttachmentType } from '$lib/enums';
import type { DatabaseMessageExtra } from '$lib/types/database';
import { formatAttachmentText } from './formatters';

const IMAGE_ATTACHMENT_PLACEHOLDER = '[Image attachment omitted in this text-only runtime]';
const AUDIO_ATTACHMENT_PLACEHOLDER = '[Audio attachment omitted in this text-only runtime]';

function formatExtraForInference(extra: DatabaseMessageExtra): string | null {
	switch (extra.type) {
		case AttachmentType.TEXT:
		case AttachmentType.LEGACY_CONTEXT:
			return formatAttachmentText(ATTACHMENT_LABEL_FILE, extra.name, extra.content);
		case AttachmentType.PDF:
			return formatAttachmentText(ATTACHMENT_LABEL_PDF_FILE, extra.name, extra.content);
		case AttachmentType.MCP_PROMPT:
			return formatAttachmentText(
				ATTACHMENT_LABEL_MCP_PROMPT,
				extra.name,
				extra.content,
				`${extra.serverName} / ${extra.promptName}`
			);
		case AttachmentType.MCP_RESOURCE:
			return formatAttachmentText(
				ATTACHMENT_LABEL_MCP_RESOURCE,
				extra.name,
				extra.content,
				`${extra.serverName} / ${extra.uri}`
			);
		case AttachmentType.IMAGE:
			return formatAttachmentText('Image', extra.name, IMAGE_ATTACHMENT_PLACEHOLDER);
		case AttachmentType.AUDIO:
			return formatAttachmentText('Audio', extra.name, AUDIO_ATTACHMENT_PLACEHOLDER);
		default:
			return null;
	}
}

export function appendExtrasToInferenceContent(
	content: string,
	extras: DatabaseMessageExtra[] | undefined
): string {
	if (!extras || extras.length === 0) {
		return content;
	}

	const serializedExtras = extras
		.map((extra) => formatExtraForInference(extra))
		.filter((extra): extra is string => Boolean(extra))
		.join('');

	if (!serializedExtras) {
		return content;
	}

	if (!content.trim()) {
		return serializedExtras.trimStart();
	}

	return `${content}${serializedExtras}`;
}
