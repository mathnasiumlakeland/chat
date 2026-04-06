const TOKENISH_PARTS = /[\p{L}\p{N}_]+|[^\s]/gu;

export function estimateDisplayedTokenCount(text: string): number {
	if (!text.trim()) {
		return 0;
	}

	return text.match(TOKENISH_PARTS)?.length ?? 0;
}

export function calculateTokensPerSecond(tokensDecoded: number, elapsedMs: number): number {
	if (tokensDecoded <= 0 || elapsedMs <= 0) {
		return 0;
	}

	return tokensDecoded / (elapsedMs / 1000);
}
