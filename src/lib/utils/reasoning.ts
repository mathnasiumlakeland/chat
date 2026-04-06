const LEADING_THINK_BLOCK = /^\s*<think>\s*([\s\S]*?)\s*<\/think>\s*/;
const OPEN_THINK_BLOCK = /^\s*<think>\s*([\s\S]*)$/;

export function splitLeadingThinkBlock(raw: string): {
	content: string;
	thinking?: string;
} {
	if (!raw) {
		return { content: '' };
	}

	const closedMatch = raw.match(LEADING_THINK_BLOCK);
	if (closedMatch) {
		const thinking = closedMatch[1].trim();
		return {
			content: raw.slice(closedMatch[0].length).trimStart(),
			...(thinking ? { thinking } : {})
		};
	}

	const openMatch = raw.match(OPEN_THINK_BLOCK);
	if (openMatch) {
		const thinking = openMatch[1].trimStart();
		return {
			content: '',
			...(thinking ? { thinking } : {})
		};
	}

	return {
		content: raw
	};
}
