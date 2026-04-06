export function formatGigabytes(bytes: number): string {
	return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function trimConversationTitle(text: string, maxLength: number = 60): string {
	const compact = text.replace(/\s+/g, ' ').trim();

	if (!compact) {
		return 'New chat';
	}

	return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

export function formatConversationDate(timestamp: number): string {
	const formatter = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	return formatter.format(timestamp);
}
